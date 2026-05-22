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

async function call<T>(path: string, init?: RequestInit & { auth?: boolean }): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.auth !== false) {
    const token = await getAccessToken();
    if (!token) {
      throw new ApiError(401, null, 'no_session');
    }
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (init?.body && !headers.has('Content-Type')) {
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

export const tasksApi = {
  list: () => api.get<{ tasks: Task[] }>('/api/tasks'),
  create: (body: Partial<Task> & { title: string }) =>
    api.post<Task>('/api/tasks', body),
  update: (id: string, body: Partial<Task>) =>
    api.patch<Task>(`/api/tasks/${id}`, body),
  remove: (id: string) => api.delete(`/api/tasks/${id}`),
};

export const projectsApi = {
  list: () => api.get<{ projects: Project[] }>('/api/projects'),
};

export const domainsApi = {
  list: () => api.get<{ domains: Domain[] }>('/api/domains'),
};
