import type { SupabaseClient } from '@supabase/supabase-js';
import type { ParsedAction } from './parser.js';
import type { CaptureSource } from '@jerad-ops/shared/schemas';
import {
  matchProject, matchDomain, matchPerson, matchTask,
  matchBook, matchContentItem, matchMilestone, matchQuote,
} from './match.js';
import { insertEvent as insertGoogleEvent, loadTokens as loadGoogleTokens } from './google.js';
import { getAppTz } from './app-settings.js';

// Action executor — dispatch each parsed action to the right table.
// Returns a per-action result so the client can confirm what happened.

export interface ActionResult {
  action: string;
  status: 'success' | 'skipped' | 'failed';
  message: string;
  entity_id?: string;     // id of the row created/updated
  entity_kind?: string;   // table name
}

// Per-invocation context threaded into each handler. We use this for
// the `source` column on rows we create — different tables use
// different vocabularies, so each handler picks the right value via
// sourceFor() rather than the dispatcher choosing for it.
export interface ExecuteOptions {
  captureSource?: CaptureSource;       // 'voice' | 'text'; default 'voice'
}

// Map (captureSource, target table) → the value the table's CHECK
// constraint actually accepts. tasks/activity_log use 'manual' for
// typed input; journal_entries use 'typed'. Voice always maps to
// 'voice' across all three.
type SourceColumnTable = 'tasks' | 'activity_log' | 'journal_entries';
function sourceFor(
  table: SourceColumnTable,
  captureSource: CaptureSource | undefined,
): string {
  if (captureSource === 'text') {
    return table === 'journal_entries' ? 'typed' : 'manual';
  }
  return 'voice';
}

// ─── Helper: read a string property without TypeScript indexing complaints ─
const str = (a: ParsedAction, k: string): string | undefined => {
  const v = a[k];
  return typeof v === 'string' ? v : undefined;
};
const num = (a: ParsedAction, k: string): number | undefined => {
  const v = a[k];
  return typeof v === 'number' ? v : undefined;
};

// ─── One handler per action type ─────────────────────────────────────────

async function createTask(
  sb: SupabaseClient,
  a: ParsedAction,
  opts: ExecuteOptions = {},
): Promise<ActionResult> {
  const title = str(a, 'title');
  if (!title) return { action: a.action, status: 'failed', message: 'missing_title' };

  const project_id = await matchProject(sb, str(a, 'project_match'));
  const parent_task_id = await matchTask(sb, str(a, 'parent_task_match'));

  const insert: Record<string, unknown> = {
    title,
    priority: num(a, 'priority') ?? 4,
    source: sourceFor('tasks', opts.captureSource),
  };
  if (str(a, 'due_date')) insert.due_date = str(a, 'due_date');
  if (str(a, 'due_time')) insert.due_time = str(a, 'due_time');
  if (project_id) insert.project_id = project_id;
  if (parent_task_id) insert.parent_task_id = parent_task_id;
  if (Array.isArray(a.reminder_offsets)) insert.reminder_offsets = a.reminder_offsets;

  const { data, error } = await sb.from('tasks').insert(insert).select('id').single();
  if (error) return { action: a.action, status: 'failed', message: error.message };
  return {
    action: a.action,
    status: 'success',
    message: `Task created: ${title}`,
    entity_id: data.id,
    entity_kind: 'tasks',
  };
}

async function completeTask(sb: SupabaseClient, a: ParsedAction): Promise<ActionResult> {
  const taskId = await matchTask(sb, str(a, 'task_match'));
  if (!taskId) return { action: a.action, status: 'skipped', message: 'task_not_found' };
  const { error } = await sb
    .from('tasks')
    .update({ status: 'done', completed_at: new Date().toISOString() })
    .eq('id', taskId);
  if (error) return { action: a.action, status: 'failed', message: error.message };
  return {
    action: a.action,
    status: 'success',
    message: 'Task marked done',
    entity_id: taskId,
    entity_kind: 'tasks',
  };
}

async function createProject(sb: SupabaseClient, a: ParsedAction): Promise<ActionResult> {
  const name = str(a, 'name');
  if (!name) return { action: a.action, status: 'failed', message: 'missing_name' };
  const domain_id = await matchDomain(sb, str(a, 'domain_match'));
  const insert: Record<string, unknown> = { name };
  if (domain_id) insert.domain_id = domain_id;
  if (str(a, 'target_date')) insert.target_date = str(a, 'target_date');
  const { data, error } = await sb.from('projects').insert(insert).select('id').single();
  if (error) return { action: a.action, status: 'failed', message: error.message };
  return { action: a.action, status: 'success', message: `Project created: ${name}`, entity_id: data.id, entity_kind: 'projects' };
}

async function updateProjectStatus(sb: SupabaseClient, a: ParsedAction): Promise<ActionResult> {
  const id = await matchProject(sb, str(a, 'project_match'));
  if (!id) return { action: a.action, status: 'skipped', message: 'project_not_found' };
  const newStatus = str(a, 'status');
  if (!newStatus) return { action: a.action, status: 'failed', message: 'missing_status' };
  const update: Record<string, unknown> = { status: newStatus };
  if (newStatus === 'done') update.completed_at = new Date().toISOString();
  const { error } = await sb.from('projects').update(update).eq('id', id);
  if (error) return { action: a.action, status: 'failed', message: error.message };
  return { action: a.action, status: 'success', message: `Project status → ${newStatus}`, entity_id: id, entity_kind: 'projects' };
}

async function logActivity(
  sb: SupabaseClient,
  a: ParsedAction,
  opts: ExecuteOptions = {},
): Promise<ActionResult> {
  const entry = str(a, 'entry');
  if (!entry) return { action: a.action, status: 'failed', message: 'missing_entry' };
  const project_id = await matchProject(sb, str(a, 'project_match'));
  const hours = num(a, 'hours_logged');

  const insert: Record<string, unknown> = { entry, source: sourceFor('activity_log', opts.captureSource) };
  if (project_id) insert.project_id = project_id;
  if (hours !== undefined) insert.hours_logged = hours;

  const { data, error } = await sb.from('activity_log').insert(insert).select('id').single();
  if (error) return { action: a.action, status: 'failed', message: error.message };

  // Bump projects.hours_logged so the list view and project detail header
  // reflect the new total. Read-then-update — there's no atomic increment
  // RPC defined yet, and this user is the only writer so the race is
  // effectively impossible.
  if (project_id && hours !== undefined && hours > 0) {
    const { data: row, error: readErr } = await sb
      .from('projects')
      .select('hours_logged')
      .eq('id', project_id)
      .single();
    if (!readErr) {
      const current = Number(row?.hours_logged ?? 0);
      const { error: updateErr } = await sb
        .from('projects')
        .update({ hours_logged: current + hours })
        .eq('id', project_id);
      if (updateErr) {
        // Activity row landed; project total didn't. Surface so the user
        // knows the project widget will be off until next correction.
        return {
          action: a.action,
          status: 'success',
          message: `Activity logged (project hours update failed: ${updateErr.message})`,
          entity_id: data.id,
          entity_kind: 'activity_log',
        };
      }
    }
  }

  return { action: a.action, status: 'success', message: 'Activity logged', entity_id: data.id, entity_kind: 'activity_log' };
}

async function updateMilestone(sb: SupabaseClient, a: ParsedAction): Promise<ActionResult> {
  const projectId = await matchProject(sb, str(a, 'project_match'));
  if (!projectId) return { action: a.action, status: 'skipped', message: 'project_not_found' };
  const milestoneId = await matchMilestone(sb, projectId, str(a, 'milestone_match'));
  if (!milestoneId) return { action: a.action, status: 'skipped', message: 'milestone_not_found' };
  const update: Record<string, unknown> = {};
  if (str(a, 'status')) update.status = str(a, 'status');
  if (str(a, 'status') === 'done') update.completed_at = new Date().toISOString();
  const { error } = await sb.from('milestones').update(update).eq('id', milestoneId);
  if (error) return { action: a.action, status: 'failed', message: error.message };
  return { action: a.action, status: 'success', message: 'Milestone updated', entity_id: milestoneId, entity_kind: 'milestones' };
}

async function createCalendarEvent(sb: SupabaseClient, a: ParsedAction): Promise<ActionResult> {
  const title = str(a, 'title');
  const start = str(a, 'start');
  const end = str(a, 'end');
  if (!title || !start || !end) return { action: a.action, status: 'failed', message: 'missing_required_fields' };

  const insert: Record<string, unknown> = {
    title, start_at: start, end_at: end,
    source: 'created_here',
  };
  if (str(a, 'location')) insert.location = str(a, 'location');
  if (Array.isArray(a.attendees)) insert.attendees = a.attendees;

  // Push to Google Calendar first when connected, then mirror locally with
  // the returned google_event_id so future pulls update (not duplicate) it.
  // Status is explicit in the message so the user always knows whether the
  // push happened: "(synced to Google)", "(local only — connect Google in
  // Settings)", or "(Google push failed: ...)".
  let pushedNote = '';
  const googleTokens = await loadGoogleTokens().catch(() => null);
  if (!googleTokens) {
    pushedNote = ' (local only — connect Google in Settings)';
  } else {
    try {
      const attendees = Array.isArray(a.attendees)
        ? (a.attendees as unknown[]).filter((x): x is string => typeof x === 'string')
        : undefined;
      const googleEvent = await insertGoogleEvent({
        summary: title,
        start, end,
        location: str(a, 'location'),
        attendees,
      });
      if (googleEvent?.id) {
        insert.google_event_id = googleEvent.id;
        pushedNote = ' (synced to Google)';
      } else {
        pushedNote = ' (Google push returned no id)';
      }
    } catch (err) {
      pushedNote = ` (Google push failed: ${err instanceof Error ? err.message : 'unknown'})`;
    }
  }

  const { data, error } = await sb.from('calendar_events').insert(insert).select('id').single();
  if (error) return { action: a.action, status: 'failed', message: error.message };
  return {
    action: a.action,
    status: 'success',
    message: `Calendar event created: ${title}${pushedNote}`,
    entity_id: data.id,
    entity_kind: 'calendar_events',
  };
}

async function createNote(sb: SupabaseClient, a: ParsedAction): Promise<ActionResult> {
  const body = str(a, 'body');
  if (!body) return { action: a.action, status: 'failed', message: 'missing_body' };

  // Resolve fuzzy references in parallel.
  const [project_id, person_id, quote_id] = await Promise.all([
    matchProject(sb, str(a, 'project_match')),
    matchPerson(sb, str(a, 'person_match')),
    matchQuote(sb, str(a, 'quote_match')),
  ]);

  const insert: Record<string, unknown> = {
    body,
    source_type: str(a, 'source_type') ?? 'own_thought',
    needs_review: a.needs_review === true,
  };
  if (str(a, 'source_reference')) insert.source_reference = str(a, 'source_reference');
  if (Array.isArray(a.tags)) insert.tags = a.tags;
  if (project_id) insert.related_project_id = project_id;
  if (person_id) insert.related_person_id = person_id;
  if (quote_id) insert.related_quote_id = quote_id;

  const { data, error } = await sb.from('notes').insert(insert).select('id').single();
  if (error) return { action: a.action, status: 'failed', message: error.message };

  // Short success message — reflects the resolved source_type so the
  // notification feed is informative ("Reading response saved" vs just
  // "Note saved").
  const labels: Record<string, string> = {
    own_thought: 'Note saved',
    reading_response: 'Reading response saved',
    meeting_note: 'Meeting note saved',
    brainstorm: 'Brainstorm saved',
    observation: 'Observation note saved',
    other: 'Note saved',
  };
  const label = labels[insert.source_type as string] ?? 'Note saved';
  const reviewSuffix = insert.needs_review ? ' (needs review)' : '';

  return {
    action: a.action,
    status: 'success',
    message: `${label}${reviewSuffix}`,
    entity_id: data.id,
    entity_kind: 'notes',
  };
}

async function createQuote(sb: SupabaseClient, a: ParsedAction): Promise<ActionResult> {
  const text = str(a, 'text');
  if (!text) return { action: a.action, status: 'failed', message: 'missing_text' };

  const book_id = await matchBook(sb, str(a, 'book_match'));
  const insert: Record<string, unknown> = { text, added_via: 'voice' };
  if (book_id) insert.book_id = book_id;
  if (num(a, 'page_number')) insert.page_number = num(a, 'page_number');
  if (str(a, 'chapter')) insert.chapter = str(a, 'chapter');
  if (str(a, 'source_type')) insert.source_type = str(a, 'source_type');
  if (str(a, 'source_reference')) insert.source_reference = str(a, 'source_reference');
  if (str(a, 'source_author')) insert.source_author = str(a, 'source_author');
  if (Array.isArray(a.tags)) insert.tags = a.tags;

  const { data, error } = await sb.from('quotes').insert(insert).select('id').single();
  if (error) return { action: a.action, status: 'failed', message: error.message };

  // Addendum 02 §4 — if the user bundled a thought with the quote in the
  // same utterance, the parser includes `annotation_body`. Write the
  // annotation alongside the quote with context='on_capture'.
  const annotationBody = str(a, 'annotation_body');
  let annotationNote = '';
  if (annotationBody) {
    const { error: annoErr } = await sb.from('quote_annotations').insert({
      quote_id: data.id,
      body: annotationBody,
      context: 'on_capture',
    });
    if (annoErr) {
      annotationNote = ` (annotation failed: ${annoErr.message})`;
    } else {
      annotationNote = ' with your thought';
    }
  }

  return {
    action: a.action,
    status: 'success',
    message: `Quote saved${annotationNote}`,
    entity_id: data.id,
    entity_kind: 'quotes',
  };
}

async function createQuoteAnnotation(sb: SupabaseClient, a: ParsedAction): Promise<ActionResult> {
  const body = str(a, 'body');
  if (!body) return { action: a.action, status: 'failed', message: 'missing_body' };
  const quote_id = await matchQuote(sb, str(a, 'quote_match'));
  if (!quote_id) return { action: a.action, status: 'skipped', message: 'quote_not_found' };

  const insert: Record<string, unknown> = {
    quote_id,
    body,
    context: str(a, 'context') ?? 'on_revisit',
  };
  if (Array.isArray(a.tags)) insert.tags = a.tags;

  const { data, error } = await sb.from('quote_annotations').insert(insert).select('id').single();
  if (error) return { action: a.action, status: 'failed', message: error.message };
  return {
    action: a.action,
    status: 'success',
    message: 'Annotation added to quote',
    entity_id: data.id,
    entity_kind: 'quote_annotations',
  };
}

async function createJournalEntry(
  sb: SupabaseClient,
  a: ParsedAction,
  opts: ExecuteOptions = {},
): Promise<ActionResult> {
  const text = str(a, 'text');
  if (!text) return { action: a.action, status: 'failed', message: 'missing_text' };
  const insert: Record<string, unknown> = {
    transcription_text: text,
    source: sourceFor('journal_entries', opts.captureSource),
    entry_date: str(a, 'date') ?? new Intl.DateTimeFormat('en-CA', {
      timeZone: await getAppTz(), year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date()),
  };
  const { data, error } = await sb.from('journal_entries').insert(insert).select('id').single();
  if (error) return { action: a.action, status: 'failed', message: error.message };
  return { action: a.action, status: 'success', message: 'Journal entry saved', entity_id: data.id, entity_kind: 'journal_entries' };
}

async function createPersonFact(sb: SupabaseClient, a: ParsedAction): Promise<ActionResult> {
  const person_id = await matchPerson(sb, str(a, 'person_match'));
  if (!person_id) return { action: a.action, status: 'skipped', message: 'person_not_found' };
  const fact_value = str(a, 'fact_value');
  if (!fact_value) return { action: a.action, status: 'failed', message: 'missing_fact_value' };
  const insert: Record<string, unknown> = {
    person_id, fact_value,
    fact_type: str(a, 'fact_type') ?? 'other',
    recurring: a.recurring === true,
  };
  if (str(a, 'date_relevant')) insert.date_relevant = str(a, 'date_relevant');
  const { data, error } = await sb.from('person_facts').insert(insert).select('id').single();
  if (error) return { action: a.action, status: 'failed', message: error.message };
  return { action: a.action, status: 'success', message: 'Person fact saved', entity_id: data.id, entity_kind: 'person_facts' };
}

async function updateContentItem(sb: SupabaseClient, a: ParsedAction): Promise<ActionResult> {
  const id = await matchContentItem(sb, str(a, 'item_match'));
  if (!id) return { action: a.action, status: 'skipped', message: 'item_not_found' };
  const update: Record<string, unknown> = {};
  if (str(a, 'status')) update.status = str(a, 'status');
  if (str(a, 'video_url')) update.video_url = str(a, 'video_url');
  if (str(a, 'outline_md')) update.outline_md = str(a, 'outline_md');
  if (Object.keys(update).length === 0) {
    return { action: a.action, status: 'skipped', message: 'nothing_to_update' };
  }
  const { error } = await sb.from('content_items').update(update).eq('id', id);
  if (error) return { action: a.action, status: 'failed', message: error.message };
  return { action: a.action, status: 'success', message: 'Content item updated', entity_id: id, entity_kind: 'content_items' };
}

async function addInventoryItem(sb: SupabaseClient, a: ParsedAction): Promise<ActionResult> {
  const category = str(a, 'category');
  if (!category) return { action: a.action, status: 'failed', message: 'missing_category' };
  const insert: Record<string, unknown> = { category };
  if (str(a, 'brand')) insert.brand = str(a, 'brand');
  if (str(a, 'model')) insert.model = str(a, 'model');
  if (str(a, 'serial')) insert.serial_number = str(a, 'serial');
  if (str(a, 'purchase_date')) insert.purchase_date = str(a, 'purchase_date');
  if (num(a, 'purchase_price') !== undefined) insert.purchase_price = num(a, 'purchase_price');
  const { data, error } = await sb.from('inventory_items').insert(insert).select('id').single();
  if (error) return { action: a.action, status: 'failed', message: error.message };
  return { action: a.action, status: 'success', message: 'Inventory item added', entity_id: data.id, entity_kind: 'inventory_items' };
}

// ─── Dispatcher ──────────────────────────────────────────────────────────

// Handlers may optionally accept ExecuteOptions for per-invocation
// metadata (currently just captureSource). Handlers that don't care
// can ignore the third arg.
type Handler = (sb: SupabaseClient, a: ParsedAction, opts?: ExecuteOptions) => Promise<ActionResult>;
type HandlerMap = Record<string, Handler>;

const handlers: HandlerMap = {
  create_task: createTask,
  complete_task: completeTask,
  create_project: createProject,
  update_project_status: updateProjectStatus,
  log_activity: logActivity,
  update_milestone: updateMilestone,
  create_calendar_event: createCalendarEvent,
  create_note: createNote,
  create_quote: createQuote,
  create_quote_annotation: createQuoteAnnotation,
  create_journal_entry: createJournalEntry,
  create_person_fact: createPersonFact,
  update_content_item: updateContentItem,
  add_inventory_item: addInventoryItem,
};

// ─── Notification writers ───────────────────────────────────────────────

// Map entity_kind → URL path for click-through. Add to this as new
// entity types ship.
const DRILL_URL: Record<string, string> = {
  tasks: '/tasks',
  projects: '/projects',
  milestones: '/projects', // no detail page yet — go to parent project
  activity_log: '/projects',
  calendar_events: '/calendar',
  notes: '/library/notes',
  quotes: '/library/quotes',
  quote_annotations: '/library/quotes', // parent quote
  journal_entries: '/library/journal',
  person_facts: '/people',
  content_items: '/content',
  inventory_items: '/library/inventory',
};

const ACTION_TITLE: Record<string, string> = {
  create_task: 'Task created',
  complete_task: 'Task completed',
  create_project: 'Project created',
  update_project_status: 'Project status changed',
  log_activity: 'Activity logged',
  update_milestone: 'Milestone updated',
  create_calendar_event: 'Event scheduled',
  create_note: 'Note saved',
  create_quote: 'Quote saved',
  create_quote_annotation: 'Annotation added',
  create_journal_entry: 'Journal entry saved',
  create_person_fact: 'Person fact saved',
  update_content_item: 'Content item updated',
  add_inventory_item: 'Inventory item added',
};

async function recordNotification(
  sb: SupabaseClient,
  action: ParsedAction,
  result: ActionResult,
): Promise<void> {
  // We log every action — success and failure. Failures get a 'concerning'
  // tone the UI can highlight. Skipped (e.g. fuzzy match miss) also lands
  // here so the user knows why something didn't happen.
  const title = ACTION_TITLE[action.action] ?? action.action;
  const type =
    result.status === 'success' ? 'voice_action'
    : result.status === 'skipped' ? 'voice_action_skipped'
    : 'voice_action_failed';

  let source_url: string | null = null;
  if (result.entity_id && result.entity_kind && DRILL_URL[result.entity_kind]) {
    source_url = `${DRILL_URL[result.entity_kind]}/${result.entity_id}`;
    // Some entity kinds don't have a /:id page yet. For those, drop to the
    // parent path. (DRILL_URL[milestones] = '/projects' which lands on the
    // list — better than a broken link.)
    if (['milestones', 'activity_log', 'notes', 'quotes', 'journal_entries',
         'person_facts', 'content_items', 'inventory_items', 'calendar_events'].includes(result.entity_kind)) {
      source_url = DRILL_URL[result.entity_kind]!;
    }
  }

  await sb.from('notifications').insert({
    type,
    title,
    body: result.message,
    source_ref: result.entity_id ?? null,
    source_url,
    status: 'unread',
  });
}

// ─── Executor ───────────────────────────────────────────────────────────

export async function executeActions(
  sb: SupabaseClient,
  actions: ParsedAction[],
  opts: ExecuteOptions = {},
): Promise<ActionResult[]> {
  const results: ActionResult[] = [];
  for (const a of actions) {
    const handler = handlers[a.action];
    let result: ActionResult;
    if (!handler) {
      result = { action: a.action, status: 'failed', message: 'unknown_action_type' };
    } else {
      try {
        result = await handler(sb, a, opts);
      } catch (err) {
        result = {
          action: a.action,
          status: 'failed',
          message: err instanceof Error ? err.message : 'unknown_error',
        };
      }
    }
    results.push(result);

    // Notification write is best-effort — never block the action result.
    try {
      await recordNotification(sb, a, result);
    } catch {
      /* swallow — observability matters less than the action itself */
    }
  }
  return results;
}
