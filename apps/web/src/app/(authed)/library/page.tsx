import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/EmptyState';

const SUBTABS = ['Notes', 'Journal', 'Quotes', 'Books', 'Inventory'] as const;

export default function LibraryPage() {
  return (
    <div>
      <ScreenHeader eyebrow="Archive" title="Library" />
      <div className="hairline" />
      <div className="px-5 py-3 flex gap-4 border-b border-line overflow-x-auto">
        {SUBTABS.map((s) => (
          <button
            key={s}
            className="font-mono text-[11px] uppercase tracking-wider text-ink-3 hover:text-ink-2 whitespace-nowrap"
          >
            {s}
          </button>
        ))}
      </div>
      <EmptyState
        title="Quotes, journal, books, inventory"
        body="Phase 3 brings handwritten-journal OCR, Readwise import, and the resurfacing engine. UI lands then."
      />
    </div>
  );
}
