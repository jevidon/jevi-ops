import type { SupabaseClient } from '@supabase/supabase-js';
import type Anthropic from '@anthropic-ai/sdk';
import { anthropic, anthropicModel } from './anthropic.js';
import { getAppTz } from './app-settings.js';

// Voice parser — spec §14. Receives a transcript + a user-scoped Supabase
// client (for context gathering), returns a structured ParseResult.

// ─── Context gathered from the DB and sent with every request ────────────

interface ParseContext {
  now_iso: string;
  today_date: string; // ISO yyyy-mm-dd in Mountain Time
  active_projects: { id: string; name: string; domain_id?: string | null }[];
  active_domains: { id: string; name: string }[];
  recent_people: { id: string; name: string }[];
  active_content_items: { id: string; title: string; status: string }[];
}

async function gatherContext(sb: SupabaseClient): Promise<ParseContext> {
  const now = new Date();
  const tz = await getAppTz();
  const todayDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);

  // Last 30 days cutoff for "recent people"
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [projects, domains, people, content] = await Promise.all([
    sb.from('projects').select('id, name, domain_id').eq('status', 'active').limit(50),
    sb.from('stewardship_domains').select('id, name').eq('active', true),
    sb.from('person_interactions')
      .select('person_id, people(id, name)')
      .gte('occurred_at', thirtyDaysAgo)
      .limit(100),
    sb.from('content_items')
      .select('id, title, status')
      .not('status', 'in', '("done")')
      .limit(50),
  ]);

  // Dedup people pulled from interactions. Supabase types the FK join as an
  // array regardless of cardinality, so flatten before dedup.
  const peopleMap = new Map<string, { id: string; name: string }>();
  type PeopleJoinRow = { people: { id: string; name: string } | { id: string; name: string }[] | null };
  for (const row of (people.data ?? []) as unknown as PeopleJoinRow[]) {
    const arr = Array.isArray(row.people) ? row.people : row.people ? [row.people] : [];
    for (const p of arr) {
      if (p?.id) peopleMap.set(p.id, { id: p.id, name: p.name });
    }
  }

  return {
    now_iso: now.toISOString(),
    today_date: todayDate,
    active_projects: projects.data ?? [],
    active_domains: domains.data ?? [],
    recent_people: Array.from(peopleMap.values()),
    active_content_items: content.data ?? [],
  };
}

// ─── System prompt (static — cached via prompt caching) ──────────────────

const SYSTEM_PROMPT = `You are a voice-transcript parser for Jerad's personal operations dashboard. \
You receive a transcript of something Jerad spoke and convert it to a JSON array \
of structured actions for the backend to execute against a Postgres database.

Action types you may produce (use the exact "action" string for each):

- create_task: { action, title, due_date?, due_time?, priority?, project_match?, parent_task_match?, reminder_offsets? }
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
- create_quote: { action, text, book_match?, page_number?, chapter?, source_type?, source_reference?, source_author?, tags?, annotation_body? }
  source_type ∈ "book" | "article" | "podcast" | "conversation" | "sermon" | "other"
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
"that Cal Newport quote about focus"). The backend resolves them to IDs against the context below.

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
  { "needs_disambiguation": true, "field": "<field-name>", "candidates": [ {"id": "...", "label": "..."} ] }
  { "error": "<reason>", "transcript": "<original transcript>" }

Rules:
1. Output rule is non-negotiable: respond with one JSON object and nothing else. \
   No \`\`\`json fences, no explanation, no "Here is the JSON:".
2. A single utterance can produce multiple actions — return an array in "actions".
3. Resolve relative dates to ISO yyyy-mm-dd in Mountain Time using "today_date" from context. \
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
// VoiceActionSchema in @jerad-ops/shared at the executor boundary.
export type ParsedAction = { action: string } & Record<string, unknown>;

export type ParseResult =
  | { kind: 'actions'; actions: ParsedAction[] }
  | { kind: 'disambiguation'; field: string; candidates: { id: string; label: string }[] }
  | { kind: 'error'; error: string; transcript: string };

// ─── Main entry point ────────────────────────────────────────────────────

export async function parseTranscript(
  transcript: string,
  sb: SupabaseClient,
): Promise<ParseResult> {
  const context = await gatherContext(sb);

  // Request body. Adaptive thinking + low effort: parsing is well-scoped,
  // doesn't need deep reasoning. System prompt is static (cached); per-request
  // context goes in the user message so it doesn't break the cached prefix.
  const requestBody: Anthropic.MessageCreateParamsNonStreaming = {
    model: anthropicModel(),
    max_tokens: 2048,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'low' },
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: [
              '<context>',
              JSON.stringify(context, null, 2),
              '</context>',
              '',
              '<transcript>',
              transcript,
              '</transcript>',
            ].join('\n'),
          },
        ],
      },
    ],
  } as Anthropic.MessageCreateParamsNonStreaming;

  const response: Anthropic.Message = await anthropic().messages.create(requestBody);

  // The structured-output guarantee means the first text block is valid JSON
  // matching our schema. Find it and parse.
  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  if (!textBlock) {
    return { kind: 'error', error: 'no_text_in_response', transcript };
  }

  // Strip accidental markdown fences if the model regresses (`​`​`​json ... `​`​`).
  let raw = textBlock.text.trim();
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
    return {
      kind: 'disambiguation',
      field: String(p.field ?? ''),
      candidates: (p.candidates as { id: string; label: string }[]) ?? [],
    };
  }
  if (typeof p.error === 'string') {
    return { kind: 'error', error: p.error, transcript };
  }

  return { kind: 'error', error: 'unrecognized_response_shape', transcript };
}
