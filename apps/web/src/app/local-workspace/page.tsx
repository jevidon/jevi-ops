import { requireUser } from '@/lib/auth';
import { LocalWorkspace } from '@/components/local-workspace/BrowserWorkspace';

// Deliberately outside (authed)'s remote-data-dependent shell. This migration
// entry point shares its screens with the bundled phone interface.
export default async function LocalWorkspacePage() {
  const user = await requireUser();
  return <LocalWorkspace account={user.id} />;
}
