'use server';

import type { CoreSetupContext, CoreStructure, OnboardingModuleDefinition, OnboardingPreview, OnboardingReceipt, OnboardingSession, OnboardingStepState } from '@jevi-ops/shared/schemas';
import { api, ApiError } from '@/lib/api';

export type OnboardingActionResult<T> = { ok: true; value: T } | { ok: false; error: string; session?: OnboardingSession; details?: { path: (string | number)[]; message: string }[] };
async function run<T>(fn: () => Promise<T>): Promise<OnboardingActionResult<T>> {
  try { return { ok: true, value: await fn() }; }
  catch (err) {
    if (err instanceof ApiError && err.body && typeof err.body === 'object') {
      const body = err.body as { error?: string; session?: OnboardingSession; details?: { path: (string | number)[]; message: string }[] };
      return { ok: false, error: body.error ?? 'request_failed', session: body.session, details: body.details };
    }
    return { ok: false, error: 'connection_failed' };
  }
}
export async function startOnboardingAction(input: { module_id: 'core' | 'vehicle'; creation_key: string; entry_point: 'first_run' | 'settings' | 'add_asset' | 'asset_detail'; subject_id?: string; parent_session_id?: string; draft?: OnboardingSession['draft'] }) {
  return run(() => api.post<OnboardingSession>('/api/onboarding/sessions', input));
}
export async function loadOnboardingAction(id: string) {
  return run(() => api.get<{ session: OnboardingSession; module: OnboardingModuleDefinition; warning: { code: string; can_migrate: boolean } | null }>(`/api/onboarding/sessions/${id}`));
}
export async function saveOnboardingStepAction(input: { id: string; step_id: string; expected_revision: number; values: OnboardingSession['draft'][string]; state: OnboardingStepState; current_step_id?: string }) {
  const { id, step_id, ...body } = input;
  return run(() => api.patch<OnboardingSession>(`/api/onboarding/sessions/${id}/steps/${step_id}`, body));
}
export async function transitionOnboardingAction(input: { id: string; action: 'defer' | 'resume' | 'abandon'; expected_revision: number }) {
  return run(() => api.post<OnboardingSession>(`/api/onboarding/sessions/${input.id}/${input.action}`, { expected_revision: input.expected_revision }));
}
export async function previewOnboardingAction(input: { id: string; expected_revision: number; action_id?: string }) {
  const suffix = input.action_id ? `/actions/${input.action_id}/preview` : '/preview';
  return run(() => api.post<OnboardingPreview>(`/api/onboarding/sessions/${input.id}${suffix}`, { expected_revision: input.expected_revision }));
}
export async function completeOnboardingAction(input: { id: string; expected_revision: number; operation_key: string; preview_fingerprint: string; action_id?: string }) {
  const { id, action_id, ...body } = input;
  const suffix = action_id ? `/actions/${action_id}/apply` : '/complete';
  return run(() => api.post<{ session: OnboardingSession; receipt: OnboardingReceipt }>(`/api/onboarding/sessions/${id}${suffix}`, body));
}
export async function loadCoreContextAction(id: string) {
  return run(() => api.get<CoreSetupContext>(`/api/onboarding/sessions/${id}/core-context`));
}
export async function interpretCoreStructureAction(text: string) {
  return run(() => api.post<CoreStructure>('/api/onboarding/core/interpret-structure', { text }));
}
