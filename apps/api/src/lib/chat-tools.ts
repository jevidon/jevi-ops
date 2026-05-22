import type { SupabaseClient } from '@supabase/supabase-js';
import type Anthropic from '@anthropic-ai/sdk';

// Tool surface for the chat query interface (spec §11). Each tool is a
// thin DB query that returns concise JSON Claude can summarize. Keep them
// small and well-described — Claude picks tools based on the description.
//
// Pattern:
//   1. JSON-schema for the tool input (passed to Claude)
//   2. handler(input, sb) — runs the query, returns plain-text-friendly JSON
//
// All queries go through the user-scoped Supabase client (RLS applies).

export interface ChatTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  handler: (input: Record<string, unknown>, sb: SupabaseClient) => Promise<unknown>;
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
  handler: async (input, sb) => {
    let q = sb
      .from('tasks')
      .select('id, title, status, due_date, completed_at, project:projects(id, name)')
      .order('created_at', { ascending: false })
      .limit(50);
    if (typeof input.title_contains === 'string') q = q.ilike('title', `%${input.title_contains}%`);
    if (input.status === 'open' || input.status === 'done') q = q.eq('status', input.status);
    if (typeof input.due_on_or_after === 'string') q = q.gte('due_date', input.due_on_or_after);
    if (typeof input.due_on_or_before === 'string') q = q.lte('due_date', input.due_on_or_before);
    if (typeof input.project_name === 'string') {
      const { data: ps } = await sb.from('projects').select('id').ilike('name', input.project_name).limit(1);
      const pid = ps?.[0]?.id;
      if (pid) q = q.eq('project_id', pid);
      else return { matches: 0, results: [], note: `No project matching "${input.project_name}"` };
    }
    const { data, error } = await q;
    if (error) return { error: error.message };
    return { matches: data?.length ?? 0, results: data ?? [] };
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
  handler: async (input, sb) => {
    let q = sb
      .from('notes')
      .select('id, body, source_type, source_reference, tags, related_quote_id, related_project_id, related_person_id, needs_review, created_at')
      .order('created_at', { ascending: false })
      .limit(30);
    if (typeof input.tag === 'string') q = q.contains('tags', [input.tag]);
    if (typeof input.body_contains === 'string') q = q.ilike('body', `%${input.body_contains}%`);
    if (typeof input.source_type === 'string') q = q.eq('source_type', input.source_type);
    if (input.needs_review === true) q = q.eq('needs_review', true);
    const { data, error } = await q;
    if (error) return { error: error.message };
    return { matches: data?.length ?? 0, results: data ?? [] };
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
  handler: async (input, sb) => {
    let q = sb
      .from('quote_annotations')
      .select('id, body, context, tags, annotated_at, quote:quotes(id, text, source_author, source_reference)')
      .order('annotated_at', { ascending: false })
      .limit(30);
    if (typeof input.body_contains === 'string') q = q.ilike('body', `%${input.body_contains}%`);
    if (typeof input.tag === 'string') q = q.contains('tags', [input.tag]);
    const { data, error } = await q;
    if (error) return { error: error.message };
    let results = data ?? [];
    if (typeof input.quote_text_contains === 'string') {
      const needle = input.quote_text_contains.toLowerCase();
      type QuoteRel = { text?: string | null };
      results = results.filter((r) => {
        const quote = (r as { quote?: QuoteRel | QuoteRel[] | null }).quote;
        const qarr = Array.isArray(quote) ? quote : quote ? [quote] : [];
        return (qarr[0]?.text ?? '').toLowerCase().includes(needle);
      });
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
  handler: async (input, sb) => {
    let q = sb
      .from('quotes')
      .select('id, text, page_number, chapter, source_author, source_reference, tags, book:books(title, author), annotations:quote_annotations(id, body, annotated_at, context)')
      .order('created_at', { ascending: false })
      .limit(30);
    if (typeof input.tag === 'string') q = q.contains('tags', [input.tag]);
    if (typeof input.text_contains === 'string') q = q.ilike('text', `%${input.text_contains}%`);
    const { data, error } = await q;
    if (error) return { error: error.message };
    let results = data ?? [];
    if (typeof input.book_or_author_contains === 'string') {
      const needle = input.book_or_author_contains.toLowerCase();
      results = results.filter((r) => {
        const author = (r.source_author ?? '').toLowerCase();
        type BookRel = { title?: string | null; author?: string | null };
        const book = (r as { book?: BookRel | BookRel[] | null }).book;
        const bookArr = Array.isArray(book) ? book : book ? [book] : [];
        const bookTitle = (bookArr[0]?.title ?? '').toLowerCase();
        const bookAuthor = (bookArr[0]?.author ?? '').toLowerCase();
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
  handler: async (input, sb) => {
    const name = String(input.project_name ?? '');
    const { data: projects } = await sb
      .from('projects')
      .select('id, name, status, hours_logged, quoted_hours, start_date, target_date, color, updated_at, domain:stewardship_domains(name)')
      .ilike('name', `%${name}%`)
      .limit(5);
    if (!projects || projects.length === 0) return { matched: 0 };
    if (projects.length > 1) return { matched: projects.length, candidates: projects.map((p) => p.name) };

    const p = projects[0]!;
    const [{ data: milestones }, { data: openTasks, count: openCount }, { data: lastActivity }] =
      await Promise.all([
        sb.from('milestones').select('title, status, weight').eq('project_id', p.id).order('position'),
        sb.from('tasks').select('id', { count: 'exact', head: false }).eq('project_id', p.id).eq('status', 'open').limit(20),
        sb.from('activity_log').select('entry, hours_logged, logged_at, source').eq('project_id', p.id).order('logged_at', { ascending: false }).limit(5),
      ]);

    return {
      project: p,
      milestones: milestones ?? [],
      open_tasks_count: openCount ?? openTasks?.length ?? 0,
      last_activity_entries: lastActivity ?? [],
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
  handler: async (input, sb) => {
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
    const { data, error } = await sb
      .from('calendar_events')
      .select('title, start_at, end_at, all_day, location, source')
      .gte('start_at', from.toISOString())
      .lte('start_at', to.toISOString())
      .order('start_at');
    if (error) return { error: error.message };
    return { range, from: from.toISOString(), to: to.toISOString(), count: data?.length ?? 0, events: data ?? [] };
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

// ─── Registry ──────────────────────────────────────────────────────────

export const CHAT_TOOLS: ChatTool[] = [
  searchTasks,
  searchNotes,
  searchQuotes,
  searchAnnotations,
  getProjectSummary,
  getRecentEvents,
];

export function toolDefsForAnthropic(): Anthropic.Tool[] {
  return CHAT_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Tool['input_schema'],
  }));
}

export async function runTool(
  name: string,
  input: Record<string, unknown>,
  sb: SupabaseClient,
): Promise<unknown> {
  const tool = CHAT_TOOLS.find((t) => t.name === name);
  if (!tool) return { error: `unknown_tool: ${name}` };
  return tool.handler(input, sb);
}
