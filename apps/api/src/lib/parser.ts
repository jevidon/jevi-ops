import { asc, eq, gte, not, inArray } from 'drizzle-orm';
import { chatComplete, isLlmConfigured, prefillPrompt, type LlmUsage } from './llm.js';
import { getAppTz } from './app-settings.js';
import { bestMatch } from './match.js';
import type { Db } from './db.js';
import { content_items, person_interactions, projects, stewardship_domains } from '../db/schema.js';

// Voice parser — spec §14. Receives a transcript + the db handle (for
// context gathering), returns a structured ParseResult.

// ─── Context gathered from the DB and sent with every request ────────────
//
// What the model sees is NAMES ONLY. Every *_match field it emits is a
// phrase the executor resolves by fuzzy name match (lib/match.ts), so
// row ids in the prompt bought nothing and cost a lot: a UUID is ~36
// tokens against ~5 for a name, and on a local model prefill is the
// whole latency story. Ids stay server-side in `ContextIds` and are
// re-attached to disambiguation candidates after the fact.
//
// The lists are sorted so the serialized context is byte-identical
// between captures while the data is unchanged — that is what lets the
// server's prompt cache carry the prefix from one request to the next.

export interface ParseContext {
  /** Active projects with the name of their domain (when assigned). */
  projects: { name: string; domain?: string }[];
  domains: string[];
  /** People interacted with in the last 30 days. */
  people: string[];
  /** Content items not yet done. */
  content_items: { title: string; status: string }[];
}

/** Name → id maps for everything in `ParseContext`, kept out of the prompt. */
export interface ContextIds {
  projects: Map<string, string>;
  domains: Map<string, string>;
  people: Map<string, string>;
  content_items: Map<string, string>;
}

export interface Clock {
  now_iso: string;
  today_date: string; // ISO yyyy-mm-dd in the app timezone
}

interface Gathered {
  context: ParseContext;
  ids: ContextIds;
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

async function gatherContext(db: Db): Promise<Gathered> {
  // Last 30 days cutoff for "recent people"
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [activeProjects, activeDomains, interactions, activeContent] = await Promise.all([
    db.query.projects.findMany({
      columns: { id: true, name: true, domain_id: true },
      where: eq(projects.status, 'active'),
      orderBy: asc(projects.name),
      limit: 50,
    }),
    db.query.stewardship_domains.findMany({
      columns: { id: true, name: true },
      where: eq(stewardship_domains.active, true),
      orderBy: asc(stewardship_domains.name),
    }),
    db.query.person_interactions.findMany({
      columns: { person_id: true },
      with: { person: { columns: { id: true, name: true } } },
      where: gte(person_interactions.occurred_at, thirtyDaysAgo),
      limit: 100,
    }),
    db.query.content_items.findMany({
      columns: { id: true, title: true, status: true },
      where: not(inArray(content_items.status, ['done'])),
      orderBy: asc(content_items.title),
      limit: 50,
    }),
  ]);

  const domainName = new Map(activeDomains.map((d) => [d.id, d.name]));

  // Dedup people pulled from interactions.
  const peopleMap = new Map<string, { id: string; name: string }>();
  for (const row of interactions) {
    const p = row.person;
    if (p?.id) peopleMap.set(p.id, { id: p.id, name: p.name });
  }
  const people = Array.from(peopleMap.values()).sort(byName);

  const ids: ContextIds = {
    projects: new Map(activeProjects.map((r) => [r.name, r.id])),
    domains: new Map(activeDomains.map((r) => [r.name, r.id])),
    people: new Map(people.map((r) => [r.name, r.id])),
    content_items: new Map(activeContent.map((r) => [r.title, r.id])),
  };

  return {
    context: {
      projects: activeProjects.map((r) => {
        const domain = r.domain_id ? domainName.get(r.domain_id) : undefined;
        return domain ? { name: r.name, domain } : { name: r.name };
      }),
      domains: activeDomains.map((r) => r.name),
      people: people.map((r) => r.name),
      content_items: activeContent.map((r) => ({ title: r.title, status: r.status })),
    },
    ids,
  };
}

async function clock(): Promise<Clock> {
  const now = new Date();
  const tz = await getAppTz();
  const today_date = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  return { now_iso: now.toISOString(), today_date };
}

// ─── User message layout ─────────────────────────────────────────────────
//
// Ordered for prefix caching: the static system prompt, then the context
// (stable while the DB is unchanged), and only then the two things that
// differ on every call — the clock and the transcript. The warm-up sends
// the prefix through </context>; the real call appends the rest, so the
// server re-processes only a few dozen tokens. Compact JSON: whitespace
// is tokens.

/** The cache-stable head of the user message: everything through </context>. */
export function contextPrefix(context: ParseContext): string {
  return ['<context>', JSON.stringify(context), '</context>'].join('\n');
}

export function buildUserMessage(context: ParseContext, clk: Clock, transcript: string): string {
  return [
    contextPrefix(context),
    `<now>${JSON.stringify(clk)}</now>`,
    '<transcript>',
    transcript,
    '</transcript>',
  ].join('\n');
}

// ─── System prompt (static — cached via prompt caching) ──────────────────

const SYSTEM_PROMPT = `You are a voice-transcript parser for Jevi's personal operations dashboard. \
You receive a transcript of something Jevi spoke and convert it to a JSON array \
of structured actions for the backend to execute against a Postgres database.

Action types you may produce (use the exact "action" string for each):

- create_task: { action, title, due_date?, due_time?, priority?, project_match?, domain_match?, parent_task_match?, reminder_offsets? }
  domain_match is a sibling of project_match — set when the user names a domain ("Field Notes", "Life", "Site Nitro") without picking a project. If the user names a specific project, set project_match alone; the backend derives the domain from the project. If neither is clearly named, leave both empty — the server defaults the task to the Inbox catch-all domain.
- complete_task: { action, task_match }
- create_project: { action, name, domain_match?, target_date? }
- update_project_status: { action, project_match, status }
  status ∈ "active" | "paused" | "done" | "archived"
- log_activity: { action, project_match, entry, hours_logged? }
- update_milestone: { action, project_match, milestone_match, progress_pct?, status? }
- create_calendar_event: { action, title, start, end, location?, attendees? }
  start/end are ISO 8601 with timezone offset
- create_note: { action, body, source_type?, source_reference?, tags?, project_match?, person_match?, quote_match?, needs_review? }
  source_type ∈ "own_thought" | "reading_response" | "meeting_note" | "brainstorm" | "observation" | "other"
- create_quote: { action, text, book_match?, page_number?, chapter?, source_type?, source_reference?, source_url?, source_author?, tags?, annotation_body? }
  source_type ∈ "book" | "article" | "podcast" | "sermon" | "video" | "conversation" | "other"
  source_reference is the title/show/episode of the source (e.g. "The Problem That Won't Let You Go")
  source_url is the link to the source — used for YouTube videos, podcast episode pages, article URLs, etc. ALWAYS set this when the user provides a URL alongside a quote; it's separate from source_reference so the UI can render the title as a hyperlink.
  source_type='video' specifically for YouTube / Vimeo / standalone videos. Use 'podcast' for podcast episodes even if streamed on YouTube.
  annotation_body is OPTIONAL — only set when the user bundles a thought with the quote in the same utterance
- create_quote_annotation: { action, quote_match, body, context?, tags? }
  context ∈ "on_capture" | "on_revisit" | "on_surface" | "unspecified"
- create_journal_entry: { action, text, date? }
- create_person_fact: { action, person_match, fact_type, fact_value, date_relevant?, recurring? }
  fact_type ∈ "anniversary" | "birthday" | "kid_name" | "shared" | "follow_up" | "other"
- update_content_item: { action, item_match, status?, video_url?, outline_md? }
- add_inventory_item: { action, category, brand?, model?, serial?, purchase_date?, purchase_price? }
- set_resurface_weight: { action, target_kind, target_match, weight }
  target_kind ∈ "quote" | "note" | "journal"
  weight ∈ 0 (excluded) | 1 (normal) | 2 (boost 2×) | 5 (boost 5×)
  Triggers: "boost", "surface more", "show me more often", "feature" → 2 (or 5 for "way more"/"top of mind")
            "exclude", "hide", "stop showing", "don't surface" → 0
            "reset", "back to normal", "default" → 1
  Examples:
  - "Boost the Cal Newport quote about focus" → {action:"set_resurface_weight", target_kind:"quote", target_match:"Cal Newport quote about focus", weight:2}
  - "Stop surfacing that note about my failed experiment" → {..., target_kind:"note", target_match:"failed experiment", weight:0}
  - "Feature yesterday's journal entry" → {..., target_kind:"journal", target_match:"yesterday's entry", weight:2}

The *_match fields are short fuzzy phrases (e.g. "the Reviews plugin", "Randy", "Mere Christianity", \
"that Cal Newport quote about focus"). The backend resolves them by name. The <context> block lists \
what exists: active projects (each with its domain), domains, recently seen people, and in-progress \
content items — by name only. Prefer those exact names in *_match fields when the user clearly means one of them.

# Notes & Quotes routing (Addendum 02 §4)

The user thinks in different shapes — quotes, thoughts about quotes, free thoughts, reading responses, \
meeting notes, journal entries. Route precisely:

1. **Quote (with optional bundled thought)** — explicit quote framing + attribution.
   Signals: "save a quote", "quote from <book/author>", attribution present, possessive of others' words.
   If a thought is bundled ("My thought on this: ..."): emit create_quote with annotation_body set.
   Examples:
   - "Save this quote from Deep Work by Cal Newport, page 47: ..." → create_quote
   - "Quote from Stewardship by Peter Block: ... My thought: ..." → create_quote with annotation_body

2. **Annotation on an existing quote** — reference to a saved quote + annotation framing.
   Signals: "the Cal Newport quote", "that quote about ...", "add a thought to", "annotate", "another thought on".
   Examples:
   - "Add a thought to that Cal Newport quote about being immersed: ..." → create_quote_annotation
   - "On the Stewardship book quote about ownership: ..." → create_quote_annotation

3. **Reading response** — reading context, no verbatim attribution.
   Signals: "I was reading", "while reading", "an article on Substack", thoughts sparked by reading.
   → create_note with source_type='reading_response', source_reference set to whatever was named.

4. **Meeting note** — person name + conversation framing.
   Signals: "after my call with...", "from my meeting with...", "<Person> mentioned...".
   → create_note with source_type='meeting_note', person_match set.

5. **Brainstorm** — multiple loose ideas, explicit framing.
   Signals: "brainstorming", "loose ideas", "thinking out loud about ...".
   → create_note with source_type='brainstorm'.

6. **Own thought** — generic capture, no external source.
   Signals: "thought to capture", "random idea", "note to self", or NO framing at all.
   → create_note with source_type='own_thought'. THIS IS THE SAFE DEFAULT.

7. **Journal entry** — explicit journal framing.
   Signals: "journal entry", "log for today", "today I ...".
   → create_journal_entry.

8. **Activity log** — project name + work activity + (often) time.
   Signals: "logged time on", "worked on", "made progress on", "logged X minutes/hours on <project>".
   → log_activity with project_match.

## Default-when-ambiguous

If you can't confidently route an utterance to one of the above, emit \
create_note with source_type='own_thought' AND needs_review=true. Never lose \
the capture. A note can be re-classified later; a lost thought can't be \
recovered.

Output format — you MUST return ONLY a single JSON object, with no markdown \
fences, no preamble, no trailing prose. The object is exactly one of these \
three shapes:

  { "actions": [ ...action objects... ] }
  { "needs_disambiguation": true, "field": "<field-name>", "candidates": [ {"label": "<exact name from context>"} ] }
  { "error": "<reason>", "transcript": "<original transcript>" }

Rules:
1. Output rule is non-negotiable: respond with one JSON object and nothing else. \
   No \`\`\`json fences, no explanation, no "Here is the JSON:".
2. A single utterance can produce multiple actions — return an array in "actions".
3. Resolve relative dates to ISO yyyy-mm-dd in Mountain Time using "today_date" from the <now> block. \
   "tomorrow" → next day, "Friday" → upcoming Friday, "next week" → 7 days from today.
4. For calendar events: convert times to ISO 8601 with -07:00 (MST) or -06:00 (MDT) offset based on date.
5. If a match is genuinely ambiguous (transcript could mean multiple distinct projects/people), \
   put it in needs_disambiguation instead of guessing.
6. If you can't parse the input confidently, return the error shape.
7. Keep titles concise (under 100 chars). Strip filler words from notes/activity entries.
8. Default priority is 4 (lowest). Use 1-3 only if user explicitly says "important", "urgent", "high priority", etc.
9. Default fact_type for ambiguous person facts is "other".
10. Task reminders (reminder_offsets) default rule:
    - If the task has a due_time AND the user did NOT mention reminders → emit reminder_offsets: [0] (the cron treats 0 as "at the due moment").
    - If the user explicitly said "no reminder" / "don't remind me" / "skip the reminder" → emit reminder_offsets: [].
    - If the user specified a lead time ("remind me 15 minutes before", "an hour before", "30 min ahead") → emit reminder_offsets: [<minutes>], converting the spoken phrasing to integer minutes (1h = 60, 1.5h = 90, etc.).
    - If the task has NO due_time → omit reminder_offsets entirely; reminders need a due_time to fire.
    - Multiple reminders ("ping me an hour before AND at the start") → emit all the offsets in one array, sorted descending: [60, 0].`;

// ─── Output schema (passed via output_config.format on every request) ────

// We tried structured outputs (`output_config.format`) but Anthropic's schema
// validator is strict in ways that bite this shape: heterogeneous array items
// (13 discriminated action types) can't be expressed cleanly. Instead we lean
// on the system prompt + JSON.parse + downstream shape detection. The model
// is reliable enough at following the JSON-only instruction; the catch path
// turns occasional misbehavior into a clean parse_error chip.

// ─── Parse result type — discriminated union ─────────────────────────────

// Loose action type for the parser — full validation happens via the
// VoiceActionSchema in @jevi-ops/shared at the executor boundary.
export type ParsedAction = { action: string } & Record<string, unknown>;

export type ParseResult =
  | { kind: 'actions'; actions: ParsedAction[] }
  | { kind: 'disambiguation'; field: string; candidates: { id: string; label: string }[] }
  | { kind: 'error'; error: string; transcript: string };

// ─── Disambiguation candidates → ids ────────────────────────────────────

// The model names candidates; ids never entered the prompt. Re-attach them
// here: exact name first, then the same fuzzy scorer the executor uses.
// `field` narrows the lookup to the matching list when it can. A label we
// can't place keeps itself as its id — the UI only displays candidates.
const FIELD_LISTS: Record<string, keyof ContextIds> = {
  project_match: 'projects',
  domain_match: 'domains',
  person_match: 'people',
  item_match: 'content_items',
};

export function resolveCandidates(
  field: string,
  raw: unknown,
  ids: ContextIds,
): { id: string; label: string }[] {
  if (!Array.isArray(raw)) return [];
  const listKey = FIELD_LISTS[field];
  const pools: Map<string, string>[] = listKey
    ? [ids[listKey]]
    : [ids.projects, ids.domains, ids.people, ids.content_items];
  const out: { id: string; label: string }[] = [];
  for (const c of raw) {
    const label =
      typeof c === 'string' ? c : typeof c === 'object' && c !== null ? String((c as { label?: unknown }).label ?? '') : '';
    if (!label) continue;
    let id: string | null = null;
    for (const pool of pools) {
      const exact = [...pool.entries()].find(([name]) => name.toLowerCase() === label.toLowerCase());
      if (exact) { id = exact[1]; break; }
    }
    if (!id) {
      const all = pools.flatMap((pool) => [...pool.entries()].map(([name, pid]) => ({ id: pid, label: name })));
      id = bestMatch(label, all)?.id ?? null;
    }
    out.push({ id: id ?? label, label });
  }
  return out;
}

// ─── Warm-up ─────────────────────────────────────────────────────────────

// Push the system prompt + context through the server's prompt cache
// while the user is still recording (the client pings /api/capture/warm on
// record start) or while the audio is with the STT server (the audio route
// fires it before transcribing). One flight at a time; a repeat within the
// window for the same context is a no-op — the cache already holds it.
const WARM_TTL_MS = 20_000;
let warm: { key: string; at: number; done: Promise<LlmUsage | null> } | null = null;

/** Test hook: forget the last warm-up so the next call goes out again. */
export function resetParserWarmup(): void {
  warm = null;
}

export async function warmParser(db: Db): Promise<LlmUsage | null> {
  if (!(await isLlmConfigured())) return null;
  const { context } = await gatherContext(db);
  const key = contextPrefix(context);
  if (warm && warm.key === key && Date.now() - warm.at < WARM_TTL_MS) return warm.done;
  const done = prefillPrompt({
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: key }],
    jsonMode: true,
    effort: 'low',
  }).catch(() => null); // best effort — the real call still works cold
  warm = { key, at: Date.now(), done };
  return done;
}

// ─── Main entry point ────────────────────────────────────────────────────

export interface ParseOptions {
  /** Structured log sink (a Fastify request logger fits). */
  log?: { info: (obj: Record<string, unknown>, msg: string) => void };
}

export async function parseTranscript(
  transcript: string,
  db: Db,
  opts: ParseOptions = {},
): Promise<ParseResult> {
  const [{ context, ids }, clk] = await Promise.all([gatherContext(db), clock()]);

  // Low effort + JSON mode: parsing is well-scoped, doesn't need deep
  // reasoning (and on hybrid-reasoning local models `low` switches
  // thinking off). The system prompt is static and the context is
  // cache-stable; see buildUserMessage for the ordering.
  const started = Date.now();
  const response = await chatComplete({
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserMessage(context, clk, transcript) }],
    jsonMode: true,
    maxTokens: 2048,
    effort: 'low',
  });
  opts.log?.info(
    { ...response.usage, elapsed_ms: Date.now() - started, transcript_chars: transcript.length },
    'parser llm call',
  );

  if (!response.text) {
    return { kind: 'error', error: 'no_text_in_response', transcript };
  }

  // Strip accidental markdown fences if the model regresses (`​`​`​json ... `​`​`).
  let raw = response.text.trim();
  if (raw.startsWith('```')) {
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'error', error: 'invalid_json_from_model', transcript };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { kind: 'error', error: 'non_object_response', transcript };
  }

  const p = parsed as Record<string, unknown>;
  if ('actions' in p && Array.isArray(p.actions)) {
    return { kind: 'actions', actions: p.actions as ParsedAction[] };
  }
  if (p.needs_disambiguation === true) {
    const field = String(p.field ?? '');
    return { kind: 'disambiguation', field, candidates: resolveCandidates(field, p.candidates, ids) };
  }
  if (typeof p.error === 'string') {
    return { kind: 'error', error: p.error, transcript };
  }

  return { kind: 'error', error: 'unrecognized_response_shape', transcript };
}
