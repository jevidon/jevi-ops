import { redirect } from 'next/navigation';

// Retired in the v2 redesign — the unified /library page filters by type via its
// facet rail. This route now deep-links into that view. Detail (/notes/[id]) and
// create (/notes/new) live on.
export default function NotesIndexPage() {
  redirect('/library?type=note');
}
