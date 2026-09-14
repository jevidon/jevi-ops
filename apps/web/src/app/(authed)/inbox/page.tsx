import Link from 'next/link';
import { ScreenHeader } from '@/components/ScreenHeader';
import { tasksApi, projectsApi, domainsApi, capturesApi, ApiError, type CaptureDetail } from '@/lib/api';
import { getAppTimezone } from '@/lib/app-settings';
import { INBOX_DOMAIN_ID } from '@jevi-ops/shared';
import type { Task } from '@jevi-ops/shared';
import { TriageRow } from './triage-row';
import { CaptureRow } from './capture-row';

// /inbox — streamlined triage for tasks captured without a domain. Each
// row gets a small destination picker; submit moves the task and the row
// disappears on revalidate. When the list empties, we show a "clean inbox"
// state instead of an empty list.
//
// Captures (capture program, Gate B): everything saved but not yet
// interpreted — waiting for the local model, blocked, needing review, or
// with an unfinished upload — is listed underneath with its truthful state.
// An empty task list therefore does not imply that every capture settled.

export default async function InboxPage() {
  let tasks: Task[] = [];
  let domains: { id: string; name: string; is_system?: boolean }[] = [];
  let projects: { id: string; name: string; domain_id: string | null }[] = [];
  let captures: CaptureDetail[] = [];
  let capturesError: string | null = null;
  let errorMessage: string | null = null;

  const tz = await getAppTimezone();
  const [tasksRes, domainsRes, projectsRes, capturesRes] = await Promise.allSettled([
    tasksApi.list({ domain_id: INBOX_DOMAIN_ID, status: 'open' }),
    domainsApi.list(),
    projectsApi.list(),
    capturesApi.list(['awaiting_media', 'queued', 'interpreting', 'blocked', 'needs_review']),
  ]);

  if (capturesRes.status === 'fulfilled') {
    captures = capturesRes.value.captures;
  } else {
    const err = capturesRes.reason;
    capturesError = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  if (tasksRes.status === 'fulfilled') {
    tasks = tasksRes.value.tasks;
  } else {
    const err = tasksRes.reason;
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  if (domainsRes.status === 'fulfilled') {
    domains = domainsRes.value.domains
      .map((d) => ({ id: d.id, name: d.name, is_system: d.is_system === true }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  if (projectsRes.status === 'fulfilled') {
    projects = projectsRes.value.projects
      .filter((p) => p.status === 'active')
      .map((p) => ({ id: p.id, name: p.name, domain_id: p.domain?.id ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  return (
    <div>
      <div className="px-5 lg:px-0 pt-4 pb-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
        <Link href="/" className="hover:text-ink-2 transition-colors">
          ← Home
        </Link>
      </div>

      <ScreenHeader
        eyebrow="📥 Triage"
        title="Inbox"
        meta={`${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'} · ${captures.length} ${captures.length === 1 ? 'capture' : 'captures'} pending`}
      />
      <div className="hairline mb-4" />

      <div className="px-5 lg:px-0 max-w-2xl">
        {errorMessage ? (
          <p className="font-sans text-[13px] text-ink-3 mt-4">
            Couldn&rsquo;t load tasks: {errorMessage}
          </p>
        ) : tasks.length === 0 ? (
          <div className="mt-4 border border-line p-6 text-center">
            <p className="font-serif text-[16px] text-ink mb-1">Inbox empty.</p>
            <p className="font-sans text-[13px] text-ink-3">
              Every captured task is sorted into its proper place. Nicely done.
            </p>
          </div>
        ) : (
          <>
            <p className="font-sans text-[13px] text-ink-3 mb-4 leading-relaxed">
              Tasks land here when you capture without picking a destination.
              Pick a domain or project for each one — it&rsquo;s out of Inbox the
              moment you triage it.
            </p>
            <ul>
              {tasks.map((t) => (
                <li key={t.id}>
                  <TriageRow task={t} domains={domains} projects={projects} />
                </li>
              ))}
            </ul>
          </>
        )}

        <section className="mt-8">
          <div className="flex items-baseline justify-between mb-2">
            <div className="eyebrow">Captures</div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-ink-3">saved, not yet settled</div>
          </div>
          {capturesError ? (
            <p className="font-sans text-[13px] text-ink-3">Couldn&rsquo;t load captures: {capturesError}</p>
          ) : captures.length === 0 ? (
            <p className="font-sans text-[13px] text-ink-3">Nothing waiting. Every saved capture has been interpreted or reviewed.</p>
          ) : (
            <>
              <p className="font-sans text-[13px] text-ink-3 mb-2 leading-relaxed">
                Each of these is stored exactly as you said it. Open one to see its state, the original, and whether it can be retried.
              </p>
              <ul>
                {captures.map((c) => (
                  <CaptureRow key={c.capture_id} capture={c} tz={tz} />
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
