import { notFound } from 'next/navigation';
import { getFeatureFlag } from '@/lib/app-settings';

// Feature-flag guard for the Shopping module (migration 0044). Default on;
// when shopping_module_enabled is turned off in Settings → Modules, every
// /shopping/* route renders the standard 404. Lists, items, and the
// purchase ledger are untouched — flip the flag back on to restore.
export default async function ShoppingLayout({ children }: { children: React.ReactNode }) {
  if (!(await getFeatureFlag('shopping_module_enabled'))) {
    notFound();
  }
  return <>{children}</>;
}
