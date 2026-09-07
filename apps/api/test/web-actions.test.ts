import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import type { FastifyInstance } from 'fastify';
import * as shared from '@jevi-ops/shared';
import { buildServer } from '../src/server.js';
import { signSession } from '../src/lib/jwt.js';
import { createAsset } from './helpers.js';

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
