import Link from 'next/link';
import { ScreenHeader } from '@/components/ScreenHeader';
import { BookForm } from '../book-form';

// /library/books/new — manual book entry. The Readwise importer also
// creates book rows; this is for everything else (manual additions,
// currently-reading shelf, physical books, etc.).

export default function NewBookPage() {
  return (
    <div>
      <div className="px-5 lg:px-0 pt-4 pb-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
        <Link href="/library/books" className="hover:text-ink-2 transition-colors">
          ← Books
        </Link>
      </div>

      <ScreenHeader eyebrow="Library" title="Add book" meta="New entry" />
      <div className="hairline mb-6" />

      <div className="px-5 lg:px-0 max-w-2xl">
        <BookForm
          initial={{
            title: '',
            author: '',
            isbn: '',
            cover_image_url: '',
            status: 'want_to_read',
            format: '',
            started_at: '',
            finished_at: '',
            rating: '',
            my_summary: '',
          }}
        />
      </div>
    </div>
  );
}
