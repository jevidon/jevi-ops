import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, rm, utimes } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { CreateSourceNoteSchema } from '@jevi-ops/shared';
import { buildServer } from '../src/server.js';
import { signSession } from '../src/lib/jwt.js';
import { getDb } from '../src/lib/db.js';
import { env } from '../src/lib/env.js';
import { createAsset, createItem, getItem, getTask, today, daysFromToday } from './helpers.js';
import { asset_meter_readings, maintenance_visits, source_candidates, source_documents, source_links } from '../src/db/schema.js';
import { retainSource, validateSourceBytes, privateSourcesDirectory, cleanupPrivateSources } from '../src/lib/private-sources.js';
import { runMaintenanceSweep } from '../src/lib/maintenance-sweep.js';
import { createSourceCandidate, updateSourceCandidate, acceptSourceCandidate } from '../src/lib/source-imports.js';

let app: FastifyInstance;
let token: string;
let directory: string;
const ownerId = '00000000-0000-0000-0000-000000000001';
const actor = 'session:source-test@example.local';
const oldPrivate = process.env.PRIVATE_SOURCES_DIR;
const oldPublic = env.UPLOADS_DIR;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'jevi-private-sources-'));
  process.env.PRIVATE_SOURCES_DIR = join(directory, 'private');
  env.UPLOADS_DIR = join(directory, 'public');
  app = await buildServer();
  await app.ready();
  token = await signSession({ id: ownerId, email: 'source-test@example.local' });
});
afterAll(async () => {
  await app?.close();
  if (oldPrivate === undefined) delete process.env.PRIVATE_SOURCES_DIR; else process.env.PRIVATE_SOURCES_DIR = oldPrivate;
  env.UPLOADS_DIR = oldPublic;
  await rm(directory, { recursive: true, force: true });
});
function req(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown, auth = true) {
  return app.inject({ method, url, ...(payload === undefined ? {} : { payload }), headers: auth ? { authorization: `Bearer ${token}` } : {} });
}

describe('private source retention and reviewed historical evidence', () => {
  it('rejects credential URLs and malformed URLs as validation results, without fetching links', () => {
    const base = { subject: { asset_id: ownerId }, label: 'A source', kind: 'link' };
    expect(CreateSourceNoteSchema.safeParse({ ...base, url: 'https://user:secret@example.com/rule' }).success).toBe(false);
    expect(CreateSourceNoteSchema.safeParse({ ...base, url: 'not a url' }).success).toBe(false);
    expect(CreateSourceNoteSchema.safeParse({ ...base, url: 'file:///etc/passwd' }).success).toBe(false);
  });

  it('retains raw bytes outside public uploads, requires owner retrieval and declares no extraction', async () => {
    const asset = await createAsset();
    const bytes = Buffer.from('%PDF-1.4\noriginal invoice bytes\n%%EOF');
    const saved = await retainSource(getDb(), { kind: 'file', subject: { asset_id: asset.id }, ownerId, actor,
      label: '../../Invoice.pdf', bytes, mediaType: 'application/pdf' });
    expect(saved.label).toBe('Invoice.pdf');
    expect(saved.processing_status).toBe('retained');
    expect(saved.content_hash).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(saved).not.toHaveProperty('storage_key');
    const unauth = await req('GET', `/api/sources/${saved.id}/content`, undefined, false);
    expect(unauth.statusCode).toBe(401);
    const content = await req('GET', `/api/sources/${saved.id}/content`);
    expect(content.statusCode).toBe(200);
    expect(content.rawPayload).toEqual(bytes);
    expect(content.headers['cache-control']).toBe('private, no-store');
    expect(content.headers['content-disposition']).toContain('attachment');
    const [stored] = await getDb().select().from(source_documents).where(eq(source_documents.id, saved.source_id));
    const bypass = await req('GET', `/uploads/${stored!.storage_key}`, undefined, false);
    expect(bypass.statusCode).not.toBe(200);
    expect(await readdir(join(directory, 'private'))).toContain(stored!.storage_key);
  });

  it('refuses storage overlapping the public root and validates file content', async () => {
    const old = process.env.PRIVATE_SOURCES_DIR;
    process.env.PRIVATE_SOURCES_DIR = join(env.UPLOADS_DIR!, 'receipts');
    await expect(privateSourcesDirectory()).rejects.toMatchObject({ code: 'private_storage_overlaps_public' });
    process.env.PRIVATE_SOURCES_DIR = old;
    expect(() => validateSourceBytes(Buffer.from('<html>bad</html>'), 'application/pdf')).toThrow();
    expect(() => validateSourceBytes(Buffer.from('plain text'), 'application/x-executable')).toThrow();
    expect(() => validateSourceBytes(Buffer.from([0xff, 0xfe]), 'text/plain')).toThrow();
    expect(validateSourceBytes(Buffer.from('# Original notes'), 'text/markdown')).toBe('text/markdown');
  });

  it('keeps bytes after a failed metadata transaction and cleans only old unreferenced files', async () => {
    const root = await privateSourcesDirectory();
    const before = new Set(await readdir(root));
    await expect(retainSource(getDb(), { kind: 'file', subject: { asset_id: randomUUID() }, ownerId, actor,
      label: 'Retained despite failed attach.pdf', bytes: Buffer.from('%PDF-1.4\nfailed association original\n%%EOF'), mediaType: 'application/pdf' })).rejects.toThrow();
    const orphan = (await readdir(root)).find((name) => !before.has(name));
    expect(orphan).toBeTruthy();
    expect(await getDb().select().from(source_documents)).toHaveLength(0);
    await cleanupPrivateSources(getDb(), ownerId);
    expect(await readdir(root)).toContain(orphan);
    const old = new Date(Date.now() - 31 * 86400_000);
    await utimes(join(root, orphan!), old, old);
    await cleanupPrivateSources(getDb(), ownerId);
    expect(await readdir(root)).not.toContain(orphan);
  });

  it('deduplicates raw bytes but preserves separate vehicle associations', async () => {
    const a = await createAsset(); const b = await createAsset();
    const input = { kind: 'text' as const, ownerId, actor, label: 'Original notes', text: 'Oil service reported March 2024' };
    const first = await retainSource(getDb(), { ...input, subject: { asset_id: a.id } });
    const retry = await retainSource(getDb(), { ...input, subject: { asset_id: a.id } });
    const other = await retainSource(getDb(), { ...input, subject: { asset_id: b.id } });
    expect(retry.id).toBe(first.id);
    expect(other.source_id).toBe(first.source_id);
    expect(other.id).not.toBe(first.id);
    const aSources = (await req('GET', `/api/sources?asset_id=${a.id}`)).json().sources;
    expect(aSources).toHaveLength(1);
    expect(aSources[0].asset_id).toBe(a.id);
    expect(await getDb().select().from(maintenance_visits)).toHaveLength(0);
    expect(await getDb().select().from(asset_meter_readings)).toHaveLength(0);
  });

  it('retains ambiguous evidence, requires a confirmed exact date, and imports once without moving pinned work', async () => {
    const asset = await createAsset();
    const item = await createItem({ asset_id: asset.id, next_due_date: '2099-01-01', next_due_meter: 50000 });
    const subject = { asset_id: asset.id };
    const source = await retainSource(getDb(), { kind: 'text', subject, ownerId, actor, label: 'Workshop note', text: 'Oil changed in March 2024.' });
    const draft = { label: 'Oil change', date_text: 'March 2024', date_precision: 'month', original_reading: 9000, original_unit: 'km' };
    const candidate = await createSourceCandidate(getDb(), source.id, { subject, operation_key: 'import-a', candidate: draft }, ownerId, actor);
    const duplicate = await createSourceCandidate(getDb(), source.id, { subject, operation_key: 'import-b', candidate: draft }, ownerId, actor);
    expect(duplicate.id).toBe(candidate.id);
    const input = { expected_revision: candidate.revision, operation_key: 'accept-a', visit: {
      visited_on: '2024-03-15', meter: 9000, currency: 'NZD', total: 145,
      lines: [{ item_id: item.id, cost: null }],
    } };
    const context = { today: await today(), currency: 'USD' };
    await expect(acceptSourceCandidate(getDb(), candidate.id, input, ownerId, actor, context)).rejects.toMatchObject({ code: 'exact_date_required' });
    expect(await getDb().select().from(maintenance_visits)).toHaveLength(0);
    const accepted = await acceptSourceCandidate(getDb(), candidate.id, { ...input, date_confirmed: true }, ownerId, actor, context);
    const replay = await acceptSourceCandidate(getDb(), candidate.id, { ...input, date_confirmed: true }, ownerId, actor, context);
    expect(replay).toEqual(accepted);
    const visits = await getDb().select().from(maintenance_visits);
    expect(visits).toHaveLength(1);
    expect(visits[0]).toMatchObject({ total: 145, currency: 'NZD', visited_on: '2024-03-15' });
    expect((await getItem(item.id)).next_due_date).toBe('2099-01-01');
    expect((await getItem(item.id)).next_due_meter).toBe(50000);
    await expect(acceptSourceCandidate(getDb(), candidate.id, { ...input, date_confirmed: true, operation_key: 'another' }, ownerId, actor, context)).rejects.toMatchObject({ code: 'candidate_already_accepted' });
  });

  it('preserves conflicting edits and requires reviewed mixed-unit conversion', async () => {
    const asset = await createAsset({ meter_unit: 'km' });
    const item = await createItem({ asset_id: asset.id });
    const subject = { asset_id: asset.id };
    const source = await retainSource(getDb(), { kind: 'text', subject, ownerId, actor, label: 'US receipt', text: 'Service 100 miles on 2024-03-15' });
    const candidate = await createSourceCandidate(getDb(), source.id, { subject, operation_key: 'mixed', candidate: {
      label: 'Service', date_precision: 'exact', date_text: '2024-03-15', original_reading: 100, original_unit: 'mi',
    } }, ownerId, actor);
    const updated = await updateSourceCandidate(getDb(), candidate.id, { expected_revision: 1, candidate: { ...candidate.candidate, notes: 'Owner reviewed original' } }, ownerId);
    await expect(updateSourceCandidate(getDb(), candidate.id, { expected_revision: 1, candidate: candidate.candidate }, ownerId)).rejects.toMatchObject({ code: 'candidate_conflict' });
    const input = { expected_revision: updated.revision, operation_key: 'accept-mixed', visit: {
      visited_on: '2024-03-15', meter: 160.93, lines: [{ item_id: item.id }],
    } };
    const context = { today: await today(), currency: 'USD' };
    await expect(acceptSourceCandidate(getDb(), candidate.id, input, ownerId, actor, context)).rejects.toMatchObject({ code: 'unit_conversion_required' });
    await acceptSourceCandidate(getDb(), candidate.id, { ...input, unit_conversion_confirmed: true }, ownerId, actor, context);
    const [retained] = await getDb().select().from(source_candidates).where(eq(source_candidates.id, candidate.id));
    expect(retained!.candidate.original_reading).toBe(100);
    expect(retained!.candidate.original_unit).toBe('mi');
  });

  it('keeps current work and pinned schedules through historical correction and undo', async () => {
    const asset = await createAsset();
    const due = await daysFromToday(-1);
    const item = await createItem({ asset_id: asset.id, next_due_date: due, next_due_meter: 50000 });
    await runMaintenanceSweep(getDb());
    const taskId = (await getItem(item.id)).generated_task_id!;
    expect((await getTask(taskId))?.status).toBe('open');
    const subject = { asset_id: asset.id };
    const source = await retainSource(getDb(), { kind: 'text', subject, ownerId, actor, label: 'Old service', text: 'Oil serviced 2024-03-15 at 9000 km.' });
    const candidate = await createSourceCandidate(getDb(), source.id, { subject, operation_key: 'historical-correction', candidate: {
      label: 'Oil service', date_text: '2024-03-15', date_precision: 'exact', original_reading: 9000, original_unit: 'km',
    } }, ownerId, actor);
    const receipt = await acceptSourceCandidate(getDb(), candidate.id, { expected_revision: 1, operation_key: 'historical-accepted',
      visit: { visited_on: '2024-03-15', meter: 9000, lines: [{ item_id: item.id }] } }, ownerId, actor, { today: await today(), currency: 'USD' });
    const corrected = await req('PATCH', `/api/visits/${receipt.visit_id}`, { meter: 9100, visited_on: '2024-03-16' });
    expect(corrected.statusCode, corrected.body).toBe(200);
    expect(await getItem(item.id)).toMatchObject({ next_due_date: due, next_due_meter: 50000, generated_task_id: taskId });
    expect((await getTask(taskId))?.status).toBe('open');
    expect((await req('DELETE', `/api/visits/${receipt.visit_id}`)).statusCode).toBe(200);
    expect(await getItem(item.id)).toMatchObject({ next_due_date: due, next_due_meter: 50000, generated_task_id: taskId });
    expect((await getTask(taskId))?.status).toBe('open');
    expect((await req('DELETE', `/api/sources/${source.id}`)).statusCode).toBe(409);
  });
});
