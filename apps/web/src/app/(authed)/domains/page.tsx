import Link from 'next/link';
import { briefingApi, ApiError, type DomainPulseRow } from '@/lib/api';
import { DomainIllustration } from './domain-illustration';

// /domains — pulse board.
//
// A grid of domain cards, sorted worst-first by cadence ratio. Each card
// carries a generated engraved-line illustration (seeded from the domain
// name — see domain-illustration.tsx), the cadence fact, and a workload
// footer: active projects, open tasks, and the time-sensitive slice
// (overdue / due within a week) with the single most-pressing dated task.
//
// Slipping domains keep the big serif day-count + accent + cadence bar;
// healthy and unconfigured domains render quieter, but every card now
// says what actually lives inside the domain.
//
// Per the design brief: status colors derive from accent + neutrals.
// No loud alert colors. Discomfort = size + prominence of facts.

export default async function DomainsPage() {
  let rows: DomainPulseRow[] = [];
  let errorMessage: string | null = null;

  try {
    const res = await briefingApi.domains();
    rows = res.domains;
  } catch (err) {
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  const slipping = rows.filter((r) => r.status === 'slip' || r.status === 'stale');
  const healthy = rows.filter((r) => r.status === 'ok');
  const unconfigured = rows.filter((r) => r.status === 'unconfigured');

  const totalProjects = rows.reduce((n, r) => n + r.stats.projects, 0);
  const totalTasks = rows.reduce((n, r) => n + r.stats.open_tasks, 0);

  return (
    <div className="pb-32">
      {/* ─── Masthead ─────────────────────────────────────────────── */}
      <div className="px-5 lg:px-0 pt-5">
        <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 mb-2">
          Pulse · sorted worst-first
        </div>
        <h1 className="font-serif text-[26px] font-semibold leading-none tracking-[-0.5px] text-ink">
          Domains
        </h1>
        <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
          {slipping.length} attending · {healthy.length} on cadence · {unconfigured.length}{' '}
          unconfigured · {totalProjects} projects · {totalTasks} open tasks
        </div>
      </div>
      <div className="hairline-strong mt-3 mx-5 lg:mx-0" />

      {errorMessage && (
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3">
          Couldn&rsquo;t load the pulse: {errorMessage}
        </div>
      )}

      {/* ─── Needs attention ──────────────────────────────────────── */}
      {slipping.length > 0 && (
        <section className="px-5 lg:px-0 mt-7">
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-accent mb-3">
            Needs attention · {slipping.length}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {slipping.map((row) => (
              <AttentionCard key={row.id} row={row} />
            ))}
          </div>
        </section>
      )}

      {/* ─── On cadence ───────────────────────────────────────────── */}
      {healthy.length > 0 && (
        <section className="px-5 lg:px-0 mt-9">
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 mb-3">
            On cadence · {healthy.length}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {healthy.map((row) => (
              <QuietCard key={row.id} row={row} />
            ))}
          </div>
        </section>
      )}

      {/* ─── Unconfigured (no cadence rule) ──────────────────────── */}
      {unconfigured.length > 0 && (
        <section className="px-5 lg:px-0 mt-9">
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 mb-3">
            Unconfigured · {unconfigured.length}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {unconfigured.map((row) => (
              <QuietCard key={row.id} row={row} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// Slipping / stale domain: full-prominence card. Accent-toned
// illustration, the big day-count, cadence bar, and next-action routing.
function AttentionCard({ row }: { row: DomainPulseRow }) {
  const slipping = row.status === 'slip';
  return (
    <Link
      href={`/domains/${row.id}`}
      className="brief-clickable flex flex-col bg-surface border border-line-strong hover:border-ink-4 transition-colors"
    >
      <div className="h-[92px] border-b border-line overflow-hidden">
        <DomainIllustration name={row.name} svg={row.illustration?.svg} tone="accent" />
      </div>

      <div className="flex-1 flex flex-col px-4 pt-3 pb-4">
        <div className="flex items-start justify-between gap-4">
          <h3 className="font-serif text-[18px] font-medium text-ink tracking-[-0.2px] leading-tight flex-1 min-w-0">
            {row.name}
          </h3>
          {row.metric != null && (
            <span
              className={`font-serif text-[34px] leading-[0.9] tabular-nums tracking-[-1px] shrink-0 ${
                slipping ? 'text-accent-slip' : 'text-ink'
              }`}
              style={{ fontWeight: 500 }}
            >
              {row.metric}
            </span>
          )}
        </div>

        <div className="flex justify-end -mt-0.5 mb-2">
          <span className="font-sans text-[11px] text-ink-3">{row.unit}</span>
        </div>

        <CadenceBar ratio={row.ratio} />

        <div className="mt-3 flex items-baseline gap-2 flex-wrap">
          <span className="font-mono text-[9px] uppercase tracking-[0.06em] text-ink-3">
            Next
          </span>
          <span className="font-sans text-[13px] text-ink-2 flex-1 min-w-0">{row.next}</span>
        </div>
        <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-accent">
          {row.routeTo.label}
        </div>
        {row.last && (
          <div className="mt-1 font-sans text-[11px] text-ink-3">{row.last}</div>
        )}

        <StatsFooter row={row} />
      </div>
    </Link>
  );
}

// Healthy or unconfigured domain: quieter card. Illustration stays in
// ink, the cadence state reads as a small mono line, and the workload
// footer does the talking.
function QuietCard({ row }: { row: DomainPulseRow }) {
  const unconfigured = row.status === 'unconfigured';
  const meta = unconfigured
    ? row.rule == null
      ? 'no cadence rule'
      : 'rule set · no data yet'
    : row.metric != null
      ? `${row.metric}d / ${row.cadence}d cadence`
      : 'on cadence';
  return (
    <Link
      href={`/domains/${row.id}`}
      className="brief-clickable flex flex-col bg-surface border border-line hover:border-line-strong transition-colors"
    >
      <div className="h-[76px] border-b border-line overflow-hidden opacity-80">
        <DomainIllustration name={row.name} svg={row.illustration?.svg} />
      </div>

      <div className="flex-1 flex flex-col px-4 pt-3 pb-4">
        <h3
          className={`font-serif text-[16px] font-medium tracking-[-0.2px] leading-tight ${
            unconfigured ? 'text-ink-2' : 'text-ink'
          }`}
        >
          {row.name}
        </h3>
        <div
          className={`mt-1 font-mono text-[9px] uppercase tracking-[0.06em] ${
            unconfigured ? 'text-ink-4' : 'text-ink-3'
          }`}
        >
          {meta}
        </div>
        {!unconfigured && (
          <div className="mt-2">
            <CadenceBar ratio={row.ratio} />
          </div>
        )}

        <StatsFooter row={row} />
      </div>
    </Link>
  );
}

// Workload footer, shared by every card: active projects · open tasks,
// the time-sensitive slice in accent, and the most-pressing dated task.
function StatsFooter({ row }: { row: DomainPulseRow }) {
  const s = row.stats;
  const empty = s.projects === 0 && s.open_tasks === 0;
  return (
    <div className="mt-auto pt-3">
      <div className="border-t border-line pt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-[9px] uppercase tracking-[0.06em] text-ink-3">
        {empty ? (
          <span className="text-ink-4">nothing filed</span>
        ) : (
          <>
            <span>{s.projects} {s.projects === 1 ? 'project' : 'projects'}</span>
            <span>{s.open_tasks} {s.open_tasks === 1 ? 'task' : 'tasks'}</span>
            {s.overdue > 0 && <span className="text-accent">{s.overdue} overdue</span>}
            {s.due_soon > 0 && <span className="text-ink-2">{s.due_soon} due soon</span>}
          </>
        )}
      </div>
      {s.next_due && (
        <div className="mt-1.5 font-sans text-[11px] text-ink-3 truncate">
          {/* next_due is the earliest dated open task, so it's overdue
              exactly when the domain has any overdue task at all. */}
          <span className={s.overdue > 0 ? 'text-accent-ink' : undefined}>
            Due {s.next_due.date}
          </span>{' '}
          · {s.next_due.title}
        </div>
      )}
    </div>
  );
}

// Same cadence bar primitive as the Briefing's brief-line component.
// Could be hoisted to a shared component later; one-file duplication is
// fine for now since the two callers have the same visual contract.
function CadenceBar({ ratio }: { ratio: number }) {
  const overdue = ratio > 1;
  const expectedFrac = overdue ? 1 / ratio : 1;
  const fillFrac = overdue ? 1 : ratio;
  return (
    <div className="relative h-[3px] bg-line-strong mt-0.5">
      <div
        className="absolute left-0 top-0 h-full bg-ink-3"
        style={{ width: `${Math.min(expectedFrac, fillFrac) * 100}%` }}
      />
      {overdue && (
        <div
          className="absolute top-0 h-full bg-accent"
          style={{
            left: `${expectedFrac * 100}%`,
            width: `${(1 - expectedFrac) * 100}%`,
          }}
        />
      )}
      <div
        className="absolute -top-[2px] h-[7px] w-px bg-ink-2"
        style={{ left: `${expectedFrac * 100}%` }}
      />
    </div>
  );
}
