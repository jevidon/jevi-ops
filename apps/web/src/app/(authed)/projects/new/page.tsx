import { ScreenHeader } from '@/components/ScreenHeader';
import { SetCrumbs } from '@/components/crumbs/crumbs';
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
      {/* The old ← Projects link pointed at a route that redirects to /work. */}
      <SetCrumbs
        trail={[
          { label: 'Work', href: '/work' },
          { label: initialKind === 'area' ? 'New area' : 'New project' },
        ]}
      />

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
            retainer_anchor_day: '',
            start_date: '',
            target_date: '',
            color: '',
          }}
        />
      </div>
    </div>
  );
}
