import { contentApi, ApiError, type ContentItem } from '@/lib/api';
import { getAppTimezone } from '@/lib/app-settings';
import { todayIsoDate } from '@/lib/today';
import { ContentView } from './content-view';

// /content — the content pipeline (v2 redesign). Thin server shell: fetch the
// items (the API excludes archived by default, Addendum 09) + app-tz today, and
// hand off to the client ContentView which owns the facet rail + stage grouping.
// A ?status= deep link (e.g. the Work page's "Ideas" link) preselects that stage.

export const dynamic = 'force-dynamic';

export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const tz = await getAppTimezone();
  const today = todayIsoDate(tz);

  let items: ContentItem[] = [];
  let errorMessage: string | null = null;
  try {
    const res = await contentApi.list();
    items = res.items;
  } catch (err) {
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  if (errorMessage) {
    return (
      <div className="px-5 lg:px-10 pt-8">
        <h1 className="font-serif text-[40px] font-medium tracking-[-0.022em] text-ink">Content</h1>
        <p className="mt-4 font-sans text-[13px] text-ink-3">Couldn&rsquo;t load content: {errorMessage}</p>
      </div>
    );
  }

  // key on the deep-link status so a soft nav to /content?status=… (e.g. the
  // in-page "Ideas" link) remounts and re-seeds the stage filter.
  return <ContentView key={status ?? 'all'} items={items} today={today} tz={tz} initialStage={status} />;
}
