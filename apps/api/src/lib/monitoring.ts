import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { MonitoringPolicyInputSchema, MonitoringSignalSchema, UpdateMonitoringPolicySchema, type MonitoringPolicyInput, type MonitoringAssetReview, factValue, ResearchProfileKeySchema } from '@jevi-ops/shared';
import { assets } from '../db/schema.js';
import { source_documents } from '../db/source-schema.js';
import { vehicle_assessments, knowledge_transitions, responsibility_rule_versions } from '../db/knowledge-schema.js';
import { research_jobs, research_proposals, research_results, research_workers } from '../db/research-schema.js';
import { monitoring_notifications, monitoring_policies, monitoring_review_runs, monitoring_signals } from '../db/monitoring-schema.js';
import { inTransaction, type DbOrTx, type Tx } from './maintenance-tx.js';
import { CommandError } from './command-error.js';
import { knowledgeFingerprint } from './knowledge.js';
import { recordAssessmentHistory } from './knowledge-invalidation.js';
import { assetSnapshotMarker } from './asset-context.js';
import { cancelResearchJob, expireResearchLeases, requestResearch } from './research.js';

type Policy = typeof monitoring_policies.$inferSelect;
const at = (now: string, hours: number) => new Date(Date.parse(now) + hours * 3_600_000).toISOString();
const FACT_KEYS = ResearchProfileKeySchema.options;
async function validatePolicyScope(tx: Tx, config: Policy['config']) {
  const rows = await tx.select({ id: assets.id }).from(assets).where(and(inArray(assets.id, [...new Set(config.asset_ids)]), eq(assets.kind, 'vehicle')));
  if (rows.length !== new Set(config.asset_ids).size) throw new CommandError(400, 'asset_not_found', 'Every monitored vehicle must exist.');
  const [worker] = await tx.select().from(research_workers).where(eq(research_workers.id, config.worker_id));
  if (!worker || !worker.capabilities.includes('external_fetch') || !worker.allowed_task_types.includes('source_verification') || !worker.allowed_task_types.includes('responsibility_review')) throw new CommandError(400, 'worker_scope_missing', 'Monitoring needs a worker configured for source verification and responsibility review.');
}
export async function createMonitoringPolicy(db: DbOrTx, input: MonitoringPolicyInput, actor: string, now = new Date().toISOString()) {
  const { creation_key, ...config } = MonitoringPolicyInputSchema.parse(input);
  config.asset_ids = [...new Set(config.asset_ids)].sort();
  return inTransaction(db, async (tx) => {
    const fingerprint = knowledgeFingerprint({ ...config, creation_key });
    if (creation_key) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`monitor-policy:${actor}:${creation_key}`}, 0))`);
      const [prior] = await tx.select().from(monitoring_policies).where(and(eq(monitoring_policies.creation_actor, actor), eq(monitoring_policies.creation_key, creation_key)));
      if (prior) { if (prior.creation_fingerprint !== fingerprint) throw new CommandError(409, 'operation_key_conflict', 'This policy creation key was used with another configuration.'); return prior; }
    }
    await validatePolicyScope(tx, config);
    const [policy] = await tx.insert(monitoring_policies).values({ worker_id: config.worker_id, config, actor, next_due_at: now, creation_key: creation_key ?? null, creation_actor: creation_key ? actor : null, creation_fingerprint: creation_key ? fingerprint : null }).returning();
    return policy!;
  });
}
async function cancelRuns(tx: Tx, policyId: string, actor: string, now: string) {
  const runs = await tx.select().from(monitoring_review_runs).where(and(eq(monitoring_review_runs.policy_id, policyId), inArray(monitoring_review_runs.status, ['researching', 'evaluating']))).for('update');
  for (const run of runs) {
    // Shared source jobs may also serve another policy. Stop this policy's
    // individual evaluations; the scheduler can finish retaining public evidence.
    for (const review of run.asset_reviews) if (review.job_id) {
      const [job] = await tx.select().from(research_jobs).where(eq(research_jobs.id, review.job_id));
      if (job && ['requested', 'leased', 'running'].includes(job.status)) await cancelResearchJob(tx, job.id, actor);
    }
    await tx.update(monitoring_review_runs).set({ status: 'cancelled', completed_at: now }).where(eq(monitoring_review_runs.id, run.id));
    if (run.shared_job_id) {
      const others = await tx.select({ id: monitoring_review_runs.id }).from(monitoring_review_runs).where(and(eq(monitoring_review_runs.shared_job_id, run.shared_job_id), ne(monitoring_review_runs.id, run.id), inArray(monitoring_review_runs.status, ['researching', 'evaluating'])));
      const [shared] = await tx.select().from(research_jobs).where(eq(research_jobs.id, run.shared_job_id));
      if (!others.length && shared && ['requested', 'leased', 'running'].includes(shared.status)) await cancelResearchJob(tx, shared.id, actor);
    }
  }
}
export async function updateMonitoringPolicy(db: DbOrTx, id: string, input: unknown, actor: string, now = new Date().toISOString()) {
  const { expected_revision, ...patch } = UpdateMonitoringPolicySchema.parse(input);
  return inTransaction(db, async (tx) => {
    const [policy] = await tx.select().from(monitoring_policies).where(eq(monitoring_policies.id, id)).for('update');
    if (!policy) throw new CommandError(404, 'not_found', 'Monitoring policy not found.');
    if (policy.revision !== expected_revision) throw new CommandError(409, 'monitoring_conflict', 'The monitoring policy changed. Reload it before saving.');
    const config = MonitoringPolicyInputSchema.parse({ ...policy.config, ...patch });
    config.asset_ids = [...new Set(config.asset_ids)].sort();
    await validatePolicyScope(tx, config);
    await cancelRuns(tx, id, actor, now);
    const [updated] = await tx.update(monitoring_policies).set({ config, worker_id: config.worker_id, revision: policy.revision + 1, actor, updated_at: now, retry_after_at: null, next_due_at: config.enabled ? now : policy.next_due_at, last_outcome: config.enabled ? 'configuration_changed' : 'paused' }).where(eq(monitoring_policies.id, id)).returning();
    return updated!;
  });
}
export async function signalMonitoringReview(db: DbOrTx, policyId: string, input: unknown, actor: string) {
  const data = MonitoringSignalSchema.parse(input), fingerprint = knowledgeFingerprint(data);
  return inTransaction(db, async (tx) => {
    const [policy] = await tx.select().from(monitoring_policies).where(eq(monitoring_policies.id, policyId)).for('update');
    if (!policy) throw new CommandError(404, 'not_found', 'Monitoring policy not found.');
    const [prior] = await tx.select().from(monitoring_signals).where(and(eq(monitoring_signals.policy_id, policyId), eq(monitoring_signals.operation_key, data.operation_key)));
    if (prior) { if (prior.fingerprint !== fingerprint) throw new CommandError(409, 'operation_key_conflict', 'The signal key belongs to another report.'); return prior; }
    if (data.source_id) {
      const [source] = await tx.select({ id: source_documents.id }).from(source_documents).where(eq(source_documents.id, data.source_id));
      if (!source) throw new CommandError(400, 'source_not_found', 'The supplied source must first be retained.');
    }
    const [signal] = await tx.insert(monitoring_signals).values({ policy_id: policyId, ...data, fingerprint, actor }).returning();
    return signal!;
  });
}
async function notify(tx: Tx, policy: Policy, key: string, kind: string, title: string, detail: string) {
  if (policy.config.notifications === 'off') return;
  await tx.insert(monitoring_notifications).values({ policy_id: policy.id, dedup_key: key, kind, title, detail }).onConflictDoNothing();
}
async function failedPolicy(tx: Tx, policy: Policy, outcome: string, now: string) {
  const count = policy.failure_count + 1;
  const backoff = Math.min(policy.config.cadence_hours, Math.min(24, 2 ** Math.min(count - 1, 5)));
  await tx.update(monitoring_policies).set({ failure_count: count, last_outcome: outcome, retry_after_at: at(now, backoff), last_attempt_at: now, updated_at: now }).where(eq(monitoring_policies.id, policy.id));
  if (count >= 3) await notify(tx, policy, `sustained-failure:${policy.last_successful_at ?? 'never-successful'}`, 'failure', 'Vehicle monitoring needs attention', `${policy.config.name}: ${outcome}. The last successful check has not advanced.`);
}
async function activeScope(tx: Tx, policy: Policy) {
  return tx.select().from(assets).where(and(inArray(assets.id, policy.config.asset_ids), eq(assets.lifecycle, 'active'))).orderBy(asc(assets.id));
}
async function scopedAssessments(tx: Tx, policy: Policy, assetIds: string[]) {
  if (!assetIds.length || !policy.config.scope.categories.length) return [];
  const rows = await tx.select({ assessment: vehicle_assessments, version: responsibility_rule_versions }).from(vehicle_assessments)
    .innerJoin(responsibility_rule_versions, eq(responsibility_rule_versions.id, vehicle_assessments.rule_version_id))
    .where(inArray(vehicle_assessments.asset_id, assetIds)).orderBy(asc(vehicle_assessments.id));
  return rows.filter(({ assessment, version }) => (!policy.config.scope.rule_ids.length || policy.config.scope.rule_ids.includes(assessment.rule_id))
    && policy.config.scope.categories.includes(version.kind)
    && (!policy.config.scope.country || !version.scope.country || version.scope.country === policy.config.scope.country)).map(({ assessment }) => assessment);
}
async function triggerState(tx: Tx, policy: Policy, activeAssets: Array<typeof assets.$inferSelect>) {
  const ids = activeAssets.map((asset) => asset.id);
  const scoped = await scopedAssessments(tx, policy, ids);
  const fingerprint = knowledgeFingerprint({ assets: activeAssets.map((asset) => ({ id: asset.id, facts: Object.fromEntries(FACT_KEYS.map((key) => [key, factValue(asset.metadata?.[key])])) })), assessments: scoped.map((assessment) => ({ id: assessment.id, rule_version_id: assessment.rule_version_id, applicability: assessment.applicability, review_state: assessment.review_state, relevant_facts: assessment.relevant_facts })) });
  return { fingerprint, assessments: scoped };
}
function semanticProposal(operations: unknown): unknown {
  if (Array.isArray(operations)) return operations.map(semanticProposal);
  if (!operations || typeof operations !== 'object') return operations;
  return Object.fromEntries(Object.entries(operations).filter(([key]) => !['citation_ids', 'reason', 'rationale', 'assessed_at', 'last_checked_at', 'review_due_at'].includes(key)).map(([key, value]) => [key, semanticProposal(value)]));
}
function proposalEvidence(result: typeof research_results.$inferSelect) {
  // Page chrome/hash changes are a signal, not new substantive support. Keep the
  // exact cited content and source URL in the duplicate identity.
  return result.result.sources.map((source) => ({ url: source.url, excerpts: source.supporting_locations.map((location) => location.excerpt.trim()).sort() })).sort((a, b) => a.url.localeCompare(b.url));
}
function proposalCircumstances(job: typeof research_jobs.$inferSelect) {
  const assessments = (job.context.assessments ?? []) as Array<Record<string, unknown>>;
  return knowledgeFingerprint({ facts: Object.fromEntries(Object.entries(job.original_metadata).map(([key, value]) => [key, factValue(value)])), document_version: job.original_doc_version,
    assessments: assessments.map(({ id, rule_version_id, applicability, review_state, item_id }) => ({ id, rule_version_id, applicability, review_state, item_id })) });
}
async function suppressRepeatedProposal(tx: Tx, result: typeof research_results.$inferSelect, job: typeof research_jobs.$inferSelect) {
  const [proposal] = await tx.select().from(research_proposals).where(eq(research_proposals.result_id, result.id));
  if (!proposal) return null;
  const key = knowledgeFingerprint({ changes: semanticProposal(proposal.operations), evidence: proposalEvidence(result) });
  const previous = await tx.select({ proposal: research_proposals, result: research_results, job: research_jobs }).from(research_proposals)
    .innerJoin(research_results, eq(research_results.id, research_proposals.result_id)).innerJoin(research_jobs, eq(research_jobs.id, research_proposals.job_id))
    .where(and(eq(research_proposals.asset_id, proposal.asset_id), inArray(research_proposals.status, ['rejected', 'pending_review', 'applied'])));
  for (const other of previous) {
    if (other.proposal.id === proposal.id || proposalCircumstances(other.job) !== proposalCircumstances(job)) continue;
    const otherKey = knowledgeFingerprint({ changes: semanticProposal(other.proposal.operations), evidence: proposalEvidence(other.result) });
    if (key !== otherKey) continue;
    await tx.update(research_proposals).set({ status: 'superseded', reason: `Equivalent evidence and circumstances are already represented by proposal ${other.proposal.id}.`, revision: proposal.revision + 1 }).where(eq(research_proposals.id, proposal.id));
    return { id: other.proposal.id, duplicate: true, pending: other.proposal.status === 'pending_review', key };
  }
  return { id: proposal.id, duplicate: false, pending: true, key };
}
async function recordNoChangeCheck(tx: Tx, policy: Policy, job: typeof research_jobs.$inferSelect, result: typeof research_results.$inferSelect, now: string) {
  const [asset] = await tx.select().from(assets).where(eq(assets.id, job.asset_id)).for('update');
  if (!asset || asset.lifecycle !== 'active' || await assetSnapshotMarker(tx, asset.id) !== job.context_snapshot) return 'vehicle_changed_during_review';
  const rows = await scopedAssessments(tx, policy, [asset.id]);
  const checkedIds = new Set(result.result.checked_assessment_ids ?? []);
  for (const assessment of rows) {
    if (!checkedIds.has(assessment.id)) continue;
    const [updated] = await tx.update(vehicle_assessments).set({ revision: assessment.revision + 1, last_checked_at: now, review_due_at: at(now, policy.config.cadence_hours), updated_at: now }).where(eq(vehicle_assessments.id, assessment.id)).returning();
    if (updated) await recordAssessmentHistory(tx, updated, 'system:monitoring', `Substantive no-change review ${result.id}; applicability and acceptance state preserved.`);
  }
  return (job.request.review_assessment_ids ?? []).every((id) => checkedIds.has(id)) ? null : 'partial_assessment_coverage';
}
async function advanceRun(tx: Tx, policy: Policy, run: typeof monitoring_review_runs.$inferSelect, now: string) {
  if (run.policy_revision !== policy.revision || !policy.config.enabled) { await cancelRuns(tx, policy.id, 'system:monitoring', now); return; }
  const active = await activeScope(tx, policy), activeIds = new Set(active.map((asset) => asset.id));
  if (!active.length) { await cancelRuns(tx, policy.id, 'system:monitoring', now); await tx.update(monitoring_policies).set({ last_outcome: 'paused_inactive_assets' }).where(eq(monitoring_policies.id, policy.id)); return; }
  if (run.status === 'researching') {
    const [shared] = await tx.select().from(research_jobs).where(eq(research_jobs.id, run.shared_job_id!));
    if (!shared || ['failed', 'cancelled'].includes(shared.status)) {
      await tx.update(monitoring_review_runs).set({ status: 'failed', completed_at: now }).where(eq(monitoring_review_runs.id, run.id));
      await failedPolicy(tx, policy, shared?.failure_reason ?? 'Shared source review failed.', now); return;
    }
    if (shared.status !== 'succeeded') {
      const [worker] = await tx.select().from(research_workers).where(eq(research_workers.id, policy.worker_id));
      if ((!worker?.enabled || !worker.last_seen_at || Date.parse(now) - Date.parse(worker.last_seen_at) > 300_000) && (!policy.retry_after_at || Date.parse(policy.retry_after_at) <= Date.parse(now))) await failedPolicy(tx, policy, 'monitoring_unavailable', now);
      return;
    }
    const [evidence] = await tx.select().from(research_results).where(eq(research_results.job_id, shared.id));
    if (!evidence || !shared.last_checked_at || !evidence.result.sources.length) {
      await tx.update(monitoring_review_runs).set({ status: 'failed', completed_at: now }).where(eq(monitoring_review_runs.id, run.id));
      await failedPolicy(tx, policy, 'insufficient_evidence', now); return;
    }
    const reviews: MonitoringAssetReview[] = [];
    for (const assetId of run.asset_reviews.map((review) => review.asset_id)) {
      if (!activeIds.has(assetId)) { reviews.push({ asset_id: assetId, status: 'skipped', outcome: 'inactive_asset' }); continue; }
      const job = await requestResearch(tx, { operation_key: `monitor:${run.id}:${assetId}`, asset_id: assetId, worker_id: policy.worker_id, task_type: 'responsibility_review',
        question: `${policy.config.question}\nEvaluate the supplied retained sources against this specific vehicle and its prior assessments, including negative and unknown assessments. Keep applicability distinct from a user reminder. Do not fetch the sources again. Scope: ${JSON.stringify(policy.config.scope)}.`,
        allowed_domains: policy.config.allowed_domains, budget: { ...policy.config.budget, max_requests: 0 }, source_result_id: evidence.id, review_assessment_ids: (await scopedAssessments(tx, policy, [assetId])).map((assessment) => assessment.id),
      }, `monitoring:${policy.id}`, 'review_policy', now);
      reviews.push({ asset_id: assetId, job_id: job.id, status: 'requested' });
    }
    await tx.update(monitoring_review_runs).set({ status: 'evaluating', asset_reviews: reviews }).where(eq(monitoring_review_runs.id, run.id));
    return;
  }
  const reviews = structuredClone(run.asset_reviews);
  let waiting = false, failed = false, hasProposal = false;
  for (const review of reviews) {
    if (['succeeded', 'skipped'].includes(review.status)) { if (review.proposal_id && review.outcome !== 'unchanged_prior_proposal') hasProposal = true; continue; }
    if (review.status === 'failed') { failed = true; continue; }
    if (!review.job_id) continue;
    const [job] = await tx.select().from(research_jobs).where(eq(research_jobs.id, review.job_id));
    if (!activeIds.has(review.asset_id)) {
      if (job && ['requested', 'leased', 'running'].includes(job.status)) await cancelResearchJob(tx, job.id, 'system:monitoring');
      review.status = 'skipped'; review.outcome = 'inactive_asset'; continue;
    }
    if (!job || ['failed', 'cancelled'].includes(job.status)) { review.status = 'failed'; review.outcome = job?.failure_reason ?? 'job_missing'; failed = true; continue; }
    if (job.status !== 'succeeded') { waiting = true; continue; }
    const [result] = await tx.select().from(research_results).where(eq(research_results.job_id, job.id));
    if (!result || !job.last_checked_at) { review.status = 'failed'; review.outcome = 'insufficient_evidence'; failed = true; continue; }
    review.status = 'succeeded'; review.outcome = result.result.outcome;
    const proposal = await suppressRepeatedProposal(tx, result, job);
    if (proposal) {
      review.proposal_id = proposal.id; hasProposal ||= proposal.pending;
      if (proposal.duplicate && !proposal.pending) review.outcome = 'unchanged_prior_proposal';
      if (!proposal.duplicate) await notify(tx, policy, `proposal:${review.asset_id}:${proposal.key}`, 'proposal', 'Vehicle research needs review', `A sourced proposal is ready for vehicle ${review.asset_id}. Approval remains required.`);
    } else if (result.result.outcome === 'no_supported_change') {
      const coverageError = await recordNoChangeCheck(tx, policy, job, result, now);
      if (coverageError) { review.status = 'failed'; review.outcome = coverageError; failed = true; }
    }
    if (review.status !== 'failed' && !(job.request.review_assessment_ids ?? []).every((id) => (result.result.checked_assessment_ids ?? []).includes(id))) {
      review.status = 'failed'; review.outcome = 'partial_assessment_coverage'; failed = true;
    }
  }
  await tx.update(monitoring_review_runs).set({ asset_reviews: reviews, ...(waiting ? {} : { status: failed ? 'failed' as const : 'complete' as const, completed_at: now }) }).where(eq(monitoring_review_runs.id, run.id));
  if (waiting) return;
  if (failed) { await failedPolicy(tx, policy, reviews.find((review) => review.status === 'failed')?.outcome ?? 'review_failed', now); return; }
  await tx.update(monitoring_policies).set({ last_successful_at: now, last_outcome: hasProposal ? 'pending_proposal' : reviews.some((review) => review.outcome === 'findings') ? 'reviewed_findings' : 'no_supported_change', failure_count: 0, retry_after_at: null, next_due_at: at(now, policy.config.cadence_hours), updated_at: now }).where(eq(monitoring_policies.id, policy.id));
}

export async function runMonitoringSweep(db: DbOrTx, now = new Date().toISOString(), limit = 20) {
  await expireResearchLeases(db, now);
  // Rotate across enabled policies so a paused or long-running early row cannot
  // starve policies beyond the bounded batch. Configuration updates cancel runs.
  const policies = await db.select({ id: monitoring_policies.id }).from(monitoring_policies).where(sql`${monitoring_policies.config}->>'enabled' = 'true'`).orderBy(sql`${monitoring_policies.last_swept_at} asc nulls first`, asc(monitoring_policies.id)).limit(limit);
  const counts = { considered: 0, started: 0, progressed: 0, unavailable: 0 };
  for (const entry of policies) await inTransaction(db, async (tx) => {
    const [policy] = await tx.select().from(monitoring_policies).where(eq(monitoring_policies.id, entry.id)).for('update', { skipLocked: true });
    if (!policy) return; counts.considered++;
    await tx.update(monitoring_policies).set({ last_swept_at: now }).where(eq(monitoring_policies.id, policy.id));
    if (policy.config.enabled && policy.config.notifications !== 'off') {
      const approaching = await tx.select().from(knowledge_transitions).where(and(inArray(knowledge_transitions.asset_id, policy.config.asset_ids), eq(knowledge_transitions.status, 'pending')));
      for (const transition of approaching) if (transition.effective_at && Date.parse(transition.effective_at) >= Date.parse(now) && Date.parse(transition.effective_at) <= Date.parse(at(now, 168))) await notify(tx, policy, `transition:${transition.id}:${transition.revision}`, 'transition', 'An approved vehicle change is approaching', `Change ${transition.id} is scheduled for ${transition.effective_at}; preconditions will be checked before activation.`);
    }
    const [running] = await tx.select().from(monitoring_review_runs).where(and(eq(monitoring_review_runs.policy_id, policy.id), inArray(monitoring_review_runs.status, ['researching', 'evaluating']))).for('update');
    if (running) { await advanceRun(tx, policy, running, now); counts.progressed++; return; }
    if (!policy.config.enabled || policy.retry_after_at && Date.parse(policy.retry_after_at) > Date.parse(now)) return;
    const active = await activeScope(tx, policy);
    if (!active.length) { await tx.update(monitoring_policies).set({ last_outcome: 'paused_inactive_assets' }).where(eq(monitoring_policies.id, policy.id)); return; }
    const state = await triggerState(tx, policy, active);
    const signals = await tx.select().from(monitoring_signals).where(and(eq(monitoring_signals.policy_id, policy.id), isNull(monitoring_signals.processed_at))).orderBy(asc(monitoring_signals.created_at), asc(monitoring_signals.id)).limit(20);
    const due = Date.parse(policy.next_due_at) <= Date.parse(now);
    const knowledgeDue = state.assessments.some((assessment) => assessment.review_due_at && Date.parse(assessment.review_due_at) <= Date.parse(now));
    const factsChanged = policy.last_trigger_fingerprint != null && policy.last_trigger_fingerprint !== state.fingerprint;
    if (!due && !knowledgeDue && !factsChanged && !signals.length) return;
    if (policy.last_attempt_at && Date.parse(now) - Date.parse(policy.last_attempt_at) < 3_600_000 && !signals.length) return;
    const [worker] = await tx.select().from(research_workers).where(eq(research_workers.id, policy.worker_id));
    if (!worker?.enabled || !worker.last_successful_at || !worker.configuration_verified || !worker.last_seen_at || Date.parse(now) - Date.parse(worker.last_seen_at) > 300_000) {
      await failedPolicy(tx, policy, 'monitoring_unavailable', now); counts.unavailable++; return;
    }
    const reasons = [...(due ? ['scheduled_review'] : []), ...(knowledgeDue ? ['assessment_review_due'] : []), ...(factsChanged ? ['relevant_vehicle_change'] : []), ...signals.map((signal) => `${signal.kind}: ${signal.reason}`)];
    const triggerKey = knowledgeFingerprint({ revision: policy.revision, next_due: policy.next_due_at, state: state.fingerprint, signals: signals.map((signal) => signal.id), retry_hour: Math.floor(Date.parse(now) / 3_600_000) });
    const [run] = await tx.insert(monitoring_review_runs).values({ policy_id: policy.id, policy_revision: policy.revision, trigger_key: triggerKey, reasons, asset_reviews: active.map((asset) => ({ asset_id: asset.id, status: 'waiting' as const })) }).onConflictDoNothing().returning();
    if (!run) return;
    const sharedKey = knowledgeFingerprint({ worker: worker.id, domains: [...policy.config.allowed_domains].sort(), question: policy.config.question, scope: policy.config.scope, budget: policy.config.budget, reports: signals.map(({ kind, reason, source_id }) => ({ kind, reason, source_id })), hour: Math.floor(Date.parse(now) / 3_600_000), supplied_sources: signals.filter((signal) => signal.source_id).map((signal) => signal.source_id).sort() });
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`monitor-shared:${sharedKey}`}, 0))`);
    const [existing] = await tx.select().from(research_jobs).where(and(eq(research_jobs.requester, 'system:shared-source-review'), eq(research_jobs.operation_key, sharedKey)));
    const shared = existing ?? await requestResearch(tx, { operation_key: sharedKey, asset_id: active[0]!.id, worker_id: worker.id, task_type: 'source_verification', allow_proposals: false,
      question: `${policy.config.question}\nFetch and retain public source evidence for this shared scope: ${JSON.stringify(policy.config.scope)}. Report source status (proposed, future-effective, effective or unresolved) with support. Do not infer individual vehicle applicability and do not propose changes. Review trigger excerpts (complete reports remain in the owner review history): ${reasons.map((reason) => reason.length > 200 ? `${reason.slice(0, 200)}…` : reason).join('; ')}.`,
      allowed_domains: policy.config.allowed_domains, budget: policy.config.budget, authorized_source_ids: signals.flatMap((signal) => signal.source_id ? [signal.source_id] : []),
    }, 'system:shared-source-review', 'review_policy', now);
    await tx.update(monitoring_review_runs).set({ shared_job_id: shared.id }).where(eq(monitoring_review_runs.id, run.id));
    await tx.update(monitoring_policies).set({ last_trigger_fingerprint: state.fingerprint, last_attempt_at: now, retry_after_at: null, last_outcome: 'research_requested', updated_at: now }).where(eq(monitoring_policies.id, policy.id));
    if (signals.length) await tx.update(monitoring_signals).set({ processed_at: now }).where(inArray(monitoring_signals.id, signals.map((signal) => signal.id)));
    counts.started++;
  });
  return counts;
}
export async function listMonitoringPolicies(db: DbOrTx, assetId?: string, now = new Date().toISOString()) {
  const rows = await db.select().from(monitoring_policies).orderBy(asc(monitoring_policies.created_at));
  const workers = await db.select().from(research_workers);
  return rows.filter((policy) => !assetId || policy.config.asset_ids.includes(assetId)).map((policy) => {
    const worker = workers.find((row) => row.id === policy.worker_id);
    const connected = !!worker?.enabled && !!worker.last_seen_at && Date.parse(now) - Date.parse(worker.last_seen_at) <= 300_000;
    return { ...policy, connection_state: !worker ? 'not_configured' : !connected ? 'degraded' : !worker.configuration_verified || !worker.last_successful_at ? 'configured_not_tested' : worker.last_health_ok ? 'ready' : 'degraded', monitoring_state: !policy.config.enabled ? 'paused' : policy.last_outcome === 'paused_inactive_assets' ? 'paused_inactive_assets' : !connected || !worker?.configuration_verified || !worker?.last_successful_at ? 'monitoring_unavailable' : policy.last_outcome === 'research_requested' ? 'review_in_progress' : 'enabled', approval_policy: 'owner_approval_required' };
  });
}
export async function monitoringPolicyDetail(db: DbOrTx, policyId: string) {
  const policy = (await listMonitoringPolicies(db)).find((row) => row.id === policyId);
  if (!policy) throw new CommandError(404, 'not_found', 'Monitoring policy not found.');
  const runs = await db.select().from(monitoring_review_runs).where(eq(monitoring_review_runs.policy_id, policyId)).orderBy(desc(monitoring_review_runs.created_at)).limit(50);
  const signals = await db.select().from(monitoring_signals).where(eq(monitoring_signals.policy_id, policyId)).orderBy(desc(monitoring_signals.created_at)).limit(50);
  const notifications = await db.select().from(monitoring_notifications).where(eq(monitoring_notifications.policy_id, policyId)).orderBy(desc(monitoring_notifications.created_at)).limit(50);
  return { policy, runs, signals, notifications };
}
export async function readMonitoringNotification(db: DbOrTx, id: string) {
  const [row] = await db.update(monitoring_notifications).set({ read_at: new Date().toISOString() }).where(eq(monitoring_notifications.id, id)).returning();
  if (!row) throw new CommandError(404, 'not_found', 'Monitoring notification not found.');
  return row;
}
