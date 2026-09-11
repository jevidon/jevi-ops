'use server';

import { revalidatePath } from 'next/cache';
import type { DocEntityType, DocRevision } from '@jevi-ops/shared';
import { ApiError, api, assetsApi, domainsApi, projectsApi, tasksApi } from '@/lib/api';

// Server actions behind the overview document (0050). One save path for
// the three entities that carry a doc; each PATCH refuses a stale version
// with 409 doc_conflict and the current body, which comes back here as a
// typed result the editor can act on (load theirs / overwrite).

export type DocSaveResult =
  | { ok: true; doc_md: string | null; doc_version: number }
  | { ok: false; conflict: { doc_md: string | null; doc_version: number } }
  | { ok: false; error: string };

function pathFor(entity: DocEntityType, id: string): string {
  return entity === 'asset' ? `/assets/${id}` : entity === 'project' ? `/projects/${id}` : `/domains/${id}`;
}

export async function saveDocAction(input: {
  entity: DocEntityType;
  id: string;
  body: string;
  version: number;
}): Promise<DocSaveResult> {
  const payload = { doc_md: input.body, doc_version: input.version };
  try {
    let saved: { doc_md?: string | null; doc_version?: number };
    if (input.entity === 'asset') saved = (await assetsApi.update(input.id, payload)).asset;
    else if (input.entity === 'project') saved = await projectsApi.update(input.id, payload);
    else saved = await domainsApi.update(input.id, payload);
    revalidatePath(pathFor(input.entity, input.id));
    return { ok: true, doc_md: saved.doc_md ?? null, doc_version: saved.doc_version ?? input.version };
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      const body = err.body as { error?: string; doc_md?: string | null; doc_version?: number } | null;
      if (body?.error === 'doc_conflict' && typeof body.doc_version === 'number') {
        return { ok: false, conflict: { doc_md: body.doc_md ?? null, doc_version: body.doc_version } };
      }
    }
    if (err instanceof ApiError) {
      const body = err.body as { error?: string; message?: string } | null;
      return { ok: false, error: body?.message ?? body?.error ?? `HTTP ${err.status}` };
    }
    return { ok: false, error: (err as Error).message };
  }
}

export async function listDocRevisionsAction(input: { entity: DocEntityType; id: string }): Promise<DocRevision[]> {
  try {
    const res = await api.get<{ revisions: DocRevision[] }>(`/api/docs/${input.entity}/${input.id}/revisions?limit=30`);
    return res.revisions;
  } catch {
    return [];
  }
}

// A checklist line in the document is document-only — it never completes
// anything. This turns one line into a real task (the one completion
// state), routed like the entity's other work.
export async function promoteChecklistLineAction(input: {
  title: string;
  projectId?: string | null;
  domainId?: string | null;
  source: string; // "Overview of Outback" — lands in the task notes
  revalidate: string;
}): Promise<{ ok: true; taskId: string } | { ok: false; error: string }> {
  const title = input.title.trim().slice(0, 200);
  if (!title) return { ok: false, error: 'Empty line.' };
  try {
    const created = await tasksApi.create({
      title,
      notes: `From the ${input.source}.`,
      project_id: input.projectId ?? null,
      domain_id: input.projectId ? null : (input.domainId ?? null),
      priority: 4,
      source: 'manual',
    });
    revalidatePath(input.revalidate);
    revalidatePath('/tasks');
    revalidatePath('/');
    return { ok: true, taskId: created.id };
  } catch (err) {
    if (err instanceof ApiError) {
      const body = err.body as { error?: string } | null;
      return { ok: false, error: body?.error ?? `HTTP ${err.status}` };
    }
    return { ok: false, error: (err as Error).message };
  }
}
