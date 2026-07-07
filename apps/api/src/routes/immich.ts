import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  assetsForDate,
  fetchOriginal,
  fetchThumbnail,
  isImmichConfigured,
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

      const added = [];
      const failed: string[] = [];
      for (const assetId of parsed.data.asset_ids) {
        try {
          const { bytes, contentType } = await fetchOriginal(assetId);
          const stored = await uploadImage({
            bytes,
            contentType,
            prefix: 'journal',
            titleHint: `immich ${entry.entry_date}`,
          });
          added.push(stored);
        } catch (err) {
          req.log.warn({ err, assetId }, 'immich attach failed for asset');
          failed.push(assetId);
        }
      }

      const merged = [...(entry.attachments ?? []), ...added];
      if (added.length > 0) {
        await db
          .update(journal_entries)
          .set({ attachments: merged })
          .where(eq(journal_entries.id, entry.id));
      }

      // Return the full post-attach list so the edit form can replace its
      // local attachment state without a refetch (avoids the stale-state
      // overwrite on the next manual save).
      return reply.code(added.length > 0 ? 200 : 502).send({
        attached: added,
        attachments: merged,
        failed,
      });
    },
  );
};
