import { eq } from 'drizzle-orm';
import type { ParsedAction } from './parser.js';
import type { CaptureSource } from '@jevi-ops/shared/schemas';
import { INBOX_DOMAIN_ID } from '@jevi-ops/shared';
import type { Db } from './db.js';
import {
  activity_log,
  calendar_events,
  content_items,
  inventory_items,
  journal_entries,
  milestones,
  notes,
  notifications,
  person_facts,
  projects,
  quote_annotations,
  quotes,
  tasks,
} from '../db/schema.js';
import {
  matchProject, matchDomain, matchPerson, matchTask,
  matchBook, matchContentItem, matchMilestone, matchQuote,
  matchNote, matchJournalEntry,
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
  db: Db,
  a: ParsedAction,
  opts: ExecuteOptions = {},
): Promise<ActionResult> {
  const title = str(a, 'title');
  if (!title) return { action: a.action, status: 'failed', message: 'missing_title' };

  const project_id = await matchProject(db, str(a, 'project_match'));
  const parent_task_id = await matchTask(db, str(a, 'parent_task_match'));

  // Domain routing (Addendum 03). Three cases:
  //   1. project_match resolved → use the project's domain
  //   2. project_match unresolved but domain_match given → use that domain
  //   3. Neither → fall through to Inbox
  // We resolve domain_id here rather than letting the API endpoint do it
  // because voice flows insert directly, not through /api/tasks. Keep the
  // routing logic in one place: this function.
  let domain_id: string;
  if (project_id) {
    const project = await db.query.projects.findFirst({
      columns: { domain_id: true },
      where: eq(projects.id, project_id),
    });
    domain_id = project?.domain_id ?? INBOX_DOMAIN_ID;
  } else {
    const matchedDomain = await matchDomain(db, str(a, 'domain_match'));
    domain_id = matchedDomain ?? INBOX_DOMAIN_ID;
  }

  const insert: typeof tasks.$inferInsert = {
    title,
    priority: num(a, 'priority') ?? 4,
    source: sourceFor('tasks', opts.captureSource),
    domain_id,
  };
  if (str(a, 'due_date')) insert.due_date = str(a, 'due_date');
  if (str(a, 'due_time')) insert.due_time = str(a, 'due_time');
  if (project_id) insert.project_id = project_id;
  if (parent_task_id) insert.parent_task_id = parent_task_id;
  if (Array.isArray(a.reminder_offsets)) insert.reminder_offsets = a.reminder_offsets as number[];

  const [row] = await db.insert(tasks).values(insert).returning({ id: tasks.id });
  if (!row) return { action: a.action, status: 'failed', message: 'insert_returned_no_row' };

  // Surface the routing decision in the user-facing message so the Today
  // notification chip tells the user "landed in Inbox" vs "landed in Life"
  // rather than just "Task created."
  const landedInInbox = domain_id === INBOX_DOMAIN_ID;
  const message = landedInInbox
    ? `Task captured to Inbox: ${title}`
    : `Task created: ${title}`;

  return {
    action: a.action,
    status: 'success',
    message,
    entity_id: row.id,
    entity_kind: 'tasks',
  };
}

async function completeTask(db: Db, a: ParsedAction): Promise<ActionResult> {
  const taskId = await matchTask(db, str(a, 'task_match'));
  if (!taskId) return { action: a.action, status: 'skipped', message: 'task_not_found' };
  await db
    .update(tasks)
    .set({ status: 'done', completed_at: new Date().toISOString() })
    .where(eq(tasks.id, taskId));
  return {
    action: a.action,
    status: 'success',
    message: 'Task marked done',
    entity_id: taskId,
    entity_kind: 'tasks',
  };
}

async function createProject(db: Db, a: ParsedAction): Promise<ActionResult> {
  const name = str(a, 'name');
  if (!name) return { action: a.action, status: 'failed', message: 'missing_name' };
  const domain_id = await matchDomain(db, str(a, 'domain_match'));
  const insert: typeof projects.$inferInsert = { name };
  if (domain_id) insert.domain_id = domain_id;
  if (str(a, 'target_date')) insert.target_date = str(a, 'target_date');
  const [row] = await db.insert(projects).values(insert).returning({ id: projects.id });
  if (!row) return { action: a.action, status: 'failed', message: 'insert_returned_no_row' };
  return { action: a.action, status: 'success', message: `Project created: ${name}`, entity_id: row.id, entity_kind: 'projects' };
}

async function updateProjectStatus(db: Db, a: ParsedAction): Promise<ActionResult> {
  const id = await matchProject(db, str(a, 'project_match'));
  if (!id) return { action: a.action, status: 'skipped', message: 'project_not_found' };
  const newStatus = str(a, 'status');
  if (!newStatus) return { action: a.action, status: 'failed', message: 'missing_status' };
  const update: Partial<typeof projects.$inferInsert> = { status: newStatus };
  if (newStatus === 'done') update.completed_at = new Date().toISOString();
  await db.update(projects).set(update).where(eq(projects.id, id));
  return { action: a.action, status: 'success', message: `Project status → ${newStatus}`, entity_id: id, entity_kind: 'projects' };
}

async function logActivity(
  db: Db,
  a: ParsedAction,
  opts: ExecuteOptions = {},
): Promise<ActionResult> {
  const entry = str(a, 'entry');
  if (!entry) return { action: a.action, status: 'failed', message: 'missing_entry' };
  const project_id = await matchProject(db, str(a, 'project_match'));
  const hours = num(a, 'hours_logged');

  const insert: typeof activity_log.$inferInsert = { entry, source: sourceFor('activity_log', opts.captureSource) };
  if (project_id) insert.project_id = project_id;
  if (hours !== undefined) insert.hours_logged = hours;

  const [row] = await db.insert(activity_log).values(insert).returning({ id: activity_log.id });
  if (!row) return { action: a.action, status: 'failed', message: 'insert_returned_no_row' };

  // Bump projects.hours_logged so the list view and project detail header
  // reflect the new total. Read-then-update — single writer, so the race is
  // effectively impossible.
  if (project_id && hours !== undefined && hours > 0) {
    try {
      const project = await db.query.projects.findFirst({
        columns: { hours_logged: true },
        where: eq(projects.id, project_id),
      });
      const current = Number(project?.hours_logged ?? 0);
      await db.update(projects).set({ hours_logged: current + hours }).where(eq(projects.id, project_id));
    } catch (err) {
      // Activity row landed; project total didn't. Surface so the user
      // knows the project widget will be off until next correction.
      return {
        action: a.action,
        status: 'success',
        message: `Activity logged (project hours update failed: ${err instanceof Error ? err.message : 'unknown'})`,
        entity_id: row.id,
        entity_kind: 'activity_log',
      };
    }
  }

  return { action: a.action, status: 'success', message: 'Activity logged', entity_id: row.id, entity_kind: 'activity_log' };
}

async function updateMilestone(db: Db, a: ParsedAction): Promise<ActionResult> {
  const projectId = await matchProject(db, str(a, 'project_match'));
  if (!projectId) return { action: a.action, status: 'skipped', message: 'project_not_found' };
  const milestoneId = await matchMilestone(db, projectId, str(a, 'milestone_match'));
  if (!milestoneId) return { action: a.action, status: 'skipped', message: 'milestone_not_found' };
  const update: Partial<typeof milestones.$inferInsert> = {};
  if (str(a, 'status')) update.status = str(a, 'status');
  if (str(a, 'status') === 'done') update.completed_at = new Date().toISOString();
  await db.update(milestones).set(update).where(eq(milestones.id, milestoneId));
  return { action: a.action, status: 'success', message: 'Milestone updated', entity_id: milestoneId, entity_kind: 'milestones' };
}

async function createCalendarEvent(db: Db, a: ParsedAction): Promise<ActionResult> {
  const title = str(a, 'title');
  const start = str(a, 'start');
  const end = str(a, 'end');
  if (!title || !start || !end) return { action: a.action, status: 'failed', message: 'missing_required_fields' };

  const insert: typeof calendar_events.$inferInsert = {
    title, start_at: start, end_at: end,
    source: 'created_here',
  };
  if (str(a, 'location')) insert.location = str(a, 'location');
  if (Array.isArray(a.attendees)) {
    insert.attendees = (a.attendees as unknown[]).filter((x): x is string => typeof x === 'string');
  }

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

  const [row] = await db.insert(calendar_events).values(insert).returning({ id: calendar_events.id });
  if (!row) return { action: a.action, status: 'failed', message: 'insert_returned_no_row' };
  return {
    action: a.action,
    status: 'success',
    message: `Calendar event created: ${title}${pushedNote}`,
    entity_id: row.id,
    entity_kind: 'calendar_events',
  };
}

async function createNote(db: Db, a: ParsedAction): Promise<ActionResult> {
  const body = str(a, 'body');
  if (!body) return { action: a.action, status: 'failed', message: 'missing_body' };

  // Resolve fuzzy references in parallel.
  const [project_id, person_id, quote_id] = await Promise.all([
    matchProject(db, str(a, 'project_match')),
    matchPerson(db, str(a, 'person_match')),
    matchQuote(db, str(a, 'quote_match')),
  ]);

  const insert: typeof notes.$inferInsert = {
    body,
    source_type: str(a, 'source_type') ?? 'own_thought',
    needs_review: a.needs_review === true,
  };
  if (str(a, 'source_reference')) insert.source_reference = str(a, 'source_reference');
  if (Array.isArray(a.tags)) insert.tags = a.tags as string[];
  if (project_id) insert.related_project_id = project_id;
  if (person_id) insert.related_person_id = person_id;
  if (quote_id) insert.related_quote_id = quote_id;

  const [row] = await db.insert(notes).values(insert).returning({ id: notes.id });
  if (!row) return { action: a.action, status: 'failed', message: 'insert_returned_no_row' };

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
    entity_id: row.id,
    entity_kind: 'notes',
  };
}

async function createQuote(db: Db, a: ParsedAction): Promise<ActionResult> {
  const text = str(a, 'text');
  if (!text) return { action: a.action, status: 'failed', message: 'missing_text' };

  const book_id = await matchBook(db, str(a, 'book_match'));
  const insert: typeof quotes.$inferInsert = { text, added_via: 'voice' };
  if (book_id) insert.book_id = book_id;
  if (num(a, 'page_number')) insert.page_number = num(a, 'page_number');
  if (str(a, 'chapter')) insert.chapter = str(a, 'chapter');
  if (str(a, 'source_type')) insert.source_type = str(a, 'source_type');
  if (str(a, 'source_reference')) insert.source_reference = str(a, 'source_reference');
  if (str(a, 'source_url')) insert.source_url = str(a, 'source_url');
  if (str(a, 'source_author')) insert.source_author = str(a, 'source_author');
  if (Array.isArray(a.tags)) insert.tags = a.tags as string[];

  // Addendum 02 §4 — if the user bundled a thought with the quote in the
  // same utterance, the parser includes `annotation_body`. Quote +
  // annotation land together or not at all.
  const annotationBody = str(a, 'annotation_body');

  const quoteId = await db.transaction(async (tx) => {
    const [q] = await tx.insert(quotes).values(insert).returning({ id: quotes.id });
    if (!q) throw new Error('insert_returned_no_row');
    if (annotationBody) {
      await tx.insert(quote_annotations).values({
        quote_id: q.id,
        body: annotationBody,
        context: 'on_capture',
      });
    }
    return q.id;
  });

  return {
    action: a.action,
    status: 'success',
    message: `Quote saved${annotationBody ? ' with your thought' : ''}`,
    entity_id: quoteId,
    entity_kind: 'quotes',
  };
}

async function createQuoteAnnotation(db: Db, a: ParsedAction): Promise<ActionResult> {
  const body = str(a, 'body');
  if (!body) return { action: a.action, status: 'failed', message: 'missing_body' };
  const quote_id = await matchQuote(db, str(a, 'quote_match'));
  if (!quote_id) return { action: a.action, status: 'skipped', message: 'quote_not_found' };

  const insert: typeof quote_annotations.$inferInsert = {
    quote_id,
    body,
    context: str(a, 'context') ?? 'on_revisit',
  };
  if (Array.isArray(a.tags)) insert.tags = a.tags as string[];

  const [row] = await db.insert(quote_annotations).values(insert).returning({ id: quote_annotations.id });
  if (!row) return { action: a.action, status: 'failed', message: 'insert_returned_no_row' };
  return {
    action: a.action,
    status: 'success',
    message: 'Annotation added to quote',
    entity_id: row.id,
    entity_kind: 'quote_annotations',
  };
}

async function createJournalEntry(
  db: Db,
  a: ParsedAction,
  opts: ExecuteOptions = {},
): Promise<ActionResult> {
  const text = str(a, 'text');
  if (!text) return { action: a.action, status: 'failed', message: 'missing_text' };
  const insert: typeof journal_entries.$inferInsert = {
    transcription_text: text,
    source: sourceFor('journal_entries', opts.captureSource),
    entry_date: str(a, 'date') ?? new Intl.DateTimeFormat('en-CA', {
      timeZone: await getAppTz(), year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date()),
  };
  const [row] = await db.insert(journal_entries).values(insert).returning({ id: journal_entries.id });
  if (!row) return { action: a.action, status: 'failed', message: 'insert_returned_no_row' };
  return { action: a.action, status: 'success', message: 'Journal entry saved', entity_id: row.id, entity_kind: 'journal_entries' };
}

async function createPersonFact(db: Db, a: ParsedAction): Promise<ActionResult> {
  const person_id = await matchPerson(db, str(a, 'person_match'));
  if (!person_id) return { action: a.action, status: 'skipped', message: 'person_not_found' };
  const fact_value = str(a, 'fact_value');
  if (!fact_value) return { action: a.action, status: 'failed', message: 'missing_fact_value' };
  const insert: typeof person_facts.$inferInsert = {
    person_id, fact_value,
    fact_type: str(a, 'fact_type') ?? 'other',
    recurring: a.recurring === true,
  };
  if (str(a, 'date_relevant')) insert.date_relevant = str(a, 'date_relevant');
  const [row] = await db.insert(person_facts).values(insert).returning({ id: person_facts.id });
  if (!row) return { action: a.action, status: 'failed', message: 'insert_returned_no_row' };
  return { action: a.action, status: 'success', message: 'Person fact saved', entity_id: row.id, entity_kind: 'person_facts' };
}

async function updateContentItem(db: Db, a: ParsedAction): Promise<ActionResult> {
  const id = await matchContentItem(db, str(a, 'item_match'));
  if (!id) return { action: a.action, status: 'skipped', message: 'item_not_found' };
  const update: Partial<typeof content_items.$inferInsert> = {};
  if (str(a, 'status')) update.status = str(a, 'status');
  if (str(a, 'video_url')) update.video_url = str(a, 'video_url');
  if (str(a, 'outline_md')) update.outline_md = str(a, 'outline_md');
  if (Object.keys(update).length === 0) {
    return { action: a.action, status: 'skipped', message: 'nothing_to_update' };
  }
  await db.update(content_items).set(update).where(eq(content_items.id, id));
  return { action: a.action, status: 'success', message: 'Content item updated', entity_id: id, entity_kind: 'content_items' };
}

// Resurface weight — "boost the Cal Newport quote about focus", "exclude
// this from resurfacing", "5x the gratitude journal from Tuesday". The
// parser emits the canonical numeric weight; we just route by kind and
// fuzzy-match the target. Anything other than the four supported weights
// (0 / 1 / 2 / 5) is treated as a request for the nearest one.
async function setResurfaceWeight(db: Db, a: ParsedAction): Promise<ActionResult> {
  const kind = str(a, 'target_kind');
  const matchPhrase = str(a, 'target_match');
  const rawWeight = num(a, 'weight');
  if (!kind || !['quote', 'note', 'journal'].includes(kind)) {
    return { action: a.action, status: 'failed', message: 'missing_or_invalid_target_kind' };
  }
  if (!matchPhrase) {
    return { action: a.action, status: 'failed', message: 'missing_target_match' };
  }
  if (rawWeight === undefined) {
    return { action: a.action, status: 'failed', message: 'missing_weight' };
  }
  // Snap to the supported cycle. The UI only ever sets {0,1,2,5}; arbitrary
  // weights work in the DB but the user can never put them back through the
  // UI again. Snapping keeps the system uniform.
  const weight = [0, 1, 2, 5].reduce((closest, w) =>
    Math.abs(w - rawWeight) < Math.abs(closest - rawWeight) ? w : closest, 1);

  const matcher =
    kind === 'quote' ? matchQuote :
    kind === 'note' ? matchNote :
    matchJournalEntry;
  const id = await matcher(db, matchPhrase);
  if (!id) return { action: a.action, status: 'skipped', message: `${kind}_not_found` };

  const table = kind === 'quote' ? quotes : kind === 'note' ? notes : journal_entries;
  const tableName = kind === 'quote' ? 'quotes' : kind === 'note' ? 'notes' : 'journal_entries';
  await db.update(table).set({ resurface_weight: weight }).where(eq(table.id, id));

  const label =
    weight === 0 ? 'excluded from resurfacing' :
    weight === 1 ? 'reset to normal' :
    `boosted ${weight}×`;
  return {
    action: a.action,
    status: 'success',
    message: `${kind[0]!.toUpperCase() + kind.slice(1)} ${label}`,
    entity_id: id,
    entity_kind: tableName,
  };
}

async function addInventoryItem(db: Db, a: ParsedAction): Promise<ActionResult> {
  const category = str(a, 'category');
  if (!category) return { action: a.action, status: 'failed', message: 'missing_category' };
  const insert: typeof inventory_items.$inferInsert = { category };
  if (str(a, 'brand')) insert.brand = str(a, 'brand');
  if (str(a, 'model')) insert.model = str(a, 'model');
  if (str(a, 'serial')) insert.serial_number = str(a, 'serial');
  if (str(a, 'purchase_date')) insert.purchase_date = str(a, 'purchase_date');
  if (num(a, 'purchase_price') !== undefined) insert.purchase_price = num(a, 'purchase_price');
  const [row] = await db.insert(inventory_items).values(insert).returning({ id: inventory_items.id });
  if (!row) return { action: a.action, status: 'failed', message: 'insert_returned_no_row' };
  return { action: a.action, status: 'success', message: 'Inventory item added', entity_id: row.id, entity_kind: 'inventory_items' };
}

// ─── Dispatcher ──────────────────────────────────────────────────────────

// Handlers may optionally accept ExecuteOptions for per-invocation
// metadata (currently just captureSource). Handlers that don't care
// can ignore the third arg.
type Handler = (db: Db, a: ParsedAction, opts?: ExecuteOptions) => Promise<ActionResult>;
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
  set_resurface_weight: setResurfaceWeight,
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
  set_resurface_weight: 'Resurface weight updated',
};

async function recordNotification(
  db: Db,
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

  await db.insert(notifications).values({
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
  db: Db,
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
        result = await handler(db, a, opts);
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
      await recordNotification(db, a, result);
    } catch {
      /* swallow — observability matters less than the action itself */
    }
  }
  return results;
}
