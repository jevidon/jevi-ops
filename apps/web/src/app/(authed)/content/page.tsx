import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ScreenHeader } from '@/components/ScreenHeader';
import { contentApi, ApiError, type ContentItem, type ContentItemStatus } from '@/lib/api';
import { PrefsPersist } from '@/components/PrefsPersist';
import { youtubeThumbnailUrl } from '@/lib/youtube';

// /content — list of content items (videos, articles, podcasts) with
// status filter chips + sort. The pipeline status is the primary mental
// model so we surface it prominently. Cookie-backed persistence via the
// shared PrefsPersist component.

type StatusFilter = ContentItemStatus | 'all' | 'in_progress';
type SortKey = 'updated' | 'status' | 'published';

// "in_progress" is a convenience filter — everything not done or shipped.
// Lets the user see "what am I actively working on" in one click.
const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'idea', label: 'Idea' },
  { value: 'outline', label: 'Outline' },
  { value: 'filming', label: 'Filming' },
  { value: 'editing', label: 'Editing' },
  { value: 'published', label: 'Published' },
  { value: 'done', label: 'Done' },
];

// Status order for the "status" sort — matches the pipeline progression
// so ordering by status visually walks the funnel.
const STATUS_ORDER: Record<ContentItemStatus, number> = {
  idea: 0,
  outline: 1,
  filming: 2,
  editing: 3,
  published: 4,
  derivatives_pending: 5,
  done: 6,
};

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'updated', label: 'Recent' },
  { value: 'status', label: 'Pipeline' },
  { value: 'published', label: 'Published' },
];

const STATUS_LABELS: Record<ContentItemStatus, string> = {
  idea: 'Idea',
  outline: 'Outline',
  filming: 'Filming',
  editing: 'Editing',
  published: 'Published',
  derivatives_pending: 'Derivatives',
  done: 'Done',
};

export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; sort?: string }>;
}) {
  const params = await searchParams;

  // Cookie restore — same pattern as /library/books.
  if (params.status === undefined && params.sort === undefined) {
    const jar = await cookies();
    const savedStatus = jar.get('content_status')?.value;
    const savedSort = jar.get('content_sort')?.value;
    const validSavedStatus = savedStatus && STATUS_FILTERS.find((f) => f.value === savedStatus)
      ? savedStatus
      : undefined;
    const validSavedSort = savedSort && SORT_OPTIONS.find((s) => s.value === savedSort)
      ? savedSort
      : undefined;
    const qs = new URLSearchParams();
    if (validSavedStatus && validSavedStatus !== 'all') qs.set('status', validSavedStatus);
    if (validSavedSort && validSavedSort !== 'updated') qs.set('sort', validSavedSort);
    if (qs.toString()) redirect(`/content?${qs.toString()}`);
  }

  const status = (
    params.status && STATUS_FILTERS.find((f) => f.value === params.status)
      ? params.status
      : 'all'
  ) as StatusFilter;
  const sort = (
    params.sort && SORT_OPTIONS.find((s) => s.value === params.sort)
      ? params.sort
      : 'updated'
  ) as SortKey;

  let items: ContentItem[] = [];
  let errorMessage: string | null = null;
  try {
    // Fetch all items so we can do client-side filtering across the
    // "in_progress" virtual filter. The API supports server-side status
    // filtering too (for direct status=X URLs), but we lose the cheap
    // "in_progress = !done && !derivatives_pending" trick if we use it.
    items = (await contentApi.list()).items;
  } catch (err) {
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  let filtered = items;
  if (status === 'in_progress') {
    filtered = items.filter((i) => i.status !== 'done' && i.status !== 'published' && i.status !== 'derivatives_pending');
  } else if (status !== 'all') {
    filtered = items.filter((i) => i.status === status);
  }

  filtered = [...filtered].sort((a, b) => sortContent(a, b, sort));

  const buildHref = (overrides: { status?: StatusFilter; sort?: SortKey }) => {
    const qs = new URLSearchParams();
    const s = overrides.status ?? status;
    const so = overrides.sort ?? sort;
    if (s !== 'all') qs.set('status', s);
    if (so !== 'updated') qs.set('sort', so);
    const str = qs.toString();
    return str ? `/content?${str}` : '/content';
  };

  return (
    <div>
      <PrefsPersist cookiePrefix="content" paramNames={['status', 'sort']} />
      <ScreenHeader
        eyebrow="Pipeline"
        title="Content"
        meta={`${filtered.length} of ${items.length} items`}
      />
      <div className="hairline" />

      <div className="px-5 lg:px-0 pt-3 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="eyebrow">Status</span>
          <div className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map((f) => (
              <Link
                key={f.value}
                href={buildHref({ status: f.value })}
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
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="eyebrow">Sort</span>
          <div className="flex flex-wrap gap-1.5">
            {SORT_OPTIONS.map((s) => (
              <Link
                key={s.value}
                href={buildHref({ sort: s.value })}
                className={`px-2.5 py-1 border font-mono text-[10px] uppercase tracking-wider transition-colors ${
                  sort === s.value
                    ? 'bg-ink text-bg border-ink'
                    : 'border-line text-ink-2 hover:border-ink-2 hover:text-ink'
                }`}
              >
                {s.label}
              </Link>
            ))}
          </div>
          <Link
            href="/content/new"
            className="ml-auto font-mono text-[11px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
          >
            + Add
          </Link>
        </div>
      </div>

      {errorMessage ? (
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3">Error: {errorMessage}</div>
      ) : filtered.length === 0 ? (
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3 italic">
          {items.length === 0
            ? 'No content items yet. Add your first video idea.'
            : 'No content items match this filter.'}
        </div>
      ) : (
        <ul className="px-5 lg:px-0 mt-4">
          {filtered.map((item) => {
            const thumb = item.video_url ? youtubeThumbnailUrl(item.video_url, 'mq') : null;
            return (
              <li key={item.id} className="py-3 border-b border-line/40">
                <Link
                  href={`/content/${item.id}`}
                  className="flex gap-3 hover:opacity-80 transition-opacity"
                >
                  {/* Thumbnail. 112px wide × 63px tall (16:9). Falls back to a
                      placeholder so non-YouTube / no-URL rows stay aligned. */}
                  <div className="w-28 aspect-video bg-surface border border-line shrink-0 overflow-hidden">
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={thumb}
                        alt=""
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center font-mono text-[9px] uppercase tracking-wider text-ink-3">
                        {item.type.replace('_', ' ')}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
                        {STATUS_LABELS[item.status]}
                        {item.domain?.name ? ` · ${item.domain.name}` : ''}
                      </span>
                      <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3 shrink-0">
                        {formatDate(item.published_at || item.updated_at)}
                      </span>
                    </div>
                    <div className="mt-1 font-serif text-[15px] text-ink leading-tight line-clamp-2">
                      {item.title}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function sortContent(a: ContentItem, b: ContentItem, key: SortKey): number {
  switch (key) {
    case 'updated':
      return b.updated_at.localeCompare(a.updated_at);
    case 'status': {
      const ao = STATUS_ORDER[a.status] ?? 99;
      const bo = STATUS_ORDER[b.status] ?? 99;
      if (ao === bo) return b.updated_at.localeCompare(a.updated_at);
      return ao - bo;
    }
    case 'published': {
      const aa = a.published_at ?? '';
      const bb = b.published_at ?? '';
      if (!aa && !bb) return b.updated_at.localeCompare(a.updated_at);
      if (!aa) return 1;
      if (!bb) return -1;
      return bb.localeCompare(aa);
    }
    default:
      return 0;
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', {
    timeZone: 'America/Denver',
    month: 'short',
    day: 'numeric',
  });
}

