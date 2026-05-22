import Link from 'next/link';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/EmptyState';
import { projectsApi, ApiError, type ProjectListItem } from '@/lib/api';

// /projects — list view. Active projects first, then by most-recently-updated.

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  paused: 'Paused',
  done: 'Done',
  archived: 'Archived',
};

function sortProjects(list: ProjectListItem[]): ProjectListItem[] {
  const statusRank = (s: string) =>
    s === 'active' ? 0 : s === 'paused' ? 1 : s === 'done' ? 2 : 3;
  return [...list].sort((a, b) => {
    const r = statusRank(a.status) - statusRank(b.status);
    if (r !== 0) return r;
    return (b.updated_at ?? '').localeCompare(a.updated_at ?? '');
  });
}

export default async function ProjectsPage() {
  let projects: ProjectListItem[] = [];
  let errorMessage: string | null = null;

  try {
    const res = await projectsApi.list();
    projects = sortProjects(res.projects);
  } catch (err) {
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  return (
    <div>
      <ScreenHeader eyebrow="Active work" title="Projects" meta={`${projects.length} total`} />
      <div className="hairline" />

      {errorMessage ? (
        <EmptyState title="Couldn't load projects" body={errorMessage} />
      ) : projects.length === 0 ? (
        <EmptyState
          title="No projects yet"
          body='Create one via voice ("start a project called Reviews v2.4 in Site Nitro") or via the API.'
        />
      ) : (
        <ul>
          {projects.map((p) => (
            <ProjectRow key={p.id} project={p} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ProjectRow({ project }: { project: ProjectListItem }) {
  const milestones = project.milestones ?? [];
  const doneCount = milestones.filter((m) => m.status === 'done').length;
  const totalCount = milestones.length;

  const hoursLogged = Number(project.hours_logged ?? 0);
  const quoted = project.quoted_hours != null ? Number(project.quoted_hours) : null;

  return (
    <li className="border-b border-line">
      <Link
        href={`/projects/${project.id}`}
        className="block px-5 lg:px-0 py-5 hover:bg-surface-2/40 transition-colors"
      >
        <div className="flex items-baseline justify-between gap-4">
          <div className="flex items-baseline gap-3 min-w-0 flex-1">
            {project.color && (
              <span
                className="h-2.5 w-2.5 rounded-full shrink-0 translate-y-[-1px]"
                style={{ backgroundColor: project.color }}
                aria-hidden
              />
            )}
            <div className="font-serif text-[20px] text-ink leading-tight truncate">
              {project.name}
            </div>
          </div>
          {project.status !== 'active' && (
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-ink-3">
              {STATUS_LABELS[project.status] ?? project.status}
            </span>
          )}
        </div>

        {project.description && (
          <div className="mt-1 font-sans text-[13px] text-ink-2 leading-snug line-clamp-2">
            {project.description}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
          {project.domain?.name && <span>{project.domain.name}</span>}
          <span>
            {quoted != null
              ? `${hoursLogged.toFixed(1)} / ${quoted.toFixed(1)}h`
              : `${hoursLogged.toFixed(1)}h logged`}
          </span>
          {totalCount > 0 && (
            <span>
              {doneCount}/{totalCount} milestones
            </span>
          )}
          {project.target_date && <span>Target {formatRelativeDate(project.target_date)}</span>}
        </div>
      </Link>
    </li>
  );
}

function formatRelativeDate(iso: string): string {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Denver',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  if (iso === today) return 'today';
  const target = new Date(iso + 'T00:00:00Z').getTime();
  const now = new Date(today + 'T00:00:00Z').getTime();
  const days = Math.round((target - now) / (24 * 60 * 60 * 1000));
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days > 1 && days < 14) return `in ${days}d`;
  if (days < -1 && days > -14) return `${Math.abs(days)}d ago`;
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', {
    timeZone: 'America/Denver',
    month: 'short',
    day: 'numeric',
  });
}
