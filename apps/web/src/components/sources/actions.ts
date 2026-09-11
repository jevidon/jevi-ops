'use server';
import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';
import type { SourceSubject, SourceCandidate, SourceDescriptor, SourceCandidateRow, SourceWithCandidates, AcceptCandidateInput } from './types';

const query = (subject: SourceSubject) => new URLSearchParams(subject as Record<string, string>).toString();
function message(error: unknown): string {
  if (error instanceof ApiError) {
    const body = error.body as { message?: string; error?: string } | null;
    return body?.message ?? body?.error ?? `Request failed (${error.status}).`;
  }
  return 'Connection interrupted. Your draft is preserved. Reload to check the saved state before retrying.';
}
function revalidate(subject: SourceSubject) {
  if (subject.asset_id) revalidatePath(`/assets/${subject.asset_id}`);
  revalidatePath('/onboarding');
}
export async function loadSourcesAction(subject: SourceSubject): Promise<{ sources?: SourceWithCandidates[]; error?: string }> {
  try {
    const res = await api.get<{ sources: SourceDescriptor[] }>(`/api/sources?${query(subject)}`);
    const sources = await Promise.all(res.sources.map(async (source) => ({ ...source, candidates: (await api.get<{ candidates: SourceCandidateRow[] }>(`/api/sources/${source.id}/candidates`)).candidates })));
    return { sources };
  } catch (error) { return { error: message(error) }; }
}
export async function addSourceAction(input: { subject: SourceSubject; label: string; kind: 'text' | 'link'; text?: string; url?: string }) {
  try { const result = await api.post<{ source: SourceDescriptor }>('/api/sources', input); revalidate(input.subject); return result; }
  catch (error) { return { error: message(error) }; }
}
export async function saveSourceCandidateAction(sourceId: string, subject: SourceSubject, candidate: SourceCandidate, operationKey: string, existing?: { id: string; revision: number }) {
  try {
    const result = existing ? await api.patch<{ candidate: SourceCandidateRow }>(`/api/source-candidates/${existing.id}`, { expected_revision: existing.revision, candidate })
      : await api.post<{ candidate: SourceCandidateRow }>(`/api/sources/${sourceId}/candidates`, { subject, candidate, operation_key: operationKey });
    revalidate(subject); return result;
  } catch (error) { return { error: message(error) }; }
}
export async function acceptSourceCandidateAction(id: string, subject: SourceSubject, input: AcceptCandidateInput) {
  try { const result = await api.post<{ receipt: Record<string, unknown> }>(`/api/source-candidates/${id}/accept`, input); revalidate(subject); return result; }
  catch (error) { return { error: message(error) }; }
}
export async function removeSourceCandidateAction(id: string, revision: number, subject: SourceSubject) {
  try { await api.delete(`/api/source-candidates/${id}`, { expected_revision: revision }); revalidate(subject); return { ok: true as const }; }
  catch (error) { return { error: message(error) }; }
}
export async function removeSourceAction(id: string, subject: SourceSubject) {
  try { await api.delete(`/api/sources/${id}`); revalidate(subject); return { ok: true as const }; }
  catch (error) { return { error: message(error) }; }
}
