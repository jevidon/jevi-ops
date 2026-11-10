import Link from 'next/link';
import type { TaskTemplate } from '@jevi-ops/shared';
import { api, domainsApi } from '@/lib/api';
import { getAppTimezone } from '@/lib/app-settings';
import { ScreenHeader } from '@/components/ScreenHeader';
import { formatEdited } from './template-draft';
import { TemplateLibrary } from './template-library';

export const dynamic = 'force-dynamic';

export default async function TaskTemplatesPage({ searchParams }: { searchParams: Promise<{ domain_id?: string }> }) {
  const [{ templates }, { domains }, params, tz] = await Promise.all([
    api.get<{ templates: TaskTemplate[] }>('/api/task-templates'), domainsApi.list(), searchParams, getAppTimezone(),
  ]);
  // Dates are formatted here, in the app timezone, so the client never
  // renders them in the device's zone.
  const edited = Object.fromEntries(templates.map(template => [template.id, formatEdited(template.updated_at, tz)]));
  return <div>
    <ScreenHeader eyebrow={<Link href="/work">Domains</Link>} title="Task templates" meta="Familiar lists, fresh starts"
      actions={<Link href="/task-templates/new" className="inline-flex items-center h-[34px] px-3 rounded bg-ink border border-ink font-mono text-[10px] uppercase tracking-[0.09em] text-bg hover:bg-ink-2 transition-colors">+ Template</Link>} />
    <div className="hairline mb-6" />
    <div className="px-5 lg:px-0 pb-24">
      <p className="max-w-2xl mb-6 text-sm text-ink-2">Keep a packing list or another repeatable set of tasks here. Each time you use it, you get a new project with every task ready to start.</p>
      <TemplateLibrary initialTemplates={templates} edited={edited} domains={domains.map(d => ({ id: d.id, name: d.name }))} initialDomainId={params.domain_id} />
    </div>
  </div>;
}
