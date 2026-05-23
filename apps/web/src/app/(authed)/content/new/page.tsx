import Link from 'next/link';
import { ScreenHeader } from '@/components/ScreenHeader';
import { domainsApi, ApiError } from '@/lib/api';
import { ContentForm } from '../content-form';

// /content/new — manual content item entry. Defaults to video + idea so the
// most common case (capturing a new video idea for a channel) is one less
// click. Domain dropdown lists active stewardship_domains (channels live
// there since migration 0008).

export default async function NewContentPage({
  searchParams,
}: {
  searchParams: Promise<{ domain_id?: string }>;
}) {
  const { domain_id: preDomainId } = await searchParams;

  let domains: { id: string; name: string }[] = [];
  try {
    const { domains: list } = await domainsApi.list();
    domains = list.map((d) => ({ id: d.id, name: d.name }));
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
  }

  return (
    <div>
      <div className="px-5 lg:px-0 pt-4 pb-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
        <Link href="/content" className="hover:text-ink-2 transition-colors">
          ← Content
        </Link>
      </div>

      <ScreenHeader eyebrow="Pipeline" title="Add content" meta="New entry" />
      <div className="hairline mb-6" />

      <div className="px-5 lg:px-0 max-w-2xl">
        <ContentForm
          domains={domains}
          initial={{
            title: '',
            domain_id: preDomainId ?? '',
            type: 'video',
            status: 'idea',
            outline_md: '',
            video_url: '',
            published_at: '',
          }}
        />
      </div>
    </div>
  );
}
