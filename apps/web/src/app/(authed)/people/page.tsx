import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/EmptyState';

export default function PeoplePage() {
  return (
    <div>
      <ScreenHeader eyebrow="Phase 2" title="People" meta="Light CRM · follow-ups · anniversaries" />
      <div className="hairline" />
      <EmptyState
        title="People is a Phase 2 feature"
        body="Schema is ready; UI builds out alongside the Gmail watcher in Phase 2."
      />
    </div>
  );
}
