import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildServer } from '../src/server.js';
import { signSession } from '../src/lib/jwt.js';
import { getDb } from '../src/lib/db.js';
import { env } from '../src/lib/env.js';
import { buildWork } from '../src/lib/work.js';
import { doc_revisions, projects, stewardship_domains } from '../src/db/schema.js';
import { INBOX, createAsset } from './helpers.js';

// The overview document (0050): versioned saves, conflicts, revisions —
// on assets, projects, and domains. Ideas as projects. The asset upload
// prefix.

let app: FastifyInstance;
let session: string;
let domainId: string;

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
  session = await signSession({ id: '00000000-0000-0000-0000-000000000001', email: 'probe@test.local' });
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  const [d] = await getDb()
    .select({ id: stewardship_domains.id })
    .from(stewardship_domains)
    .where(eq(stewardship_domains.is_system, false))
    .limit(1);
  domainId = d!.id;
  await getDb().delete(projects);
  await getDb().delete(doc_revisions);
  await getDb().update(stewardship_domains).set({ doc_md: null, doc_version: 1 });
});

function req(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown) {
  return app.inject({ method, url, headers: { authorization: `Bearer ${session}` }, ...(body !== undefined ? { payload: body } : {}) });
}

describe('doc save — optimistic concurrency + revisions', () => {
  it('an asset doc saves against its version, bumps it, keeps a revision, and refuses a stale write', async () => {
    const asset = await createAsset({ name: 'Outback' });
    expect(asset.doc_version).toBe(1);
    const first = await req('PATCH', `/api/assets/${asset.id}`, { doc_md: '# Outback\n\n- [ ] roof rack', doc_version: 1 });
    expect(first.statusCode).toBe(200);
    expect(first.json().asset.doc_version).toBe(2);
    expect(first.json().asset.doc_md).toBe('# Outback\n\n- [ ] roof rack');

    // A second writer holding v1 (the agent, another tab) is refused with the current body.
    const stale = await req('PATCH', `/api/assets/${asset.id}`, { doc_md: 'their text', doc_version: 1 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: 'doc_conflict', doc_version: 2, doc_md: '# Outback\n\n- [ ] roof rack' });

    // Same body, right version: nothing changes, no new revision.
    const same = await req('PATCH', `/api/assets/${asset.id}`, { doc_md: '# Outback\n\n- [ ] roof rack', doc_version: 2 });
    expect(same.json().asset.doc_version).toBe(2);
    // No version = unconditional (imports).
    const forced = await req('PATCH', `/api/assets/${asset.id}`, { doc_md: 'imported' });
    expect(forced.json().asset.doc_version).toBe(3);
    // Empty string clears.
    const cleared = await req('PATCH', `/api/assets/${asset.id}`, { doc_md: '', doc_version: 3 });
    expect(cleared.json().asset.doc_md).toBeNull();
    expect(cleared.json().asset.doc_version).toBe(4);

    const history = await req('GET', `/api/docs/asset/${asset.id}/revisions`);
    expect(history.statusCode).toBe(200);
    expect(history.json().revisions.map((r: { version: number; body: string | null }) => [r.version, r.body])).toEqual([
      [4, null],
      [3, 'imported'],
      [2, '# Outback\n\n- [ ] roof rack'],
    ]);
    expect(history.json().revisions[0].actor).toBe('session:probe@test.local');
    expect((await req('GET', `/api/docs/vehicle/${asset.id}/revisions`)).statusCode).toBe(400);
  });

  it('a conflict rolls the whole PATCH back — the rename beside a stale doc does not land', async () => {
    const created = (await req('POST', '/api/projects', { name: 'Roof rack', domain_id: domainId, doc_md: 'v1 body' })).json();
    expect(created.doc_version).toBe(1); // a create seeds the body without a revision
    await req('PATCH', `/api/projects/${created.id}`, { doc_md: 'agent wrote this', doc_version: 1 });
    const stale = await req('PATCH', `/api/projects/${created.id}`, { name: 'Roof rack (renamed)', doc_md: 'mine', doc_version: 1 });
    expect(stale.statusCode).toBe(409);
    const row = await getDb().query.projects.findFirst({ where: eq(projects.id, created.id) });
    expect(row?.name).toBe('Roof rack');
    expect(row?.doc_md).toBe('agent wrote this');
    expect(row?.doc_version).toBe(2);
    // A doc-only patch (no other fields) is fine.
    const docOnly = await req('PATCH', `/api/projects/${created.id}`, { doc_md: 'mine, rebased', doc_version: 2 });
    expect(docOnly.statusCode).toBe(200);
    expect(docOnly.json().doc_version).toBe(3);
  });

  it('a domain doc saves the same way, including on the system Inbox domain', async () => {
    const res = await req('PATCH', `/api/domains/${domainId}`, { doc_md: '## How this runs', doc_version: 1 });
    expect(res.statusCode).toBe(200);
    expect(res.json().doc_version).toBe(2);
    const inbox = await req('PATCH', `/api/domains/${INBOX}`, { doc_md: 'Triage rules', doc_version: 1 });
    expect(inbox.statusCode).toBe(200);
    const stale = await req('PATCH', `/api/domains/${domainId}`, { doc_md: 'x', doc_version: 1 });
    expect(stale.statusCode).toBe(409);
  });
});

describe('ideas (projects with status idea)', () => {
  it('an idea under an asset inherits the domain, stays off the Work board, and promotes with its document intact', async () => {
    const asset = await createAsset({ name: 'Outback', domain_id: domainId, meter_unit: null });
    const idea = (await req('POST', '/api/projects', { name: 'Lift kit', asset_id: asset.id, status: 'idea', doc_md: 'Why: clearance.' })).json();
    expect(idea.status).toBe('idea');
    expect(idea.domain_id).toBe(domainId);

    let work = await buildWork(getDb());
    let domain = work.domains.concat(work.parked).find((d) => d.id === domainId)!;
    expect(domain.projects.some((p) => p.id === idea.id)).toBe(false);
    expect(domain.assets.find((a) => a.id === asset.id)?.projects).toBe(0);

    const bundle = (await req('GET', `/api/assets/${asset.id}`)).json();
    expect(bundle.projects.map((p: { name: string; status: string }) => [p.name, p.status])).toEqual([['Lift kit', 'idea']]);

    const promoted = await req('PATCH', `/api/projects/${idea.id}`, { status: 'active' });
    expect(promoted.statusCode).toBe(200);
    expect(promoted.json().doc_md).toBe('Why: clearance.');
    expect(promoted.json().completed_at).toBeNull();
    work = await buildWork(getDb());
    domain = work.domains.concat(work.parked).find((d) => d.id === domainId)!;
    expect(domain.projects.some((p) => p.id === idea.id)).toBe(true);
  });
});

describe('uploads', () => {
  it('accepts the assets prefix and stores under assets/', async () => {
    const previous = env.UPLOADS_DIR;
    env.UPLOADS_DIR = mkdtempSync(join(tmpdir(), 'jevi-uploads-'));
    try {
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
      const form = new FormData();
      form.append('file', new Blob([png], { type: 'image/png' }), 'pixel.png');
      form.append('prefix', 'assets');
      form.append('title_hint', 'Outback');
      const res = await app.inject({ method: 'POST', url: '/api/uploads/image', headers: { authorization: `Bearer ${session}` }, payload: form });
      expect(res.statusCode).toBe(201);
      expect(res.json().storage_path).toMatch(/^assets\/\d{8}-outback-[a-f0-9]{4}\.png$/);
      const bogus = new FormData();
      bogus.append('file', new Blob([png], { type: 'image/png' }), 'pixel.png');
      bogus.append('prefix', 'secrets');
      const fallback = await app.inject({ method: 'POST', url: '/api/uploads/image', headers: { authorization: `Bearer ${session}` }, payload: bogus });
      expect(fallback.json().storage_path).toMatch(/^other\//);
    } finally {
      env.UPLOADS_DIR = previous;
    }
  });
});
