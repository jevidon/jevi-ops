import Link from 'next/link';
import { ScreenHeader } from '@/components/ScreenHeader';
import { getAppTimezone } from '@/lib/app-settings';
import { todayIsoDate } from '@/lib/today';
import { NewJournalEntryForm } from './new-entry-form';

// /library/journal/new — manual journal entry editor. Voice (cmd+J) and
// the Apple Watch shortcut still work; this is the explicit form path.
// Defaults entry_date to today in the user's app timezone.

export default async function NewJournalEntryPage() {
  const tz = await getAppTimezone();
  const today = todayIsoDate(tz);

  return (
    <div>
      <div className="px-5 lg:px-0 pt-4 pb-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
        <Link href="/library/journal" className="hover:text-ink-2 transition-colors">
          ← Journal
        </Link>
      </div>

      <ScreenHeader eyebrow="Capture" title="New journal entry" meta="Full editor" />
      <div className="hairline mb-4" />

      <div className="px-5 lg:px-0">
        <NewJournalEntryForm today={today} />
      </div>
    </div>
  );
}
