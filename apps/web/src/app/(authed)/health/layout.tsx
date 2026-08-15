import { notFound } from 'next/navigation';
import { getFeatureFlag } from '@/lib/app-settings';

// Feature-flag guard for the whole Health module (Addendum 05). When
// health_module_enabled is false, every /health/* route renders the
// standard 404 — matching the API, which returns 404 for /api/health/*.
// Tables and data are untouched; flip the flag on in Settings → Modules
// to restore the module.
export default async function HealthLayout({ children }: { children: React.ReactNode }) {
  if (!(await getFeatureFlag('health_module_enabled'))) {
    notFound();
  }
  return <>{children}</>;
}
