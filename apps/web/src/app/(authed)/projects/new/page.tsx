import Link from 'next/link';
import { ScreenHeader } from '@/components/ScreenHeader';
import { domainsApi, ApiError } from '@/lib/api';
import { ProjectForm } from '../project-form';

// /projects/new — manual project creation. Pre-fill ?domain_id=… to land
// inside a specific stewardship area.

export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ domain_id?: string; kind?: string }>;
}) {
  const { domain_id: preDomainId, kind: preKind } = await searchParams;
  const initialKind = preKind === 'area' ? 'area' : 'project';

  let domains: { id: string; name: string }[] = [];
  try {
    const res = await domainsApi.list();
    domains = res.domains.map((d) => ({ id: d.id, name: d.name }));
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
  }

  return (
    <div>
      <div className="px-5 lg:px-0 pt-4 pb-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
        <Link href="/projects" className="hover:text-ink-2 transition-colors">
          ← Projects
        </Link>
      </div>

      <ScreenHeader
        eyebrow="Capture"
        title={initialKind === 'area' ? 'New area' : 'New project'}
        meta={initialKind === 'area' ? 'Ongoing context for tasks' : 'Initiative within a domain'}
      />
      <div className="hairline mb-6" />

      <div className="px-5 lg:px-0 max-w-2xl">
        <ProjectForm
          domains={domains}
          initial={{
            name: '',
            description: '',
            domain_id: preDomainId ?? '',
            type: '',
            status: 'active',
            engagement_type: 'project',
            kind: initialKind,
            quoted_hours: '',
            start_date: '',
            target_date: '',
            color: '',
          }}
        />
      </div>
    </div>
  );
}
