import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { CAPTURE_CLIENT_SCOPES } from '@jevi-ops/shared';

// Durable acceptance (capture program, Gate B / PR2). Everything in this file
// runs with the model, STT and executor spied to prove that acceptance,
// upload and finalize never touch them (CAP-01/05/17), and with a private
// temp directory as CAPTURE_MEDIA_DIR so the storage boundary can be broken
// on purpose (CAP-05..08).

const spies = vi.hoisted(() => ({ chat: vi.fn(), prefill: vi.fn(), stt: vi.fn(), exec: vi.fn() }));
vi.mock('../src/lib/llm.js', async (orig) => ({ ...(await orig<typeof import('../src/lib/llm.js')>()), chatComplete: spies.chat, prefillPrompt: spies.prefill }));
vi.mock('../src/lib/stt.js', async (orig) => ({ ...(await orig<typeof import('../src/lib/stt.js')>()), transcribeAudio: spies.stt }));
vi.mock('../src/lib/executor.js', async (orig) => ({ ...(await orig<typeof import('../src/lib/executor.js')>()), executeActions: spies.exec }));

import { buildServer } from '../src/server.js';
import { signSession } from '../src/lib/jwt.js';
import { hashApiToken } from '../src/routes/auth.js';
import { closeDb, getDb } from '../src/lib/db.js';
import { env } from '../src/lib/env.js';
import { api_tokens, capture_media, capture_receipts, captured_data, operation_receipts } from '../src/db/schema.js';
import { mediaFs } from '../src/lib/capture/media-store.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let app: FastifyInstance;
let session: string;
let mediaDir: string;
const TOKEN_A = 'ops_test_capture_a_0123456789';
const TOKEN_B = 'ops_test_capture_b_0123456789';
const READ_TOKEN = 'ops_test_capture_read_0123456789';
const INGEST_SECRET = 'test-ingest-secret-0123456789';
const fetchSpy = vi.spyOn(globalThis, 'fetch');
const envBefore = { LLM_BASE_URL: env.LLM_BASE_URL, STT_BASE_URL: env.STT_BASE_URL, INGEST_WEBHOOK_SECRET: env.INGEST_WEBHOOK_SECRET, CAPTURE_MEDIA_DIR: env.CAPTURE_MEDIA_DIR, DATABASE_URL: env.DATABASE_URL };
const original = { open: mediaFs.open, rename: mediaFs.rename, fsyncDirectory: mediaFs.fsyncDirectory };

beforeAll(async () => {
  mediaDir = await mkdtemp(join(tmpdir(), 'jevi-capture-media-'));
  env.CAPTURE_MEDIA_DIR = mediaDir;
  env.INGEST_WEBHOOK_SECRET = INGEST_SECRET;
  // Closed ports: even a bug that reaches for a model must fail, not succeed.
  env.LLM_BASE_URL = 'http://127.0.0.1:1/v1';
  env.STT_BASE_URL = 'http://127.0.0.1:1/v1';
  app = await buildServer();
  await app.ready();
  session = await signSession({ id: '00000000-0000-0000-0000-000000000001', email: 'probe@test.local' });
});
afterAll(async () => {
  await app.close();
  Object.assign(env, envBefore);
  await rm(mediaDir, { recursive: true, force: true });
});
beforeEach(async () => {
  await getDb().insert(api_tokens).values([
    { name: 'phone-a', token_hash: hashApiToken(TOKEN_A), permission_profile: 'capture_client', scopes: [...CAPTURE_CLIENT_SCOPES] },
    { name: 'phone-b', token_hash: hashApiToken(TOKEN_B), permission_profile: 'capture_client', scopes: [...CAPTURE_CLIENT_SCOPES] },
    { name: 'reader', token_hash: hashApiToken(READ_TOKEN), permission_profile: 'capture_client', scopes: ['capture:read'] },
  ]);
  for (const name of await readdir(mediaDir)) await rm(join(mediaDir, name), { force: true });
});
afterEach(() => {
  Object.assign(mediaFs, original);
});

// ─── helpers ──────────────────────────────────────────────────────────────
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const wav = (fill = 7, size = 120) => Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(size - 12, fill)]);
const png = () => Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(64, 1)]);
function textEnvelope(overrides: Record<string, unknown> = {}, payload: Record<string, unknown> = {}) {
  return {
    protocol_version: 1, operation_id: randomUUID(), command: 'capture.create',
    payload: { capture_id: randomUUID(), kind: 'text', modality: 'typed', text: 'call the plumber about the hot water cylinder', captured_at: '2026-09-14T10:12:00+12:00', time_zone: 'Pacific/Auckland', client: { name: 'web', surface: 'portal-text' }, ...payload },
    ...overrides,
  };
}
function audioEnvelope(bytes: Buffer, mediaType = 'audio/wav', payload: Record<string, unknown> = {}) {
  return {
    protocol_version: 1, operation_id: randomUUID(), command: 'capture.create',
    payload: { capture_id: randomUUID(), kind: 'audio', modality: 'spoken', captured_at: '2026-09-14T10:15:00+12:00', client: { name: 'web', surface: 'portal-voice' },
      attachments: [{ attachment_id: randomUUID(), media_type: mediaType, size_bytes: bytes.length, sha256: sha(bytes) }], ...payload },
  };
}
const finalizeEnvelope = (captureId: string) => ({ protocol_version: 1, operation_id: randomUUID(), command: 'capture.finalize', payload: { capture_id: captureId } });
function post(url: string, body: unknown, token = session) { return app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${token}` }, payload: body }); }
function get(url: string, token = session) { return app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } }); }
function put(attachmentId: string, bytes: Buffer, token = session, contentType = 'application/octet-stream') {
  return app.inject({ method: 'PUT', url: `/api/capture-uploads/${attachmentId}`, headers: { authorization: `Bearer ${token}`, 'content-type': contentType }, payload: bytes });
}
async function counts() {
  const db = getDb();
  return { raw: (await db.select().from(captured_data)).length, receipts: (await db.select().from(capture_receipts)).length, ops: (await db.select().from(operation_receipts)).length };
}
const parts = async () => (await readdir(mediaDir)).filter((n) => n.endsWith('.part'));

// ─── text ─────────────────────────────────────────────────────────────────
describe('text acceptance (CAP-01, CAP-03, CAP-04)', () => {
  it('stores the original, its receipt and a ledger entry without any inference', async () => {
    const envelope = textEnvelope();
    const res = await post('/api/captures', envelope);
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json();
    expect(body.replayed).toBe(false);
    expect(body.receipt).toMatchObject({ capture_id: envelope.payload.capture_id, operation_id: envelope.operation_id, receipt_kind: 'server_saved', storage_state: 'complete', processing_state: 'queued', server_epoch: 1, uploads: [] });
    expect(body.receipt.data_space_id).toMatch(/^[0-9a-f-]{36}$/);

    const [raw] = await getDb().select().from(captured_data).where(eq(captured_data.id, envelope.payload.capture_id));
    expect(raw).toMatchObject({ source: 'manual', type: 'capture_text', processed_status: 'raw', display_hint: 'log' });
    expect((raw!.payload as { text: string }).text).toBe(envelope.payload.text);
    const [receipt] = await getDb().select().from(capture_receipts).where(eq(capture_receipts.capture_id, envelope.payload.capture_id));
    expect(receipt).toMatchObject({ kind: 'text', intent: 'capture_only', modality: 'typed', actor: 'session:probe@test.local', credential_id: null, client: { name: 'web', surface: 'portal-text' } });
    const [op] = await getDb().select().from(operation_receipts).where(eq(operation_receipts.operation_id, envelope.operation_id));
    expect(op).toMatchObject({ command: 'capture.create', disposition: 'applied', status: 201, resource_ref: `capture:${envelope.payload.capture_id}`, protocol_version: 1 });

    expect(spies.chat).not.toHaveBeenCalled();
    expect(spies.prefill).not.toHaveBeenCalled();
    expect(spies.stt).not.toHaveBeenCalled();
    expect(spies.exec).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('replays the same result for a retried operation and refuses a reused id', async () => {
    const envelope = textEnvelope();
    const first = await post('/api/captures', envelope);
    expect(first.statusCode).toBe(201);
    const before = await counts();
    const again = await post('/api/captures', envelope);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ replayed: true, receipt: { capture_id: envelope.payload.capture_id, receipt_kind: 'server_saved' } });
    expect(await counts()).toEqual(before);

    const reused = await post('/api/captures', { ...envelope, payload: { ...envelope.payload, text: 'something else' } });
    expect(reused.statusCode).toBe(409);
    expect(reused.json().error).toBe('operation_id_reused');
    expect(await counts()).toEqual(before);
  });

  it('memoises a capture_id conflict as a conflict disposition', async () => {
    const envelope = textEnvelope();
    expect((await post('/api/captures', envelope)).statusCode).toBe(201);
    const clash = { ...envelope, operation_id: randomUUID() };
    const res = await post('/api/captures', clash);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('capture_id_conflict');
    const retry = await post('/api/captures', clash);
    expect(retry.statusCode).toBe(409);
    expect(retry.json().error).toBe('capture_id_conflict');
    const [op] = await getDb().select().from(operation_receipts).where(eq(operation_receipts.operation_id, clash.operation_id));
    expect(op?.disposition).toBe('conflict');
    expect((await counts()).raw).toBe(1);
  });

  it('serialises concurrent retries of one operation into a single capture', async () => {
    const envelope = textEnvelope();
    const results = await Promise.all([post('/api/captures', envelope), post('/api/captures', envelope), post('/api/captures', envelope)]);
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes).toEqual([200, 200, 201]);
    expect((await counts()).raw).toBe(1);
  });

  it('validates strictly and never writes on a rejected envelope', async () => {
    const before = await counts();
    expect((await post('/api/captures', textEnvelope({}, { extra: 1 }))).statusCode).toBe(400);
    expect((await post('/api/captures', textEnvelope({}, { text: undefined }))).statusCode).toBe(400);
    expect((await post('/api/captures', textEnvelope({ protocol_version: 2 }))).statusCode).toBe(400);
    expect((await post('/api/captures', textEnvelope({}, { modality: 'spoken' }))).statusCode).toBe(400);
    expect(await counts()).toEqual(before);
  });

  it('the acceptance modules never import inference, enrichment or notification code', async () => {
    const forbidden = /from '\.\.?\/(?:\.\.\/)?(?:lib\/)?(parser|executor|stt|llm|storage|google|pushover|calendar-sync|immich|integration-fetch)\.js'/;
    for (const file of ['service.ts', 'ledger.ts', 'media-store.ts', 'digest.ts']) {
      const src = await readFile(join(ROOT, 'src/lib/capture', file), 'utf8');
      expect(src, file).not.toMatch(forbidden);
    }
    const route = await readFile(join(ROOT, 'src/routes/captures.ts'), 'utf8');
    expect(route).not.toMatch(forbidden);
  });
});

// ─── media ────────────────────────────────────────────────────────────────
describe('media reservation, upload and finalize (CAP-05, CAP-06, CAP-07, CAP-08)', () => {
  it('reserves, refuses finalize until verified, then finalizes idempotently', async () => {
    const bytes = wav();
    const envelope = audioEnvelope(bytes);
    const attachmentId = envelope.payload.attachments[0]!.attachment_id;
    const reserved = await post('/api/captures', envelope);
    expect(reserved.statusCode, reserved.body).toBe(201);
    expect(reserved.json().receipt).toMatchObject({ receipt_kind: 'awaiting_media', storage_state: 'awaiting_media', processing_state: 'awaiting_media', uploads: [{ attachment_id: attachmentId, put_url: `/api/capture-uploads/${attachmentId}`, resumable: false }] });

    const early = await post(`/api/captures/${envelope.payload.capture_id}/finalize`, finalizeEnvelope(envelope.payload.capture_id));
    expect(early.statusCode).toBe(409);
    expect(early.json()).toMatchObject({ error: 'media_incomplete', missing: [attachmentId] });
    expect((await getDb().select().from(operation_receipts)).filter((o) => o.command === 'capture.finalize')).toHaveLength(0);

    const wrong = await put(attachmentId, wav(9));
    expect(wrong.statusCode).toBe(409);
    expect(wrong.json().error).toBe('media_digest_mismatch');
    expect(await readdir(mediaDir)).toEqual([]);

    const ok = await put(attachmentId, bytes);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ attachment_id: attachmentId, state: 'verified', replayed: false });
    const info = await stat(join(mediaDir, attachmentId));
    expect(info.mode & 0o777).toBe(0o600);
    expect(await parts()).toEqual([]);
    expect((await put(attachmentId, bytes)).json().replayed).toBe(true);

    const fin = finalizeEnvelope(envelope.payload.capture_id);
    const done = await post(`/api/captures/${envelope.payload.capture_id}/finalize`, fin);
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json()).toMatchObject({ replayed: false, receipt: { receipt_kind: 'server_saved', storage_state: 'complete', processing_state: 'queued', uploads: [] } });
    expect((await post(`/api/captures/${envelope.payload.capture_id}/finalize`, fin)).json().replayed).toBe(true);
    const another = await post(`/api/captures/${envelope.payload.capture_id}/finalize`, finalizeEnvelope(envelope.payload.capture_id));
    expect(another.statusCode).toBe(200);
    expect(another.json().receipt.storage_state).toBe('complete');
    const op = await get(`/api/operations/${fin.operation_id}`);
    expect(op.statusCode).toBe(200);
    expect(op.json().operation).toMatchObject({ command: 'capture.finalize', disposition: 'applied', status: 200 });

    const detail = await get(`/api/captures/${envelope.payload.capture_id}`);
    expect(detail.json().capture).toMatchObject({ kind: 'audio', modality: 'spoken', storage_state: 'complete', processing_state: 'queued', media: [{ attachment_id: attachmentId, state: 'verified', media_type: 'audio/wav' }] });
    const download = await get(`/api/captures/${envelope.payload.capture_id}/media/${attachmentId}`);
    expect(download.statusCode).toBe(200);
    expect(download.headers['cache-control']).toBe('private, no-store');
    expect(download.headers['content-type']).toContain('audio/wav');
    expect(Buffer.from(download.rawPayload).equals(bytes)).toBe(true);
    expect(spies.stt).not.toHaveBeenCalled();
    expect(spies.chat).not.toHaveBeenCalled();
  });

  it('rejects content that does not match the declared media type, oversize and non-octet bodies', async () => {
    const bytes = png();
    const envelope = audioEnvelope(bytes, 'audio/webm');
    expect((await post('/api/captures', envelope)).statusCode).toBe(201);
    const attachmentId = envelope.payload.attachments[0]!.attachment_id;
    const res = await put(attachmentId, bytes);
    expect(res.statusCode).toBe(415);
    expect(res.json().error).toBe('media_type_mismatch');
    expect(await readdir(mediaDir)).toEqual([]);
    const json = await put(attachmentId, Buffer.from('{}'), session, 'application/json');
    expect(json.statusCode).toBe(415);
    const tooBig = audioEnvelope(wav(), 'audio/wav', { attachments: [{ attachment_id: randomUUID(), media_type: 'audio/wav', size_bytes: 26_214_401, sha256: 'a'.repeat(64) }] });
    expect((await post('/api/captures', tooBig)).statusCode).toBe(400);
    const missing = await put(randomUUID(), wav());
    expect(missing.statusCode).toBe(404);
    const download = await get(`/api/captures/${envelope.payload.capture_id}/media/${attachmentId}`);
    expect(download.statusCode).toBe(409);
    expect(download.json().error).toBe('media_not_uploaded');
  });

  it('adopts a verified file whose row is still reserved (crash after rename) and clears stale parts', async () => {
    const bytes = wav(3);
    const envelope = audioEnvelope(bytes);
    const attachmentId = envelope.payload.attachments[0]!.attachment_id;
    expect((await post('/api/captures', envelope)).statusCode).toBe(201);
    // Simulate: bytes were renamed into place, process died before the row flipped.
    await writeFile(join(mediaDir, attachmentId), bytes, { mode: 0o600 });
    const stale = join(mediaDir, `${attachmentId}.deadbeef.part`);
    await writeFile(stale, Buffer.from('partial'));
    const old = new Date(Date.now() - 20 * 60 * 1000);
    await utimes(stale, old, old);
    const done = await post(`/api/captures/${envelope.payload.capture_id}/finalize`, finalizeEnvelope(envelope.payload.capture_id));
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json().receipt.storage_state).toBe('complete');
    const [row] = await getDb().select().from(capture_media).where(eq(capture_media.attachment_id, attachmentId));
    expect(row).toMatchObject({ state: 'verified', storage_key: attachmentId });
    // A later upload of the same bytes is a harmless replay and sweeps the stale part.
    expect((await put(attachmentId, bytes)).statusCode).toBe(200);
    expect(await parts()).toEqual([]);
  });

  it('never claims verified when write, rename or directory sync fails; retry recovers (CAP-07/08)', async () => {
    const bytes = wav(5);
    const envelope = audioEnvelope(bytes);
    const attachmentId = envelope.payload.attachments[0]!.attachment_id;
    expect((await post('/api/captures', envelope)).statusCode).toBe(201);
    const reservedRow = async () => (await getDb().select().from(capture_media).where(eq(capture_media.attachment_id, attachmentId)))[0]!;

    mediaFs.open = (async () => { throw Object.assign(new Error('no space'), { code: 'ENOSPC' }); }) as typeof mediaFs.open;
    const full = await put(attachmentId, bytes);
    expect(full.statusCode).toBe(507);
    expect(full.json().error).toBe('capture_storage_full');
    expect((await reservedRow()).state).toBe('reserved');
    expect(await readdir(mediaDir)).toEqual([]);
    mediaFs.open = original.open;

    mediaFs.rename = (async () => { throw Object.assign(new Error('io'), { code: 'EIO' }); }) as typeof mediaFs.rename;
    const renameFail = await put(attachmentId, bytes);
    expect(renameFail.statusCode).toBe(500);
    expect(renameFail.json().error).toBe('capture_storage_failed');
    expect((await reservedRow()).state).toBe('reserved');
    expect(await readdir(mediaDir)).toEqual([]); // temp cleaned, nothing final
    mediaFs.rename = original.rename;

    mediaFs.fsyncDirectory = async () => { throw Object.assign(new Error('io'), { code: 'EIO' }); };
    const syncFail = await put(attachmentId, bytes);
    expect(syncFail.statusCode).toBe(500);
    expect((await reservedRow()).state).toBe('reserved'); // file may exist, row is honest
    mediaFs.fsyncDirectory = original.fsyncDirectory;

    const ok = await put(attachmentId, bytes);
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await reservedRow()).state).toBe('verified');
    expect(await parts()).toEqual([]);
    expect((await readdir(mediaDir)).sort()).toEqual([attachmentId]);
  });

  it('serialises concurrent uploads of one attachment into one verified object', async () => {
    const bytes = wav(11, 4096);
    const envelope = audioEnvelope(bytes);
    const attachmentId = envelope.payload.attachments[0]!.attachment_id;
    expect((await post('/api/captures', envelope)).statusCode).toBe(201);
    const results = await Promise.all([put(attachmentId, bytes), put(attachmentId, bytes), put(attachmentId, bytes)]);
    for (const r of results) expect(r.statusCode, r.body).toBe(200);
    expect((await readdir(mediaDir)).sort()).toEqual([attachmentId]);
    expect(Buffer.from(await readFile(join(mediaDir, attachmentId))).equals(bytes)).toBe(true);
    const rows = await getDb().select().from(capture_media).where(eq(capture_media.attachment_id, attachmentId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.state).toBe('verified');
  });

  it('returns 503 for media captures when no media directory is configured, text still works', async () => {
    env.CAPTURE_MEDIA_DIR = undefined;
    try {
      const envelope = audioEnvelope(wav());
      expect((await post('/api/captures', envelope)).statusCode).toBe(201); // reservation is metadata only
      const res = await put(envelope.payload.attachments[0]!.attachment_id, wav());
      expect(res.statusCode).toBe(503);
      expect(res.json().error).toBe('capture_media_not_configured');
      expect((await post('/api/captures', textEnvelope())).statusCode).toBe(201);
    } finally {
      env.CAPTURE_MEDIA_DIR = mediaDir;
    }
  });
});

// ─── database unavailable ─────────────────────────────────────────────────
describe('database unavailable (CAP-02)', () => {
  it('returns a failure, memoises nothing, and the same operation succeeds afterwards', async () => {
    const envelope = textEnvelope();
    await closeDb();
    env.DATABASE_URL = 'postgresql://jevi:jevi@127.0.0.1:1/nowhere';
    let res;
    try {
      res = await post('/api/captures', envelope);
    } finally {
      await closeDb();
      env.DATABASE_URL = envBefore.DATABASE_URL;
    }
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    expect(res.json().error).not.toBe('accepted_no_db');
    const retry = await post('/api/captures', envelope);
    expect(retry.statusCode).toBe(201);
    expect(retry.json().replayed).toBe(false);
  });
});

// ─── authorization ────────────────────────────────────────────────────────
describe('capture_client authorization', () => {
  it('a capture_client sees only its own captures and operations; the owner sees everything', async () => {
    const envelope = textEnvelope({}, { client: { name: 'ios', device_id: 'phone-a' } });
    const created = await post('/api/captures', envelope, TOKEN_A);
    expect(created.statusCode, created.body).toBe(201);
    const id = envelope.payload.capture_id;
    const [receipt] = await getDb().select().from(capture_receipts).where(eq(capture_receipts.capture_id, id));
    expect(receipt!.actor).toBe('token:phone-a');
    expect(receipt!.credential_id).toBeTruthy();

    expect((await get(`/api/captures/${id}`, TOKEN_A)).statusCode).toBe(200);
    expect((await get(`/api/captures/${id}`, TOKEN_B)).statusCode).toBe(404);
    expect((await get(`/api/captures/${id}`)).statusCode).toBe(200);
    expect((await get(`/api/operations/${envelope.operation_id}`, TOKEN_A)).statusCode).toBe(200);
    expect((await get(`/api/operations/${envelope.operation_id}`, TOKEN_B)).statusCode).toBe(404);
    expect((await get(`/api/operations/${envelope.operation_id}`)).statusCode).toBe(200);
    const replayByOther = await post('/api/captures', envelope, TOKEN_B);
    expect(replayByOther.statusCode).toBe(404);
    expect(replayByOther.json().error).toBe('operation_not_found');
    expect((await post('/api/captures', envelope, TOKEN_A)).json().replayed).toBe(true);

    const listB = await get('/api/captures?state=queued', TOKEN_B);
    expect(listB.json().captures).toEqual([]);
    const listA = await get('/api/captures?state=queued', TOKEN_A);
    expect(listA.json().captures.map((c: { capture_id: string }) => c.capture_id)).toEqual([id]);
    expect((await post('/api/captures', textEnvelope(), READ_TOKEN)).statusCode).toBe(403);
    expect((await get(`/api/captures/${id}`, READ_TOKEN)).statusCode).toBe(404); // scoped in, but not its capture
  });
});

// ─── listing and legacy rows ──────────────────────────────────────────────
describe('listing and legacy projection (CAP-18)', () => {
  it('lists pending captures, exposes pre-0060 rows as legacy to the owner only', async () => {
    const [legacy] = await getDb().insert(captured_data).values({ source: 'watch', type: 'note', payload: { text: 'from the watch' } }).returning({ id: captured_data.id });
    const envelope = textEnvelope();
    expect((await post('/api/captures', envelope)).statusCode).toBe(201);

    const pending = await get('/api/captures?state=queued,blocked');
    expect(pending.json().captures.map((c: { capture_id: string }) => c.capture_id)).toEqual([envelope.payload.capture_id]);
    const all = await get('/api/captures');
    expect(all.json().captures.map((c: { capture_id: string }) => c.capture_id)).toEqual([envelope.payload.capture_id]);
    const withLegacy = await get('/api/captures?state=legacy,queued');
    const rows = withLegacy.json().captures as Array<{ capture_id: string; processing_state: string; text: string | null; retry_permitted: boolean }>;
    expect(rows.map((r) => r.capture_id).sort()).toEqual([envelope.payload.capture_id, legacy!.id].sort());
    const legacyRow = rows.find((r) => r.capture_id === legacy!.id)!;
    expect(legacyRow).toMatchObject({ processing_state: 'legacy', text: 'from the watch', retry_permitted: false });
    expect((await get(`/api/captures/${legacy!.id}`)).json().capture.processing_state).toBe('legacy');
    expect((await get('/api/captures?state=legacy', TOKEN_A)).json().captures).toEqual([]);
    expect((await get(`/api/captures/${legacy!.id}`, TOKEN_A)).statusCode).toBe(404);
    expect((await get('/api/captures?state=nope')).statusCode).toBe(400);
  });
});

// ─── legacy webhook ingest ────────────────────────────────────────────────
describe('POST /api/ingest through the durable service (CAP-02, CAP-03)', () => {
  const ingest = (body: unknown, secret = INGEST_SECRET) => app.inject({ method: 'POST', url: '/api/ingest', headers: { 'x-ingest-secret': secret }, payload: body });

  it('keeps {id, created_at}, records a receipt, and replays on operation_id', async () => {
    const res = await ingest({ source: 'watch', type: 'dictation', payload: { text: 'buy filters for the furnace' }, tags: ['watch'] });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(['created_at', 'id']);
    const [receipt] = await getDb().select().from(capture_receipts).where(eq(capture_receipts.capture_id, body.id));
    expect(receipt).toMatchObject({ kind: 'text', processing_state: 'queued', storage_state: 'complete', actor: 'ingest:webhook', client: { name: 'ingest', surface: 'watch' } });
    const [raw] = await getDb().select().from(captured_data).where(eq(captured_data.id, body.id));
    expect(raw).toMatchObject({ source: 'watch', type: 'dictation', tags: ['watch'] });

    const operationId = randomUUID();
    const first = await ingest({ source: 'webhook', type: 'event', payload: { note: 'x' }, operation_id: operationId });
    expect(first.statusCode).toBe(201);
    const again = await ingest({ source: 'webhook', type: 'event', payload: { note: 'x' }, operation_id: operationId });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual(first.json());
    const changed = await ingest({ source: 'webhook', type: 'event', payload: { note: 'y' }, operation_id: operationId });
    expect(changed.statusCode).toBe(409);
    expect(changed.json().error).toBe('operation_id_reused');
    expect((await get(`/api/captures/${body.id}`)).json().capture.text).toBe('buy filters for the furnace');
  });

  it('fails closed without a database and never returns the old stub', async () => {
    const saved = env.DATABASE_URL;
    env.DATABASE_URL = undefined;
    try {
      const res = await ingest({ source: 'watch', type: 'dictation', payload: { text: 'lost?' } });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ error: 'database_not_configured' });
    } finally {
      env.DATABASE_URL = saved;
    }
    expect((await ingest({ type: 'x', payload: {} }, 'wrong')).statusCode).toBe(401);
  });
});
