'use server';

import { revalidatePath } from 'next/cache';
import { RESEARCH_WORKER_SCOPES, type MonitoringPolicyInput, type ResearchJobInput } from '@jevi-ops/shared';
import { api, ApiError } from '@/lib/api';
import type { MonitoringDetail, MonitoringPolicy, ResearchJob, ResearchJobDetail, ResearchProposal, ResearchToken, ResearchWorker } from './types';

export type ResearchActionResult<T> = { ok: true; value: T } | { ok: false; error: string; code: string };
async function run<T>(fn: () => Promise<T>): Promise<ResearchActionResult<T>> {
  try { return { ok: true, value: await fn() }; }
  catch (error) {
    if (error instanceof ApiError) {
      const body = error.body as { error?: string; message?: string } | null;
      return { ok: false, code: body?.error ?? 'request_failed', error: body?.message ?? body?.error?.replaceAll('_', ' ') ?? 'Request failed. Review the current state and retry.' };
    }
    return { ok: false, code: 'connection_failed', error: 'Connection interrupted. Your inputs are preserved. Check the current state before retrying.' };
  }
}
export async function loadResearchWorkersAction() {
  return run(async () => {
    const [{ workers }, { tokens }] = await Promise.all([api.get<{ workers: ResearchWorker[] }>('/api/research/workers'), api.get<{ tokens: ResearchToken[] }>('/api/auth/tokens')]);
    return { workers, tokens: tokens.filter((token) => token.permission_profile === 'research_worker') };
  });
}
export async function createHermesWorkerAction(name: string) {
  return run(async () => {
    const runtime = await api.get<{ adapter: string; adapter_version: string; capabilities: string[]; allowed_task_types: string[] }>('/api/research/setup-package');
    return api.post<{ worker: ResearchWorker }>('/api/research/workers', { name, ...runtime, enabled: true });
  });
}
export async function updateResearchWorkerAction(id: string, enabled: boolean) {
  return run(() => api.patch<{ worker: ResearchWorker }>(`/api/research/workers/${id}`, { enabled }));
}
export async function mintResearchWorkerTokenAction(workerId: string, name: string) {
  return run(() => api.post<{ id: string; token: string }>('/api/auth/tokens', { name, kind: 'agent', permission_profile: 'research_worker', worker_id: workerId, scopes: [...RESEARCH_WORKER_SCOPES] }));
}
export async function revokeResearchWorkerTokenAction(id: string) {
  return run(() => api.delete(`/api/auth/tokens/${id}`));
}
export async function loadAssetResearchAction(assetId: string) {
  return run(async () => {
    const [{ workers }, { jobs }, { proposals }] = await Promise.all([
      api.get<{ workers: ResearchWorker[] }>('/api/research/workers'),
      api.get<{ jobs: ResearchJob[] }>(`/api/research/jobs?asset_id=${assetId}`),
      api.get<{ proposals: ResearchProposal[] }>(`/api/research/proposals?asset_id=${assetId}`),
    ]);
    return { workers, jobs, proposals };
  });
}
export async function requestVehicleResearchAction(input: ResearchJobInput) {
  return run(() => api.post<{ job: ResearchJob }>('/api/research/jobs', input));
}
export async function researchJobDetailAction(id: string) { return run(() => api.get<ResearchJobDetail>(`/api/research/jobs/${id}`)); }
export async function cancelResearchJobAction(id: string) { return run(() => api.post(`/api/research/jobs/${id}/cancel`, {})); }
export async function previewResearchProposalAction(id: string) { return run(() => api.post<{ proposal: ResearchProposal }>(`/api/research/proposals/${id}/preview`, {})); }
export async function approveResearchProposalAction(assetId: string, proposal: { id: string; revision: number; fingerprint: string }, key: string) {
  const result = await run(() => api.post<{ receipt: Record<string, unknown> }>(`/api/research/proposals/${proposal.id}/approve`, { expected_revision: proposal.revision, fingerprint: proposal.fingerprint, operation_key: key }));
  if (result.ok) { revalidatePath(`/assets/${assetId}`); revalidatePath('/maintenance'); }
  return result;
}
export async function rejectResearchProposalAction(id: string, revision: number, reason: string) {
  return run(() => api.post(`/api/research/proposals/${id}/reject`, { expected_revision: revision, reason }));
}
export async function loadMonitoringPoliciesAction(assetId: string) { return run(() => api.get<{ policies: MonitoringPolicy[] }>(`/api/monitoring/policies?asset_id=${assetId}`)); }
export async function monitoringChoicesAction() {
  return run(async () => {
    const [{ assets }, { rules }] = await Promise.all([
      api.get<{ assets: { id: string; name: string; kind: string; lifecycle: string }[] }>('/api/assets?include_archived=true'),
      api.get<{ rules: { rule: { id: string }; version: { title: string } }[] }>('/api/responsibilities'),
    ]);
    return { assets: assets.filter((asset) => asset.kind === 'vehicle'), rules: rules.map((rule) => ({ id: rule.rule.id, title: rule.version.title })) };
  });
}
export async function monitoringDetailAction(id: string) { return run(() => api.get<MonitoringDetail>(`/api/monitoring/policies/${id}`)); }
export async function saveMonitoringPolicyAction(config: MonitoringPolicyInput, existing?: { id: string; revision: number }) {
  return run(() => existing ? api.patch<{ policy: MonitoringPolicy }>(`/api/monitoring/policies/${existing.id}`, { ...config, expected_revision: existing.revision }) : api.post<{ policy: MonitoringPolicy }>('/api/monitoring/policies', config));
}
export async function setMonitoringEnabledAction(id: string, revision: number, enabled: boolean) { return run(() => api.patch(`/api/monitoring/policies/${id}`, { expected_revision: revision, enabled })); }
export async function signalMonitoringAction(id: string, input: { operation_key: string; kind: 'manual_review' | 'user_report' | 'source_change'; reason: string }) { return run(() => api.post(`/api/monitoring/policies/${id}/signals`, input)); }
export async function readMonitoringNotificationAction(id: string) { return run(() => api.post(`/api/monitoring/notifications/${id}/read`, {})); }
