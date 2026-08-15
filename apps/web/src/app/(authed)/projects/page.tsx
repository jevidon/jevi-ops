import { redirect } from 'next/navigation';

// The Projects index is retired — consolidated into /work (Addendum 08 §7).
// Project detail pages (/projects/[id]) remain. This redirect keeps old
// bookmarks and deep links working.
export default function ProjectsIndexRedirect() {
  redirect('/work');
}
