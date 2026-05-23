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
            published_at: publishedDate,
          }}
        />
      </div>
    </div>
  );
}
