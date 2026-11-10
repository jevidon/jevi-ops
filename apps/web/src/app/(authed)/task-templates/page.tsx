import Link from 'next/link';
import type { TaskTemplate } from '@jevi-ops/shared';
import { api, domainsApi } from '@/lib/api';
import { ScreenHeader } from '@/components/ScreenHeader';
import { TaskTemplates } from './task-templates';

export const dynamic = 'force-dynamic';

export default async function TaskTemplatesPage({ searchParams }: { searchParams: Promise<{ domain_id?: string }> }) {
  const [{ templates }, { domains }, params] = await Promise.all([
    api.get<{ templates: TaskTemplate[] }>('/api/task-templates'), domainsApi.list(), searchParams,
  ]);
  return <div>
    <ScreenHeader eyebrow={<Link href="/work">Domains</Link>} title="Task templates" meta="Familiar lists, fresh starts" />
    <div className="hairline mb-6" />
    <div className="px-5 lg:px-0 pb-24">
      <p className="max-w-2xl mb-6 text-sm text-ink-2">Keep a packing list or another repeatable set of tasks here. Each time you use it, you get a new project with every task ready to start.</p>
      <TaskTemplates initialTemplates={templates} domains={domains.map(d => ({ id: d.id, name: d.name }))} initialDomainId={params.domain_id} />
    </div>
  </div>;
}
