'use client';

import { createClientId } from '../../lib/client-id';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { OnboardingModuleDefinition, OnboardingPreview, OnboardingSession, OnboardingStepDefinition, OnboardingStepState } from '@jevi-ops/shared/schemas';
import { completeOnboardingAction, loadOnboardingAction, previewOnboardingAction, saveOnboardingStepAction, transitionOnboardingAction } from '../../app/(authed)/onboarding/actions';
import { ChangeReview, ReadableValues } from './ChangeReview';

type Values = OnboardingSession['draft'][string];
export interface OnboardingStepProps {
  step: OnboardingStepDefinition;
  values: Values;
  onChange(values: Values): void;
  session: OnboardingSession;
  /** Flush current values before an immediate action or child session creation. */
  save(): Promise<OnboardingSession | null>;
  /** An immediate reviewed operation can return an updated session. */
  onSession(updated: OnboardingSession): void;
  /** Keep immediate settings/structure operations from racing step navigation. */
  blockNavigation(blocked: boolean): void;
  /** Non-autosaved form state (for example a credential candidate); never its contents. */
  setUnsavedChanges(dirty: boolean): void;
}
const button = 'rounded border border-line px-4 py-2 text-sm disabled:opacity-50';
const messages: Record<string, string> = {
  revision_conflict: 'This setup changed in another tab. Compare the saved answers below before continuing.',
  preview_stale: 'The records changed after this review. Review the current changes again.',
  preview_required: 'Review the current changes before applying them.',
  module_version_changed: 'Setup has been updated. Resume to migrate your saved answers, or return later.',
  connection_failed: 'Connection failed. Your unsaved answers remain here. Retry when the connection is available.',
  invalid_payload: 'Check the highlighted answers before continuing.',
};

/** Serialised autosaves preserve input typed while a previous snapshot is in flight. */
export function OnboardingShell({ initialSession, module, renderStep, exitHref = '/onboarding', autosaveMs = 650, notice }: {
  initialSession: OnboardingSession;
  module: OnboardingModuleDefinition;
  renderStep(props: OnboardingStepProps): ReactNode;
  exitHref?: string;
  autosaveMs?: number;
  notice?: ReactNode;
}) {
  const [session, setSession] = useState(initialSession);
  const sessionRef = useRef(initialSession);
  const [stepId, setStepId] = useState(initialSession.current_step_id);
  const stepIdRef = useRef(stepId);
  const [values, setValues] = useState<Values>(initialSession.draft[stepId] ?? {});
  const valuesRef = useRef(values);
  const [baseline, setBaseline] = useState(JSON.stringify(values));
  const baselineRef = useRef(baseline);
  const [saving, setSaving] = useState(false);
  const pending = useRef<Promise<OnboardingSession | null> | null>(null);
  const [busy, setBusy] = useState(false);
  const [stepBusy, setStepBusy] = useState(false);
  const [externalDirty, setExternalDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<{ path: (string | number)[]; message: string }[]>([]);
  const [conflict, setConflict] = useState<OnboardingSession | null>(null);
  const [preview, setPreview] = useState<OnboardingPreview | null>(null);
  const operationKey = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const errorBox = useRef<HTMLDivElement>(null);
  const dirty = JSON.stringify(values) !== baseline;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty || externalDirty;
  const stepIndex = Math.max(0, module.steps.findIndex((s) => s.id === stepId));
  const step = module.steps[stepIndex]!;

  const acceptSession = useCallback((updated: OnboardingSession) => {
    sessionRef.current = updated;
    setSession(updated);
  }, []);
  const acceptBaseline = (next: string) => { baselineRef.current = next; setBaseline(next); };
  const changeValues = useCallback((next: Values) => {
    valuesRef.current = next;
    setValues(next);
    setPreview(null);
    operationKey.current = null;
  }, []);
  const report = useCallback(async (result: { error: string; session?: OnboardingSession; details?: { path: (string | number)[]; message: string }[] }) => {
    setError(messages[result.error] ?? result.error.replaceAll('_', ' '));
    setIssues(Array.isArray(result.details) ? result.details : []);
    if (result.error === 'revision_conflict') {
      // Fetch current state as the conflict response may already be stale.
      const current = await loadOnboardingAction(sessionRef.current.id);
      setConflict(current.ok ? current.value.session : result.session ?? null);
    }
    requestAnimationFrame(() => errorBox.current?.focus());
  }, []);

  const flush = useCallback(async (): Promise<OnboardingSession | null> => {
    if (pending.current) return pending.current;
    if (JSON.stringify(valuesRef.current) === baselineRef.current) return sessionRef.current;
    const operation = (async () => {
      setSaving(true);
      try {
        while (JSON.stringify(valuesRef.current) !== baselineRef.current) {
          const snapshot = valuesRef.current;
          const serialized = JSON.stringify(snapshot);
          const result = await saveOnboardingStepAction({ id: sessionRef.current.id, step_id: stepIdRef.current,
            expected_revision: sessionRef.current.revision, values: snapshot, state: 'draft' });
          if (!result.ok) { await report(result); return null; }
          acceptSession(result.value);
          // Deliberately keep the latest local values; only this submitted snapshot is saved.
          acceptBaseline(serialized);
          setError(null);
          setIssues([]);
        }
        return sessionRef.current;
      } finally { setSaving(false); pending.current = null; }
    })();
    pending.current = operation;
    return operation;
  }, [acceptSession, report]);

  useEffect(() => {
    if (!dirty || conflict || session.status !== 'in_progress' || busy) return;
    const timer = setTimeout(() => { void flush(); }, autosaveMs);
    return () => clearTimeout(timer);
  }, [values, dirty, conflict, session.status, busy, autosaveMs, flush]);

  useEffect(() => {
    if (!dirty && !externalDirty) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      const anchor = (event.target as Element | null)?.closest?.('a[href]');
      if (anchor && !window.confirm('Leave setup with unsaved answers?')) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', unload);
    document.addEventListener('click', click, true);
    return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('click', click, true); };
  }, [dirty, externalDirty]);

  // A same-URL history entry catches browser Back before leaving this form.
  // Preserve Next's history data; remove the guard entry after a successful save.
  const historyGuard = useRef(false);
  useEffect(() => {
    const pop = (event: PopStateEvent) => {
      if (!historyGuard.current) return;
      historyGuard.current = false;
      if (!dirtyRef.current) return;
      event.stopImmediatePropagation();
      if (window.confirm('Leave setup with unsaved answers?')) window.history.back();
      else {
        window.history.pushState({ ...window.history.state, onboardingGuard: true }, '', window.location.href);
        historyGuard.current = true;
      }
    };
    window.addEventListener('popstate', pop, true);
    return () => window.removeEventListener('popstate', pop, true);
  }, []);
  useEffect(() => {
    if ((dirty || externalDirty) && !historyGuard.current) {
      window.history.pushState({ ...window.history.state, onboardingGuard: true }, '', window.location.href);
      historyGuard.current = true;
    } else if (!dirty && !externalDirty && historyGuard.current) {
      historyGuard.current = false;
      window.history.back();
    }
  }, [dirty, externalDirty]);

  const go = async (index: number, state: OnboardingStepState = 'confirmed') => {
    if (stepBusy || (externalDirty && !window.confirm('Leave this step with unsaved settings inputs?'))) return;
    setBusy(true);
    try {
      const saved = await flush();
      if (!saved) return;
      const target = module.steps[index]!;
      const result = await saveOnboardingStepAction({ id: saved.id, step_id: stepIdRef.current, expected_revision: saved.revision,
        values: valuesRef.current, state, current_step_id: target.id });
      if (!result.ok) { await report(result); return; }
      acceptSession(result.value);
      stepIdRef.current = target.id;
      setStepId(target.id);
      setExternalDirty(false);
      const next = result.value.draft[target.id] ?? {};
      changeValues(next);
      acceptBaseline(JSON.stringify(next));
      setError(null);
      setIssues([]);
      requestAnimationFrame(() => heading.current?.focus());
    } finally { setBusy(false); }
  };
  const transition = async (action: 'defer' | 'resume' | 'abandon') => {
    if (stepBusy || (externalDirty && !window.confirm('Leave setup with unsaved settings inputs?'))) return;
    setBusy(true);
    try {
      const current = action === 'resume' || sessionRef.current.status === 'deferred' ? sessionRef.current : await flush();
      if (!current) return;
      const result = await transitionOnboardingAction({ id: current.id, action, expected_revision: current.revision });
      if (!result.ok) { await report(result); return; }
      acceptSession(result.value);
      setError(null);
      setPreview(null);
      setExternalDirty(false);
      if (action === 'resume') {
        const next = result.value.draft[stepIdRef.current] ?? {};
        changeValues(next);
        acceptBaseline(JSON.stringify(next));
      }
    } finally { setBusy(false); }
  };
  const review = async () => {
    setBusy(true);
    try {
      const saved = await flush();
      if (!saved) return;
      const result = await previewOnboardingAction({ id: saved.id, expected_revision: saved.revision });
      if (!result.ok) { await report(result); return; }
      setPreview(result.value);
      operationKey.current = createClientId();
      setError(null);
    } finally { setBusy(false); }
  };
  const complete = async () => {
    if (!preview || !operationKey.current || dirty) return;
    setBusy(true);
    try {
      const result = await completeOnboardingAction({ id: session.id, expected_revision: preview.revision,
        operation_key: operationKey.current, preview_fingerprint: preview.fingerprint });
      if (!result.ok) { await report(result); return; }
      acceptSession(result.value.session);
      setPreview(null);
      setError(null);
    } finally { setBusy(false); }
  };

  return <section className="mx-auto w-full max-w-3xl space-y-5 px-5 py-6" aria-label={`${module.title} setup`}
    onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (!conflict && session.status === 'in_progress') void flush(); } }}>
    <header className="space-y-2"><h1 className="font-serif text-2xl">{module.title}</h1>
      <p role="status" aria-live="polite" className="text-sm text-ink-3">{saving ? 'Saving…' : dirty ? error ? 'Not saved — retry' : 'Unsaved changes' : 'Saved'}</p>
      {notice}
    </header>
    {error && <div ref={errorBox} role="alert" tabIndex={-1} className="rounded border border-red-400 p-3">
      <p>{error}</p>{issues.length > 0 && <ul>{issues.map((issue, i) => <li key={i}>{issue.path.join(' › ')}: {issue.message}</li>)}</ul>}
      {dirty && !conflict && <button className={button} onClick={() => void flush()} disabled={saving}>Retry save</button>}
    </div>}
    {conflict && <div className="space-y-3 rounded border border-line p-4" aria-label="Reconcile answers">
      <p>Local answers are still in the form. The saved answers for this step are:</p>
      <ReadableValues value={conflict.draft[stepId] ?? {}} />
      <div className="flex flex-wrap gap-2">
        <button className={button} onClick={() => { acceptSession(conflict); const next = conflict.draft[stepId] ?? {}; changeValues(next); acceptBaseline(JSON.stringify(next)); setConflict(null); setError(null); }}>Use saved answers</button>
        <button className={button} onClick={() => { acceptSession(conflict); acceptBaseline(JSON.stringify(conflict.draft[stepId] ?? {})); setConflict(null); setError(null); }}>Keep my step answers</button>
      </div>
    </div>}
    {session.status === 'completed' ? <div className="space-y-3"><h2 className="font-serif text-xl">Setup complete</h2>
      <p>Your reviewed changes were saved.</p><a className={button} href={session.subject_id ? `/assets/${session.subject_id}` : '/'}>Open {session.subject_id ? 'vehicle' : 'workspace'}</a></div>
      : session.status === 'abandoned' ? <div><p>This draft was abandoned. Previously saved records remain available.</p><a href={exitHref}>Return to setup</a></div>
      : session.status === 'deferred' ? <div className="space-y-3"><p>Setup is saved for later.</p><button className={button} disabled={busy} onClick={() => void transition('resume')}>Resume</button> <a href={exitHref}>Return to workspace</a></div>
      : <>
        <ol className="flex flex-wrap gap-2 text-sm" aria-label="Setup progress">{module.steps.map((item, index) => <li key={item.id} aria-current={item.id === stepId ? 'step' : undefined}
          className={item.id === stepId ? 'font-semibold' : 'text-ink-3'}>{index + 1}. {item.title}{session.step_states[item.id] === 'skipped' ? ' (skipped)' : ''}</li>)}</ol>
        <h2 ref={heading} tabIndex={-1} className="font-serif text-xl">{step.title}</h2>
        {step.description && <p className="text-sm text-ink-3">{step.description}</p>}
        <fieldset disabled={busy || Boolean(conflict) || Boolean(preview)} className="min-w-0 border-0 p-0">
          <legend className="sr-only">{step.title} answers</legend>
          {renderStep({ step, values, onChange: changeValues, session, save: flush, onSession: acceptSession, blockNavigation: setStepBusy, setUnsavedChanges: setExternalDirty })}
        </fieldset>
        {preview && <section aria-label="Review changes" className="space-y-3 rounded border border-line p-4">
          <h3 className="font-semibold">Review changes</h3>
          <ChangeReview changes={preview.changes} />
          <div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => void complete()}>Apply reviewed changes</button>
            <button className={button} disabled={busy} onClick={() => setPreview(null)}>Edit answers</button></div>
        </section>}
        <nav aria-label="Setup navigation" className="flex flex-wrap gap-2">
          <button className={button} disabled={busy || stepBusy || Boolean(conflict) || stepIndex === 0} onClick={() => void go(stepIndex - 1, 'draft')}>Back</button>
          {stepIndex < module.steps.length - 1 ? <button className={button} disabled={busy || stepBusy || Boolean(conflict)} onClick={() => void go(stepIndex + 1)}>Continue</button>
            : <button className={button} disabled={busy || stepBusy || Boolean(conflict) || Boolean(preview)} onClick={() => void review()}>Review changes</button>}
          {step.optional && stepIndex < module.steps.length - 1 && <button className={button} disabled={busy || stepBusy || Boolean(conflict)} onClick={() => void go(stepIndex + 1, 'skipped')}>Skip for now</button>}
          <button className={button} disabled={busy || stepBusy || Boolean(conflict)} onClick={() => void transition('defer')}>Save and exit</button>
          <button className={button} disabled={busy || stepBusy || Boolean(conflict)} onClick={() => void transition('abandon')}>Abandon draft</button>
        </nav>
      </>}
  </section>;
}
