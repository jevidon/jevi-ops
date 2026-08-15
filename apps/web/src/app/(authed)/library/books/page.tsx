import { redirect } from 'next/navigation';

// Retired in the v2 redesign — the unified /library page filters by type via its
// facet rail (Books get Status + Sort there). This route now deep-links into
// that view. Detail (/books/[id]) and create (/books/new) live on.
export default function BooksIndexPage() {
  redirect('/library?type=book');
}
