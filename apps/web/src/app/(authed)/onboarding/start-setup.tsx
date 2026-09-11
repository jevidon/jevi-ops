'use client';

import { createClientId } from '../../../lib/client-id';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { startOnboardingAction } from './actions';

export function StartSetup({ moduleId, title, firstRun = false, subjectId, parentSessionId, domainId }: {
  moduleId: 'core' | 'vehicle'; title: string; firstRun?: boolean;
  subjectId?: string; parentSessionId?: string; domainId?: string;
}) {
  const router = useRouter();
  const creationKey = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <div className="space-y-2"><button type="button" disabled={busy} className="rounded border border-line px-4 py-2 disabled:opacity-50" onClick={async () => {
    if (busy) return;
    setBusy(true);
    try {
      creationKey.current ??= createClientId();
      const result = await startOnboardingAction({ module_id: moduleId, creation_key: creationKey.current,
        entry_point: firstRun ? 'first_run' : moduleId === 'core' ? 'settings' : subjectId ? 'asset_detail' : 'add_asset',
        ...(subjectId ? { subject_id: subjectId } : {}), ...(parentSessionId ? { parent_session_id: parentSessionId } : {}),
        ...(domainId ? { draft: { plans: { domain_id: domainId } } } : {}),
      });
      if (result.ok) router.push(`/onboarding/${result.value.id}`);
      else if (result.error === 'active_session_conflict' && result.session) router.push(`/onboarding/${result.session.id}`);
      else setError(result.error.replaceAll('_', ' '));
    } finally { setBusy(false); }
  }}>{busy ? 'Opening setup…' : title}</button>{error && <p role="alert">{error}</p>}</div>;
}
