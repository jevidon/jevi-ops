import type { SourceCandidate, SourceSubject } from '@jevi-ops/shared';
import type { CompleteVisitBody } from '@/lib/api';
export type { SourceCandidate, SourceSubject };
export interface SourceDescriptor {
  id: string; source_id: string; label: string; kind: 'file' | 'text' | 'link'; media_type: string;
  size_bytes: number; content_hash: string; received_at: string; asset_id: string | null; session_id: string | null;
  processing_status: 'retained'; url: string | null; download_url: string;
}
export interface SourceCandidateRow {
  id: string; source_link_id: string; candidate: SourceCandidate; revision: number;
  status: 'pending' | 'accepted' | 'rejected'; receipt: { visit_id?: string; accepted_at?: string } | null;
}
export interface SourceWithCandidates extends SourceDescriptor { candidates: SourceCandidateRow[] }
export interface AcceptCandidateInput {
  expected_revision: number; operation_key: string; visit: CompleteVisitBody & { visited_on: string };
  date_confirmed: boolean; unit_conversion_confirmed: boolean;
}
