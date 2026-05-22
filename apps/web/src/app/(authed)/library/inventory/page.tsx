import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/EmptyState';
import { LibraryTabBar } from '../library-tab-bar';

// Inventory — Phase 3+. Schema is in place; UI stub.

export default function InventoryPage() {
  return (
    <div>
      <ScreenHeader eyebrow="Library" title="Inventory" />
      <div className="hairline" />
      <LibraryTabBar active="inventory" />
      <EmptyState
        title="Inventory UI is Phase 3+"
        body="Schema supports cameras, lenses, computers, audio, lighting with photos + receipts. Voice can already create inventory items (add_inventory_item). PDF export for insurance comes in Phase 4."
      />
    </div>
  );
}
