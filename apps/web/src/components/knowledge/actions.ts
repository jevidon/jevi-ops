'use server';

import { revalidatePath } from 'next/cache';
import type { KnowledgeChangeInput, ResponsibilityVersionInput } from '@jevi-ops/shared';
import { api, ApiError } from '@/lib/api';
import type { KnowledgeHistory, KnowledgePanelData, KnowledgePreview, KnowledgeReceipt, ResponsibilityVersion, ResponsibilityRow, VehicleAssessment, KnowledgeTransition } from './types';
import type { SourceDescriptor } from '../sources/types';

export type KnowledgeResult<T> = { ok: true; value: T } | { ok: false; error: string };
async function run<T>(fn: () => Promise<T>): Promise<KnowledgeResult<T>> {
  try { return { ok: true, value: await fn() }; }
  catch (error) {
    if (error instanceof ApiError) {
      const body = error.body as { message?: string; error?: string } | null;
      return { ok: false, error: body?.message ?? body?.error?.replaceAll('_', ' ') ?? 'The request failed. Review your inputs and retry.' };
    }
    return { ok: false, error: 'Connection interrupted. Your inputs are preserved. Reload the current state before retrying an uncertain save.' };
  }
}
export async function loadKnowledgePanelAction(assetId: string): Promise<KnowledgeResult<KnowledgePanelData>> {
  return run(async () => {
    const [knowledge, { rules }, { sources }] = await Promise.all([
      api.get<{ assessments: VehicleAssessment[]; transitions: KnowledgeTransition[] }>(`/api/assets/${assetId}/knowledge`),
      api.get<{ rules: ResponsibilityRow[] }>('/api/responsibilities'),
      api.get<{ sources: SourceDescriptor[] }>(`/api/sources?asset_id=${assetId}`),
    ]);
    return { ...knowledge, rules, sources };
  });
}
export async function saveResponsibilityAction(input: ResponsibilityVersionInput, existing?: { id: string; version: number }, creationKey?: string) {
  return run(() => api.post<{ version: ResponsibilityVersion }>(existing ? `/api/responsibilities/${existing.id}/versions` : '/api/responsibilities',
    { ...input, ...(existing ? { expected_version: existing.version } : creationKey ? { creation_key: creationKey } : {}) }));
}
export async function responsibilityHistoryAction(id: string) {
  return run(() => api.get<{ versions: ResponsibilityVersion[] }>(`/api/responsibilities/${id}/versions`));
}
export async function previewKnowledgeAction(input: KnowledgeChangeInput) {
  return run(() => api.post<{ preview: KnowledgePreview }>('/api/knowledge/preview', input));
}
export async function acceptKnowledgeAction(assetId: string, preview: { id: string; fingerprint: string }, operationKey: string) {
  const result = await run(() => api.post<{ receipt: KnowledgeReceipt }>('/api/knowledge/accept', { preview_id: preview.id, fingerprint: preview.fingerprint, operation_key: operationKey }));
  if (result.ok) { revalidatePath(`/assets/${assetId}`); revalidatePath('/maintenance'); }
  return result;
}
export async function knowledgeHistoryAction(kind: 'assessment' | 'transition', id: string) {
  return run(() => api.get<{ history: KnowledgeHistory[] }>(`/api/knowledge/${kind === 'assessment' ? 'assessments' : 'transitions'}/${id}/history`));
}
export async function cancelKnowledgeTransitionAction(assetId: string, id: string, expectedRevision: number, reason: string) {
  const result = await run(() => api.post(`/api/knowledge/transitions/${id}/cancel`, { expected_revision: expectedRevision, reason }));
  if (result.ok) revalidatePath(`/assets/${assetId}`);
  return result;
}
export async function createKnowledgeFollowupAction(assetId: string, assessmentId: string) {
  const result = await run(() => api.post<{ task: { id: string } }>(`/api/knowledge/assessments/${assessmentId}/follow-up`, {}));
  if (result.ok) revalidatePath(`/assets/${assetId}`);
  return result;
}
export async function processKnowledgeTransitionsAction(assetId: string) {
  const result = await run(() => api.post('/api/knowledge/transitions/process', {}));
  if (result.ok) revalidatePath(`/assets/${assetId}`);
  return result;
}
