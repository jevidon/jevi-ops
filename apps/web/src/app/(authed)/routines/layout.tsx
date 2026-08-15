import { notFound } from 'next/navigation';
import { getFeatureFlag } from '@/lib/app-settings';

// Feature-flag guard for the Routines module (Addendum 06). Default on; when
// routines_module_enabled is turned off in Settings → Modules, every
// /routines/* route renders the standard 404. Tables and data are untouched —
// flip the flag back on to restore the module.
export default async function RoutinesLayout({ children }: { children: React.ReactNode }) {
  if (!(await getFeatureFlag('routines_module_enabled'))) {
    notFound();
  }
  return <>{children}</>;
}
