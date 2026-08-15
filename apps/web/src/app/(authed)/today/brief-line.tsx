import Link from 'next/link';
import type { BriefLine } from '@/lib/api';
import { Pill } from '@/components/Pill';

// Editorial brief line — the heart of the Briefing.
//
// Visual structure (per the design brief):
//   ┌──────────────────────────────────────────────────────────┐
//   │ {domain} —                              {N}              │
//   │                              {days since X}              │
//   │ ──── cadence bar (neutral, accent overflow) ────         │
//   │ NEXT  {action sentence}                                  │
//   │ {routing label · destination →}                          │
//   └──────────────────────────────────────────────────────────┘
//
// The whole row is tappable. The fact (N) reads in accent.slip when ratio
// > 1 (past cadence) and ink when timed/positive. The cadence bar is
// SVG-free — three positioned divs, see CadenceBar below.

export function BriefLineRow({ line }: { line: BriefLine }) {
  // Cadence slip → the two warm pill states. Stale (no activity at all) and
  // far-past-cadence read as "over"; a fresh slip reads "due".
  const over = line.status === 'stale' || line.ratio >= 1.5;
  const pillState = over ? 'over' : 'due';
  return (
    <Link
      href={line.routeTo.href}
      className="brief-clickable block rounded border border-line bg-bg p-4 hover:border-line-strong transition-colors"
    >
      <div className="flex items-start justify-between gap-6">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5 mb-1.5 flex-wrap">
            <h3 className="font-serif text-[18px] font-medium text-ink tracking-[-0.2px] leading-tight">
              {line.name}
            </h3>
            <Pill state={pillState}>{line.status === 'stale' ? 'Stale' : 'Slipping'}</Pill>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div
            className={`font-serif text-[34px] leading-[0.9] tabular-nums tracking-[-1px] ${over ? 'text-accent' : 'text-ink'}`}
            style={{ fontWeight: 500 }}
          >
            {line.big}
          </div>
          <div className="mt-1.5 font-sans text-[11px] text-ink-3 max-w-[118px]">{line.unit}</div>
        </div>
      </div>

      <CadenceBar ratio={line.ratio} />

      <div className="mt-3 flex items-baseline gap-2 flex-wrap">
        <span className="font-sans text-[13.5px] font-medium text-accent flex-1 min-w-0">
          {line.next}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.07em] text-ink-4 shrink-0">
          {line.routeTo.label}
        </span>
      </div>

      {line.last && (
        <div className="mt-2 font-mono text-[10.5px] text-ink-4">{line.last}</div>
      )}
    </Link>
  );
}

// Cadence bar: track = max(metric, cadence). Fill up to the cadence
// threshold in ink-3 (neutral); the overflow past threshold renders in
// accent. A 7px tick marks the expected cadence. Matches the design's
// `CadenceBar` in today-redesign.jsx.
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
