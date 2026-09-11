import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { z, ZodError } from 'zod';
import { CreateSourceNoteSchema, SourceSubjectSchema } from '@jevi-ops/shared';
import { source_candidates, source_documents, source_links } from '../db/schema.js';
import { getDb } from '../lib/db.js';
import { requireOwnerSession } from '../lib/owner-session.js';
import { getAppSettings } from '../lib/app-settings.js';
import { todayInTz } from '../lib/tz.js';
import { MaintenanceConflict, MaintenanceNeedsDetails } from '../lib/maintenance.js';
import { ReadingRejected } from '../lib/meter-readings.js';
import { VisitError } from '../lib/visits.js';
import { cleanupPrivateSources, getSourceLink, lockSourceSubject, readSourceContent, retainSource, sourceDescriptor, SourceError, sourceSubjectWhere, unlinkSource } from '../lib/private-sources.js';
import { acceptSourceCandidate, createSourceCandidate, updateSourceCandidate } from '../lib/source-imports.js';

const Id = z.string().uuid();
export const sourceRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);
  app.addHook('preHandler', requireOwnerSession);
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof SourceError) return reply.code(err.status).send({ error: err.code, message: err.message });
    if (err instanceof ZodError) return reply.code(400).send({ error: 'invalid_payload', details: err.flatten().fieldErrors });
    if (err instanceof MaintenanceConflict) return reply.code(409).send({ error: err.code, message: err.message });
    if (err instanceof MaintenanceNeedsDetails || err instanceof ReadingRejected || err instanceof VisitError) return reply.code(400).send({ error: 'invalid_history_evidence', message: err.message });
    req.log.error({ code: (err as { code?: string }).code }, 'source operation failed');
    return reply.code(500).send({ error: 'source_operation_failed' });
  });

  app.get<{ Querystring: { asset_id?: string; session_id?: string } }>('/api/sources', async (req) => {
    const subject = SourceSubjectSchema.parse(req.query);
    return getDb().transaction(async (tx) => {
      await lockSourceSubject(tx, subject, req.user!.id);
      const rows = await tx.select({ link: source_links, document: source_documents }).from(source_links)
        .innerJoin(source_documents, eq(source_links.source_id, source_documents.id)).where(sourceSubjectWhere(subject));
      return { sources: rows.map((r) => sourceDescriptor(r.link, r.document)) };
    });
  });
  app.post('/api/sources', async (req, reply) => {
    const d = CreateSourceNoteSchema.parse(req.body);
    const source = await retainSource(getDb(), { ...d, ownerId: req.user!.id, actor: `session:${req.user!.email}` });
    return reply.code(201).send({ source });
  });
  app.post<{ Querystring: { asset_id?: string; session_id?: string } }>('/api/sources/upload', async (req, reply) => {
    const subject = SourceSubjectSchema.parse(req.query);
    if (!req.isMultipart()) throw new SourceError(400, 'expected_multipart', 'Choose a source file.');
    let file: { bytes: Buffer; label: string; mediaType: string } | null = null;
    for await (const part of req.parts()) {
      if (part.type !== 'file') continue;
      if (file) throw new SourceError(400, 'one_source_per_upload', 'Upload one source at a time.');
      const bytes = await part.toBuffer();
      if (part.file.truncated) throw new SourceError(413, 'source_too_large', 'Source exceeds 25 MB.');
      file = { bytes, label: part.filename, mediaType: part.mimetype };
    }
    if (!file) throw new SourceError(400, 'source_file_required', 'Choose a source file.');
    const source = await retainSource(getDb(), { ...file, kind: 'file', subject, ownerId: req.user!.id, actor: `session:${req.user!.email}` });
    return reply.code(201).send({ source });
  });
  app.get<{ Params: { id: string } }>('/api/sources/:id/content', async (req, reply) => {
    const row = await getSourceLink(getDb(), Id.parse(req.params.id), req.user!.id);
    const bytes = await readSourceContent(row.document);
    return reply.header('Cache-Control', 'private, no-store').header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "sandbox; default-src 'none'")
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(row.link.label)}`)
      .type(row.document.media_type).send(bytes);
  });
  app.get<{ Params: { id: string } }>('/api/sources/:id/candidates', async (req) => {
    await getSourceLink(getDb(), Id.parse(req.params.id), req.user!.id);
    return { candidates: await getDb().select().from(source_candidates).where(eq(source_candidates.source_link_id, req.params.id)) };
  });
  app.post<{ Params: { id: string } }>('/api/sources/:id/candidates', async (req, reply) => {
    return reply.code(201).send({ candidate: await createSourceCandidate(getDb(), Id.parse(req.params.id), req.body, req.user!.id, `session:${req.user!.email}`) });
  });
  app.patch<{ Params: { id: string } }>('/api/source-candidates/:id', async (req) => ({
    candidate: await updateSourceCandidate(getDb(), Id.parse(req.params.id), req.body, req.user!.id),
  }));
  app.post<{ Params: { id: string } }>('/api/source-candidates/:id/accept', async (req) => {
    const settings = await getAppSettings();
    return { receipt: await acceptSourceCandidate(getDb(), Id.parse(req.params.id), req.body, req.user!.id,
      `session:${req.user!.email}`, { today: todayInTz(settings.timezone), currency: settings.currency }) };
  });
  app.delete<{ Params: { id: string } }>('/api/source-candidates/:id', async (req) => {
    const id = Id.parse(req.params.id);
    const { expected_revision } = z.object({ expected_revision: z.number().int().positive() }).parse(req.body);
    return getDb().transaction(async (tx) => {
      const [peek] = await tx.select().from(source_candidates).where(eq(source_candidates.id, id));
      if (!peek) throw new SourceError(404, 'candidate_not_found', 'Candidate not found.');
      const { link } = await getSourceLink(tx, peek.source_link_id, req.user!.id);
      await lockSourceSubject(tx, link.asset_id ? { asset_id: link.asset_id } : { session_id: link.session_id! }, req.user!.id);
      const [current] = await tx.select().from(source_candidates).where(eq(source_candidates.id, id)).for('update');
      if (!current || current.revision !== expected_revision || current.status === 'accepted') throw new SourceError(409, 'candidate_conflict', 'Accepted or changed evidence cannot be discarded.');
      const [candidate] = await tx.update(source_candidates).set({ status: 'rejected', revision: current.revision + 1, updated_at: new Date().toISOString() }).where(eq(source_candidates.id, id)).returning();
      return { candidate };
    });
  });
  app.delete<{ Params: { id: string } }>('/api/sources/:id', async (req) => unlinkSource(getDb(), Id.parse(req.params.id), req.user!.id));
  app.post('/api/sources/cleanup', async (req) => {
    z.object({ confirm: z.literal(true) }).parse(req.body);
    return cleanupPrivateSources(getDb(), req.user!.id);
  });
};
