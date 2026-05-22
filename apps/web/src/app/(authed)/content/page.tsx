import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/EmptyState';

const PIPELINE = ['idea', 'outline', 'filming', 'editing', 'published', 'derivatives_pending', 'done'] as const;

export default function ContentPage() {
  return (
    <div>
      <ScreenHeader eyebrow="Pipeline" title="Content" meta="Idea → outline → filming → editing → published → derivatives" />
      <div className="hairline" />
      <div className="overflow-x-auto px-5 py-4">
        <div className="flex gap-3 min-w-max">
          {PIPELINE.map((status) => (
            <div key={status} className="w-44 shrink-0 border border-line">
              <div className="eyebrow px-3 py-2 border-b border-line bg-surface-2/40">
                {status.replace('_', ' ')}
              </div>
              <div className="p-3 font-sans text-[12px] text-ink-3 italic">empty</div>
            </div>
          ))}
        </div>
      </div>
      <EmptyState
        title="No content items"
        body="Add videos/articles via voice or the + button. Status transitions spawn derivative templates."
      />
    </div>
  );
}
