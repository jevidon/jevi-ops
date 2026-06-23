import Link from 'next/link';
import { briefingApi, ApiError, type CadenceRow } from '@/lib/api';

// /domains — pulse board.
//
// The full version of the Briefing's awareness column: every active
// domain, sorted worst-first by cadence ratio. Slipping domains lead
// with the big serif day-count + accent + cadence bar. Healthy and
// unconfigured domains drop to dimmed one-liners — the board reads as
// "what to attend to" rather than "all my domains."
//
// Per the design brief: status colors derive from accent + neutrals.
// No loud alert colors. Discomfort = size + prominence of facts.

export default async function DomainsPage() {
  let rows: CadenceRow[] = [];
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
          {slipping.length} attending · {healthy.length} on cadence · {unconfigured.length} unconfigured
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
          {slipping.map((row) => (
            <AttentionRow key={row.id} row={row} />
          ))}
        </section>
      )}

      {/* ─── On cadence ───────────────────────────────────────────── */}
      {healthy.length > 0 && (
        <section className="px-5 lg:px-0 mt-9">
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 mb-3">
            On cadence · {healthy.length}
          </div>
          {healthy.map((row) => (
            <QuietRow key={row.id} row={row} />
          ))}
        </section>
      )}

      {/* ─── Unconfigured (no cadence rule) ──────────────────────── */}
      {unconfigured.length > 0 && (
        <section className="px-5 lg:px-0 mt-9">
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 mb-3">
            Unconfigured · {unconfigured.length}
          </div>
          {unconfigured.map((row) => (
            <UnconfiguredRow key={row.id} row={row} />
          ))}
        </section>
      )}
    </div>
  );
}

// Slipping / stale domain: full-prominence row with the big day-count,
// cadence bar, and a next-action label.
function AttentionRow({ row }: { row: CadenceRow }) {
  const slipping = row.status === 'slip';
  return (
    <Link
      href={`/domains/${row.id}`}
      className="brief-clickable block py-4 border-b border-line"
    >
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
    </Link>
  );
}

// Healthy domain: dimmed one-liner. Name + small metric, no big numeral.
function QuietRow({ row }: { row: CadenceRow }) {
  return (
    <Link
      href={`/domains/${row.id}`}
      className="brief-clickable flex items-baseline justify-between gap-3 py-2 border-b border-line/60 hover:opacity-100 opacity-80 transition-opacity"
    >
      <span className="font-serif text-[15px] text-ink-2 truncate">{row.name}</span>
      <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3 shrink-0">
        {row.metric != null
          ? `${row.metric}d / ${row.cadence}d cadence`
          : 'on cadence'}
      </span>
    </Link>
  );
}

// Unconfigured domain (no days_since_X rule, or no data yet). Quietest
// visual treatment so they don't compete with the slipping rows.
function UnconfiguredRow({ row }: { row: CadenceRow }) {
  return (
    <Link
      href={`/domains/${row.id}`}
      className="brief-clickable flex items-baseline justify-between gap-3 py-2 border-b border-line/40 opacity-60 hover:opacity-100 transition-opacity"
    >
      <span className="font-serif text-[15px] text-ink-3 truncate">{row.name}</span>
      <span className="font-mono text-[10px] uppercase tracking-wider text-ink-4">
        no cadence rule
      </span>
    </Link>
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
