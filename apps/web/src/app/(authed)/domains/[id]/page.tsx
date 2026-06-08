import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ScreenHeader } from '@/components/ScreenHeader';
import { domainsApi, tasksApi, ApiError } from '@/lib/api';
import type { Domain, Task } from '@jerad-ops/shared';
import { EditDomainForm } from './edit-domain-form';
import { getAppTimezone } from '@/lib/app-settings';

// /domains/[id] — domain detail + edit. Shows direct domain tasks and
// project-grouped tasks so the user can see ongoing-responsibility work
// alongside project-bound work. Failure patterns are read-only here.
//
// System domains (Inbox) render a streamlined triage-oriented view
// instead of the standard edit form + failure patterns — Inbox can't
// be renamed or deactivated anyway, so showing those controls would
// only invite frustration when the API rejects the update.

export default async function DomainDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tz = await getAppTimezone();

  let domain: Domain | null = null;
  let openTasks: Task[] = [];
  let errorMessage: string | null = null;

  const [domainRes, tasksRes] = await Promise.allSettled([
    domainsApi.get(id),
    tasksApi.list({ domain_id: id, status: 'open' }),
  ]);

  if (domainRes.status === 'fulfilled') {
    domain = domainRes.value;
  } else if (domainRes.reason instanceof ApiError && domainRes.reason.status === 404) {
    notFound();
  } else {
    const err = domainRes.reason;
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  if (tasksRes.status === 'fulfilled') {
    openTasks = tasksRes.value.tasks;
  }

  if (!domain) {
    return (
      <div>
        <ScreenHeader eyebrow="Domain" title="—" />
        <div className="hairline" />
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3">
          {errorMessage ?? 'Domain not found.'}
        </div>
      </div>
    );
  }

  // Split tasks into direct (no project) and project-grouped. The two
  // sections render with the same row shape — the only difference is the
  // group header above each subset.
  const directTasks = openTasks.filter((t) => !t.project_id);
  const projectTasks = openTasks.filter((t) => t.project_id);
  const projectGroups = new Map<string, { name: string; tasks: Task[] }>();
  for (const t of projectTasks) {
    const projectId = t.project_id!;
    const projectName = t.project?.name ?? '(unnamed project)';
    const existing = projectGroups.get(projectId);
    if (existing) existing.tasks.push(t);
    else projectGroups.set(projectId, { name: projectName, tasks: [t] });
  }
  const orderedProjectGroups = Array.from(projectGroups.entries())
    .map(([id, group]) => ({ id, ...group }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const isInbox = domain.is_system === true;
  const patternCount = Array.isArray(domain.failure_patterns)
    ? domain.failure_patterns.length
    : 0;

  return (
    <div>
      <div className="px-5 lg:px-0 pt-4 pb-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
        <Link href="/domains" className="hover:text-ink-2 transition-colors">
          ← Domains
        </Link>
      </div>

      <ScreenHeader
        eyebrow={isInbox ? 'Inbox' : (domain.active ? 'Domain' : 'Domain · inactive')}
        title={domain.name}
        meta={isInbox
          ? `${openTasks.length} ${openTasks.length === 1 ? 'task' : 'tasks'} awaiting triage`
          : `${patternCount} failure ${patternCount === 1 ? 'pattern' : 'patterns'} watched`}
      />
      <div className="hairline mb-6" />

      <div className="px-5 lg:px-0 max-w-2xl">
        {isInbox ? (
          // Inbox-specific intro. No edit form (the API rejects identity
          // changes on system domains anyway) and no failure patterns —
          // Inbox is exempt from observations.
          <div className="border border-line p-4 mb-6">
            <p className="font-sans text-[13px] text-ink-2 leading-relaxed">
              Tasks here are waiting for a home. Move them to a domain or project
              when you triage — frictionless capture in, intentional placement
              out. Inbox is exempt from slippage detection, so tasks won&rsquo;t
              be flagged for sitting here.
            </p>
            {openTasks.length > 0 && (
              <Link
                href="/today#inbox-triage"
                className="mt-3 inline-block font-mono text-[11px] uppercase tracking-wider text-accent hover:text-ink transition-colors"
              >
                Triage all →
              </Link>
            )}
          </div>
        ) : (
          <EditDomainForm
            initial={{
              id: domain.id,
              name: domain.name,
              description: domain.description ?? '',
              fruit_definition: domain.fruit_definition ?? '',
              expected_cadence: domain.expected_cadence ?? '',
              active: domain.active,
            }}
          />
        )}

        {/* ─── Open tasks under this domain ───────────────────────────── */}
        <div className="mt-12">
          <div className="eyebrow mb-3 pb-2 border-b border-line">
            Open tasks · {openTasks.length}
          </div>
          {openTasks.length === 0 ? (
            <p className="font-sans text-[13px] text-ink-3 italic">No open tasks here.</p>
          ) : (
            <>
              {directTasks.length > 0 && (
                <div className="mb-6">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-ink-3 mb-2">
                    Direct tasks · {directTasks.length}
                  </div>
                  <ul className="border-t border-line/40">
                    {directTasks.map((t) => (
                      <TaskRow key={t.id} task={t} tz={tz} />
                    ))}
                  </ul>
                </div>
              )}

              {orderedProjectGroups.map((group) => (
                <div key={group.id} className="mb-6">
                  <Link
                    href={`/projects/${group.id}`}
                    className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-ink mb-2 inline-block"
                  >
                    {group.name} · {group.tasks.length}
                  </Link>
                  <ul className="border-t border-line/40">
                    {group.tasks.map((t) => (
                      <TaskRow key={t.id} task={t} tz={tz} />
                    ))}
                  </ul>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Read-only failure patterns view (hidden for Inbox) */}
        {!isInbox && patternCount > 0 && (
          <div className="mt-12 pt-6 border-t border-line">
            <div className="eyebrow mb-3">Failure patterns (read-only)</div>
            <p className="font-sans text-[12px] text-ink-3 mb-3 leading-relaxed">
              The observations cron evaluates these rules against this domain. Edit via SQL
              for now — a dedicated UI is on the roadmap.
            </p>
            <pre className="font-mono text-[11px] text-ink-2 bg-surface border border-line p-3 overflow-auto">
              {JSON.stringify(domain.failure_patterns, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

function TaskRow({ task, tz }: { task: Task; tz: string }) {
  return (
    <li className="py-2 border-b border-line/40">
      <Link
        href={`/tasks/${task.id}`}
        className="flex items-baseline justify-between gap-3 hover:opacity-80 transition-opacity"
      >
        <span className="font-sans text-[14px] text-ink truncate">{task.title}</span>
        {task.due_date && (
          <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3 shrink-0">
            {new Date(task.due_date + 'T12:00:00Z').toLocaleDateString('en-US', {
              timeZone: tz,
              month: 'short',
              day: 'numeric',
            })}
          </span>
        )}
      </Link>
    </li>
  );
}
