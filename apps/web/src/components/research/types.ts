import type { MonitoringAssetReview, MonitoringPolicyConfig, ResearchJobRequest, ResearchOperation, ResearchResult } from '@jevi-ops/shared';

export interface ResearchWorker {
  id: string; name: string; adapter: string; adapter_version: string; capabilities: string[]; allowed_task_types: string[]; enabled: boolean;
  last_seen_at: string | null; last_health_ok: boolean | null; health_detail: string | null; last_successful_at: string | null;
  connection_state: 'not_configured' | 'configured_not_tested' | 'ready' | 'degraded';
}
export interface ResearchToken {
  id: string; name: string; permission_profile: string; worker_id: string | null; scopes: string[];
  created_at: string; last_used_at: string | null; revoked_at: string | null;
}
export interface ResearchJob {
  id: string; asset_id: string; request: ResearchJobRequest; status: 'requested' | 'leased' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  attempts: number; failure_reason: string | null; last_checked_at: string | null; created_at: string; updated_at: string;
  lease_expires_at: string | null; run_deadline: string | null;
}
export interface ResearchProposal {
  id: string; job_id: string; asset_id: string; operations: ResearchOperation[];
  status: 'pending_review' | 'applied' | 'rejected' | 'superseded' | 'conflicted'; revision: number;
  preview: { changes: Array<{ type: string; before?: unknown; after?: unknown; reason?: string; changes?: { label: string; before?: unknown; after?: unknown }[]; new_rule?: unknown }>; summary: string; uncertainty: string[]; missing_facts: string[] } | null;
  fingerprint: string | null; reason: string | null; receipt: Record<string, unknown> | null;
}
export interface ResearchJobDetail {
  job: ResearchJob; result: { id: string; result: Omit<ResearchResult, 'lease_token'>; created_at: string } | null;
  proposals: ResearchProposal[];
  history: { id: string; event: string; actor: string; created_at: string; detail: Record<string, unknown> }[];
}
export interface MonitoringPolicy {
  id: string; config: MonitoringPolicyConfig; revision: number; next_due_at: string;
  retry_after_at: string | null; last_attempt_at: string | null; last_successful_at: string | null;
  last_outcome: string | null; failure_count: number; monitoring_state: string; connection_state: string;
}
export interface MonitoringDetail {
  policy: MonitoringPolicy;
  runs: { id: string; status: string; reasons: string[]; shared_job_id: string | null; asset_reviews: MonitoringAssetReview[]; created_at: string; completed_at: string | null }[];
  signals: { id: string; kind: string; reason: string; processed_at: string | null; created_at: string }[];
  notifications: { id: string; title: string; detail: string; created_at: string; read_at: string | null }[];
}
