import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  assetsForDate,
  fetchAssetInfo,
  fetchOriginal,
  fetchThumbnail,
  isImmichConfigured,
  isWebSafeImage,
} from '../lib/immich.js';
import { getDb } from '../lib/db.js';
import { journal_entries } from '../db/schema.js';
import { isStorageConfigured, uploadImage } from '../lib/storage.js';

// Immich ↔ journal integration (Phase H).
//
//   GET  /api/library/journal/immich-candidates?date=YYYY-MM-DD
//        → photos taken that local day, with proxied thumbnail URLs
//   GET  /api/immich/thumb/:assetId
//        → thumbnail bytes (the browser can't carry Immich's API key)
//   POST /api/library/journal/:id/attach-immich { asset_ids }
//        → copies the originals into UPLOADS_DIR and appends them to the
//          entry's attachments jsonb. Copy (not hotlink) so journal
//          history survives Immich re-indexes/deletions.

const AttachSchema = z.object({
  asset_ids: z.array(z.string().min(1)).min(1).max(20),
  // When the edit form's committed date differs from the saved entry_date,
  // the attach also persists it ("attach saves date") — same UPDATE, atomic.
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const immichRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  app.get<{ Querystring: { date?: string } }>(
    '/api/library/journal/immich-candidates',
    async (req, reply) => {
      if (!(await isImmichConfigured())) {
        return reply.code(503).send({ error: 'immich_not_configured' });
      }
      const date = (req.query.date ?? '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return reply.code(400).send({ error: 'invalid_date', expected: 'YYYY-MM-DD' });
      }
      try {
        const assets = await assetsForDate(date);
        return {
          date,
          candidates: assets.map((a) => ({
            id: a.id,
            taken_at: a.taken_at,
            thumb_url: `/api/immich/thumb/${a.id}`,
          })),
        };
      } catch (err) {
        req.log.warn({ err }, 'immich candidates fetch failed');
        return reply.code(502).send({
          error: 'immich_unreachable',
          message: err instanceof Error ? err.message : 'unknown',
        });
      }
    },
  );

  app.get<{ Params: { assetId: string } }>('/api/immich/thumb/:assetId', async (req, reply) => {
    if (!(await isImmichConfigured())) {
      return reply.code(503).send({ error: 'immich_not_configured' });
    }
    try {
      const { bytes, contentType } = await fetchThumbnail(req.params.assetId);
      // Thumbnails are immutable per asset id — let the browser cache them.
      reply.header('Cache-Control', 'private, max-age=86400');
      reply.type(contentType);
      return reply.send(bytes);
    } catch (err) {
      req.log.warn({ err, assetId: req.params.assetId }, 'immich thumb fetch failed');
      return reply.code(502).send({ error: 'immich_unreachable' });
    }
  });

  app.post<{ Params: { id: string } }>(
    '/api/library/journal/:id/attach-immich',
    async (req, reply) => {
      if (!(await isImmichConfigured())) {
        return reply.code(503).send({ error: 'immich_not_configured' });
      }
      if (!isStorageConfigured()) {
        return reply.code(503).send({ error: 'storage_not_configured' });
      }
      const parsed = AttachSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
      }

      const db = getDb();
      const entry = await db.query.journal_entries.findFirst({
        columns: { id: true, attachments: true, entry_date: true },
        where: eq(journal_entries.id, req.params.id),
      });
      if (!entry) return reply.code(404).send({ error: 'not_found' });

      // Dedupe against assets already copied into this entry (stamped with
      // immich_asset_id at attach time). Legacy attachments predate the
      // stamp and can't be recognized — accepted for a single-user app.
      const alreadyStamped = new Set(
        (entry.attachments ?? []).map((a) => a.immich_asset_id).filter(Boolean),
      );

      const added = [];
      const failed: string[] = [];
      const already_attached: string[] = [];
      for (const assetId of parsed.data.asset_ids) {
        if (alreadyStamped.has(assetId)) {
          already_attached.push(assetId);
          continue;
        }
        try {
          let { bytes, contentType } = await fetchOriginal(assetId);
          // iPhone originals are HEIC — browsers other than Safari render
          // them as broken images. Store Immich's preview JPEG instead for
          // anything a browser can't display.
          if (!isWebSafeImage(contentType)) {
            ({ bytes, contentType } = await fetchThumbnail(assetId));
          }
          const stored = await uploadImage({
            bytes,
            contentType,
            prefix: 'journal',
            titleHint: `immich ${entry.entry_date}`,
          });
          // The preview fallback strips EXIF, so uploadImage finds no
          // date/GPS — backfill from Immich's own metadata (best-effort).
          if (!stored.taken_at || !stored.gps) {
            const info = await fetchAssetInfo(assetId).catch(() => null);
            if (info) {
              stored.taken_at = stored.taken_at ?? info.taken_at;
              stored.gps = stored.gps ?? info.gps;
              stored.location = stored.location ?? info.location;
            }
          }
          added.push({ ...stored, immich_asset_id: assetId });
        } catch (err) {
          req.log.warn({ err, assetId }, 'immich attach failed for asset');
          failed.push(assetId);
        }
      }

      const merged = [...(entry.attachments ?? []), ...added];
      // entry_date persists even when every download failed — it mirrors the
      // user's committed date field, which shouldn't hinge on Immich health.
      const dateChanged =
        parsed.data.entry_date !== undefined && parsed.data.entry_date !== entry.entry_date;
      if (added.length > 0 || dateChanged) {
        await db
          .update(journal_entries)
          .set({
            ...(added.length > 0 ? { attachments: merged } : {}),
            ...(dateChanged ? { entry_date: parsed.data.entry_date } : {}),
          })
          .where(eq(journal_entries.id, entry.id));
      }

      // Return the full post-attach list so the edit form can replace its
      // local attachment state without a refetch (avoids the stale-state
      // overwrite on the next manual save). 502 only when nothing at all
      // succeeded — an all-duplicates request is a 200 no-op, not an error.
      const anySuccess = added.length > 0 || already_attached.length > 0 || dateChanged;
      return reply.code(anySuccess ? 200 : 502).send({
        attached: added,
        attachments: merged,
        failed,
        already_attached,
        entry_date: dateChanged ? parsed.data.entry_date : entry.entry_date,
      });
    },
  );
};
