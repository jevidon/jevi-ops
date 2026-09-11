import Link from 'next/link';
import type { InstallationSetup } from '@jevi-ops/shared/schemas';
import { api } from '@/lib/api';

/** Fresh installation state is persisted; optional/deferred setup never nags. */
export async function SetupEntry() {
  let setup: InstallationSetup;
  try { setup = await api.get<InstallationSetup>('/api/onboarding/installation'); }
  catch { return null; }
  if (setup.state !== 'eligible' && setup.state !== 'in_progress') return null;
  return <aside aria-label="Workspace setup" className="mx-5 mt-4 rounded border border-line p-4">
    <p>{setup.state === 'eligible' ? 'Welcome. Set your timezone, choose a starting structure and connect optional services.' : 'Your workspace setup is saved and ready to continue.'}</p>
    <Link className="underline" href={setup.core_session_id ? `/onboarding/${setup.core_session_id}` : '/onboarding'}>{setup.state === 'eligible' ? 'Set up workspace' : 'Continue workspace setup'}</Link>
  </aside>;
}
