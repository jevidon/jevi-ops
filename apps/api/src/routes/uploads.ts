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

  app.post<{ Querystring: { prefix?: string; alt?: string } }>(
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

      const fileData = await req.file();
      if (!fileData) {
        return reply.code(400).send({ error: 'no_file_uploaded' });
      }

      const contentType = (fileData.mimetype || '').toLowerCase();
      if (!ALLOWED_MIME.has(contentType) || !extensionForImage(contentType)) {
        return reply.code(400).send({
          error: 'unsupported_content_type',
          got: contentType,
          allowed: Array.from(ALLOWED_MIME),
        });
      }

      // toBuffer drains the multipart stream. @fastify/multipart's
      // limits.fileSize cap throws if the file is too large; we let
      // that surface naturally.
      let buffer: Buffer;
      try {
        buffer = await fileData.toBuffer();
      } catch (err) {
        return reply.code(413).send({ error: 'file_too_large', message: (err as Error).message });
      }
      if (buffer.length === 0) {
        return reply.code(400).send({ error: 'empty_file' });
      }

      // Logical bucket (`notes`, `journal`, `other`) — drives the
      // storage path prefix so files are organized by parent kind.
      const rawPrefix = (req.query.prefix ?? 'other').toString();
      const prefix = ALLOWED_PREFIXES.has(rawPrefix)
        ? (rawPrefix as 'notes' | 'journal' | 'other')
        : 'other';
      const alt = typeof req.query.alt === 'string' ? req.query.alt : null;

      try {
        const stored = await uploadImage({
          bytes: buffer,
          contentType,
          prefix,
          alt,
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
