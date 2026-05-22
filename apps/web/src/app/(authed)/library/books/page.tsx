import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/EmptyState';
import { LibraryTabBar } from '../library-tab-bar';

// Books reading log — Phase 3 feature. Stub for now.

export default function BooksPage() {
  return (
    <div>
      <ScreenHeader eyebrow="Library" title="Books" />
      <div className="hairline" />
      <LibraryTabBar active="books" />
      <EmptyState
        title="Reading log lands in Phase 3"
        body="Schema is ready (books table with status, format, rating). Readwise bulk import + a list view ship together. Voice can already create book references when used inside a quote capture."
      />
    </div>
  );
}
