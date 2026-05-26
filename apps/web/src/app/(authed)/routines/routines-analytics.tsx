import type { RoutineListItem } from '@/lib/api';

// Overall analytics strip for the /routines page header. Three pieces:
//
//   1. Big number: 30-day completion rate across all currently-active
//      routines. Computed as (completed routine-days) / (eligible
//      routine-days) where eligibility is "the routine existed on that
//      day" (created_at <= day).
//
//   2. Sparkline of the daily rate over the last 30 days.
//
//   3. A small "honor roll" line: best current streak + total completions
//      in the last 7 days.
//
// Server component — gets all its data from the routine list response.

interface Props {
  routines: RoutineListItem[];
  today: string; // YYYY-MM-DD in app TZ
}

// Returns the last N day-isos (oldest first) anchored at `todayIso`.
function lastNDays(todayIso: string, n: number): string[] {
  const y = parseInt(todayIso.slice(0, 4), 10);
  const m = parseInt(todayIso.slice(5, 7), 10) - 1;
  const d = parseInt(todayIso.slice(8, 10), 10);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const cell = new Date(Date.UTC(y, m, d - i));
    out.push(cell.toISOString().slice(0, 10));
  }
  return out;
}

interface DailyRate {
  date: string;
  done: number;
  eligible: number;
  rate: number; // 0..1
}

function computeDailyRates(routines: RoutineListItem[], todayIso: string, days: number): DailyRate[] {
  const dates = lastNDays(todayIso, days);
  // Precompute a set of completion dates per routine for O(1) lookups.
  const completionSets = routines.map((r) => new Set(r.recent_completions));
  const createdOn = routines.map((r) => r.created_at.slice(0, 10));

  return dates.map((date) => {
    let done = 0;
    let eligible = 0;
    for (let i = 0; i < routines.length; i++) {
      // A routine is eligible on `date` only if it existed by then.
      // Skips inflating "missed" counts for routines you just added.
      if (createdOn[i]! > date) continue;
      eligible += 1;
      if (completionSets[i]!.has(date)) done += 1;
    }
    return { date, done, eligible, rate: eligible === 0 ? 0 : done / eligible };
  });
}

export function RoutinesAnalytics({ routines, today }: Props) {
  if (routines.length === 0) return null;

  const daily = computeDailyRates(routines, today, 30);
  // Overall 30-day rate — sum across eligible/done.
  const totals = daily.reduce(
    (acc, d) => ({ done: acc.done + d.done, eligible: acc.eligible + d.eligible }),
    { done: 0, eligible: 0 },
  );
  const overall30 = totals.eligible === 0 ? 0 : totals.done / totals.eligible;

  // Last 7 days for the secondary line.
  const last7 = daily.slice(-7);
  const totals7 = last7.reduce(
    (acc, d) => ({ done: acc.done + d.done, eligible: acc.eligible + d.eligible }),
    { done: 0, eligible: 0 },
  );
  const rate7 = totals7.eligible === 0 ? 0 : totals7.done / totals7.eligible;

  // Best current streak across all active routines.
  const bestStreak = routines.reduce(
    (best, r) => (r.stats.current_streak > best.streak
      ? { streak: r.stats.current_streak, name: r.name }
      : best),
    { streak: 0, name: '' },
  );

  return (
    <section className="px-5 lg:px-0 pt-3">
      <div className="flex flex-col md:flex-row md:items-end gap-4 md:gap-6 py-4 border-b border-line">
        {/* Big number: 30-day rate */}
        <div className="shrink-0">
          <div className="font-serif text-[40px] leading-none text-ink">
            {Math.round(overall30 * 100)}<span className="text-[24px] text-ink-3">%</span>
          </div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
            30-day rate · 7-day {Math.round(rate7 * 100)}%
          </div>
        </div>

        {/* Sparkline */}
        <div className="flex-1 min-w-0 hidden sm:block">
          <Sparkline daily={daily} />
          <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
            Last 30 days · daily completion rate
          </div>
        </div>

        {/* Honor roll */}
        {bestStreak.streak > 0 && (
          <div className="shrink-0 text-right md:text-left">
            <div className="font-serif text-[20px] text-ink leading-none">
              🔥 {bestStreak.streak}
              <span className="text-[14px] text-ink-3"> days</span>
            </div>
            <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-ink-3 truncate">
              {bestStreak.name}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// SVG sparkline. 30 points, viewBox-based so it scales with the parent
// width. Stroke uses the ink color; fill uses a faint ink wash below the
// line. A subtle baseline at y=0 helps anchor "0%" days visually.
function Sparkline({ daily }: { daily: DailyRate[] }) {
  if (daily.length === 0) return null;

  const W = 300; // logical viewbox width
  const H = 36;  // logical viewbox height
  const PAD = 2;
  const innerW = W - PAD * 2;
  const innerH = H - PAD * 2;

  const stepX = daily.length > 1 ? innerW / (daily.length - 1) : 0;
  const points = daily.map((d, i) => {
    const x = PAD + i * stepX;
    // Invert y so 100% is at the top.
    const y = PAD + innerH * (1 - d.rate);
    return { x, y };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  // Fill path: line + down-right + along-bottom + close.
  const fillPath =
    `${linePath} L${(PAD + innerW).toFixed(1)},${(PAD + innerH).toFixed(1)} L${PAD.toFixed(1)},${(PAD + innerH).toFixed(1)} Z`;

  const lastPoint = points[points.length - 1]!;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="w-full h-9"
      aria-label="Daily completion rate over the last 30 days"
    >
      {/* Faint baseline (0%) */}
      <line
        x1={PAD}
        x2={PAD + innerW}
        y1={PAD + innerH}
        y2={PAD + innerH}
        className="stroke-line"
        strokeWidth={0.5}
      />
      {/* Filled area */}
      <path d={fillPath} className="fill-ink/10" />
      {/* Line */}
      <path
        d={linePath}
        className="stroke-ink"
        strokeWidth={1.5}
        fill="none"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Today marker */}
      <circle
        cx={lastPoint.x}
        cy={lastPoint.y}
        r={2}
        className="fill-accent"
      />
    </svg>
  );
}
