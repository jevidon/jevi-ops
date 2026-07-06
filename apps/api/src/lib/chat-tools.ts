import { and, asc, count, desc, eq, gte, ilike, inArray, lte, sql, type SQL } from 'drizzle-orm';
import type { LlmToolDef } from './llm.js';
import { arrayContains } from 'drizzle-orm';
import { getAppTz } from './app-settings.js';
import type { Db } from './db.js';
import {
  activity_log,
  calendar_events,
  milestones as milestonesTable,
  notes,
  people,
  person_facts,
  person_interactions,
  projects,
  quote_annotations,
  quotes,
  routines,
  tasks,
} from '../db/schema.js';

// Tool surface for the chat query interface (spec §11). Each tool is a
// thin DB query that returns concise JSON the model can summarize. Keep them
// small and well-described — the model picks tools based on the description.
//
// Pattern:
//   1. JSON-schema for the tool input (passed to the model)
//   2. handler(input, db) — runs the query, returns plain-text-friendly JSON

export interface ChatTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  handler: (input: Record<string, unknown>, db: Db) => Promise<unknown>;
}

// ─── search_tasks ────────────────────────────────────────────────────────

const searchTasks: ChatTool = {
  name: 'search_tasks',
  description: 'Search tasks by title (substring, case-insensitive), status, due-date range, or project. Returns up to 50 matches with title, status, due date, project name.',
  input_schema: {
    type: 'object',
    properties: {
      title_contains: { type: 'string', description: 'Substring to match in the task title' },
      status: { type: 'string', enum: ['open', 'done'], description: 'Filter by status' },
      due_on_or_after: { type: 'string', description: 'ISO date yyyy-mm-dd' },
      due_on_or_before: { type: 'string', description: 'ISO date yyyy-mm-dd' },
      project_name: { type: 'string', description: 'Exact project name (case-insensitive)' },
    },
  },
  handler: async (input, db) => {
    const conds: SQL[] = [];
    if (typeof input.title_contains === 'string') conds.push(ilike(tasks.title, `%${input.title_contains}%`));
    if (input.status === 'open' || input.status === 'done') conds.push(eq(tasks.status, input.status));
    if (typeof input.due_on_or_after === 'string') conds.push(gte(tasks.due_date, input.due_on_or_after));
    if (typeof input.due_on_or_before === 'string') conds.push(lte(tasks.due_date, input.due_on_or_before));
    if (typeof input.project_name === 'string') {
      const ps = await db.query.projects.findMany({
        columns: { id: true },
        where: ilike(projects.name, input.project_name),
        limit: 1,
      });
      const pid = ps[0]?.id;
      if (pid) conds.push(eq(tasks.project_id, pid));
      else return { matches: 0, results: [], note: `No project matching "${input.project_name}"` };
    }
    const results = await db.query.tasks.findMany({
      columns: { id: true, title: true, status: true, due_date: true, completed_at: true },
      with: { project: { columns: { id: true, name: true } } },
      where: conds.length ? and(...conds) : undefined,
      orderBy: desc(tasks.created_at),
      limit: 50,
    });
    return { matches: results.length, results };
  },
};

// ─── search_notes ────────────────────────────────────────────────────────

const searchNotes: ChatTool = {
  name: 'search_notes',
  description: 'Search notes by tag, body substring, or source_type. Notes are free-floating thoughts — distinct from quote_annotations (which are thoughts attached to a captured quote). Use search_annotations for those. Returns up to 30 matches.',
  input_schema: {
    type: 'object',
    properties: {
      tag: { type: 'string', description: 'Match any note that has this tag' },
      body_contains: { type: 'string', description: 'Substring to match in the note body' },
      source_type: {
        type: 'string',
        enum: ['own_thought', 'reading_response', 'meeting_note', 'brainstorm', 'observation', 'other'],
        description: 'Filter by source_type (Addendum 02 §3)',
      },
      needs_review: { type: 'boolean', description: 'Only return notes flagged for re-classification' },
    },
  },
  handler: async (input, db) => {
    const conds: SQL[] = [];
    if (typeof input.tag === 'string') conds.push(arrayContains(notes.tags, [input.tag]));
    if (typeof input.body_contains === 'string') conds.push(ilike(notes.body, `%${input.body_contains}%`));
    if (typeof input.source_type === 'string') conds.push(eq(notes.source_type, input.source_type));
    if (input.needs_review === true) conds.push(eq(notes.needs_review, true));
    const results = await db.query.notes.findMany({
      columns: {
        id: true, body: true, source_type: true, source_reference: true, tags: true,
        related_quote_id: true, related_project_id: true, related_person_id: true,
        needs_review: true, created_at: true,
      },
      where: conds.length ? and(...conds) : undefined,
      orderBy: desc(notes.created_at),
      limit: 30,
    });
    return { matches: results.length, results };
  },
};

// ─── search_annotations ──────────────────────────────────────────────────

const searchAnnotations: ChatTool = {
  name: 'search_annotations',
  description: "Search quote_annotations — thoughts the user attached to specific quotes over time. Use this when the question is about what they've thought or written about quotes (rather than the quotes themselves). Returns up to 30 matches each with the parent quote text for context.",
  input_schema: {
    type: 'object',
    properties: {
      body_contains: { type: 'string', description: 'Substring to match in the annotation body' },
      tag: { type: 'string', description: 'Tag on the annotation itself' },
      quote_text_contains: { type: 'string', description: 'Substring to match in the parent quote text' },
    },
  },
  handler: async (input, db) => {
    const conds: SQL[] = [];
    if (typeof input.body_contains === 'string') conds.push(ilike(quote_annotations.body, `%${input.body_contains}%`));
    if (typeof input.tag === 'string') conds.push(arrayContains(quote_annotations.tags, [input.tag]));
    let results = await db.query.quote_annotations.findMany({
      columns: { id: true, body: true, context: true, tags: true, annotated_at: true },
      with: { quote: { columns: { id: true, text: true, source_author: true, source_reference: true } } },
      where: conds.length ? and(...conds) : undefined,
      orderBy: desc(quote_annotations.annotated_at),
      limit: 30,
    });
    if (typeof input.quote_text_contains === 'string') {
      const needle = input.quote_text_contains.toLowerCase();
      results = results.filter((r) => (r.quote?.text ?? '').toLowerCase().includes(needle));
    }
    return { matches: results.length, results };
  },
};

// ─── search_quotes ──────────────────────────────────────────────────────

const searchQuotes: ChatTool = {
  name: 'search_quotes',
  description: 'Search saved quotes by tag, text substring, or book/author. Returns up to 30 matches.',
  input_schema: {
    type: 'object',
    properties: {
      tag: { type: 'string' },
      text_contains: { type: 'string' },
      book_or_author_contains: { type: 'string' },
    },
  },
  handler: async (input, db) => {
    const conds: SQL[] = [];
    if (typeof input.tag === 'string') conds.push(arrayContains(quotes.tags, [input.tag]));
    if (typeof input.text_contains === 'string') conds.push(ilike(quotes.text, `%${input.text_contains}%`));
    let results = await db.query.quotes.findMany({
      columns: {
        id: true, text: true, page_number: true, chapter: true,
        source_author: true, source_reference: true, tags: true,
      },
      with: {
        book: { columns: { title: true, author: true } },
        annotations: { columns: { id: true, body: true, annotated_at: true, context: true } },
      },
      where: conds.length ? and(...conds) : undefined,
      orderBy: desc(quotes.created_at),
      limit: 30,
    });
    if (typeof input.book_or_author_contains === 'string') {
      const needle = input.book_or_author_contains.toLowerCase();
      results = results.filter((r) => {
        const author = (r.source_author ?? '').toLowerCase();
        const bookTitle = (r.book?.title ?? '').toLowerCase();
        const bookAuthor = (r.book?.author ?? '').toLowerCase();
        return author.includes(needle) || bookTitle.includes(needle) || bookAuthor.includes(needle);
      });
    }
    return { matches: results.length, results };
  },
};

// ─── get_project_summary ────────────────────────────────────────────────

const getProjectSummary: ChatTool = {
  name: 'get_project_summary',
  description: 'Get a snapshot of a project by name: status, hours logged, milestones, open tasks count, last activity. Use when the question is about a specific project.',
  input_schema: {
    type: 'object',
    properties: {
      project_name: { type: 'string', description: 'Project name (case-insensitive fuzzy match)' },
    },
    required: ['project_name'],
  },
  handler: async (input, db) => {
    const name = String(input.project_name ?? '');
    const matched = await db.query.projects.findMany({
      columns: {
        id: true, name: true, status: true, hours_logged: true, quoted_hours: true,
        start_date: true, target_date: true, color: true, updated_at: true,
      },
      with: { domain: { columns: { name: true } } },
      where: ilike(projects.name, `%${name}%`),
      limit: 5,
    });
    if (matched.length === 0) return { matched: 0 };
    if (matched.length > 1) return { matched: matched.length, candidates: matched.map((p) => p.name) };

    const p = matched[0]!;
    const [projectMilestones, openCountRows, lastActivity] = await Promise.all([
      db.query.milestones.findMany({
        columns: { title: true, status: true, weight: true },
        where: eq(milestonesTable.project_id, p.id),
        orderBy: asc(milestonesTable.position),
      }),
      db.select({ n: count() }).from(tasks)
        .where(and(eq(tasks.project_id, p.id), eq(tasks.status, 'open'))),
      db.query.activity_log.findMany({
        columns: { entry: true, hours_logged: true, logged_at: true, source: true },
        where: eq(activity_log.project_id, p.id),
        orderBy: desc(activity_log.logged_at),
        limit: 5,
      }),
    ]);

    return {
      project: p,
      milestones: projectMilestones,
      open_tasks_count: openCountRows[0]?.n ?? 0,
      last_activity_entries: lastActivity,
    };
  },
};

// ─── get_recent_events ──────────────────────────────────────────────────

const getRecentEvents: ChatTool = {
  name: 'get_recent_events',
  description: 'Get calendar events in a relative time window: today, this week, last week, next week. Returns title, start, end, location.',
  input_schema: {
    type: 'object',
    properties: {
      range: {
        type: 'string',
        enum: ['today', 'tomorrow', 'this_week', 'next_week', 'last_week', 'last_30_days'],
      },
    },
    required: ['range'],
  },
  handler: async (input, db) => {
    const now = new Date();
    const range = String(input.range ?? '');
    const day = 24 * 60 * 60 * 1000;
    let from: Date, to: Date;
    switch (range) {
      case 'today': from = startOfDay(now); to = endOfDay(now); break;
      case 'tomorrow': from = startOfDay(new Date(now.getTime() + day)); to = endOfDay(from); break;
      case 'this_week': from = startOfWeek(now); to = endOfWeek(now); break;
      case 'next_week': from = startOfWeek(new Date(now.getTime() + 7 * day)); to = endOfWeek(from); break;
      case 'last_week': from = startOfWeek(new Date(now.getTime() - 7 * day)); to = endOfWeek(from); break;
      case 'last_30_days': from = new Date(now.getTime() - 30 * day); to = now; break;
      default: return { error: 'unknown_range' };
    }
    const events = await db.query.calendar_events.findMany({
      columns: { title: true, start_at: true, end_at: true, all_day: true, location: true, source: true },
      where: and(
        gte(calendar_events.start_at, from.toISOString()),
        lte(calendar_events.start_at, to.toISOString()),
      ),
      orderBy: asc(calendar_events.start_at),
    });
    return { range, from: from.toISOString(), to: to.toISOString(), count: events.length, events };
  },
};

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function startOfWeek(d: Date): Date {
  // Sunday-anchored
  const x = startOfDay(d);
  x.setDate(x.getDate() - x.getDay());
  return x;
}
function endOfWeek(d: Date): Date {
  const x = startOfWeek(d);
  x.setDate(x.getDate() + 6);
  return endOfDay(x);
}

// ─── search_people ──────────────────────────────────────────────────────
//
// Lookup against the People CRM. Returns people matching the filter
// along with their facts (birthdays/anniversaries/kids/follow-ups) and
// recent interactions. One tool covers both "who do I know named Randy"
// (multi-result list) and "tell me about Randy" (single match with full
// detail), with the caller using name_contains for both.

const searchPeople: ChatTool = {
  name: 'search_people',
  description: "Look up people (the user's CRM) by name, relationship type, or company. Returns each matching person plus their facts (birthdays, anniversaries, kid names, follow-ups) and last 5 interactions. Use this for questions like 'when is Randy's birthday', 'who do I know at Acme', 'when did I last talk to Sam', 'what's my client list'.",
  input_schema: {
    type: 'object',
    properties: {
      name_contains: { type: 'string', description: 'Substring to match in the person\'s name (case-insensitive)' },
      relationship_type: {
        type: 'string',
        enum: ['client', 'family', 'church', 'friend', 'team', 'vendor', 'other'],
        description: 'Filter by relationship',
      },
      company_contains: { type: 'string', description: 'Substring to match in the company/org field' },
    },
  },
  handler: async (input, db) => {
    const conds: SQL[] = [];
    if (typeof input.name_contains === 'string') conds.push(ilike(people.name, `%${input.name_contains}%`));
    if (typeof input.relationship_type === 'string') conds.push(eq(people.relationship_type, input.relationship_type));
    if (typeof input.company_contains === 'string') conds.push(ilike(people.company, `%${input.company_contains}%`));
    const matchedPeople = await db.query.people.findMany({
      columns: {
        id: true, name: true, relationship_type: true, email: true,
        phone: true, company: true, notes: true, updated_at: true,
      },
      where: conds.length ? and(...conds) : undefined,
      orderBy: asc(people.name),
      limit: 20,
    });
    if (matchedPeople.length === 0) return { matches: 0, results: [] };

    // Fan out to facts + interactions in one batch each. Cheaper than
    // per-person queries when the result set is small.
    const ids = matchedPeople.map((p) => p.id);
    const [facts, interactions] = await Promise.all([
      db.query.person_facts.findMany({
        columns: { person_id: true, fact_type: true, fact_value: true, date_relevant: true, recurring: true },
        where: inArray(person_facts.person_id, ids),
        orderBy: sql`${person_facts.date_relevant} asc nulls last`,
      }),
      db.query.person_interactions.findMany({
        columns: { person_id: true, interaction_type: true, notes: true, occurred_at: true },
        where: inArray(person_interactions.person_id, ids),
        orderBy: desc(person_interactions.occurred_at),
        limit: ids.length * 5,
      }),
    ]);

    const factsBy = new Map<string, unknown[]>();
    for (const f of facts) {
      const list = factsBy.get(f.person_id) ?? [];
      list.push({
        type: f.fact_type,
        value: f.fact_value,
        date: f.date_relevant,
        recurring: f.recurring,
      });
      factsBy.set(f.person_id, list);
    }
    const intsBy = new Map<string, unknown[]>();
    for (const i of interactions) {
      const list = intsBy.get(i.person_id) ?? [];
      // Trim each person to their 5 most recent.
      if (list.length < 5) {
        list.push({
          type: i.interaction_type,
          notes: i.notes,
          occurred_at: i.occurred_at,
        });
      }
      intsBy.set(i.person_id, list);
    }

    const results = matchedPeople.map((p) => ({
      ...p,
      facts: factsBy.get(p.id) ?? [],
      recent_interactions: intsBy.get(p.id) ?? [],
    }));
    return { matches: results.length, results };
  },
};

// ─── search_routines ────────────────────────────────────────────────────
//
// Daily habits + streak data. Useful for questions like "what's my
// streak on read the Bible", "did I take meds today", "which routines
// haven't I done today".

const searchRoutines: ChatTool = {
  name: 'search_routines',
  description: 'Search the user\'s daily routines (habits with streak tracking). Returns each routine with current streak, longest streak, whether it\'s done today, and recent completion history. Use for questions about habits, streaks, daily routines, or "did I do X today".',
  input_schema: {
    type: 'object',
    properties: {
      name_contains: { type: 'string', description: 'Substring to match in the routine name' },
      time_of_day: {
        type: 'string',
        enum: ['morning', 'afternoon', 'evening', 'anytime'],
        description: 'Filter to routines in a specific time bucket',
      },
      include_archived: { type: 'boolean', description: 'Include archived (inactive) routines' },
    },
  },
  handler: async (input, db) => {
    const conds: SQL[] = [];
    if (input.include_archived !== true) conds.push(eq(routines.active, true));
    if (typeof input.name_contains === 'string') conds.push(ilike(routines.name, `%${input.name_contains}%`));
    if (typeof input.time_of_day === 'string') conds.push(eq(routines.time_of_day, input.time_of_day));
    const rows = await db.query.routines.findMany({
      columns: {
        id: true, name: true, description: true, time_of_day: true,
        specific_time: true, active: true,
      },
      with: { completions: { columns: { completed_date: true } } },
      where: conds.length ? and(...conds) : undefined,
      orderBy: asc(routines.position),
    });

    // Compute today + last-90-day stats inline. We mirror what
    // routine-stats.ts does in shared but keep this self-contained so
    // the chat tool doesn't depend on a workspace import.
    const todayIso = todayInTz(await getAppTz());

    const results = rows.map((r) => {
      const dates = (r.completions ?? [])
        .map((c) => c.completed_date)
        .sort()
        .reverse();
      const set = new Set(dates);
      const done_today = set.has(todayIso);

      // Current streak: walks back from today (or yesterday if today
      // isn't done yet — same forgiveness rule as the UI).
      let current = 0;
      let cursor = todayIso;
      if (!set.has(cursor)) {
        cursor = shiftDay(cursor, -1);
        if (!set.has(cursor)) cursor = '';
      }
      while (cursor && set.has(cursor)) {
        current += 1;
        cursor = shiftDay(cursor, -1);
      }

      // Last 7d / 30d windows.
      const last7 = dates.filter((d) => daysBetween(d, todayIso) < 7).length;
      const last30 = dates.filter((d) => daysBetween(d, todayIso) < 30).length;

      return {
        id: r.id,
        name: r.name,
        description: r.description,
        time_of_day: r.time_of_day,
        specific_time: r.specific_time,
        active: r.active,
        done_today,
        current_streak: current,
        completions_7d: last7,
        completions_30d: last30,
        total_completions: dates.length,
        recent_completions: dates.slice(0, 10),
      };
    });
    return { matches: results.length, today: todayIso, results };
  },
};

function todayInTz(tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}`;
}

function shiftDay(iso: string, n: number): string {
  const y = parseInt(iso.slice(0, 4), 10);
  const m = parseInt(iso.slice(5, 7), 10) - 1;
  const d = parseInt(iso.slice(8, 10), 10);
  const date = new Date(Date.UTC(y, m, d + n));
  return date.toISOString().slice(0, 10);
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.UTC(
    parseInt(fromIso.slice(0, 4), 10),
    parseInt(fromIso.slice(5, 7), 10) - 1,
    parseInt(fromIso.slice(8, 10), 10),
  );
  const to = Date.UTC(
    parseInt(toIso.slice(0, 4), 10),
    parseInt(toIso.slice(5, 7), 10) - 1,
    parseInt(toIso.slice(8, 10), 10),
  );
  return Math.round((to - from) / 86_400_000);
}

// ─── Registry ──────────────────────────────────────────────────────────

export const CHAT_TOOLS: ChatTool[] = [
  searchTasks,
  searchNotes,
  searchQuotes,
  searchAnnotations,
  getProjectSummary,
  getRecentEvents,
  searchPeople,
  searchRoutines,
];

export function toolDefs(): LlmToolDef[] {
  return CHAT_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
  }));
}

export async function runTool(
  name: string,
  input: Record<string, unknown>,
  db: Db,
): Promise<unknown> {
  const tool = CHAT_TOOLS.find((t) => t.name === name);
  if (!tool) return { error: `unknown_tool: ${name}` };
  return tool.handler(input, db);
}
