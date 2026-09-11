import { createHash, randomUUID } from 'node:crypto';
import { mkdir, realpath, readFile, writeFile, unlink, readdir, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, join } from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import { SourceSubjectSchema, type SourceSubject } from '@jevi-ops/shared';
import { assets, onboarding_sessions, source_candidates, source_documents, source_links } from '../db/schema.js';
import { env } from './env.js';
import { inTransaction, type DbOrTx, type Tx } from './maintenance-tx.js';

export class SourceError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const SOURCE_MAX_BYTES = 25 * 1024 * 1024;

function inside(parent: string, child: string): boolean {
  const p = relative(parent, child);
  return p === '' || (!p.startsWith('..') && !isAbsolute(p));
}

export async function privateSourcesDirectory(options: { create?: boolean } = {}): Promise<string> {
  const configured = process.env.PRIVATE_SOURCES_DIR;
  if (!configured) throw new SourceError(503, 'private_storage_not_configured', 'Set PRIVATE_SOURCES_DIR to a directory outside public image storage.');
  const root = resolve(configured);
  if (env.UPLOADS_DIR && (inside(resolve(env.UPLOADS_DIR), root) || inside(root, resolve(env.UPLOADS_DIR)))) {
    throw new SourceError(503, 'private_storage_overlaps_public', 'Private sources must be outside public image storage.');
  }
  if (options.create !== false) await mkdir(root, { recursive: true, mode: 0o700 });
  const actual = await realpath(root);
  if (env.UPLOADS_DIR) {
    const pub = await realpath(resolve(env.UPLOADS_DIR)).catch(() => resolve(env.UPLOADS_DIR!));
    if (inside(pub, actual) || inside(actual, pub)) throw new SourceError(503, 'private_storage_overlaps_public', 'Private sources must be outside public image storage.');
  }
  return actual;
}

export function validateSourceBytes(bytes: Buffer, declared: string): string {
  if (!bytes.length || bytes.length > SOURCE_MAX_BYTES) throw new SourceError(413, 'source_size_invalid', 'Choose a nonempty file up to 25 MB.');
  const mime = declared.toLowerCase().split(';')[0]!.trim();
  const prefix = bytes.subarray(0, 16);
  const valid = mime === 'application/pdf' ? prefix.toString('ascii').startsWith('%PDF-')
    : ['image/jpeg', 'image/jpg'].includes(mime) ? prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff
    : mime === 'image/png' ? prefix.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : mime === 'image/webp' ? prefix.toString('ascii', 0, 4) === 'RIFF' && prefix.toString('ascii', 8, 12) === 'WEBP'
    : ['text/plain', 'text/markdown'].includes(mime) ? !bytes.includes(0) && validUtf8(bytes)
    : false;
  if (!valid) throw new SourceError(415, 'unsupported_source_type', 'Use a PDF, JPEG, PNG, WebP, UTF-8 text or Markdown file matching its content type.');
  return mime === 'image/jpg' ? 'image/jpeg' : mime;
}
function validUtf8(bytes: Buffer): boolean {
  try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return true; } catch { return false; }
}
function cleanLabel(label: string): string {
  const cleaned = label.replace(/[\x00-\x1f\x7f]/g, '').split(/[\\/]/).pop()?.trim().slice(0, 255);
  if (!cleaned) throw new SourceError(400, 'source_label_required', 'Give this source a label.');
  return cleaned;
}

export async function lockSourceSubject(tx: Tx, raw: SourceSubject, ownerId: string): Promise<SourceSubject> {
  const subject = SourceSubjectSchema.parse(raw);
  if (subject.session_id) {
    const [session] = await tx.select().from(onboarding_sessions).where(eq(onboarding_sessions.id, subject.session_id)).for('update');
    if (!session || session.owner_id !== ownerId) throw new SourceError(404, 'subject_not_found', 'Onboarding session not found.');
    if (!['in_progress', 'deferred'].includes(session.status)) throw new SourceError(409, 'session_closed', 'Attach sources to the saved vehicle after setup is completed.');
  } else {
    const [asset] = await tx.select({ id: assets.id }).from(assets).where(eq(assets.id, subject.asset_id!)).for('update');
    if (!asset) throw new SourceError(404, 'subject_not_found', 'Asset not found.');
  }
  return subject;
}
export function sourceSubjectWhere(subject: SourceSubject) {
  return subject.asset_id ? eq(source_links.asset_id, subject.asset_id) : eq(source_links.session_id, subject.session_id!);
}

export async function retainSource(db: DbOrTx, input: {
  subject: SourceSubject; ownerId: string; actor: string; label: string;
  kind: 'file' | 'text' | 'link'; text?: string; url?: string; bytes?: Buffer; mediaType?: string;
}) {
  const label = cleanLabel(input.label);
  const bytes = input.kind === 'file' ? input.bytes! : Buffer.from(input.kind === 'text' ? input.text! : input.url!, 'utf8');
  const mediaType = input.kind === 'file' ? validateSourceBytes(bytes, input.mediaType ?? '') : 'text/plain';
  const hash = createHash('sha256').update(bytes).digest('hex');
  // Never hold a transaction while writing uploaded bytes. A failed metadata
  // transaction leaves the original available for deliberate orphan recovery.
  let storageKey: string | null = null;
  if (input.kind === 'file') {
    const dir = await privateSourcesDirectory();
    storageKey = randomUUID();
    await writeFile(join(dir, storageKey), bytes, { flag: 'wx', mode: 0o600 });
  }
  const result = await inTransaction(db, async (tx) => {
    await lockSourceSubject(tx, input.subject, input.ownerId);
    await tx.insert(source_documents).values({
      kind: input.kind, content_hash: hash, media_type: mediaType, size_bytes: bytes.length,
      storage_key: storageKey, text_content: input.kind === 'text' ? input.text : null,
      source_url: input.kind === 'link' ? input.url : null,
    }).onConflictDoNothing();
    const [doc] = await tx.select().from(source_documents).where(eq(source_documents.content_hash, hash)).for('update');
    if (!doc) throw new SourceError(409, 'source_retry_required', 'Source changed while attaching it; retry.');
    await tx.insert(source_links).values({ source_id: doc.id, ...input.subject, label, actor: input.actor }).onConflictDoNothing();
    const [link] = await tx.select().from(source_links).where(and(eq(source_links.source_id, doc.id), sourceSubjectWhere(input.subject)));
    return { link: link!, document: doc };
  });
  // Duplicate bytes already retained have one source object but independent
  // associations; no history candidates/events are silently merged.
  if (storageKey && result.document.storage_key !== storageKey) await unlink(join(await privateSourcesDirectory(), storageKey)).catch(() => {});
  return sourceDescriptor(result.link, result.document);
}

export function sourceDescriptor(link: typeof source_links.$inferSelect, doc: typeof source_documents.$inferSelect) {
  return { id: link.id, source_id: doc.id, label: link.label, kind: doc.kind, media_type: doc.media_type,
    size_bytes: doc.size_bytes, content_hash: doc.content_hash, received_at: link.created_at,
    asset_id: link.asset_id, session_id: link.session_id, processing_status: 'retained' as const,
    url: doc.source_url, download_url: `/api/sources/${link.id}/content` };
}
export async function getSourceLink(db: DbOrTx, linkId: string, ownerId: string) {
  const [row] = await db.select({ link: source_links, document: source_documents }).from(source_links)
    .innerJoin(source_documents, eq(source_links.source_id, source_documents.id)).where(eq(source_links.id, linkId));
  if (!row) throw new SourceError(404, 'source_not_found', 'Source not found.');
  if (row.link.session_id) {
    const [session] = await db.select({ owner_id: onboarding_sessions.owner_id }).from(onboarding_sessions).where(eq(onboarding_sessions.id, row.link.session_id));
    if (session?.owner_id !== ownerId) throw new SourceError(404, 'source_not_found', 'Source not found.');
  }
  return row;
}
export async function readSourceContent(doc: typeof source_documents.$inferSelect): Promise<Buffer> {
  if (doc.kind !== 'file') return Buffer.from(doc.kind === 'text' ? doc.text_content! : doc.source_url!, 'utf8');
  if (!doc.storage_key || !/^[0-9a-f-]{36}$/.test(doc.storage_key)) throw new SourceError(500, 'source_storage_invalid', 'Source storage reference is invalid.');
  const root = await privateSourcesDirectory();
  const path = await realpath(join(root, doc.storage_key)).catch(() => null);
  if (!path || !inside(root, path)) throw new SourceError(404, 'source_bytes_unavailable', 'The original source bytes are unavailable.');
  return readFile(path);
}

// Called by the vehicle adapter inside its reviewed transaction. Promote
// draft associations without stranding their candidates in a closed session.
export async function attachSessionSources(tx: Tx, sessionId: string, assetId: string, ownerId: string, actor: string) {
  await lockSourceSubject(tx, { session_id: sessionId }, ownerId);
  const rows = await tx.select().from(source_links).where(eq(source_links.session_id, sessionId));
  for (const link of rows) {
    const [existing] = await tx.select().from(source_links).where(and(eq(source_links.source_id, link.source_id), eq(source_links.asset_id, assetId)));
    if (existing) {
      // Preserve distinct candidate evidence, including its original actor.
      // Namespace creation keys because keys were originally per draft link.
      await tx.update(source_candidates).set({ source_link_id: existing.id,
        operation_key: sql`${link.id} || ':' || ${source_candidates.operation_key}` }).where(eq(source_candidates.source_link_id, link.id));
      await tx.delete(source_links).where(eq(source_links.id, link.id));
    } else {
      await tx.update(source_links).set({ asset_id: assetId, session_id: null }).where(eq(source_links.id, link.id));
    }
  }
  return rows.map((link) => link.source_id);
}

async function sourceHasKnowledgeReferences(tx: Tx, sourceId: string): Promise<boolean> {
  const rows = await tx.execute(sql`select exists (
    select 1 from responsibility_rule_sources where source_id = ${sourceId}::uuid
    union all select 1 from vehicle_assessments a where a::text like ${`%${sourceId}%`}
    union all select 1 from vehicle_assessment_history h where h::text like ${`%${sourceId}%`}
    union all select 1 from knowledge_change_previews p where p::text like ${`%${sourceId}%`}
    union all select 1 from knowledge_transitions t where t::text like ${`%${sourceId}%`}
    union all select 1 from assets a where a.metadata::text like ${`%${sourceId}%`}
  ) as retained`);
  return Boolean(rows[0]?.retained);
}

/** Unlink only unaccepted evidence; physical originals have deliberate GC. */
export async function unlinkSource(db: DbOrTx, linkId: string, ownerId: string) {
  return inTransaction(db, async (tx) => {
    const { link } = await getSourceLink(tx, linkId, ownerId);
    await lockSourceSubject(tx, link.asset_id ? { asset_id: link.asset_id } : { session_id: link.session_id! }, ownerId);
    await tx.select({ id: source_documents.id }).from(source_documents).where(eq(source_documents.id, link.source_id)).for('update');
    const [accepted] = await tx.select({ id: source_candidates.id }).from(source_candidates).where(and(eq(source_candidates.source_link_id, linkId), eq(source_candidates.status, 'accepted')));
    if (accepted || await sourceHasKnowledgeReferences(tx, link.source_id)) throw new SourceError(409, 'source_in_use', 'This source supports accepted records or a reviewed change and must be retained.');
    await tx.delete(source_candidates).where(eq(source_candidates.source_link_id, linkId));
    await tx.delete(source_links).where(eq(source_links.id, linkId));
    return { unlinked: true };
  });
}

/** Deliberate owner operation; retains shared evidence, allows file-write retry. */
export async function cleanupPrivateSources(db: DbOrTx, ownerId: string, now = new Date()) {
  const cutoff = new Date(now.getTime() - 30 * 86400_000);
  const abandoned = await db.select().from(onboarding_sessions).where(and(eq(onboarding_sessions.owner_id, ownerId), eq(onboarding_sessions.status, 'abandoned')));
  let linksRemoved = 0;
  for (const session of abandoned.filter((s) => new Date(s.updated_at) < cutoff)) {
    await inTransaction(db, async (tx) => {
      const [current] = await tx.select().from(onboarding_sessions).where(eq(onboarding_sessions.id, session.id)).for('update');
      if (current?.status !== 'abandoned' || new Date(current.updated_at) >= cutoff) return;
      const links = await tx.select().from(source_links).where(eq(source_links.session_id, session.id));
      for (const link of links) {
        const [accepted] = await tx.select({ id: source_candidates.id }).from(source_candidates).where(and(eq(source_candidates.source_link_id, link.id), eq(source_candidates.status, 'accepted')));
        if (accepted || await sourceHasKnowledgeReferences(tx, link.source_id)) continue;
        await tx.delete(source_candidates).where(eq(source_candidates.source_link_id, link.id));
        await tx.delete(source_links).where(eq(source_links.id, link.id));
        linksRemoved++;
      }
    });
  }
  const docs = await db.select().from(source_documents);
  const deletedKeys: string[] = [];
  let documentsRemoved = 0;
  for (const doc of docs.filter((d) => new Date(d.created_at) < cutoff)) {
    await inTransaction(db, async (tx) => {
      const [current] = await tx.select().from(source_documents).where(eq(source_documents.id, doc.id)).for('update');
      if (!current) return;
      const [link] = await tx.select({ id: source_links.id }).from(source_links).where(eq(source_links.source_id, doc.id));
      if (link || await sourceHasKnowledgeReferences(tx, doc.id)) return;
      await tx.delete(source_documents).where(eq(source_documents.id, doc.id));
      if (doc.storage_key) deletedKeys.push(doc.storage_key);
      documentsRemoved++;
    });
  }
  let filesRemoved = 0;
  if (process.env.PRIVATE_SOURCES_DIR) {
    const root = await privateSourcesDirectory();
    for (const key of deletedKeys) {
      if (/^[0-9a-f-]{36}$/.test(key)) { if (await unlink(join(root, key)).then(() => true, () => false)) filesRemoved++; }
    }
    // A failed metadata commit may leave a file with no database row. UUID
    // filenames are never reused, and the grace period protects in-flight uploads.
    const live = new Set((await db.select({ key: source_documents.storage_key }).from(source_documents)).map((d) => d.key));
    for (const key of await readdir(root)) {
      if (!/^[0-9a-f-]{36}$/.test(key) || live.has(key)) continue;
      const info = await stat(join(root, key)).catch(() => null);
      if (info?.isFile() && info.mtime < cutoff) { if (await unlink(join(root, key)).then(() => true, () => false)) filesRemoved++; }
    }
  }
  return { links_removed: linksRemoved, documents_removed: documentsRemoved, files_removed: filesRemoved, grace_days: 30 };
}
