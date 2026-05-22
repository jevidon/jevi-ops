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
}

export interface ProjectListItem extends Project {
  milestones?: Milestone[];
  domain?: { id: string; name: string } | null;
  color?: string | null;
}

export interface ProjectDetail {
  project: Project & { domain?: { id: string; name: string } | null };
  milestones: Milestone[];
  tasks: Task[];
  activity: ActivityLogEntry[];
}

export const tasksApi = {
  list: () => api.get<{ tasks: Task[] }>('/api/tasks'),
  get: (id: string) => api.get<Task>(`/api/tasks/${id}`),
  create: (body: Partial<Task> & { title: string }) =>
    api.post<Task>('/api/tasks', body),
  update: (id: string, body: Partial<Task>) =>
    api.patch<Task>(`/api/tasks/${id}`, body),
  remove: (id: string) => api.delete(`/api/tasks/${id}`),
};

export const projectsApi = {
  list: () => api.get<{ projects: ProjectListItem[] }>('/api/projects'),
  get: (id: string) => api.get<ProjectDetail>(`/api/projects/${id}`),
};

export const domainsApi = {
  list: () => api.get<{ domains: Domain[] }>('/api/domains'),
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
  voice: (transcript: string) =>
    api.post<VoiceCaptureResponse>('/api/capture/voice', { transcript }),

  // Audio path — accepts FormData with field "audio". Don't set
  // Content-Type; fetch picks the right multipart boundary automatically.
  voiceAudio: (formData: FormData) =>
    call<VoiceCaptureResponse>('/api/capture/voice-audio', {
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

export const chatApi = {
  ask: (question: string) => api.post<ChatResponse>('/api/chat', { question }),
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
