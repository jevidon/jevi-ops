import { redirect } from 'next/navigation';

// Retired in the v2 redesign — the unified /library page filters by type via its
// facet rail. This route now deep-links into that view. Detail (/journal/[id])
// and create (/journal/new) live on.
export default function JournalIndexPage() {
  redirect('/library?type=journal');
}
