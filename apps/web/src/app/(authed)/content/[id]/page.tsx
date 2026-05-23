import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ScreenHeader } from '@/components/ScreenHeader';
import { contentApi, domainsApi, ApiError, type ContentItem } from '@/lib/api';
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
  let errorMessage: string | null = null;

  try {
    const [itemRes, domainsRes] = await Promise.all([
      contentApi.get(id),
      domainsApi.list(),
    ]);
    item = itemRes;
    domains = domainsRes.domains.map((d) => ({ id: d.id, name: d.name }));
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
