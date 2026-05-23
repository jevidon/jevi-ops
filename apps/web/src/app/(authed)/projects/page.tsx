import Link from 'next/link';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/EmptyState';
import { projectsApi, ApiError, type ProjectListItem } from '@/lib/api';

// /projects — list view. Split into Active projects, Retainers, then
// Paused / Done / Archived (collapsed). Retainers are kept separate
// because their relevant metric is monthly usage, not cumulative.

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  paused: 'Paused',
  done: 'Done',
  archived: 'Archived',
};

function sortProjects(list: ProjectListItem[]): ProjectListItem[] {
  return [...list].sort((a, b) =>
    (b.updated_at ?? '').localeCompare(a.updated_at ?? ''),
  );
}

interface GroupedProjects {
  activeProjects: ProjectListItem[];
  retainers: ProjectListItem[];
  paused: ProjectListItem[];
  done: ProjectListItem[];
  archived: ProjectListItem[];
}

function group(list: ProjectListItem[]): GroupedProjects {
  const g: GroupedProjects = {
    activeProjects: [],
    retainers: [],
    paused: [],
    done: [],
    archived: [],
  };
  for (const p of list) {
    if (p.status === 'paused') g.paused.push(p);
    else if (p.status === 'done') g.done.push(p);
    else if (p.status === 'archived') g.archived.push(p);
    else if (p.engagement_type === 'retainer') g.retainers.push(p);
    else g.activeProjects.push(p);
  }
  return g;
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

  const grouped = group(projects);
  const activeCount = grouped.activeProjects.length + grouped.retainers.length;

  return (
    <div>
      <ScreenHeader
        eyebrow="Active work"
        title="Projects"
        meta={`${activeCount} active · ${projects.length} total`}
      />
      <div className="hairline" />

      <div className="px-5 lg:px-0 pt-3 flex justify-end">
        <Link
          href="/projects/new"
          className="font-mono text-[11px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
        >
          + New project
        </Link>
      </div>

      {errorMessage ? (
        <EmptyState title="Couldn't load projects" body={errorMessage} />
      ) : projects.length === 0 ? (
        <EmptyState
          title="No projects yet"
          body='Create one via voice ("start a project called Reviews v2.4 in Site Nitro") or via the API.'
        />
      ) : (
        <div className="mt-2">
          {grouped.activeProjects.length > 0 && (
            <ProjectGroup label={`Active · ${grouped.activeProjects.length}`} projects={grouped.activeProjects} />
          )}
          {grouped.retainers.length > 0 && (
            <ProjectGroup label={`Retainers · ${grouped.retainers.length}`} projects={grouped.retainers} />
          )}
          {grouped.paused.length > 0 && (
            <CollapsedGroup label={`Paused · ${grouped.paused.length}`} projects={grouped.paused} />
          )}
          {grouped.done.length > 0 && (
            <CollapsedGroup label={`Done · ${grouped.done.length}`} projects={grouped.done} />
          )}
          {grouped.archived.length > 0 && (
            <CollapsedGroup label={`Archived · ${grouped.archived.length}`} projects={grouped.archived} />
          )}
        </div>
      )}
    </div>
  );
}

function ProjectGroup({
  label,
  projects,
}: {
  label: string;
  projects: ProjectListItem[];
}) {
  return (
    <section className="mt-4">
      <div className="px-5 lg:px-0 eyebrow pb-2 border-b border-line">{label}</div>
      <ul>
        {projects.map((p) => (
          <ProjectRow key={p.id} project={p} />
        ))}
      </ul>
    </section>
  );
}

function CollapsedGroup({
  label,
  projects,
}: {
  label: string;
  projects: ProjectListItem[];
}) {
  return (
    <section className="mt-4">
      <details>
        <summary className="px-5 lg:px-0 eyebrow pb-2 border-b border-line cursor-pointer list-none hover:text-ink-2 transition-colors">
          {label}
        </summary>
        <ul>
          {projects.map((p) => (
            <ProjectRow key={p.id} project={p} />
          ))}
        </ul>
      </details>
    </section>
  );
}

function ProjectRow({ project }: { project: ProjectListItem }) {
  const isRetainer = project.engagement_type === 'retainer';
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
          {isRetainer ? (
            // For retainers we don't have hours_this_month on the list
            // endpoint (only the detail endpoint computes it). Surface
            // cumulative + monthly cap as the rollup signal here; tap
            // through to the detail page for this-month / last-month.
            <span>
              {quoted != null
                ? `${hoursLogged.toFixed(1)}h logged · ${quoted.toFixed(1)}h/mo cap`
                : `${hoursLogged.toFixed(1)}h logged · retainer`}
            </span>
          ) : (
            <>
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
            </>
          )}
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
