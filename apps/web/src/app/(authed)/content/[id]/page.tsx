import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ScreenHeader } from '@/components/ScreenHeader';
import { contentApi, domainsApi, tasksApi, ApiError, type ContentItem } from '@/lib/api';
import type { Task } from '@jerad-ops/shared';
import { ContentForm } from '../content-form';

// /content/[id] — detail + edit. Status changes (idea→outline→…→done) happen
// in the form. Outline + video URL live below the metadata so the form is
// long but linear. Delete in the danger zone of the form.

export default async function ContentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let item: ContentItem | null = null;
  let domains: { id: string; name: string }[] = [];
  let linkedTasks: Task[] = [];
  let errorMessage: string | null = null;

  try {
    const [itemRes, domainsRes, tasksRes] = await Promise.all([
      contentApi.get(id),
      domainsApi.list(),
      tasksApi.list({ content_item_id: id }),
    ]);
    item = itemRes;
    domains = domainsRes.domains.map((d) => ({ id: d.id, name: d.name }));
    linkedTasks = tasksRes.tasks;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  if (!item) {
    return (
      <div>
        <ScreenHeader eyebrow="Content" title="—" />
        <div className="hairline" />
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3">
          {errorMessage ?? 'Content item not found.'}
        </div>
      </div>
    );
  }

  // ISO timestamp → YYYY-MM-DD for the <input type="date"> default value.
  const publishedDate = item.published_at ? item.published_at.slice(0, 10) : '';

  const metaBits = [
    item.type.replace('_', ' '),
    item.domain?.name,
  ].filter(Boolean);

  return (
    <div>
      <div className="px-5 lg:px-0 pt-4 pb-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
        <Link href="/content" className="hover:text-ink-2 transition-colors">
          ← Content
        </Link>
      </div>

      <ScreenHeader
        eyebrow={metaBits.join(' · ')}
        title={item.title}
        meta={`Status · ${item.status.replace('_', ' ')}`}
      />
      <div className="hairline mb-6" />

      <div className="px-5 lg:px-0 max-w-2xl">
        {/* Video embed + links — surface above tasks so the content itself
            is the first thing on the page (it's what the page is about).
            Only renders when there's actually something to show. */}
        {(item.video_url || item.article_url) && (
          <section className="mb-10">
            {item.video_url && youtubeEmbedSrc(item.video_url) && (
              <div className="mb-4 aspect-video bg-surface border border-line overflow-hidden">
                {/* eslint-disable-next-line jsx-a11y/iframe-has-title */}
                <iframe
                  src={youtubeEmbedSrc(item.video_url)!}
                  title={item.title}
                  className="w-full h-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              </div>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-2 font-mono text-[10px] uppercase tracking-wider text-ink-3">
              {item.video_url && (
                <a
                  href={item.video_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-accent transition-colors break-all"
                >
                  ↗ Video URL
                </a>
              )}
              {item.article_url && (
                <a
                  href={item.article_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-accent transition-colors break-all"
                >
                  ↗ Article URL
                </a>
              )}
            </div>
          </section>
        )}

        {/* Linked tasks — surface above the edit form so the user sees
            their checklist of TODOs at a glance. */}
        <section className="mb-10">
          <div className="flex items-baseline justify-between mb-3">
            <div className="eyebrow">
              Tasks {linkedTasks.length > 0 ? `· ${linkedTasks.filter((t) => t.status === 'open').length} open` : ''}
            </div>
            <Link
              href={`/tasks/new?content_item_id=${item.id}`}
              className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
            >
              + Add task
            </Link>
          </div>
          {linkedTasks.length === 0 ? (
            <div className="font-sans text-[13px] text-ink-3 italic">
              No tasks linked to this content yet.
            </div>
          ) : (
            <ul className="space-y-2">
              {linkedTasks.map((t) => (
                <li key={t.id} className="flex items-baseline gap-3 py-1.5 border-b border-line/40">
                  <span
                    className={`font-mono text-[10px] uppercase tracking-wider w-12 shrink-0 ${
                      t.status === 'done' ? 'text-ink-3' : 'text-accent'
                    }`}
                  >
                    {t.status === 'done' ? '✓ done' : 'open'}
                  </span>
                  <Link
                    href={`/tasks/${t.id}`}
                    className={`flex-1 font-sans text-[14px] hover:text-accent transition-colors ${
                      t.status === 'done' ? 'text-ink-3 line-through' : 'text-ink'
                    }`}
                  >
                    {t.title}
                  </Link>
                  {t.due_date && (
                    <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3 shrink-0">
                      {t.due_date}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="mb-2 eyebrow">Edit content</div>
        <ContentForm
          domains={domains}
          initial={{
            id: item.id,
            title: item.title,
            domain_id: item.domain_id ?? '',
            type: item.type,
            status: item.status,
            outline_md: item.outline_md ?? '',
            video_url: item.video_url ?? '',
            article_url: item.article_url ?? '',
            published_at: publishedDate,
          }}
        />
      </div>
    </div>
  );
}

// Convert a YouTube watch/share URL to an embed URL. Returns null for
// non-YouTube URLs so the caller can decide not to render an iframe.
//
// Handles the common shapes:
//   https://www.youtube.com/watch?v=ID
//   https://youtu.be/ID
//   https://youtube.com/shorts/ID
//   https://www.youtube.com/embed/ID  (already an embed; passes through)
function youtubeEmbedSrc(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    let id: string | null = null;
    if (host === 'youtu.be') {
      id = u.pathname.replace(/^\//, '').split('/')[0] ?? null;
    } else if (host === 'youtube.com' || host === 'm.youtube.com') {
      if (u.pathname === '/watch') id = u.searchParams.get('v');
      else if (u.pathname.startsWith('/shorts/')) id = u.pathname.replace('/shorts/', '').split('/')[0] ?? null;
      else if (u.pathname.startsWith('/embed/')) id = u.pathname.replace('/embed/', '').split('/')[0] ?? null;
    }
    if (!id || !/^[\w-]{6,}$/.test(id)) return null;
    return `https://www.youtube.com/embed/${id}`;
  } catch {
    return null;
  }
}
