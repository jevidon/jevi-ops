import Link from 'next/link';
import type { BriefLine } from '@/lib/api';

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
  const slipping = line.status === 'slip';
  return (
    <Link
      href={line.routeTo.href}
      className="brief-clickable block py-4 border-b border-line"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="font-serif text-[18px] font-medium text-ink tracking-[-0.2px] leading-tight">
            {line.name}
          </h3>
        </div>
        <div className="text-right shrink-0 flex items-baseline gap-1.5">
          <span
            className={`font-serif text-[34px] leading-[0.9] tabular-nums tracking-[-1px] ${
              slipping ? 'text-accent-slip' : 'text-ink'
            }`}
            style={{ fontWeight: 500 }}
          >
            {line.big}
          </span>
        </div>
      </div>

      <div className="flex justify-end -mt-0.5 mb-2">
        <span className="font-sans text-[11px] text-ink-3">{line.unit}</span>
      </div>

      <CadenceBar ratio={line.ratio} />

      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <span className="font-mono text-[9px] uppercase tracking-[0.06em] text-ink-3">
          Next
        </span>
        <span className="font-sans text-[13px] text-ink-2 flex-1 min-w-0">
          {line.next}
        </span>
      </div>

      <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-accent">
        {line.routeTo.label}
      </div>

      {line.last && (
        <div className="mt-1 font-sans text-[11px] text-ink-3">
          {line.last}
        </div>
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
