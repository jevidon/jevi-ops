import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { signSession } from '../src/lib/jwt.js';

let app: FastifyInstance, token: string;
beforeAll(async () => { app = await buildServer(); token = await signSession({ id: randomUUID(), email: 'agenda@test.local' }); });
afterAll(async () => { await app.close(); });
const headers = () => ({ authorization: `Bearer ${token}` });

describe('agenda bundle', () => {
  it('composes every panel the Agenda page renders, without secrets', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/briefing/bundle' })).statusCode).toBe(401);
    const starred = (await app.inject({ method: 'POST', url: '/api/tasks', headers: headers(), payload: { title: 'Starred today' } })).json();
    const state = (await app.inject({ method: 'GET', url: '/api/tasks/sync-state', headers: headers() })).json();
    expect(state.task_edit_protocol).toBe(1);
    const bundleBefore = (await app.inject({ method: 'GET', url: '/api/briefing/bundle', headers: headers() })).json();
    await app.inject({ method: 'PATCH', url: `/api/tasks/${starred.id}`, headers: headers(), payload: { top3_for_date: bundleBefore.today } });
    await app.inject({ method: 'POST', url: '/api/tasks', headers: headers(), payload: { title: 'Long overdue', due_date: '2020-01-01' } });

    const r = await app.inject({ method: 'GET', url: '/api/briefing/bundle?skip=', headers: headers() });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.protocol_version).toBe(1);
    expect(b.masthead.date_line).toMatch(/WEEK \d+/);
    expect(b.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Panels resolve from the registry in order, module-gated.
    expect(b.panels.map((p: { id: string }) => p.id)).toEqual([
      'frame', 'weather', 'domain-pulse', 'silent-clients', 'attention', 'reflection', 'latest-quote', 'pinned', 'agenda', 'doing', 'health', 'routines',
    ]);
    expect(b.panels.find((p: { id: string }) => p.id === 'health').enabled).toBe(false);
    // Rail: Top 3 first, then overdue.
    expect(b.rail.tasks[0].id).toBe(starred.id);
    expect(b.rail.tasks.some((t: { title: string }) => t.title === 'Long overdue')).toBe(true);
    expect(b.rail.top3_count).toBe(1);
    expect(b.counts.overdue).toBeGreaterThanOrEqual(1);
    expect(b.briefing.doing_today).toBeDefined();
    expect(Array.isArray(b.domains)).toBe(true);
    expect(b.agenda.date).toBe(b.today);
    expect(Array.isArray(b.pins)).toBe(true);
    expect(b.attention.active_count).toBeGreaterThanOrEqual(0);
    expect(b.resurfacing).toHaveProperty('item');
    // Only the settings the page reads travel; never the AI keys.
    expect(Object.keys(b.settings).sort()).toEqual([
      'agenda_data_url', 'agenda_image_url', 'health_module_enabled', 'maintenance_module_enabled', 'routines_module_enabled', 'timezone',
    ]);
    expect(JSON.stringify(b)).not.toContain('llm_api_key');
  });
});
