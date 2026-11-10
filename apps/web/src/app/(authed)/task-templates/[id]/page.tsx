import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { TaskTemplate } from '@jevi-ops/shared';
import { api, ApiError } from '@/lib/api';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SetCrumbs } from '@/components/crumbs/crumbs';
import { TemplateEditor } from '../template-editor';

export const dynamic = 'force-dynamic';

export default async function EditTaskTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let template: TaskTemplate;
  try {
    template = await api.get<TaskTemplate>(`/api/task-templates/${encodeURIComponent(id)}`);
  } catch (err) {
    // A deleted template and a malformed id are the same thing to a reader.
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) notFound();
    throw err;
  }
  return <div>
    <SetCrumbs trail={[{ label: 'Domains', href: '/work' }, { label: 'Task templates', href: '/task-templates' }]} />
    <ScreenHeader eyebrow={<Link href="/task-templates">Task templates</Link>} title="Edit template" meta="Changes apply to future projects" />
    <div className="hairline mb-6" />
    <div className="px-5 lg:px-0 pb-24">
      <TemplateEditor key={template.id} template={template} />
    </div>
  </div>;
}
