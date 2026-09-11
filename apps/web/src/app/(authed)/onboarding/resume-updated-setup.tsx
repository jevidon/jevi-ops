'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { OnboardingSession } from '@jevi-ops/shared/schemas';
import { transitionOnboardingAction } from './actions';
import { ReadableValues } from '@/components/onboarding/ChangeReview';

export function ResumeUpdatedSetup({ session, canMigrate }: { session: OnboardingSession; canMigrate: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return <section className="mx-auto max-w-3xl space-y-4 px-5 py-6"><h1 className="font-serif text-2xl">Setup has been updated</h1>
    <p>Your saved answers are preserved. {canMigrate ? 'Resume to move them into the current setup version.' : 'This installation does not yet have a migration for this saved setup. Your existing workspace remains available.'}</p>
    <details><summary>View saved answers</summary><ReadableValues value={session.draft} /></details>
    {canMigrate && <button className="rounded border border-line px-4 py-2" disabled={busy} onClick={async () => {
      setBusy(true);
      try { const result = await transitionOnboardingAction({ id: session.id, expected_revision: session.revision, action: 'resume' });
        if (result.ok) router.refresh(); else setError(result.error.replaceAll('_', ' '));
      } finally { setBusy(false); }
    }}>Resume updated setup</button>}
    {error && <p role="alert">{error}</p>}<p><a className="underline" href="/">Open workspace</a></p>
  </section>;
}
