import type { KnowledgeChange, KnowledgeEffectiveTime, KnowledgePreviewChange, KnowledgeReceipt, ResponsibilityVersionInput } from '@jevi-ops/shared';
import type { SourceDescriptor } from '../sources/types';

export interface ResponsibilityVersion extends Omit<ResponsibilityVersionInput, 'source_ids'> {
  id: string; rule_id: string; version: number; status: 'proposed' | 'accepted' | 'withdrawn';
  source_ids?: string[]; created_at: string; actor: string;
}
export interface ResponsibilityRow { rule: { id: string; current_version: number }; version: ResponsibilityVersion }
export interface VehicleAssessment {
  id: string; asset_id: string; rule_id: string; rule_version_id: string; revision: number;
  applicability: 'unknown' | 'applicable' | 'not_applicable';
  evidence_basis: 'user_reported' | 'document_supported' | 'official_source_supported';
  review_state: 'unreviewed' | 'accepted' | 'needs_review';
  rationale: string; relevant_facts: Record<string, unknown>; source_ids: string[];
  assessed_at: string; last_checked_at: string | null; review_due_at: string | null;
  item_id: string | null; invalidation_reason: string | null; freshness: string; knowledge_label: string;
}
export interface KnowledgeTransition {
  id: string; asset_id: string; operation: KnowledgeChange; effective: KnowledgeEffectiveTime; effective_at: string | null;
  status: 'pending' | 'applied' | 'needs_review' | 'cancelled' | 'superseded'; revision: number;
  approved_at: string; reason: string | null; applied_at: string | null;
  preconditions?: { rule: { id: string; version_id: string; current_version: number } };
}
export interface KnowledgePreview { id: string; fingerprint: string; changes: KnowledgePreviewChange[] }
export interface KnowledgeHistory { id: string; revision: number; actor: string; reason: string; created_at: string; snapshot: Record<string, unknown> }
export interface KnowledgePanelData {
  assessments: VehicleAssessment[]; transitions: KnowledgeTransition[]; rules: ResponsibilityRow[]; sources: SourceDescriptor[];
}
export type { KnowledgeReceipt };
