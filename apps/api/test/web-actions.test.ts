import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as crypto from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import type { FastifyInstance } from 'fastify';
import * as shared from '@jevi-ops/shared';
import { buildServer } from '../src/server.js';
import { signSession } from '../src/lib/jwt.js';
import { createAsset } from './helpers.js';
import { env } from '../src/lib/env.js';
import { invalidateAppSettings } from '../src/lib/app-settings.js';
import { startFakeLlm } from './fake-llm.js';

// The web's server actions, run for real against the real Fastify routes and
// the disposable database. The action file is transpiled on the fly and
// evaluated with `next/*` stubbed and `@/lib/api` routed into app.inject —
// so the FormData → action → route path is what's tested, not a re-telling
// of it. (Technique from the 8 Sept review's regression harness.)

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '../../web/src');

let app: FastifyInstance;
let token: string;

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
  token = await signSession({ id: '00000000-0000-0000-0000-000000000001', email: 'probe@test.local' });
});
afterAll(async () => {
  await app.close();
});

class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`API ${status}`);
  }
}

async function call<T>(method: string, url: string, payload?: unknown): Promise<T> {
  const r = await app.inject({ method: method as 'GET', url, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined ? { payload } : {}) });
  if (r.statusCode >= 400) throw new ApiError(r.statusCode, r.json());
  return r.json() as T;
}

// A tiny CommonJS loader: transpile a web source file, resolve relative
// imports the same way, and hand everything else to the mocks.
function loadWebModule(relPath: string, mocks: Record<string, unknown>): Record<string, unknown> {
  const abs = resolve(WEB, relPath);
  const source = readFileSync(abs, 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} as Record<string, unknown> };
  const require = (id: string): unknown => {
    if (id in mocks) return mocks[id];
    if (id.startsWith('.')) {
      const target = resolve(dirname(abs), id);
      return loadWebModule(target.slice(WEB.length + 1) + (target.endsWith('.ts') ? '' : '.ts'), mocks);
    }
    throw new Error(`unmocked import: ${id}`);
  };
  new Function('require', 'module', 'exports', js)(require, module, module.exports);
  return module.exports;
}

const REDIRECT = 'redirect-success';
const baseMocks = {
  'next/cache': { revalidatePath() {} },
  'next/navigation': {
    redirect() {
      throw new Error(REDIRECT);
    },
  },
  '@jevi-ops/shared': shared,
};

describe('maintenance create action (#5)', () => {
  const load = () =>
    loadWebModule('app/(authed)/maintenance/actions.ts', {
      ...baseMocks,
      '@/lib/api': {
        ApiError,
        maintenanceApi: { create: (body: unknown) => call('POST', '/api/maintenance', body) },
        assetsApi: {},
      },
    });

  it('blank override inputs are omitted, so the seeded date survives', async () => {
    const { createItemAction } = load() as { createItemAction: (p: null, f: FormData) => Promise<unknown> };
    const form = new FormData();
    form.set('name', 'Quarterly air filter');
    form.set('policy', 'interval');
    form.set('date_interval', '3');
    form.set('date_unit', 'months');
    form.set('last_completed_on', '2026-06-01');
    form.set('next_due_date', '');
    form.set('next_due_meter', '');
    form.set('last_completed_meter', '');
    await expect(createItemAction(null, form)).rejects.toThrow(REDIRECT);
    const list = await call<{ items: Array<{ name: string; next_due_date: string | null; last_completed_on: string | null }> }>('GET', '/api/maintenance');
    const item = list.items.find((i) => i.name === 'Quarterly air filter')!;
    expect(item.last_completed_on).toBe('2026-06-01');
    expect(item.next_due_date).toBe('2026-09-01');
  });

  it('a dual-cadence item seeds its meter axis from the baseline', async () => {
    const asset = await createAsset();
    const { createItemAction } = load() as { createItemAction: (p: null, f: FormData) => Promise<unknown> };
    const form = new FormData();
    form.set('name', 'Oil');
    form.set('policy', 'interval');
    form.set('asset_id', asset.id);
    form.set('date_interval', '6');
    form.set('date_unit', 'months');
    form.set('interval_meter', '5000');
    form.set('last_completed_on', '2026-06-01');
    form.set('last_completed_meter', '100000');
    form.set('next_due_date', '');
    form.set('next_due_meter', '');
    await expect(createItemAction(null, form)).rejects.toThrow(REDIRECT);
    const list = await call<{ items: Array<{ name: string; next_due_date: string | null; next_due_meter: number | null }> }>('GET', '/api/maintenance');
    const item = list.items.find((i) => i.name === 'Oil')!;
    expect(item.next_due_date).toBe('2026-12-01');
    expect(item.next_due_meter).toBe(105000);
  });
});

describe('doc save action (0050)', () => {
  const load = () =>
    loadWebModule('components/doc/doc-actions.ts', {
      ...baseMocks,
      '@/lib/api': {
        ApiError,
        api: { get: (url: string) => call('GET', url) },
        assetsApi: { update: (id: string, body: unknown) => call('PATCH', `/api/assets/${id}`, body) },
        projectsApi: { update: (id: string, body: unknown) => call('PATCH', `/api/projects/${id}`, body) },
        domainsApi: { update: (id: string, body: unknown) => call('PATCH', `/api/domains/${id}`, body) },
        tasksApi: { create: (body: unknown) => call('POST', '/api/tasks', body) },
      },
    });
  type Save = (input: { entity: 'asset' | 'project' | 'domain'; id: string; body: string; version: number }) => Promise<
    { ok: true; doc_md: string | null; doc_version: number } | { ok: false; conflict: { doc_md: string | null; doc_version: number } } | { ok: false; error: string }
  >;
  type Promote = (input: { title: string; domainId?: string | null; source: string; revalidate: string }) => Promise<{ ok: boolean; taskId?: string }>;

  it('saves against the version it read and surfaces a conflict as a typed result', async () => {
    const asset = await createAsset({ name: 'Outback' });
    const { saveDocAction, promoteChecklistLineAction } = load() as { saveDocAction: Save; promoteChecklistLineAction: Promote };
    const first = await saveDocAction({ entity: 'asset', id: asset.id, body: '# Outback', version: 1 });
    expect(first).toEqual({ ok: true, doc_md: '# Outback', doc_version: 2 });
    const stale = await saveDocAction({ entity: 'asset', id: asset.id, body: 'mine', version: 1 });
    expect(stale).toEqual({ ok: false, conflict: { doc_md: '# Outback', doc_version: 2 } });
    const promoted = await promoteChecklistLineAction({ title: 'order the roof rack', domainId: null, source: 'overview of Outback', revalidate: `/assets/${asset.id}` });
    expect(promoted.ok).toBe(true);
    const task = await call<{ title: string; notes: string | null; domain_id: string }>('GET', `/api/tasks/${promoted.taskId}`);
    expect(task.title).toBe('order the roof rack');
    expect(task.notes).toBe('From the overview of Outback.');
  });
});

describe('facts action (#1, #2)', () => {
  const load = () =>
    loadWebModule('app/(authed)/assets/[id]/actions.ts', {
      ...baseMocks,
      '@/lib/api': {
        ApiError,
        assetsApi: {
          update: (id: string, body: unknown) => call('PATCH', `/api/assets/${id}`, body),
          get: (id: string) => call('GET', `/api/assets/${id}`),
        },
      },
    });
  type Save = (p: null, f: FormData) => Promise<{ ok: boolean; error?: string; message?: string }>;

  // What the page renders into the editor: editable keys with their raw
  // originals (structured values are shown read-only and never posted).
  function form(assetId: string, rows: Array<{ key: string; value: string }>, original: Record<string, unknown>): FormData {
    const f = new FormData();
    f.set('asset_id', assetId);
    f.set('facts', JSON.stringify(rows));
    f.set('original', JSON.stringify(original));
    return f;
  }

  it('an unchanged save changes nothing: a leading-zero serial, a structured spec, a rich fact all survive', async () => {
    const original = { serial: '001234', model: { value: 'GX470', source: 'manual', verified: true }, year: 2019 };
    const asset = await createAsset({ metadata: { ...original, specs: { oil: { grade: '5W30' } } } });
    const { saveAssetFactsAction } = load() as { saveAssetFactsAction: Save };
    const res = await saveAssetFactsAction(
      null,
      form(asset.id, [{ key: 'serial', value: '001234' }, { key: 'model', value: 'GX470' }, { key: 'year', value: '2019' }], original),
    );
    expect(res.ok).toBe(true);
    expect(res.message).toBe('No changes.');
    const after = await call<{ asset: { metadata: Record<string, unknown> } }>('GET', `/api/assets/${asset.id}`);
    expect(after.asset.metadata).toEqual({ ...original, specs: { oil: { grade: '5W30' } } });
  });

  it('typing is per field: year becomes a number, an identifier stays a string; a changed rich fact becomes bare', async () => {
    const original = { serial: '001234', model: { value: 'GX470', source: 'manual', verified: true } };
    const asset = await createAsset({ metadata: original });
    const { saveAssetFactsAction } = load() as { saveAssetFactsAction: Save };
    const res = await saveAssetFactsAction(
      null,
      form(
        asset.id,
        [{ key: 'serial', value: '001234' }, { key: 'model', value: 'GX460' }, { key: 'year', value: '2019' }, { key: 'plate', value: '007' }],
        original,
      ),
    );
    expect(res.ok).toBe(true);
    const after = await call<{ asset: { metadata: Record<string, unknown> } }>('GET', `/api/assets/${asset.id}`);
    expect(after.asset.metadata).toEqual({ serial: '001234', model: 'GX460', year: 2019, plate: '007' });
  });

  it('an agent adding a fact while the editor is open loses nothing; an agent editing the same key is a conflict', async () => {
    const original = { model: { value: 'GX470', source: 'manual', verified: true }, make: 'Lexus' };
    const asset = await createAsset({ metadata: original });
    const { saveAssetFactsAction } = load() as { saveAssetFactsAction: Save };
    // Agent adds the VIN after the page rendered.
    await call('PATCH', `/api/assets/${asset.id}`, { metadata_patch: { set: { vin: { value: { value: 'JTJBT20X…', source: 'photo', verified: true } } } } });
    const res = await saveAssetFactsAction(null, form(asset.id, [{ key: 'model', value: 'GX470' }, { key: 'make', value: 'Toyota' }], original));
    expect(res.ok).toBe(true);
    let after = await call<{ asset: { metadata: Record<string, unknown> } }>('GET', `/api/assets/${asset.id}`);
    expect(after.asset.metadata).toEqual({ model: original.model, make: 'Toyota', vin: { value: 'JTJBT20X…', source: 'photo', verified: true } });

    // Agent corrects make while a stale editor changes it too.
    const stale = { ...original, make: 'Toyota' };
    await call('PATCH', `/api/assets/${asset.id}`, { metadata_patch: { set: { make: { value: 'Lexus (Toyota)' } } } });
    const conflict = await saveAssetFactsAction(null, form(asset.id, [{ key: 'model', value: 'GX470' }, { key: 'make', value: 'Toyoda' }], stale));
    expect(conflict.ok).toBe(false);
    expect(conflict.error).toMatch(/changed since you opened them \(make\)/);
    after = await call<{ asset: { metadata: Record<string, unknown> } }>('GET', `/api/assets/${asset.id}`);
    expect(after.asset.metadata.make).toBe('Lexus (Toyota)');
  });

  it('removing a row unsets the key — only when it is still what the editor saw', async () => {
    const original = { colour: 'red', make: 'Lexus' };
    const asset = await createAsset({ metadata: original });
    const { saveAssetFactsAction } = load() as { saveAssetFactsAction: Save };
    const res = await saveAssetFactsAction(null, form(asset.id, [{ key: 'make', value: 'Lexus' }], original));
    expect(res.ok).toBe(true);
    const after = await call<{ asset: { metadata: Record<string, unknown> } }>('GET', `/api/assets/${asset.id}`);
    expect(after.asset.metadata).toEqual({ make: 'Lexus' });
  });
});

// ─── Durable capture actions (capture program, Gate B) ────────────────────
//
// Save-then-interpret from the web's point of view: the storage receipt is
// what the action returns first, and it never says "saved" for a recording
// whose bytes did not reach the server.

describe('durable capture actions', () => {
  let llm: import('./fake-llm.js').FakeLlm;
  let mediaDir: string;
  const envBefore = { LLM_PROVIDER: env.LLM_PROVIDER, LLM_BASE_URL: env.LLM_BASE_URL, LLM_MODEL: env.LLM_MODEL, STT_BASE_URL: env.STT_BASE_URL, STT_MODEL: env.STT_MODEL, CAPTURE_MEDIA_DIR: env.CAPTURE_MEDIA_DIR };
  beforeAll(async () => {
    llm = await startFakeLlm();
    mediaDir = await mkdtemp(join(tmpdir(), 'jevi-web-capture-'));
    env.LLM_PROVIDER = 'openai_compatible'; env.LLM_MODEL = 'test-model'; env.STT_BASE_URL = llm.baseUrl; env.STT_MODEL = 'whisper-test';
  });
  afterAll(async () => {
    await llm.close();
    Object.assign(env, envBefore);
    invalidateAppSettings();
    await rm(mediaDir, { recursive: true, force: true });
  });
  function loadCapture(overrides: Record<string, unknown> = {}) {
    const capturesApi = {
      create: (b: unknown) => call('POST', '/api/captures', b),
      upload: async (id: string, bytes: Uint8Array) => {
        const r = await app.inject({ method: 'PUT', url: `/api/capture-uploads/${id}`, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' }, payload: Buffer.from(bytes) });
        if (r.statusCode >= 400) throw new ApiError(r.statusCode, r.json());
        return r.json();
      },
      finalize: (id: string, b: unknown) => call('POST', `/api/captures/${id}/finalize`, b),
      get: (id: string) => call('GET', `/api/captures/${id}`),
      list: (states: string[]) => call('GET', `/api/captures?state=${states.join(',')}`),
      interpret: (id: string) => call('POST', `/api/captures/${id}/interpret`),
      retry: (id: string, b: unknown) => call('POST', `/api/captures/${id}/retry-interpretation`, b),
      operation: (id: string) => call('GET', `/api/operations/${id}`),
      ...overrides,
    };
    const captureResult = loadWebModule('lib/capture-result.ts', baseMocks);
    return loadWebModule('lib/capture-actions.ts', { ...baseMocks, 'node:crypto': crypto, '@/lib/api': { ApiError, capturesApi }, '@/lib/capture-result': captureResult }) as {
      saveTextCapture: (text: string, ids: { operationId: string; captureId: string; capturedAt: string }) => Promise<{ kind: string; captureId?: string; message: string }>;
      saveAudioCapture: (fd: FormData) => Promise<{ kind: string; captureId?: string; message: string }>;
      interpretSavedCapture: (id: string) => Promise<{ kind: string; state?: string; errorCode?: string | null; summary?: string }>;
      retryInterpretationAction: (id: string, n: number) => Promise<{ ok: boolean; message: string }>;
    };
  }
  const wavForm = (ids: Record<string, string>) => {
    const bytes = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(300, 9)]);
    const fd = new FormData();
    fd.append('audio', new Blob([bytes], { type: 'audio/wav' }), 'voice.wav');
    for (const [k, v] of Object.entries(ids)) fd.set(k, v);
    return fd;
  };
  const ids = () => ({ operation_id: crypto.randomUUID(), capture_id: crypto.randomUUID(), attachment_id: crypto.randomUUID(), finalize_operation_id: crypto.randomUUID(), captured_at: new Date().toISOString() });

  it('model down: the save is reported as saved and interpretation as pending/blocked', async () => {
    env.LLM_BASE_URL = 'http://127.0.0.1:1/v1'; invalidateAppSettings();
    const { saveTextCapture, interpretSavedCapture } = loadCapture();
    const saved = await saveTextCapture('call the plumber', { operationId: crypto.randomUUID(), captureId: crypto.randomUUID(), capturedAt: new Date().toISOString() });
    expect(saved).toMatchObject({ kind: 'server_saved', message: 'Saved to Jevi Ops.' });
    const outcome = await interpretSavedCapture(saved.captureId!);
    expect(outcome).toMatchObject({ kind: 'pending', state: 'blocked', errorCode: 'llm_unavailable' });
    const detail = await call<{ capture: { processing_state: string; retry_permitted: boolean } }>('GET', `/api/captures/${saved.captureId}`);
    expect(detail.capture).toMatchObject({ processing_state: 'blocked', retry_permitted: true });
  });

  it('model up: the same two steps end in an executed summary, and a retried save replays', async () => {
    env.LLM_BASE_URL = llm.baseUrl; invalidateAppSettings();
    llm.state.reply = '{"actions":[{"action":"create_task","title":"Web action task"}]}';
    const { saveTextCapture, interpretSavedCapture } = loadCapture();
    const id = { operationId: crypto.randomUUID(), captureId: crypto.randomUUID(), capturedAt: new Date().toISOString() };
    const first = await saveTextCapture('add a task', id);
    const again = await saveTextCapture('add a task', id);
    expect(first.captureId).toBe(again.captureId);
    expect(await interpretSavedCapture(id.captureId)).toMatchObject({ kind: 'executed', summary: '✓ 1 done' });
    const tasks = await call<{ tasks: Array<{ title: string }> }>('GET', '/api/tasks?status=open');
    expect(tasks.tasks.filter((t) => t.title === 'Web action task')).toHaveLength(1);
  });

  it('audio: saved only after upload + finalize; a failed upload is reported as incomplete, not saved', async () => {
    env.CAPTURE_MEDIA_DIR = mediaDir; env.LLM_BASE_URL = llm.baseUrl; invalidateAppSettings();
    const { saveAudioCapture } = loadCapture();
    const ok = await saveAudioCapture(wavForm(ids()));
    expect(ok, ok.message).toMatchObject({ kind: 'server_saved' });
    expect((await call<{ capture: { storage_state: string } }>('GET', `/api/captures/${ok.captureId}`)).capture.storage_state).toBe('complete');

    env.CAPTURE_MEDIA_DIR = undefined;
    const broken = ids();
    const incomplete = await saveAudioCapture(wavForm(broken));
    expect(incomplete.kind).toBe('upload_incomplete');
    expect(incomplete.message).toMatch(/not yet saved to Jevi Ops/);
    expect((await call<{ capture: { storage_state: string; processing_state: string } }>('GET', `/api/captures/${broken.capture_id}`)).capture).toMatchObject({ storage_state: 'awaiting_media', processing_state: 'awaiting_media' });
    // Retry with the same identities once storage is back: replays the reservation, uploads, finalizes.
    env.CAPTURE_MEDIA_DIR = mediaDir;
    const retried = await saveAudioCapture(wavForm(broken));
    expect(retried).toMatchObject({ kind: 'server_saved', captureId: broken.capture_id });
  });

  it('audio: a lost finalize response is reconciled through the operation ledger', async () => {
    env.CAPTURE_MEDIA_DIR = mediaDir; invalidateAppSettings();
    let finalized = 0;
    const { saveAudioCapture } = loadCapture({
      finalize: async (id: string, b: unknown) => { await call('POST', `/api/captures/${id}/finalize`, b); finalized += 1; throw new Error('socket hang up'); },
    });
    const res = await saveAudioCapture(wavForm(ids()));
    expect(finalized).toBe(1);
    expect(res).toMatchObject({ kind: 'server_saved' });
  });
});
