import { createHash } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  OnboardingDraftSchema, OnboardingModuleDefinitionSchema,
  type OnboardingCapability, type OnboardingChange, type OnboardingDraft,
  type OnboardingJson, type OnboardingModuleDefinition, type OnboardingPreview,
  type OnboardingReceipt, type OnboardingSession,
  type StartOnboardingSchema, type SaveOnboardingStepSchema, type CompleteOnboardingSchema,
} from '@jevi-ops/shared/schemas';
import { onboarding_sessions, installation_setup, onboarding_operation_receipts } from '../db/onboarding-schema.js';
import { getDb } from './db.js';
import type { Tx } from './maintenance-tx.js';

export class OnboardingError extends Error {
  constructor(public code: string, public status = 409, public details?: Record<string, unknown>) { super(code); }
}

/** Stable across JSON key order; array order remains meaningful. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(',')}}`;
}
export function onboardingFingerprint(value: unknown): string { return createHash('sha256').update(canonicalJson(value)).digest('hex'); }

export interface OnboardingContext { session: OnboardingSession; actor_id: string }
export interface OnboardingReview { changes: OnboardingChange[]; preconditions: Record<string, OnboardingJson> }
export interface OnboardingOperation {
  /** Must lock resources in normal asset → visit → ordered-item order. No network I/O. */
  preview(draft: OnboardingDraft, context: OnboardingContext, tx: Tx): Promise<OnboardingReview>;
  /** All related writes execute on tx. Do not open another transaction or make HTTP calls. */
  commit(draft: OnboardingDraft, context: OnboardingContext, tx: Tx, reviewed: OnboardingPreview): Promise<Record<string, OnboardingJson>>;
}
export interface OnboardingModuleAdapter extends OnboardingOperation {
  definition: OnboardingModuleDefinition;
  draftSchema: z.ZodType<OnboardingDraft, z.ZodTypeDef, unknown>;
  initialDraft?(input: z.infer<typeof StartOnboardingSchema>, actorId: string, tx: Tx): Promise<OnboardingDraft>;
  /** Server-captured review context; client saves cannot replace these fields. */
  readonlyDraftFields?: Record<string, string[]>;
  getCapabilities?(): Promise<OnboardingCapability[]>;
  validateCompletion(draft: OnboardingDraft): void | Promise<void>;
  validateStep?(draft: OnboardingDraft, stepId: string, state: 'not_started' | 'draft' | 'confirmed' | 'skipped'): void | Promise<void>;
  /** Optional schema-version migration; must preserve old answers. Explicit resume invokes it. */
  migrateDraft?(draft: OnboardingDraft, fromVersion: number): OnboardingDraft;
  actions?: Record<string, OnboardingOperation>;
}

const modules = new Map<string, OnboardingModuleAdapter>();
export function registerOnboardingModule(adapter: OnboardingModuleAdapter): void {
  const definition = OnboardingModuleDefinitionSchema.parse(adapter.definition);
  if (new Set(definition.steps.map((s) => s.id)).size !== definition.steps.length) throw new Error('Duplicate onboarding step ID');
  if (modules.has(definition.id)) throw new Error(`Onboarding module already registered: ${definition.id}`);
  modules.set(definition.id, adapter);
}
export function getOnboardingModule(id: string): OnboardingModuleAdapter {
  const module = modules.get(id);
  if (!module) throw new OnboardingError('module_unavailable', 503);
  return module;
}
export async function listOnboardingModules() {
  return Promise.all([...modules.values()].map(async (module) => ({
    ...module.definition,
    capabilities: module.getCapabilities ? await module.getCapabilities() : [
      { id: 'manual_forms', status: 'configured', detail: 'Manual forms do not require an AI provider.' },
      ...['text_generation', 'structured_interpretation', 'transcription', 'document_extraction', 'external_research', 'active_monitoring']
        .map((id) => ({ id, status: 'unavailable', detail: 'This enhancement is not configured for this module.' })),
    ],
  })));
}

type StoredSession = typeof onboarding_sessions.$inferSelect;
function publicSession(row: StoredSession): OnboardingSession {
  const { creation_fingerprint: _fingerprint, ...session } = row;
  return session;
}
export async function listOnboardingSessions(ownerId: string): Promise<OnboardingSession[]> {
  const rows = await getDb().select().from(onboarding_sessions).where(eq(onboarding_sessions.owner_id, ownerId)).orderBy(desc(onboarding_sessions.updated_at));
  return rows.map(publicSession);
}
export async function getOnboardingSession(id: string, ownerId: string): Promise<OnboardingSession> {
  const [row] = await getDb().select().from(onboarding_sessions).where(and(eq(onboarding_sessions.id, id), eq(onboarding_sessions.owner_id, ownerId)));
  if (!row) throw new OnboardingError('session_not_found', 404);
  return publicSession(row);
}
export async function getInstallationSetup() {
  const [row] = await getDb().select().from(installation_setup).where(eq(installation_setup.id, true));
  if (!row) throw new OnboardingError('setup_schema_missing', 503);
  const { id: _id, ...state } = row;
  return state;
}
async function lockSession(tx: Tx, id: string, actorId: string): Promise<StoredSession> {
  const [session] = await tx.select().from(onboarding_sessions)
    .where(and(eq(onboarding_sessions.id, id), eq(onboarding_sessions.owner_id, actorId))).for('update');
  if (!session) throw new OnboardingError('session_not_found', 404);
  return session;
}
function checkRevision(session: OnboardingSession, expected: number): void {
  if (session.revision !== expected) throw new OnboardingError('revision_conflict', 409, { session });
}
function checkVersion(session: OnboardingSession, module: OnboardingModuleAdapter): void {
  if (session.module_version !== module.definition.version) throw new OnboardingError('module_version_changed', 409, {
    session, available_version: module.definition.version, can_migrate: Boolean(module.migrateDraft),
  });
}
function validateDraft(module: OnboardingModuleAdapter, draft: OnboardingDraft): OnboardingDraft {
  OnboardingDraftSchema.parse(draft);
  const allowed = new Set(module.definition.steps.map((s) => s.id));
  if (Object.keys(draft).some((stepId) => !allowed.has(stepId))) throw new OnboardingError('unknown_step', 400);
  return module.draftSchema.parse(draft);
}
function assertActive(session: OnboardingSession): void {
  if (session.status !== 'in_progress') throw new OnboardingError('session_not_active', 409, { session });
}
function isUniqueViolation(err: unknown): boolean {
  const pg = err as { code?: string; cause?: { code?: string } };
  return (pg.code ?? pg.cause?.code) === '23505';
}

export async function startOnboardingSession(input: z.infer<typeof StartOnboardingSchema>, actorId: string) {
  const module = getOnboardingModule(input.module_id);
  if (!module.definition.entry_points.includes(input.entry_point)) throw new OnboardingError('invalid_entry_point', 400);
  if (input.module_id === 'core' && (input.subject_id || input.parent_session_id)) throw new OnboardingError('invalid_core_subject', 400);
  const creationFingerprint = onboardingFingerprint(input);
  try {
    return await getDb().transaction(async (tx) => {
      // Serialise creation retries before reading; distinct keys remain independent.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${actorId + ':' + input.creation_key}, 0))`);
      const [existing] = await tx.select().from(onboarding_sessions)
        .where(and(eq(onboarding_sessions.owner_id, actorId), eq(onboarding_sessions.creation_key, input.creation_key)));
      if (existing) {
        if (existing.creation_fingerprint !== creationFingerprint) throw new OnboardingError('creation_key_conflict');
        return publicSession(existing);
      }
      if (input.parent_session_id) {
        const [parent] = await tx.select().from(onboarding_sessions).where(and(eq(onboarding_sessions.id, input.parent_session_id), eq(onboarding_sessions.owner_id, actorId)));
        if (!parent || parent.module_id !== 'core') throw new OnboardingError('invalid_parent_session', 400);
      }
      const initial = module.initialDraft ? await module.initialDraft(input, actorId, tx) : {};
      const merged = { ...initial, ...Object.fromEntries(Object.entries(input.draft ?? {}).map(([step, values]) => [step, { ...initial[step], ...values }])) };
      for (const [stepId, fields] of Object.entries(module.readonlyDraftFields ?? {})) {
        for (const field of fields) {
          if (Object.prototype.hasOwnProperty.call(input.draft?.[stepId] ?? {}, field)) throw new OnboardingError('readonly_draft_field', 400);
          if (initial[stepId]?.[field] !== undefined) merged[stepId] = { ...merged[stepId], [field]: initial[stepId]![field]! };
        }
      }
      const draft = validateDraft(module, merged);
      const createdAt = new Date().toISOString();
      const [session] = await tx.insert(onboarding_sessions).values({
        owner_id: actorId, creation_key: input.creation_key, creation_fingerprint: creationFingerprint,
        module_id: input.module_id, module_version: module.definition.version,
        subject_id: input.subject_id ?? null, parent_session_id: input.parent_session_id ?? null,
        current_step_id: module.definition.steps[0]!.id,
        created_at: createdAt, updated_at: createdAt,
        step_states: Object.fromEntries(module.definition.steps.map((s) => [s.id, draft[s.id] ? 'draft' : 'not_started'])), draft,
      }).returning();
      if (session!.module_id === 'core') await tx.update(installation_setup)
        .set({ state: 'in_progress', core_session_id: session!.id, updated_at: new Date().toISOString() }).where(eq(installation_setup.id, true));
      return publicSession(session!);
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const active = (await listOnboardingSessions(actorId)).find((s) => s.module_id === input.module_id
      && ['in_progress', 'deferred'].includes(s.status) && (input.module_id === 'core' || s.subject_id === input.subject_id));
    throw new OnboardingError('active_session_conflict', 409, active ? { session: active } : undefined);
  }
}

export async function saveOnboardingStep(id: string, stepId: string, input: z.infer<typeof SaveOnboardingStepSchema>, actorId: string) {
  return getDb().transaction(async (tx) => {
    const session = await lockSession(tx, id, actorId);
    checkRevision(publicSession(session), input.expected_revision);
    assertActive(session);
    const module = getOnboardingModule(session.module_id);
    checkVersion(publicSession(session), module);
    const step = module.definition.steps.find((s) => s.id === stepId);
    if (!step || (input.current_step_id && !module.definition.steps.some((s) => s.id === input.current_step_id))) throw new OnboardingError('unknown_step', 400);
    if (input.state === 'skipped' && !step.optional) throw new OnboardingError('step_required', 400);
    for (const field of module.readonlyDraftFields?.[stepId] ?? []) {
      if (canonicalJson(input.values[field]) !== canonicalJson(session.draft[stepId]?.[field])) throw new OnboardingError('readonly_draft_field', 400);
    }
    const draft = validateDraft(module, { ...session.draft, [stepId]: input.values });
    await module.validateStep?.(draft, stepId, input.state);
    const [updated] = await tx.update(onboarding_sessions).set({
      draft, current_step_id: input.current_step_id ?? stepId,
      step_states: { ...session.step_states, [stepId]: input.state },
      revision: session.revision + 1, preview: null, updated_at: new Date().toISOString(),
    }).where(eq(onboarding_sessions.id, id)).returning();
    return publicSession(updated!);
  });
}

export async function transitionOnboardingSession(id: string, action: 'defer' | 'resume' | 'abandon', expected: number, actorId: string) {
  return getDb().transaction(async (tx) => {
    const session = await lockSession(tx, id, actorId);
    checkRevision(publicSession(session), expected);
    if (!['in_progress', 'deferred'].includes(session.status)) throw new OnboardingError('session_finished');
    const module = getOnboardingModule(session.module_id);
    let draft = session.draft;
    let moduleVersion = session.module_version;
    let stepStates = session.step_states;
    if (action === 'resume' && moduleVersion !== module.definition.version) {
      if (!module.migrateDraft || moduleVersion > module.definition.version) checkVersion(publicSession(session), module);
      draft = validateDraft(module, module.migrateDraft!(draft, moduleVersion));
      moduleVersion = module.definition.version;
      stepStates = { ...Object.fromEntries(module.definition.steps.map((s) => [s.id, 'not_started' as const])), ...stepStates };
    }
    const status = action === 'defer' ? 'deferred' : action === 'resume' ? 'in_progress' : 'abandoned';
    const [updated] = await tx.update(onboarding_sessions).set({
      draft, module_version: moduleVersion, step_states: stepStates,
      current_step_id: module.definition.steps.some((s) => s.id === session.current_step_id) ? session.current_step_id : module.definition.steps[0]!.id,
      status, revision: session.revision + 1, preview: null, updated_at: new Date().toISOString(),
    }).where(eq(onboarding_sessions.id, id)).returning();
    if (session.module_id === 'core') await tx.update(installation_setup).set({
      state: status === 'abandoned' ? 'opt_in' : status, updated_at: new Date().toISOString(),
    }).where(and(eq(installation_setup.id, true), eq(installation_setup.core_session_id, id)));
    return publicSession(updated!);
  });
}

function operationFor(module: OnboardingModuleAdapter, actionId?: string): OnboardingOperation {
  if (!actionId) return module;
  const action = module.actions?.[actionId];
  if (!action) throw new OnboardingError('unknown_action', 404);
  return action;
}
async function reviewedPreview(session: StoredSession, actorId: string, tx: Tx, actionId?: string): Promise<OnboardingPreview> {
  const module = getOnboardingModule(session.module_id);
  checkVersion(publicSession(session), module);
  const draft = validateDraft(module, session.draft);
  if (!actionId) await module.validateCompletion(draft);
  const reviewed = await operationFor(module, actionId).preview(draft, { session: publicSession(session), actor_id: actorId }, tx);
  const fingerprint = onboardingFingerprint({ session_id: session.id, module_version: session.module_version,
    revision: session.revision, draft, action_id: actionId ?? null, ...reviewed });
  return { revision: session.revision, fingerprint, ...reviewed, ...(actionId ? { action_id: actionId } : {}) };
}
export async function previewOnboardingSession(id: string, expected: number, actorId: string, actionId?: string) {
  return getDb().transaction(async (tx) => {
    const session = await lockSession(tx, id, actorId);
    checkRevision(publicSession(session), expected);
    assertActive(session);
    const preview = await reviewedPreview(session, actorId, tx, actionId);
    await tx.update(onboarding_sessions).set({ preview }).where(eq(onboarding_sessions.id, id));
    return preview;
  });
}
export async function listOnboardingOperationReceipts(id: string, actorId: string) {
  await getOnboardingSession(id, actorId);
  return getDb().select().from(onboarding_operation_receipts).where(eq(onboarding_operation_receipts.session_id, id)).orderBy(onboarding_operation_receipts.created_at);
}

export async function completeOnboardingSession(id: string, input: z.infer<typeof CompleteOnboardingSchema>, actorId: string, actionId?: string) {
  try {
    return await getDb().transaction(async (tx) => {
      const session = await lockSession(tx, id, actorId);
      // Successful retries are reads: inspect receipt before revision or lifecycle checks.
      const [priorAction] = actionId ? await tx.select().from(onboarding_operation_receipts)
        .where(and(eq(onboarding_operation_receipts.session_id, id), eq(onboarding_operation_receipts.operation_key, input.operation_key))) : [];
      const prior = actionId ? priorAction?.receipt : session.commit_receipt;
      if (prior) {
        if (prior.operation_key !== input.operation_key || prior.preview_fingerprint !== input.preview_fingerprint || prior.expected_revision !== input.expected_revision || (priorAction && priorAction.action_id !== actionId)) {
          throw new OnboardingError('operation_key_conflict');
        }
        return { session: publicSession(session), receipt: prior };
      }
      // Do not permit an immediate operation key to be reused for finalisation (or the reverse).
      if (session.commit_operation_key === input.operation_key) throw new OnboardingError('operation_key_conflict');
      if (!actionId) {
        const [reused] = await tx.select({ id: onboarding_operation_receipts.id }).from(onboarding_operation_receipts)
          .where(and(eq(onboarding_operation_receipts.session_id, id), eq(onboarding_operation_receipts.operation_key, input.operation_key)));
        if (reused) throw new OnboardingError('operation_key_conflict');
      }
      checkRevision(publicSession(session), input.expected_revision);
      assertActive(session);
      const savedPreview = session.preview;
      if (!savedPreview || savedPreview.fingerprint !== input.preview_fingerprint || savedPreview.revision !== session.revision || savedPreview.action_id !== actionId) {
        throw new OnboardingError('preview_required');
      }
      const freshPreview = await reviewedPreview(session, actorId, tx, actionId);
      if (freshPreview.fingerprint !== savedPreview.fingerprint) throw new OnboardingError('preview_stale');
      const module = getOnboardingModule(session.module_id);
      const result = await operationFor(module, actionId).commit(session.draft, { session: publicSession(session), actor_id: actorId }, tx, savedPreview);
      const completedAt = new Date().toISOString();
      const receipt: OnboardingReceipt = { operation_key: input.operation_key, preview_fingerprint: input.preview_fingerprint,
        expected_revision: input.expected_revision, completed_at: completedAt, result };
      if (actionId) await tx.insert(onboarding_operation_receipts).values({ session_id: id, action_id: actionId, operation_key: input.operation_key, receipt });
      const subjectId = result.subject_id;
      if (subjectId !== undefined && subjectId !== null && (typeof subjectId !== 'string' || !z.string().uuid().safeParse(subjectId).success)) throw new Error('Invalid adapter subject ID');
      const [updated] = await tx.update(onboarding_sessions).set({
        revision: session.revision + 1, preview: null, updated_at: completedAt,
        ...(actionId ? {} : { status: 'completed' as const, subject_id: (subjectId as string | null | undefined) ?? session.subject_id,
          commit_operation_key: input.operation_key, commit_receipt: receipt, completed_at: completedAt }),
      }).where(eq(onboarding_sessions.id, id)).returning();
      if (!actionId && session.module_id === 'core') await tx.update(installation_setup)
        .set({ state: 'completed', core_session_id: id, updated_at: completedAt }).where(eq(installation_setup.id, true));
      return { session: publicSession(updated!), receipt };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new OnboardingError('operation_key_conflict');
    throw err;
  }
}
