import { notFound } from 'next/navigation';
import { getFeatureFlag } from '@/lib/app-settings';

// Feature-flag guard for the Maintenance module (migration 0047). Default on;
// when maintenance_module_enabled is turned off in Settings → Modules, every
// /maintenance/* route renders the standard 404. The cron sweep + attention
// rules keep running server-side — this gate hides the pages, not the data.
export default async function MaintenanceLayout({ children }: { children: React.ReactNode }) {
  if (!(await getFeatureFlag('maintenance_module_enabled'))) {
    notFound();
  }
  return <>{children}</>;
}
