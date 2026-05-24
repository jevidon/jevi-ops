import 'server-only';
import { getAccessToken } from './auth';

// Server-side typed fetch wrapper. Reads the current user's access token
// (from Supabase cookies) and attaches it as a Bearer header to every call
// against the Fastify API.
//
// Use from Server Components or Server Actions only — the access token
// shouldn't be exposed to the browser via this path.

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

class ApiError extends Error {
  constructor(public status: number, public body: unknown, message?: string) {
    super(message ?? `API ${status}`);
    this.name = 'ApiError';
  }
}

async function call<T>(path: string, init?: RequestInit & { auth?: boolean; json?: boolean }): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.auth !== false) {
    const token = await getAccessToken();
    if (!token) {
      throw new ApiError(401, null, 'no_session');
    }
    headers.set('Authorization', `Bearer ${token}`);
  }
  // Only set JSON content-type for JSON bodies. FormData / multipart sets its
  // own content-type with the boundary, and a manual override breaks parsing.
  if (init?.body && init.json !== false && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    cache: 'no-store',
  });

  if (!res.ok) {
    let body: unknown = null;
    try { body = await res.json(); } catch { /* ignore */ }
    throw new ApiError(res.status, body);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string, opts?: { auth?: boolean }) =>
    call<T>(path, { method: 'GET', auth: opts?.auth }),
  post: <T>(path: string, body?: unknown, opts?: { auth?: boolean }) =>
    call<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined, auth: opts?.auth }),
  patch: <T>(path: string, body?: unknown) =>
    call<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  delete: <T = void>(path: string) => call<T>(path, { method: 'DELETE' }),
};

export { ApiError };

// Typed helpers — one per known route. Add as new routes ship.
import type { Task, Project, Domain } from '@jerad-ops/shared';

// Project list/detail include relations the bare Project type doesn't.
export interface Milestone {
  id: string;
  project_id: string;
  title: string;
  status: 'open' | 'done';
  weight: number;
  position: number;
  completed_at: string | null;
  created_at: string;
}

export interface ActivityLogEntry {
  id: string;
  project_id: string | null;
  entry: string;
  hours_logged: number | null;
  logged_at: string;
  source: string;
  // 'work' (default — hours-loggable effort) or 'update' (no hours;
  // wins, status notes, events). Older rows pre-migration 0018 may be
  // missing this; treat undefined as 'work'.
  kind?: 'work' | 'update';
}

export interface ProjectListItem extends Project {
  milestones?: Milestone[];
  domain?: { id: string; name: string } | null;
  color?: string | null;
}

export interface ProjectChecklistItem {
  id: string;
  project_id: string;
  position: number;
  title: string;
  done: boolean;
  done_at: string | null;
  recurrence_rule: 'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly' | 'yearly' | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectDetail {
  project: Project & { domain?: { id: string; name: string } | null };
  milestones: Milestone[];
  tasks: Task[];
  activity: ActivityLogEntry[];
  checklist: ProjectChecklistItem[];
  hours_this_month: number;
  hours_last_month: number;
}

export const tasksApi = {
  list: (opts?: { content_item_id?: string; project_id?: string; status?: string }) => {
    const qs = new URLSearchParams();
    if (opts?.content_item_id) qs.set('content_item_id', opts.content_item_id);
    if (opts?.project_id) qs.set('project_id', opts.project_id);
    if (opts?.status) qs.set('status', opts.status);
    const s = qs.toString();
    return api.get<{ tasks: Task[] }>(`/api/tasks${s ? `?${s}` : ''}`);
  },
  get: (id: string) => api.get<Task>(`/api/tasks/${id}`),
  create: (body: Partial<Task> & { title: string }) =>
    api.post<Task>('/api/tasks', body),
  update: (id: string, body: Partial<Task>) =>
    api.patch<Task>(`/api/tasks/${id}`, body),
  remove: (id: string) => api.delete(`/api/tasks/${id}`),
};

export type EngagementType = 'project' | 'retainer';

export interface ProjectCreate {
  name: string;
  description?: string | null;
  domain_id?: string | null;
  type?: 'client' | 'internal' | 'content' | null;
  client_id?: string | null;
  quoted_hours?: number | null;
  start_date?: string | null;
  target_date?: string | null;
  color?: string | null;
  engagement_type?: EngagementType;
}

export interface ProjectUpdate extends Partial<ProjectCreate> {
  status?: 'active' | 'paused' | 'done' | 'archived';
}

export const projectsApi = {
  list: () => api.get<{ projects: ProjectListItem[] }>('/api/projects'),
  get: (id: string) => api.get<ProjectDetail>(`/api/projects/${id}`),
  create: (body: ProjectCreate) => api.post<Project>('/api/projects', body),
  update: (id: string, body: ProjectUpdate) => api.patch<Project>(`/api/projects/${id}`, body),
  remove: (id: string) => api.delete(`/api/projects/${id}`),
  milestones: {
    create: (projectId: string, body: { title: string; weight?: number; position?: number }) =>
      api.post<Milestone>(`/api/projects/${projectId}/milestones`, body),
    update: (
      projectId: string,
      milestoneId: string,
      body: { title?: string; status?: 'open' | 'done'; weight?: number; position?: number },
    ) => api.patch<Milestone>(`/api/projects/${projectId}/milestones/${milestoneId}`, body),
    remove: (projectId: string, milestoneId: string) =>
      api.delete(`/api/projects/${projectId}/milestones/${milestoneId}`),
  },
  checklist: {
    add: (
      projectId: string,
      body: {
        title: string;
        position?: number;
        recurrence_rule?: 'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly' | 'yearly' | null;
      },
    ) => api.post<ProjectChecklistItem>(`/api/projects/${projectId}/checklist`, body),
    update: (
      projectId: string,
      itemId: string,
      body: {
        title?: string;
        done?: boolean;
        position?: number;
        recurrence_rule?: 'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly' | 'yearly' | null;
      },
    ) => api.patch<ProjectChecklistItem>(`/api/projects/${projectId}/checklist/${itemId}`, body),
    remove: (projectId: string, itemId: string) =>
      api.delete(`/api/projects/${projectId}/checklist/${itemId}`),
  },
  activity: {
    add: (
      projectId: string,
      body: { entry: string; hours?: number | null; logged_at?: string; kind?: 'work' | 'update' },
    ) => api.post<ActivityLogEntry>(`/api/projects/${projectId}/activity`, body),
    update: (
      projectId: string,
      entryId: string,
      body: { entry?: string; hours?: number | null; logged_at?: string; kind?: 'work' | 'update' },
    ) => api.patch<ActivityLogEntry>(`/api/projects/${projectId}/activity/${entryId}`, body),
    remove: (projectId: string, entryId: string) =>
      api.delete(`/api/projects/${projectId}/activity/${entryId}`),
  },
};

export interface DomainUpdate {
  name?: string;
  description?: string | null;
  fruit_definition?: string | null;
  expected_cadence?: string | null;
  active?: boolean;
}

export const contentApi = {
  list: (opts?: { status?: string; domain_id?: string; type?: string }) => {
    const qs = new URLSearchParams();
    if (opts?.status) qs.set('status', opts.status);
    if (opts?.domain_id) qs.set('domain_id', opts.domain_id);
    if (opts?.type) qs.set('type', opts.type);
    const s = qs.toString();
    return api.get<{ items: ContentItem[] }>(`/api/content${s ? `?${s}` : ''}`);
  },
  get: (id: string) => api.get<ContentItem>(`/api/content/${id}`),
  create: (body: Partial<ContentItem> & { title: string }) =>
    api.post<ContentItem>('/api/content', body),
  update: (id: string, body: Partial<ContentItem>) =>
    api.patch<ContentItem>(`/api/content/${id}`, body),
  remove: (id: string) => api.delete(`/api/content/${id}`),
  checklist: {
    add: (contentId: string, body: { title: string; position?: number }) =>
      api.post<ContentChecklistItem>(`/api/content/${contentId}/checklist`, body),
    update: (
      contentId: string,
      itemId: string,
      body: { title?: string; done?: boolean; position?: number },
    ) => api.patch<ContentChecklistItem>(`/api/content/${contentId}/checklist/${itemId}`, body),
    remove: (contentId: string, itemId: string) =>
      api.delete(`/api/content/${contentId}/checklist/${itemId}`),
    seedDefaults: (contentId: string) =>
      api.post<{ inserted: number; reason?: string }>(`/api/content/${contentId}/checklist/seed-defaults`, {}),
  },
};

export const domainsApi = {
  list: () => api.get<{ domains: Domain[] }>('/api/domains'),
  get: (id: string) => api.get<Domain>(`/api/domains/${id}`),
  update: (id: string, body: DomainUpdate) => api.patch<Domain>(`/api/domains/${id}`, body),
};

export interface VoiceCaptureResponse {
  status: 'executed' | 'needs_disambiguation' | 'parse_error';
  transcript: string;
  actions?: Array<{
    action: string;
    status: 'success' | 'skipped' | 'failed';
    message: string;
    entity_id?: string;
    entity_kind?: string;
  }>;
  field?: string;
  candidates?: Array<{ id: string; label: string }>;
  error?: string;
}

export const captureApi = {
  // `source` ('voice' default | 'text') tags rows created by the
  // executor with the right origin: text captures via Cmd+J get
  // 'manual' (tasks/activity) or 'typed' (journal) instead of 'voice'.
  voice: (transcript: string, source: 'voice' | 'text' = 'voice') =>
    api.post<VoiceCaptureResponse>('/api/capture/voice', { transcript, source }),

  // Audio path — accepts FormData with field "audio". Don't set
  // Content-Type; fetch picks the right multipart boundary automatically.
  // (Always tagged 'voice' server-side since the input is literal audio.)
  voiceAudio: (formData: FormData) =>
    call<VoiceCaptureResponse>('/api/capture/voice-audio', {
      method: 'POST',
      body: formData,
      json: false,
    }),
};

// ─── Image uploads ──────────────────────────────────────────────────────
//
// Server-proxied uploads to Bunny Storage. Returns the StoredAttachment
// the client then appends to a note/journal's attachments array via the
// regular PATCH route.
//
// The route accepts ?prefix=notes|journal|other which controls the
// storage folder. Alt text can be passed as ?alt= but most clients
// just leave it null at upload time and let the user fill it in later.

export const uploadsApi = {
  // The FormData carries the file and (optionally) `prefix` / `title_hint`
  // as additional fields. Passing prefix via query also works as a
  // fallback for old clients; the server prefers the form-field value
  // when both are present.
  image: (formData: FormData, prefix: 'notes' | 'journal' | 'other' = 'other') =>
    call<Attachment>(`/api/uploads/image?prefix=${prefix}`, {
      method: 'POST',
      body: formData,
      json: false,
    }),
};

// ─── Chat ────────────────────────────────────────────────────────────────

export interface ChatToolTrace {
  name: string;
  input: Record<string, unknown>;
  result_summary: string;
}

export interface ChatResponse {
  question: string;
  answer: string;
  tool_trace: ChatToolTrace[];
  turns: number;
}

export interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export const chatApi = {
  // Two shapes:
  //   ask("What's on my calendar?")                       — single-turn
  //   ask([{role:'user', content:'Q1'}, {role:'assistant', content:'A1'}, {role:'user', content:'Q2'}])
  ask: (input: string | ChatHistoryMessage[]) => {
    const body = typeof input === 'string' ? { question: input } : { messages: input };
    return api.post<ChatResponse>('/api/chat', body);
  },
};

// ─── Google Calendar ─────────────────────────────────────────────────────

export interface CalendarEvent {
  id: string;
  google_event_id: string | null;
  title: string;
  description: string | null;
  start_at: string;
  end_at: string;
  all_day: boolean;
  location: string | null;
  source: 'google' | 'created_here';
}

export interface GoogleStatus {
  configured: boolean;
  connected: boolean;
  last_synced_at: string | null;
  scope: string | null;
}

export const calendarApi = {
  upcoming: (limit = 4) =>
    api.get<{ events: CalendarEvent[] }>(`/api/calendar/upcoming?limit=${limit}`),
  list: (opts?: { from?: string; to?: string }) => {
    const qs = new URLSearchParams();
    if (opts?.from) qs.set('from', opts.from);
    if (opts?.to) qs.set('to', opts.to);
    const q = qs.toString();
    return api.get<{ events: CalendarEvent[]; range: { from: string; to: string } }>(
      `/api/calendar/events${q ? `?${q}` : ''}`,
    );
  },
  pull: () =>
    api.post<{
      status: string;
      events_fetched: number;
      events_upserted: number;
      events_deleted: number;
      orphans_pushed: number;
      orphans_failed: number;
    }>('/api/sync/calendar/pull'),
};

export const googleApi = {
  status: () => api.get<GoogleStatus>('/api/auth/google/status'),
  disconnect: () => api.post<{ status: string }>('/api/auth/google/disconnect'),
};

// ─── Library: notes, quotes, annotations, journal, feed ────────────────

export type NoteSourceType =
  | 'own_thought' | 'reading_response' | 'meeting_note'
  | 'brainstorm' | 'observation' | 'other';

// Image attachment record. Created server-side by /api/uploads/image
// (which talks to Bunny Storage), stored as an element of the
// attachments jsonb array on the parent row (note / journal entry).
// The client never crafts these by hand — it just passes through what
// the upload endpoint returned.
export interface Attachment {
  url: string;
  storage_path: string;
  content_type?: string;
  size_bytes?: number;
  alt?: string | null;
  uploaded_at?: string;
  // GPS + reverse-geocoded address are populated at upload time from
  // EXIF when present. Either may be null if EXIF is missing or
  // Nominatim is unavailable.
  gps?: { lat: number; lon: number } | null;
  location?: string | null;
}

export interface Note {
  id: string;
  title: string | null;
  body: string;
  source_type: NoteSourceType;
  source_reference: string | null;
  tags: string[];
  related_project_id: string | null;
  related_person_id: string | null;
  related_quote_id: string | null;
  needs_review: boolean;
  attachments: Attachment[];
  created_at: string;
  project?: { id: string; name: string; color: string | null } | null;
  person?: { id: string; name: string } | null;
  quote?: { id: string; text: string; source_author?: string | null } | null;
}

export interface Quote {
  id: string;
  text: string;
  page_number: string | number | null;
  chapter: string | null;
  source_type: string | null;
  source_reference: string | null;
  source_author: string | null;
  tags: string[];
  added_via: string;
  created_at: string;
  book?: { id: string; title: string; author: string | null } | null;
  annotation_count?: number;
}

export type AnnotationContext = 'on_capture' | 'on_revisit' | 'on_surface' | 'unspecified';

export interface QuoteAnnotation {
  id: string;
  quote_id: string;
  body: string;
  annotated_at: string;
  context: AnnotationContext;
  tags: string[];
  created_at: string;
}

export interface JournalEntry {
  id: string;
  entry_date: string;
  transcription_text: string | null;
  source: string;
  attachments: Attachment[];
  created_at: string;
}

export type FeedItemKind = 'note' | 'quote' | 'annotation' | 'journal';
export interface FeedItem {
  kind: FeedItemKind;
  id: string;
  at: string;
  payload: Record<string, unknown>;
}

export type ContentItemStatus =
  | 'idea' | 'outline' | 'filming' | 'editing'
  | 'published' | 'derivatives_pending' | 'done';

export type ContentItemType =
  | 'video' | 'article' | 'short_clip' | 'podcast_episode' | 'newsletter';

export interface ContentItem {
  id: string;
  title: string;
  domain_id: string | null;
  type: ContentItemType;
  status: ContentItemStatus;
  outline_md: string | null;
  video_url: string | null;
  article_url: string | null;
  published_at: string | null;
  parent_id: string | null;
  derivative_type: string | null;
  created_at: string;
  updated_at: string;
  domain?: { id: string; name: string } | null;
  // Present on GET /api/content/:id only; the list endpoint omits it.
  checklist?: ContentChecklistItem[];
}

export interface ContentChecklistItem {
  id: string;
  content_item_id: string;
  position: number;
  title: string;
  done: boolean;
  done_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Book {
  id: string;
  title: string;
  author: string | null;
  isbn: string | null;
  cover_image_url: string | null;
  status: 'reading' | 'finished' | 'abandoned' | 'want_to_read';
  format: 'physical' | 'kindle' | 'audiobook' | null;
  started_at: string | null;
  finished_at: string | null;
  rating: number | null;
  my_summary: string | null;
  created_at: string;
  quote_count?: number;
}

export interface TagAggregate {
  tag: string;
  notes: number;
  quotes: number;
  total: number;
}

export const libraryApi = {
  feed: (limit = 500) =>
    api.get<{ items: FeedItem[] }>(`/api/library/feed?limit=${limit}`),
  tags: () => api.get<{ tags: TagAggregate[] }>('/api/library/tags'),
  notes: {
    list: (opts?: { source_type?: string; needs_review?: boolean; tag?: string }) => {
      const qs = new URLSearchParams();
      if (opts?.source_type) qs.set('source_type', opts.source_type);
      if (opts?.needs_review) qs.set('needs_review', 'true');
      if (opts?.tag) qs.set('tag', opts.tag);
      const q = qs.toString();
      return api.get<{ notes: Note[] }>(`/api/notes${q ? `?${q}` : ''}`);
    },
    get: (id: string) => api.get<Note>(`/api/notes/${id}`),
    update: (id: string, body: Partial<Note>) => api.patch<Note>(`/api/notes/${id}`, body),
    remove: (id: string) => api.delete(`/api/notes/${id}`),
  },
  quotes: {
    list: (opts?: { tag?: string }) => {
      const qs = new URLSearchParams();
      if (opts?.tag) qs.set('tag', opts.tag);
      const q = qs.toString();
      return api.get<{ quotes: Quote[] }>(`/api/quotes${q ? `?${q}` : ''}`);
    },
    get: (id: string) =>
      api.get<{ quote: Quote; annotations: QuoteAnnotation[] }>(`/api/quotes/${id}`),
    create: (body: {
      text: string;
      book_id?: string | null;
      page_number?: number | null;
      chapter?: string | null;
      source_type?: string | null;
      source_ref?: string | null;
      source_author?: string | null;
      tags?: string[];
      added_via?: string;
    }) => api.post<Quote>('/api/quotes', body),
    update: (id: string, body: Partial<Quote>) =>
      api.patch<Quote>(`/api/quotes/${id}`, body),
    remove: (id: string) => api.delete(`/api/quotes/${id}`),
  },
  annotations: {
    create: (quote_id: string, body: string) =>
      api.post<QuoteAnnotation>('/api/quote-annotations', { quote_id, body, context: 'on_revisit' }),
    update: (id: string, body: string) =>
      api.patch<QuoteAnnotation>(`/api/quote-annotations/${id}`, { body }),
    remove: (id: string) => api.delete(`/api/quote-annotations/${id}`),
  },
  journal: {
    list: () => api.get<{ entries: JournalEntry[] }>('/api/journal-entries'),
    get: (id: string) => api.get<JournalEntry>(`/api/journal-entries/${id}`),
    update: (id: string, body: Partial<{
      transcription_text: string | null;
      entry_date: string;
      attachments: Attachment[];
    }>) => api.patch<JournalEntry>(`/api/journal-entries/${id}`, body),
    remove: (id: string) => api.delete(`/api/journal-entries/${id}`),
  },
  books: {
    list: () => api.get<{ books: Book[] }>('/api/books'),
    get: (id: string) => api.get<{ book: Book; quotes: Quote[] }>(`/api/books/${id}`),
    create: (body: Partial<Book> & { title: string }) =>
      api.post<Book>('/api/books', body),
    update: (id: string, body: Partial<Book>) =>
      api.patch<Book>(`/api/books/${id}`, body),
    remove: (id: string) => api.delete(`/api/books/${id}`),
  },
};

// ─── Routines / streak tracker ───────────────────────────────────────────

export type TimeOfDayBucket = 'morning' | 'afternoon' | 'evening' | 'anytime';

export interface Routine {
  id: string;
  name: string;
  description: string | null;
  position: number;
  active: boolean;
  time_of_day: TimeOfDayBucket;
  specific_time: string | null;       // HH:MM[:SS], app-tz interpreted
  reminder_enabled: boolean;
  last_reminder_sent_date: string | null;
  last_missed_sent_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface RoutineStats {
  current_streak: number;
  longest_streak: number;
  completions_7d: number;
  completions_30d: number;
  total: number;
  done_today: boolean;
}

export interface RoutineListItem extends Routine {
  // Last ~120 days of completion dates (YYYY-MM-DD), oldest-first.
  recent_completions: string[];
  stats: RoutineStats;
}

export interface RoutineDetail {
  routine: Routine;
  completions: string[]; // lifetime, newest-first
  stats: RoutineStats;
  today: string;
}

export const routinesApi = {
  list: (opts?: { include_archived?: boolean }) => {
    const qs = new URLSearchParams();
    if (opts?.include_archived) qs.set('include_archived', 'true');
    const q = qs.toString();
    return api.get<{ routines: RoutineListItem[]; today: string }>(
      `/api/routines${q ? `?${q}` : ''}`,
    );
  },
  get: (id: string) => api.get<RoutineDetail>(`/api/routines/${id}`),
  create: (body: {
    name: string;
    description?: string | null;
    position?: number;
    time_of_day?: TimeOfDayBucket;
    specific_time?: string | null;
    reminder_enabled?: boolean;
  }) => api.post<Routine>('/api/routines', body),
  update: (
    id: string,
    body: Partial<{
      name: string;
      description: string | null;
      position: number;
      active: boolean;
      time_of_day: TimeOfDayBucket;
      specific_time: string | null;
      reminder_enabled: boolean;
    }>,
  ) => api.patch<Routine>(`/api/routines/${id}`, body),
  remove: (id: string) => api.delete(`/api/routines/${id}`),
  toggleCompletion: (id: string, body: { date?: string; done?: boolean }) =>
    api.post<unknown>(`/api/routines/${id}/completions`, body),
};

// ─── People CRM ──────────────────────────────────────────────────────────

export type RelationshipType =
  | 'client' | 'family' | 'church' | 'friend' | 'team' | 'vendor' | 'other';

export interface Person {
  id: string;
  name: string;
  relationship_type: RelationshipType | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // Synthesized on list endpoint:
  interaction_count?: number;
  fact_count?: number;
}

export type PersonFactType =
  | 'anniversary' | 'birthday' | 'kid_name' | 'shared' | 'follow_up' | 'other';

export interface PersonFact {
  id: string;
  person_id: string;
  fact_type: PersonFactType;
  fact_value: string;
  source_ref: string | null;
  date_relevant: string | null;
  recurring: boolean;
  created_at: string;
}

export type PersonInteractionType =
  | 'email' | 'call' | 'in_person' | 'text' | 'meeting' | 'other';

export interface PersonInteraction {
  id: string;
  person_id: string;
  interaction_type: PersonInteractionType;
  notes: string | null;
  occurred_at: string;
}

export interface PersonDetail {
  person: Person;
  facts: PersonFact[];
  interactions: PersonInteraction[];
  notes: { id: string; title: string | null; body: string; source_type: string; created_at: string }[];
  projects: { id: string; name: string; status: string; color: string | null }[];
}

export interface PersonCreate {
  name: string;
  relationship_type?: RelationshipType | null;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  notes?: string | null;
}

export const peopleApi = {
  list: (opts?: { relationship_type?: RelationshipType }) => {
    const qs = new URLSearchParams();
    if (opts?.relationship_type) qs.set('relationship_type', opts.relationship_type);
    const q = qs.toString();
    return api.get<{ people: Person[] }>(`/api/people${q ? `?${q}` : ''}`);
  },
  get: (id: string) => api.get<PersonDetail>(`/api/people/${id}`),
  create: (body: PersonCreate) => api.post<Person>('/api/people', body),
  update: (id: string, body: Partial<PersonCreate>) => api.patch<Person>(`/api/people/${id}`, body),
  remove: (id: string) => api.delete(`/api/people/${id}`),
  facts: {
    add: (personId: string, body: {
      fact_type: PersonFactType;
      fact_value: string;
      date_relevant?: string | null;
      recurring?: boolean;
    }) => api.post<PersonFact>(`/api/people/${personId}/facts`, body),
    update: (personId: string, factId: string, body: Partial<{
      fact_type: PersonFactType;
      fact_value: string;
      date_relevant: string | null;
      recurring: boolean;
    }>) => api.patch<PersonFact>(`/api/people/${personId}/facts/${factId}`, body),
    remove: (personId: string, factId: string) =>
      api.delete(`/api/people/${personId}/facts/${factId}`),
  },
  interactions: {
    add: (personId: string, body: {
      interaction_type: PersonInteractionType;
      notes?: string | null;
      occurred_at?: string | null;
    }) => api.post<PersonInteraction>(`/api/people/${personId}/interactions`, body),
    update: (personId: string, interactionId: string, body: Partial<{
      interaction_type: PersonInteractionType;
      notes: string | null;
      occurred_at: string | null;
    }>) => api.patch<PersonInteraction>(`/api/people/${personId}/interactions/${interactionId}`, body),
    remove: (personId: string, interactionId: string) =>
      api.delete(`/api/people/${personId}/interactions/${interactionId}`),
  },
};

// ─── Search ──────────────────────────────────────────────────────────────

export interface SearchNoteHit {
  id: string;
  title: string | null;
  body: string;
  source_type: NoteSourceType;
  created_at: string;
}

export interface SearchQuoteHit {
  id: string;
  text: string;
  source_author: string | null;
  created_at: string;
  book?: { id: string; title: string; author: string | null } | null;
}

export interface SearchTaskHit {
  id: string;
  title: string;
  notes: string | null;
  status: 'open' | 'done';
  due_date: string | null;
  created_at: string;
  project?: { id: string; name: string; color: string | null } | null;
}

export interface SearchContentHit {
  id: string;
  title: string;
  type: ContentItemType;
  status: ContentItemStatus;
  outline_md: string | null;
  updated_at: string;
  domain?: { id: string; name: string } | null;
}

export interface SearchBookHit {
  id: string;
  title: string;
  author: string | null;
  status: 'reading' | 'finished' | 'abandoned' | 'want_to_read';
  created_at: string;
}

export interface SearchProjectHit {
  id: string;
  name: string;
  description: string | null;
  status: 'active' | 'paused' | 'done' | 'archived';
  color: string | null;
  created_at: string;
  domain?: { id: string; name: string } | null;
}

export interface SearchPersonHit {
  id: string;
  name: string;
  relationship_type: RelationshipType | null;
  email: string | null;
  company: string | null;
  notes: string | null;
  updated_at: string;
}

export interface SearchResults {
  query: string;
  notes: SearchNoteHit[];
  quotes: SearchQuoteHit[];
  tasks: SearchTaskHit[];
  content: SearchContentHit[];
  books: SearchBookHit[];
  projects: SearchProjectHit[];
  people: SearchPersonHit[];
}

export const searchApi = {
  search: (q: string) =>
    api.get<SearchResults>(`/api/search?q=${encodeURIComponent(q)}`),
};

// ─── Observations ────────────────────────────────────────────────────────

export interface Observation {
  id: string;
  type: string;
  severity: 'info' | 'notable' | 'concerning';
  title: string;
  body: string | null;
  supporting_data: Record<string, unknown> | null;
  domain_id: string | null;
  project_id: string | null;
  surfaced_at: string;
  dismissed_at: string | null;
  acted_on: boolean;
  domain?: { id: string; name: string } | null;
  project?: { id: string; name: string; color: string | null } | null;
}

export const observationsApi = {
  list: (active = true, limit = 50) =>
    api.get<{ observations: Observation[] }>(
      `/api/observations?active=${active}&limit=${limit}`,
    ),
  dismiss: (id: string) =>
    api.post<Observation>(`/api/observations/${id}/dismiss`),
  acted: (id: string) =>
    api.post<Observation>(`/api/observations/${id}/acted`),
};

// ─── Notifications ───────────────────────────────────────────────────────

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  source_ref: string | null;
  source_url: string | null;
  status: 'unread' | 'read' | 'dismissed';
  created_at: string;
}

export type NotificationStatus = 'unread' | 'read' | 'dismissed' | 'all';

export const notificationsApi = {
  list: (status: NotificationStatus = 'all', limit = 50) =>
    api.get<{ notifications: Notification[] }>(
      `/api/notifications?status=${status}&limit=${limit}`,
    ),
  count: () => api.get<{ unread: number }>('/api/notifications/count'),
  patch: (id: string, status: 'unread' | 'read' | 'dismissed') =>
    api.patch<Notification>(`/api/notifications/${id}`, { status }),
  markAllRead: () =>
    api.post<{ marked_read: number }>('/api/notifications/mark-all-read'),
};
