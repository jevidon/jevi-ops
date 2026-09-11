import Link from 'next/link';
import type { InstallationSetup, OnboardingModuleDefinition, OnboardingSession } from '@jevi-ops/shared/schemas';
import { api } from '@/lib/api';
import { StartSetup } from './start-setup';

export default async function OnboardingPage() {
  const [setup, { modules }, { sessions }] = await Promise.all([
    api.get<InstallationSetup>('/api/onboarding/installation'),
    api.get<{ modules: OnboardingModuleDefinition[] }>('/api/onboarding/modules'),
    api.get<{ sessions: OnboardingSession[] }>('/api/onboarding/sessions'),
  ]);
  const active = sessions.filter((s) => s.status === 'in_progress' || s.status === 'deferred');
  return <div className="mx-auto max-w-3xl space-y-6 px-5 py-6">
    <h1 className="font-serif text-2xl">Set up your workspace</h1>
    <p>Start with what you know. Save any setup for later and keep using your workspace.</p>
    {active.length > 0 && <section className="space-y-3"><h2 className="font-serif text-xl">Continue saved setup</h2><ul className="space-y-3">{active.map((session) => <li key={session.id}>
      <Link className="underline" href={`/onboarding/${session.id}`}>{session.module_id === 'core' ? 'Workspace' : 'Vehicle'} setup — {session.status === 'deferred' ? 'saved for later' : 'in progress'}</Link>
    </li>)}</ul></section>}
    <section className="space-y-3"><h2 className="font-serif text-xl">Start setup</h2>{modules.map((module) => <StartSetup key={module.id} moduleId={module.id}
      title={module.id === 'core' ? setup.state === 'completed' ? 'Review workspace setup' : 'Set up workspace' : 'Add another vehicle'} firstRun={setup.state === 'eligible'} />)}</section>
    <Link className="underline" href="/">Return to workspace</Link>
  </div>;
}
