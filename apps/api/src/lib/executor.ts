import type { SupabaseClient } from '@supabase/supabase-js';
import type { ParsedAction } from './parser.js';
import {
  matchProject, matchDomain, matchPerson, matchTask,
  matchBook, matchContentItem, matchMilestone,
} from './match.js';
import { insertEvent as insertGoogleEvent, loadTokens as loadGoogleTokens } from './google.js';

// Action executor — dispatch each parsed action to the right table.
// Returns a per-action result so the client can confirm what happened.

export interface ActionResult {
  action: string;
  status: 'success' | 'skipped' | 'failed';
  message: string;
  entity_id?: string;     // id of the row created/updated
  entity_kind?: string;   // table name
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

async function createTask(sb: SupabaseClient, a: ParsedAction): Promise<ActionResult> {
  const title = str(a, 'title');
  if (!title) return { action: a.action, status: 'failed', message: 'missing_title' };

  const project_id = await matchProject(sb, str(a, 'project_match'));
  const parent_task_id = await matchTask(sb, str(a, 'parent_task_match'));

  const insert: Record<string, unknown> = {
    title,
    priority: num(a, 'priority') ?? 4,
    source: 'voice',
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

async function logActivity(sb: SupabaseClient, a: ParsedAction): Promise<ActionResult> {
  const entry = str(a, 'entry');
  if (!entry) return { action: a.action, status: 'failed', message: 'missing_entry' };
  const project_id = await matchProject(sb, str(a, 'project_match'));
  const hours = num(a, 'hours_logged');

  const insert: Record<string, unknown> = { entry, source: 'voice' };
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
  const project_id = await matchProject(sb, str(a, 'project_match'));
  const person_id = await matchPerson(sb, str(a, 'person_match'));
  const insert: Record<string, unknown> = { body, type: 'note' };
  if (Array.isArray(a.tags)) insert.tags = a.tags;
  if (project_id) insert.related_project_id = project_id;
  if (person_id) insert.related_person_id = person_id;
  const { data, error } = await sb.from('notes').insert(insert).select('id').single();
  if (error) return { action: a.action, status: 'failed', message: error.message };
  return { action: a.action, status: 'success', message: 'Note saved', entity_id: data.id, entity_kind: 'notes' };
}

async function createQuote(sb: SupabaseClient, a: ParsedAction): Promise<ActionResult> {
  const text = str(a, 'text');
  if (!text) return { action: a.action, status: 'failed', message: 'missing_text' };
  const book_id = await matchBook(sb, str(a, 'book_match'));
  const insert: Record<string, unknown> = { text, added_via: 'voice' };
  if (book_id) insert.book_id = book_id;
  if (num(a, 'page_number')) insert.page_number = num(a, 'page_number');
  if (Array.isArray(a.tags)) insert.tags = a.tags;
  const { data, error } = await sb.from('quotes').insert(insert).select('id').single();
  if (error) return { action: a.action, status: 'failed', message: error.message };
  return { action: a.action, status: 'success', message: 'Quote saved', entity_id: data.id, entity_kind: 'quotes' };
}

async function createJournalEntry(sb: SupabaseClient, a: ParsedAction): Promise<ActionResult> {
  const text = str(a, 'text');
  if (!text) return { action: a.action, status: 'failed', message: 'missing_text' };
  const insert: Record<string, unknown> = {
    transcription_text: text,
    source: 'voice',
    entry_date: str(a, 'date') ?? new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit',
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

type HandlerMap = Record<string, (sb: SupabaseClient, a: ParsedAction) => Promise<ActionResult>>;

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
  create_journal_entry: createJournalEntry,
  create_person_fact: createPersonFact,
  update_content_item: updateContentItem,
  add_inventory_item: addInventoryItem,
};

export async function executeActions(
  sb: SupabaseClient,
  actions: ParsedAction[],
): Promise<ActionResult[]> {
  const results: ActionResult[] = [];
  for (const a of actions) {
    const handler = handlers[a.action];
    if (!handler) {
      results.push({ action: a.action, status: 'failed', message: 'unknown_action_type' });
      continue;
    }
    try {
      results.push(await handler(sb, a));
    } catch (err) {
      results.push({
        action: a.action,
        status: 'failed',
        message: err instanceof Error ? err.message : 'unknown_error',
      });
    }
  }
  return results;
}
