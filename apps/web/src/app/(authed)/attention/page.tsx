import Link from 'next/link';
import { ScreenHeader } from '@/components/ScreenHeader';
import { attentionApi, ApiError, type AttentionItem, type AttentionUrgency, type AttentionStatus } from '@/lib/api';
import { AttentionItemRow } from '@/components/attention/AttentionItemRow';

// /attention — the full Attention feed (Addendum 05 §11). Grouped by urgency,
// filterable by status (active / snoozed). The Today card shows the top slice;
// this is everything.

const STATUS_FILTERS: Array<{ value: AttentionStatus; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'snoozed', label: 'Snoozed' },
];

const URGENCY_ORDER: Array<{ value: AttentionUrgency; label: string }> = [
  { value: 'high', label: 'High' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
];

export default async function AttentionPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const params = await searchParams;
  const status = (
    params.status && STATUS_FILTERS.find((f) => f.value === params.status)
      ? params.status
      : 'active'
  ) as AttentionStatus;

  let items: AttentionItem[] = [];
  let errorMessage: string | null = null;
  try {
    items = (await attentionApi.list({ status, limit: 500 })).items;
  } catch (err) {
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  const byUrgency = new Map<AttentionUrgency, AttentionItem[]>();
  for (const it of items) {
    const list = byUrgency.get(it.urgency) ?? [];
    list.push(it);
    byUrgency.set(it.urgency, list);
  }

  return (
    <div>
      <div className="px-5 lg:px-0 pt-4 pb-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
        <Link href="/today" className="hover:text-ink-2 transition-colors">← Today</Link>
      </div>
      <ScreenHeader
        eyebrow="Attention"
        title="Needs attention"
        meta={`${items.length} ${status}`}
      />
      <div className="hairline" />

      {/* Status filter */}
      <div className="px-5 lg:px-0 pt-3 flex flex-wrap items-center gap-1.5">
        {STATUS_FILTERS.map((f) => (
          <Link
            key={f.value}
            href={f.value === 'active' ? '/attention' : `/attention?status=${f.value}`}
            className={`px-2.5 py-1 border font-mono text-[10px] uppercase tracking-wider transition-colors ${
              status === f.value
                ? 'bg-ink text-bg border-ink'
                : 'border-line text-ink-2 hover:border-ink-2 hover:text-ink'
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {errorMessage ? (
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3">Error: {errorMessage}</div>
      ) : items.length === 0 ? (
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3 italic">
          {status === 'active'
            ? 'Nothing needs your attention right now. Clear runway.'
            : 'No snoozed items.'}
        </div>
      ) : (
        <div className="px-5 lg:px-0 mt-4">
          {URGENCY_ORDER.map(({ value, label }) => {
            const group = byUrgency.get(value) ?? [];
            if (group.length === 0) return null;
            return (
              <section key={value} className="mb-6">
                <div className="eyebrow pb-2 border-b border-line mb-2">
                  {label} <span className="text-ink-3">· {group.length}</span>
                </div>
                <ul>
                  {group.map((it) => (
                    <AttentionItemRow key={it.id} item={it} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
