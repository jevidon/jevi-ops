import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import type { TaskTemplate } from '@jevi-ops/shared';
import { api, ApiError } from '@/lib/api';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SetCrumbs } from '@/components/crumbs/crumbs';
import { duplicateEntries } from '../template-draft';
import { TemplateEditor } from '../template-editor';

export const dynamic = 'force-dynamic';

// New template. `?from=<id>` is Duplicate: the form opens prefilled from an
// existing template under fresh keys, and nothing is created until Save.
export default async function NewTaskTemplatePage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams;
  let initial: { name: string; entries: TaskTemplate['entries'] } | undefined;
  let sourceMissing = false;
  if (from) {
    try {
      const source = await api.get<TaskTemplate>(`/api/task-templates/${encodeURIComponent(from)}`);
      // Names cap at 200 characters; leave room for the suffix.
      initial = { name: `${source.name.slice(0, 195)} copy`, entries: duplicateEntries(source.entries, randomUUID) };
    } catch (err) {
      if (!(err instanceof ApiError && (err.status === 404 || err.status === 400))) throw err;
      sourceMissing = true;
    }
  }
  return <div>
    <SetCrumbs trail={[{ label: 'Domains', href: '/work' }, { label: 'Task templates', href: '/task-templates' }]} />
    <ScreenHeader eyebrow={<Link href="/task-templates">Task templates</Link>} title="New template" meta={initial ? 'A copy; nothing is saved yet' : 'A list to reuse'} />
    <div className="hairline mb-6" />
    <div className="px-5 lg:px-0 pb-24">
      {sourceMissing && <p role="status" className="max-w-2xl mb-6 text-sm text-ink-2">The template to duplicate is no longer available. This starts a new one.</p>}
      {/* The first blank line's key is made here, on the server, so the
          editor renders the same markup on both sides of hydration. */}
      <TemplateEditor key={from ?? 'new'} initial={initial ?? { name: '', entries: [{ key: randomUUID(), title: '', notes: null, parent_key: null }] }} />
    </div>
  </div>;
}
