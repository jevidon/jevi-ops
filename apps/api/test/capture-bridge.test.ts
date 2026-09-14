import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { CAPTURE_CLIENT_SCOPES } from '@jevi-ops/shared';
import { buildServer } from '../src/server.js';
import { signSession } from '../src/lib/jwt.js';
import { hashApiToken } from '../src/routes/auth.js';
import { getDb } from '../src/lib/db.js';
import { env } from '../src/lib/env.js';
import { invalidateAppSettings } from '../src/lib/app-settings.js';
import { api_tokens, app_settings, calendar_events, capture_attempts, capture_receipts, captured_data, tasks } from '../src/db/schema.js';
import { advanceAttempt, bridgeHooks } from '../src/lib/capture/legacy-bridge.js';
import { startFakeLlm, type FakeLlm } from './fake-llm.js';

// The transitional interpretation bridge (Gate B / PR3): saved captures are
// interpreted by the legacy parser + executor under a fenced attempt, with
// the local-only policy enforced before every model call. Runs against a
// fake OpenAI-compatible server on loopback; nothing here reaches a real
// model.

let app: FastifyInstance;
let session: string;
let llm: FakeLlm;
let mediaDir: string;
const CAPTURE_TOKEN = 'ops_test_capture_bridge_0123456789';
const envBefore = { LLM_PROVIDER: env.LLM_PROVIDER, LLM_BASE_URL: env.LLM_BASE_URL, LLM_MODEL: env.LLM_MODEL, STT_BASE_URL: env.STT_BASE_URL, STT_MODEL: env.STT_MODEL, LOCAL_INFERENCE_ORIGINS: env.LOCAL_INFERENCE_ORIGINS, CAPTURE_MEDIA_DIR: env.CAPTURE_MEDIA_DIR };
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const wav = () => Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(200, 3)]);

beforeAll(async () => {
  llm = await startFakeLlm();
  mediaDir = await mkdtemp(join(tmpdir(), 'jevi-capture-bridge-'));
  env.CAPTURE_MEDIA_DIR = mediaDir;
  app = await buildServer();
  await app.ready();
  session = await signSession({ id: '00000000-0000-0000-0000-000000000001', email: 'probe@test.local' });
});
afterAll(async () => {
  await app.close();
  await llm.close();
  Object.assign(env, envBefore);
  invalidateAppSettings();
  await rm(mediaDir, { recursive: true, force: true });
});
beforeEach(async () => {
  env.LLM_PROVIDER = 'openai_compatible';
  env.LLM_BASE_URL = llm.baseUrl;
  env.LLM_MODEL = 'test-model';
  env.STT_BASE_URL = llm.baseUrl;
  env.STT_MODEL = 'whisper-test';
  env.LOCAL_INFERENCE_ORIGINS = undefined;
  invalidateAppSettings();
  llm.state.bodies = [];
  llm.state.reply = '{"actions":[{"action":"create_task","title":"Call the plumber"}]}';
  llm.state.delayMs = 0;
  llm.state.failStatus = null;
  llm.state.sttRequests = 0;
  bridgeHooks.afterExecute = undefined;
  await getDb().insert(api_tokens).values({ name: 'phone', token_hash: hashApiToken(CAPTURE_TOKEN), permission_profile: 'capture_client', scopes: [...CAPTURE_CLIENT_SCOPES] });
});
afterEach(async () => {
  await getDb().update(app_settings).set({ capture_async_enabled: false }).where(eq(app_settings.id, true));
  invalidateAppSettings();
});

function post(url: string, body?: unknown, token = session) { return app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { payload: body }) }); }
function get(url: string, token = session) { return app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } }); }
async function savedText(text = 'call the plumber about the hot water cylinder', modality = 'typed'): Promise<string> {
  const captureId = randomUUID();
  const res = await post('/api/captures', { protocol_version: 1, operation_id: randomUUID(), command: 'capture.create', payload: { capture_id: captureId, kind: 'text', modality, text, captured_at: '2026-09-14T10:12:00+12:00', client: { name: 'web' } } });
  expect(res.statusCode, res.body).toBe(201);
  return captureId;
}
async function savedImage(): Promise<string> {
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(32, 1)]);
  const captureId = randomUUID(); const attachmentId = randomUUID();
  expect((await post('/api/captures', { protocol_version: 1, operation_id: randomUUID(), command: 'capture.create', payload: { capture_id: captureId, kind: 'image', captured_at: '2026-09-14T10:12:00+12:00', client: { name: 'web' }, attachments: [{ attachment_id: attachmentId, media_type: 'image/png', size_bytes: png.length, sha256: sha(png) }] } })).statusCode).toBe(201);
  expect((await app.inject({ method: 'PUT', url: `/api/capture-uploads/${attachmentId}`, headers: { authorization: `Bearer ${session}`, 'content-type': 'application/octet-stream' }, payload: png })).statusCode).toBe(200);
  expect((await post(`/api/captures/${captureId}/finalize`, { protocol_version: 1, operation_id: randomUUID(), command: 'capture.finalize', payload: { capture_id: captureId } })).statusCode).toBe(200);
  return captureId;
}
async function savedAudio(): Promise<string> {
  const bytes = wav();
  const captureId = randomUUID(); const attachmentId = randomUUID();
  expect((await post('/api/captures', { protocol_version: 1, operation_id: randomUUID(), command: 'capture.create', payload: { capture_id: captureId, kind: 'audio', modality: 'spoken', captured_at: '2026-09-14T10:12:00+12:00', client: { name: 'web' }, attachments: [{ attachment_id: attachmentId, media_type: 'audio/wav', size_bytes: bytes.length, sha256: sha(bytes) }] } })).statusCode).toBe(201);
  expect((await app.inject({ method: 'PUT', url: `/api/capture-uploads/${attachmentId}`, headers: { authorization: `Bearer ${session}`, 'content-type': 'application/octet-stream' }, payload: bytes })).statusCode).toBe(200);
  expect((await post(`/api/captures/${captureId}/finalize`, { protocol_version: 1, operation_id: randomUUID(), command: 'capture.finalize', payload: { capture_id: captureId } })).statusCode).toBe(200);
  return captureId;
}
const retryEnvelope = (captureId: string, expected: number, operationId = randomUUID()) => ({ protocol_version: 1, operation_id: operationId, command: 'capture.retry_interpretation', payload: { capture_id: captureId, expected_attempt_no: expected } });
const interpret = (id: string, token = session) => post(`/api/captures/${id}/interpret`, undefined, token);
const retry = (id: string, expected: number, operationId?: string) => post(`/api/captures/${id}/retry-interpretation`, retryEnvelope(id, expected, operationId));
const taskCount = async () => (await getDb().select().from(tasks).where(eq(tasks.title, 'Call the plumber'))).length;
const receipt = async (id: string) => (await getDb().select().from(capture_receipts).where(eq(capture_receipts.capture_id, id)))[0]!;
async function plantAttempt(captureId: string, stage: 'parsing' | 'executing', ageMs: number, token = 'old-token') {
  const at = new Date(Date.now() - ageMs).toISOString();
  await getDb().insert(capture_attempts).values({ capture_id: captureId, attempt_no: 1, attempt_token_hash: hash(token), operation_id: randomUUID(), stage, stage_changed_at: at, heartbeat_at: at, plan: stage === 'executing' ? [{ action: 'create_task', title: 'Call the plumber' }] : null });
  await getDb().update(capture_receipts).set({ processing_state: 'interpreting', current_attempt_no: 1 }).where(eq(capture_receipts.capture_id, captureId));
}

describe('interpretation after a durable save', () => {
  it('commits a clean plan exactly once and replays the outcome afterwards', async () => {
    const id = await savedText();
    const res = await interpret(id);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ capture_id: id, attempt_no: 1, processing_state: 'committed', error_code: null, replayed: false, outcome: { status: 'executed' } });
    expect(await taskCount()).toBe(1);
    expect((await getDb().select().from(captured_data).where(eq(captured_data.id, id)))[0]?.processed_status).toBe('parsed');
    const [attempt] = await getDb().select().from(capture_attempts).where(eq(capture_attempts.capture_id, id));
    expect(attempt).toMatchObject({ attempt_no: 1, stage: 'finished', error_code: null });
    expect(attempt!.plan).toEqual([{ action: 'create_task', title: 'Call the plumber' }]);
    expect(Array.isArray(attempt!.effects)).toBe(true);
    expect(llm.state.bodies).toHaveLength(1);

    const again = await interpret(id);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ processing_state: 'committed', replayed: true });
    expect(await taskCount()).toBe(1);
    expect(llm.state.bodies).toHaveLength(1);
    expect((await retry(id, 1)).statusCode).toBe(409);
    expect((await retry(id, 1)).json().error).toBe('retry_not_permitted');
  });

  it('routes a disambiguation to review and keeps the transcript', async () => {
    llm.state.reply = '{"needs_disambiguation":true,"field":"project_match","candidates":["A","B"]}';
    const id = await savedText();
    const res = await interpret(id);
    expect(res.json()).toMatchObject({ processing_state: 'needs_review', error_code: null, outcome: { status: 'needs_disambiguation', field: 'project_match' } });
    expect((await get(`/api/captures/${id}`)).json().capture.retry_permitted).toBe(false);
    expect(await taskCount()).toBe(0);
  });

  it('blocks when the model is down, stays readable, and an explicit retry runs once (CAP-06, CAP-11)', async () => {
    env.LLM_BASE_URL = 'http://127.0.0.1:1/v1';
    invalidateAppSettings();
    const id = await savedText();
    const down = await interpret(id);
    expect(down.statusCode).toBe(200);
    expect(down.json()).toMatchObject({ processing_state: 'blocked', error_code: 'llm_unavailable', attempt_no: 1 });
    const detail = await get(`/api/captures/${id}`);
    expect(detail.json().capture).toMatchObject({ text: 'call the plumber about the hot water cylinder', processing_state: 'blocked', retry_permitted: true, current_attempt_no: 1 });
    expect((await interpret(id)).json()).toMatchObject({ processing_state: 'blocked', replayed: true }); // interpret never re-runs a finished attempt

    env.LLM_BASE_URL = llm.baseUrl;
    invalidateAppSettings();
    const op = randomUUID();
    const ok = await retry(id, 1, op);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ processing_state: 'committed', attempt_no: 2, replayed: false });
    expect(await taskCount()).toBe(1);
    const replay = await retry(id, 1, op);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ processing_state: 'committed', attempt_no: 2, replayed: true });
    expect(await taskCount()).toBe(1);
    expect((await retry(id, 1)).json().error).toBe('retry_not_permitted');
  });

  it('refuses a retry against a stale attempt number', async () => {
    env.LLM_BASE_URL = 'http://127.0.0.1:1/v1';
    invalidateAppSettings();
    const id = await savedText();
    await interpret(id);
    const res = await retry(id, 0);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'attempt_conflict', current_attempt_no: 1 });
  });

  it('a second request while one is running is refused, not doubled', async () => {
    llm.state.delayMs = 400;
    const id = await savedText();
    const [a, b] = await Promise.all([interpret(id), new Promise<Awaited<ReturnType<typeof interpret>>>((r) => setTimeout(() => r(interpret(id)), 80))]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([200, 409]);
    expect([a, b].find((r) => r.statusCode === 409)!.json().error).toBe('capture_busy');
    expect(await taskCount()).toBe(1);
  });

  it('supersedes a stale pre-effect attempt; the old attempt can no longer advance to execution', async () => {
    const id = await savedText();
    await plantAttempt(id, 'parsing', 5 * 60 * 1000);
    const res = await interpret(id);
    expect(res.json()).toMatchObject({ processing_state: 'committed', attempt_no: 2 });
    expect(await taskCount()).toBe(1);
    // The hung attempt "wakes up" and tries to execute: fenced out.
    expect(await advanceAttempt(getDb(), id, 1, 'old-token', 'parsing', 'executing', { plan: [] })).toBe(false);
    expect((await getDb().select().from(capture_attempts).where(and(eq(capture_attempts.capture_id, id), eq(capture_attempts.attempt_no, 1))))[0]?.stage).toBe('finished');
    expect(await taskCount()).toBe(1);
  });

  it('a stale attempt that died after execution began becomes execution_uncertain and is never rerun', async () => {
    const id = await savedText();
    await plantAttempt(id, 'executing', 5 * 60 * 1000);
    const res = await interpret(id);
    expect(res.json()).toMatchObject({ processing_state: 'needs_review', error_code: 'execution_uncertain', attempt_no: 1 });
    expect(llm.state.bodies).toHaveLength(0);
    expect(await taskCount()).toBe(0);
    expect((await retry(id, 1)).json().error).toBe('retry_not_permitted');
    expect((await get(`/api/captures/${id}`)).json().capture.retry_permitted).toBe(false);
  });

  it('a crash between execution and recording is reported as uncertain, with exactly one effect (SYN-03 analogue)', async () => {
    bridgeHooks.afterExecute = () => { throw new Error('process died'); };
    const id = await savedText();
    const res = await interpret(id);
    expect(res.json()).toMatchObject({ processing_state: 'needs_review', error_code: 'execution_uncertain' });
    expect(await taskCount()).toBe(1);
    bridgeHooks.afterExecute = undefined;
    expect((await retry(id, 1)).json().error).toBe('retry_not_permitted');
    expect((await interpret(id)).json()).toMatchObject({ processing_state: 'needs_review', replayed: true });
    expect(await taskCount()).toBe(1);
  });

  it('external effects are routed to review instead of executed', async () => {
    llm.state.reply = '{"actions":[{"action":"create_calendar_event","title":"Dentist","start":"2026-09-20T10:00:00+12:00"},{"action":"create_task","title":"Call the plumber"}]}';
    const id = await savedText();
    const res = await interpret(id);
    expect(res.json()).toMatchObject({ processing_state: 'needs_review', error_code: 'external_effect_requires_review', outcome: { status: 'needs_review' } });
    expect(await taskCount()).toBe(0);
    expect((await getDb().select().from(calendar_events)).length).toBe(0);
    const [attempt] = await getDb().select().from(capture_attempts).where(eq(capture_attempts.capture_id, id));
    expect((attempt!.plan as unknown[]).length).toBe(2);
  });

  it('any failed action means review, not committed', async () => {
    llm.state.reply = '{"actions":[{"action":"create_task","title":"Call the plumber"},{"action":"teleport","title":"x"}]}';
    const id = await savedText();
    const res = await interpret(id);
    expect(res.json()).toMatchObject({ processing_state: 'needs_review', error_code: 'partial_execution' });
    expect(await taskCount()).toBe(1);
    expect((await retry(id, 1)).json().error).toBe('retry_not_permitted');
  });

  it('a malformed model reply blocks with parser_failed and can be retried', async () => {
    llm.state.reply = 'not json at all';
    const id = await savedText();
    expect((await interpret(id)).json()).toMatchObject({ processing_state: 'blocked', error_code: 'parser_failed', outcome: { status: 'parse_error', error: 'invalid_json_from_model' } });
    llm.state.reply = '{"actions":[{"action":"create_task","title":"Call the plumber"}]}';
    expect((await retry(id, 1)).json()).toMatchObject({ processing_state: 'committed', attempt_no: 2 });
    expect(await taskCount()).toBe(1);
  });

  it('images are preserved and never parsed here', async () => {
    const id = await savedImage();
    const res = await interpret(id);
    expect(res.json()).toMatchObject({ processing_state: 'blocked', error_code: 'image_processing_unavailable' });
    expect(llm.state.bodies).toHaveLength(0);
    expect((await retry(id, 1)).json().error).toBe('retry_not_permitted');
    expect((await get(`/api/captures/${id}`)).json().capture.media[0].state).toBe('verified');
  });

  it('audio is transcribed by the approved local STT and then parsed', async () => {
    const id = await savedAudio();
    const res = await interpret(id);
    expect(res.json(), res.body).toMatchObject({ processing_state: 'committed' });
    expect(llm.state.sttRequests).toBe(1);
    expect(llm.state.bodies).toHaveLength(1);
    expect(JSON.stringify(llm.state.bodies[0])).toContain('call the plumber about the hot water cylinder');
    expect(await taskCount()).toBe(1);
  });
});

describe('local-only policy on the new flow (CAP-17)', () => {
  it('an unapproved LLM endpoint receives nothing; approving it via LOCAL_INFERENCE_ORIGINS lets the attempt proceed', async () => {
    env.LLM_BASE_URL = 'http://unapproved.invalid:9/v1';
    invalidateAppSettings();
    const id = await savedText();
    expect((await interpret(id)).json()).toMatchObject({ processing_state: 'blocked', error_code: 'endpoint_not_approved' });
    expect(llm.state.bodies).toHaveLength(0);
    const warm = await post('/api/capture/warm');
    expect(warm.statusCode).toBe(503);
    expect(warm.json().error).toBe('endpoint_not_approved');

    env.LOCAL_INFERENCE_ORIGINS = 'http://unapproved.invalid:9';
    invalidateAppSettings();
    const res = await retry(id, 1);
    expect(res.json().error_code).toBe('llm_unavailable'); // policy passed; the host does not exist
    expect(res.json().processing_state).toBe('blocked');
  });

  it('an unapproved STT endpoint blocks an audio capture before any upload of private audio', async () => {
    env.STT_BASE_URL = 'https://api.openai.com/v1';
    env.STT_API_KEY = 'sk-test-not-real';
    invalidateAppSettings();
    try {
      const id = await savedAudio();
      const res = await interpret(id);
      expect(res.json()).toMatchObject({ processing_state: 'blocked', error_code: 'endpoint_not_approved' });
      expect(llm.state.sttRequests).toBe(0);
      expect(llm.state.bodies).toHaveLength(0);
    } finally {
      env.STT_API_KEY = undefined;
    }
  });

  it('with no LLM configured the capture stays saved and blocked', async () => {
    env.LLM_BASE_URL = undefined;
    invalidateAppSettings();
    const id = await savedText();
    expect((await interpret(id)).json()).toMatchObject({ processing_state: 'blocked', error_code: 'llm_not_configured' });
    expect((await get(`/api/captures/${id}`)).json().capture.text).toContain('plumber');
  });
});

describe('ownership and gating', () => {
  it('the async flag hands captures to the consumer', async () => {
    await getDb().update(app_settings).set({ capture_async_enabled: true }).where(eq(app_settings.id, true));
    invalidateAppSettings();
    const id = await savedText();
    const res = await interpret(id);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('capture_async_owned');
    expect((await receipt(id)).processing_state).toBe('queued');
  });

  it('capture_client credentials cannot interpret; media-incomplete captures cannot be interpreted', async () => {
    const id = await savedText();
    expect((await interpret(id, CAPTURE_TOKEN)).statusCode).toBe(403);
    const captureId = randomUUID();
    await post('/api/captures', { protocol_version: 1, operation_id: randomUUID(), command: 'capture.create', payload: { capture_id: captureId, kind: 'audio', captured_at: '2026-09-14T10:12:00+12:00', client: { name: 'web' }, attachments: [{ attachment_id: randomUUID(), media_type: 'audio/wav', size_bytes: 10, sha256: 'a'.repeat(64) }] } });
    const res = await interpret(captureId);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('capture_not_ready');
  });
});
