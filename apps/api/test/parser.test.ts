import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { eq, inArray } from 'drizzle-orm';
import { env } from '../src/lib/env.js';
import { getDb } from '../src/lib/db.js';
import { invalidateAppSettings } from '../src/lib/app-settings.js';
import { projects, stewardship_domains } from '../src/db/schema.js';
import { stripThinking } from '../src/lib/llm.js';
import { buildUserMessage, contextPrefix, parseTranscript, resetParserWarmup, resolveCandidates, warmParser } from '../src/lib/parser.js';

// The voice parser against a fake OpenAI-compatible server: what goes over
// the wire (thinking switched off at the top level of the body, names-only
// context, a cache-stable prefix shared by the warm-up and the real call)
// and how the reply is read back (inline <think> blocks, candidate ids).

type Body = {
  messages: { role: string; content: string }[];
  chat_template_kwargs?: Record<string, unknown>;
  extra_body?: unknown;
  response_format?: { type: string };
  max_tokens?: number;
};

let server: Server;
let bodies: Body[] = [];
let reply = '{"actions":[]}';

function completion(content: string) {
  return {
    id: 'x', object: 'chat.completion', created: 0, model: 'test',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
    timings: { cache_n: 7, prompt_n: 3, prompt_ms: 1.5, predicted_n: 2, predicted_ms: 2.5 },
  };
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const PROJECT = 'Parser Test Project';

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      bodies.push(JSON.parse(raw) as Body);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(completion(reply)));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  env.LLM_PROVIDER = 'openai_compatible';
  env.LLM_BASE_URL = `http://127.0.0.1:${port}/v1`;
  env.LLM_MODEL = 'test-model';
  invalidateAppSettings();
});

afterAll(async () => {
  await getDb().delete(projects).where(inArray(projects.name, [PROJECT]));
  await new Promise<void>((r) => server.close(() => r()));
});

// The shared setup truncates the maintenance tables (assets included)
// with cascade before every test, which takes projects along — so the
// fixture project is (re)inserted per test, after that sweep.
beforeEach(async () => {
  bodies = [];
  reply = '{"actions":[]}';
  resetParserWarmup();
  const db = getDb();
  const domain = await db.query.stewardship_domains.findFirst({ where: eq(stewardship_domains.active, true) });
  await db.insert(projects).values({ name: PROJECT, status: 'active', domain_id: domain?.id ?? null });
});

describe('request shape', () => {
  it('switches thinking off at the top level of the body and asks for JSON', async () => {
    await parseTranscript('water the garden tomorrow', getDb());
    expect(bodies).toHaveLength(1);
    const body = bodies[0]!;
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false, thinking: false });
    expect(body.extra_body).toBeUndefined();
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('sends names only — no row ids — with the clock and transcript after the context', async () => {
    await parseTranscript('log time on the test project', getDb());
    const user = bodies[0]!.messages.find((m) => m.role === 'user')!.content;
    expect(user).not.toMatch(UUID);
    expect(user).toContain(PROJECT);
    const ctxEnd = user.indexOf('</context>');
    expect(user.indexOf('<now>')).toBeGreaterThan(ctxEnd);
    expect(user.indexOf('<transcript>')).toBeGreaterThan(user.indexOf('<now>'));
    expect(user.endsWith('log time on the test project\n</transcript>')).toBe(true);
    // Compact JSON — no pretty-printing whitespace inside the context.
    const ctx = user.slice(user.indexOf('<context>') + 10, ctxEnd).trim();
    expect(ctx).not.toMatch(/\n/);
    const parsed = JSON.parse(ctx) as { projects: { name: string; domain?: string }[]; domains: string[] };
    expect(parsed.projects.some((p) => p.name === PROJECT && typeof p.domain === 'string')).toBe(true);
    expect(parsed.domains.length).toBeGreaterThan(0);
  });

  it('the warm-up sends the exact prefix of the real call with a one-token budget', async () => {
    await warmParser(getDb());
    await parseTranscript('anything at all', getDb());
    expect(bodies).toHaveLength(2);
    const [warm, real] = bodies as [Body, Body];
    expect(warm.max_tokens).toBe(1);
    expect(warm.messages[0]).toEqual(real.messages[0]); // identical system prompt
    const warmUser = warm.messages[1]!.content;
    const realUser = real.messages[1]!.content;
    expect(warmUser.endsWith('</context>')).toBe(true);
    expect(realUser.startsWith(warmUser)).toBe(true);
    expect(warm.chat_template_kwargs).toEqual(real.chat_template_kwargs);
  });

  it('a repeat warm-up for an unchanged context is a no-op within the window', async () => {
    await warmParser(getDb());
    await warmParser(getDb());
    expect(bodies).toHaveLength(1);
  });

  it('builds a byte-stable prefix for the same context', () => {
    const ctx = { projects: [{ name: 'A', domain: 'D' }], domains: ['D'], people: [], content_items: [] };
    expect(contextPrefix(ctx)).toBe(contextPrefix({ ...ctx }));
    const msg = buildUserMessage(ctx, { now_iso: 'n', today_date: 't' }, 'hi');
    expect(msg.startsWith(contextPrefix(ctx))).toBe(true);
  });
});

describe('response handling', () => {
  it('reports token usage and cache hits to the log sink', async () => {
    const seen: Record<string, unknown>[] = [];
    await parseTranscript('x', getDb(), { log: { info: (o) => seen.push(o) } });
    expect(seen[0]).toMatchObject({ promptTokens: 10, cachedPromptTokens: 7, completionTokens: 2, promptMs: 1.5, completionMs: 2.5 });
  });

  it('drops an inline <think> block before parsing', async () => {
    reply = '<think>\nlet me see\n</think>\n{"actions":[{"action":"create_task","title":"Water the garden"}]}';
    const res = await parseTranscript('water the garden', getDb());
    expect(res).toEqual({ kind: 'actions', actions: [{ action: 'create_task', title: 'Water the garden' }] });
  });

  it('an unclosed <think> block (budget exhausted) is no answer', async () => {
    reply = '<think>still thinking about';
    const res = await parseTranscript('water the garden', getDb());
    expect(res).toMatchObject({ kind: 'error', error: 'no_text_in_response' });
  });

  it('re-attaches ids to disambiguation candidates the model named', async () => {
    reply = `{"needs_disambiguation":true,"field":"project_match","candidates":[{"label":"${PROJECT.toLowerCase()}"},{"label":"Nowhere"}]}`;
    const res = await parseTranscript('the project', getDb());
    expect(res.kind).toBe('disambiguation');
    if (res.kind !== 'disambiguation') return;
    const row = await getDb().query.projects.findFirst({ where: eq(projects.name, PROJECT) });
    expect(res.candidates[0]).toEqual({ id: row!.id, label: PROJECT.toLowerCase() });
    expect(res.candidates[1]).toEqual({ id: 'Nowhere', label: 'Nowhere' });
  });
});

describe('helpers', () => {
  it('stripThinking', () => {
    expect(stripThinking('<think>a</think>  {"ok":1}')).toBe('{"ok":1}');
    expect(stripThinking('</think>\n{"ok":1}')).toBe('{"ok":1}');
    expect(stripThinking('{"ok":1}')).toBe('{"ok":1}');
    expect(stripThinking('<think>never ends')).toBe('');
  });

  it('resolveCandidates falls back to fuzzy matching and to the label itself', () => {
    const ids = {
      projects: new Map([['Reviews v2.4 plugin', 'p1']]),
      domains: new Map([['Field Notes', 'd1']]),
      people: new Map(),
      content_items: new Map(),
    };
    expect(resolveCandidates('project_match', [{ label: 'Reviews plugin' }], ids)).toEqual([{ id: 'p1', label: 'Reviews plugin' }]);
    expect(resolveCandidates('', ['field notes'], ids)).toEqual([{ id: 'd1', label: 'field notes' }]);
    expect(resolveCandidates('person_match', [{ label: 'Field Notes' }], ids)).toEqual([{ id: 'Field Notes', label: 'Field Notes' }]);
    expect(resolveCandidates('x', 'garbage', ids)).toEqual([]);
  });
});
