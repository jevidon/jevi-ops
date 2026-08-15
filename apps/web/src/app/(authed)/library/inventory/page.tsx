import { redirect } from 'next/navigation';

// Retired in the v2 redesign — the unified /library page carries an Inventory
// type facet (a stub until the inventory API lands). This route deep-links there.
export default function InventoryIndexPage() {
  redirect('/library?type=inventory');
}
