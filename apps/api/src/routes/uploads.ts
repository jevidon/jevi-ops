import type { FastifyPluginAsync } from 'fastify';
import { uploadImage, isBunnyConfigured, extensionForImage } from '../lib/bunny.js';

// POST /api/uploads/image — multipart image upload, server-proxied to
// Bunny Storage. Returns the StoredAttachment record the client then
// appends to a note/journal's attachments array via the regular PATCH.
//
// Why server-proxied (vs. browser-direct upload):
//   - The Bunny access key never touches the browser.
//   - File-type + size validation happens server-side (can't be bypassed
//     by a malicious client).
//   - One auth check (requireAuth) covers it.
//
// Size cap: the multipart plugin is already configured for 25 MB
// (matches Whisper's audio limit). Mobile photos clear that comfortably
// — newer iPhones can produce 8-12 MB JPEGs but not 25+.

// Allowed MIME types. We trust the browser-reported value; the
// extension is derived from it. Anything outside this whitelist gets
// rejected before hitting Bunny.
const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
  'image/gif', 'image/heic', 'image/heif',
]);

const ALLOWED_PREFIXES = new Set(['notes', 'journal', 'other']);

export const uploadRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  app.post<{ Querystring: { prefix?: string; alt?: string; title_hint?: string } }>(
    '/api/uploads/image',
    async (req, reply) => {
      if (!isBunnyConfigured()) {
        return reply.code(503).send({
          error: 'bunny_not_configured',
          reason: 'Set BUNNY_STORAGE_ZONE, BUNNY_STORAGE_ACCESS_KEY, and BUNNY_CDN_HOST in API .env.',
        });
      }
      if (!req.isMultipart()) {
        return reply.code(400).send({ error: 'expected_multipart' });
      }

      // We need to read multipart parts that are NOT the file (so we can
      // capture title_hint / prefix as form fields), so use parts() and
      // walk through manually instead of req.file(). The order doesn't
      // matter; we collect into vars and validate at the end.
      let buffer: Buffer | null = null;
      let contentType = '';
      let prefix: 'notes' | 'journal' | 'other' =
        ALLOWED_PREFIXES.has((req.query.prefix ?? '').toString())
          ? ((req.query.prefix ?? 'other').toString() as 'notes' | 'journal' | 'other')
          : 'other';
      let alt: string | null = typeof req.query.alt === 'string' ? req.query.alt : null;
      let titleHint: string | null =
        typeof req.query.title_hint === 'string' ? req.query.title_hint : null;

      try {
        for await (const part of req.parts()) {
          if (part.type === 'file') {
            const mt = (part.mimetype || '').toLowerCase();
            if (!ALLOWED_MIME.has(mt) || !extensionForImage(mt)) {
              return reply.code(400).send({
                error: 'unsupported_content_type',
                got: mt,
                allowed: Array.from(ALLOWED_MIME),
              });
            }
            buffer = await part.toBuffer();
            contentType = mt;
          } else {
            // Plain text field. The form posts `prefix`, `title_hint`,
            // `alt` here so the client can use a single FormData call
            // and avoid query-string escaping for free-form text.
            const value = String(part.value ?? '');
            if (part.fieldname === 'prefix' && ALLOWED_PREFIXES.has(value)) {
              prefix = value as 'notes' | 'journal' | 'other';
            } else if (part.fieldname === 'title_hint') {
              titleHint = value;
            } else if (part.fieldname === 'alt') {
              alt = value;
            }
          }
        }
      } catch (err) {
        return reply.code(413).send({ error: 'file_too_large', message: (err as Error).message });
      }

      if (!buffer || buffer.length === 0) {
        return reply.code(400).send({ error: 'empty_file' });
      }

      try {
        const stored = await uploadImage({
          bytes: buffer,
          contentType,
          prefix,
          alt,
          titleHint,
        });
        req.log.info(
          { user_id: req.user!.id, storage_path: stored.storage_path, bytes: buffer.length },
          'image uploaded to bunny',
        );
        return reply.code(201).send(stored);
      } catch (err) {
        req.log.error({ err }, 'bunny upload failed');
        return reply.code(502).send({
          error: 'upload_failed',
          message: err instanceof Error ? err.message : 'unknown',
        });
      }
    },
  );
};
