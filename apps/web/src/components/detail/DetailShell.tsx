import Link from 'next/link';

// Shared detail-page shell (Detail Pages v2, Addendum 10 §5). The anatomy every
// operational detail page (Project · Content · Company · Person) inherits:
// header band → stat strip → two-column read layout. Pure presentational,
// server-renderable. Configuration lives behind the Edit drawer (a separate
// client island); this file is the read surface.

// ─── Header band ─────────────────────────────────────────────────────────────
// Breadcrumb-lite · the item name (with an optional colour dot) · a state chip
// in the Work vocabulary · the page's action buttons at the right.
export function DetailHeader({
  crumb,
  name,
  color,
  state,
  actions,
  below,
  titleClass = 'text-[40px]',
}: {
  crumb: React.ReactNode;
  name: string;
  color?: string | null;
  state?: React.ReactNode;
  actions?: React.ReactNode;
  below?: React.ReactNode; // e.g. the content pipeline, inside the header band
  titleClass?: string;
}) {
  return (
    <div className="bg-surface border-b border-line-strong px-5 lg:px-8 pt-6 pb-5">
      <div className="font-mono text-[10px] uppercase tracking-[0.11em] text-ink-3 flex items-center gap-2 flex-wrap">
        {crumb}
      </div>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <h1 className={`font-serif ${titleClass} font-medium leading-[1.0] tracking-[-0.022em] text-ink flex items-center gap-3 flex-wrap min-w-0`}>
          {color && <span className="h-3 w-3 rounded-full shrink-0" style={{ background: color }} aria-hidden />}
          <span className="min-w-0">{name}</span>
          {state}
        </h1>
        {actions && <div className="flex items-center gap-2 flex-wrap pb-1">{actions}</div>}
      </div>
      {below}
    </div>
  );
}

// A crumb separator dot.
export function CrumbDot() {
  return <span className="text-ink-4" aria-hidden>·</span>;
}

// ─── Action buttons ──────────────────────────────────────────────────────────
// ghost = capture · solid = Edit · accent = the computed my-move verb (content).
const BTN: Record<'ghost' | 'solid' | 'accent', string> = {
  ghost: 'border-line-strong bg-bg text-ink-2 hover:border-ink-3 hover:text-ink',
  solid: 'bg-ink border-ink text-bg hover:bg-ink-2',
  accent: 'bg-accent border-accent text-bg hover:bg-accent-ink',
};

export function ActionButton({
  href,
  variant = 'ghost',
  children,
}: {
  href: string;
  variant?: 'ghost' | 'solid' | 'accent';
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1.5 h-[34px] px-3 rounded border font-mono text-[10px] font-semibold uppercase tracking-[0.07em] transition-colors shrink-0 ${BTN[variant]}`}
    >
      {children}
    </Link>
  );
}

// ─── Stat strip ──────────────────────────────────────────────────────────────
// A computed row of tiles; every tile can turn accent (label + value + sub) when
// its number becomes a problem. `tone` drives that: 'accent' | 'warn' | undefined.
export function StatStrip({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 border-b border-line-strong bg-bg">
      {children}
    </div>
  );
}

export function Stat({
  label,
  value,
  unit,
  sub,
  tone,
  badge,
  children,
}: {
  label: string;
  value?: React.ReactNode;
  unit?: string;
  sub?: React.ReactNode;
  tone?: 'accent' | 'warn';
  badge?: React.ReactNode;
  children?: React.ReactNode; // custom value body (e.g. the work-count cluster)
}) {
  const toneCls = tone === 'accent' ? 'text-accent' : tone === 'warn' ? 'text-warn' : '';
  return (
    <div className="px-5 py-4 border-r border-b border-line md:border-b-0 [&:nth-child(2n)]:border-r-0 md:[&:nth-child(2n)]:border-r md:[&:last-child]:border-r-0 min-w-0">
      <div className={`font-mono text-[9.5px] uppercase tracking-[0.1em] mb-2 flex items-center gap-2 ${toneCls || 'text-ink-3'}`}>
        {label}
        {badge}
      </div>
      {children ?? (
        <div className={`font-serif text-[27px] leading-none tracking-[-0.01em] flex items-baseline gap-1.5 ${toneCls || 'text-ink'}`}>
          <span className="tabular-nums">{value}</span>
          {unit && <span className="font-sans text-[13px] font-normal text-ink-3">{unit}</span>}
        </div>
      )}
      {sub && <div className={`mt-1.5 font-mono text-[10px] tracking-[0.02em] ${tone ? toneCls : 'text-ink-4'}`}>{sub}</div>}
    </div>
  );
}

// The multi-count "Work" tile body (N open · N overdue · N waiting).
export function WorkCounts({ open, overdue, waiting }: { open: number; overdue: number; waiting: number }) {
  return (
    <div className="flex items-baseline gap-2.5">
      <Count n={open} label="open" />
      <Count n={overdue} label="overdue" accent={overdue > 0} />
      <Count n={waiting} label="waiting" accent={waiting > 0} />
    </div>
  );
}
function Count({ n, label, accent }: { n: number; label: string; accent?: boolean }) {
  return (
    <span className="flex items-baseline gap-1">
      <b className={`font-serif text-[27px] leading-none font-medium tabular-nums ${accent ? 'text-accent' : n === 0 ? 'text-ink-4' : 'text-ink'}`}>{n}</b>
      <span className="font-mono text-[9px] uppercase tracking-[0.07em] text-ink-4">{label}</span>
    </span>
  );
}

// ─── Two-column read layout ──────────────────────────────────────────────────
// Main (living material) + a 320px rail (stable material). Rail stacks below on
// mobile. Pass the columns as slots.
export function DetailBody({ main, rail }: { main: React.ReactNode; rail: React.ReactNode }) {
  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
      <div className="min-w-0 px-5 lg:px-8 pt-6 pb-24">{main}</div>
      <div className="px-5 lg:px-6 pt-6 pb-24 border-t border-line lg:border-t-0 lg:border-l lg:border-line bg-surface lg:min-h-[400px]">{rail}</div>
    </div>
  );
}

// A section with an eyebrow header + optional right-side action/link.
export function DetailSection({
  label,
  count,
  action,
  children,
  className = '',
}: {
  label: string;
  count?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`mt-8 first:mt-0 ${className}`}>
      <div className="flex items-baseline justify-between gap-3 pb-2 mb-3 border-b border-line">
        <div className="flex items-baseline gap-2.5">
          <span className="eyebrow">{label}</span>
          {count != null && <span className="font-mono text-[10px] text-ink-4">{count}</span>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

// A quiet rail block (eyebrow + content), for the stable-material column.
export function RailBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-6 first:mt-0">
      <div className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-ink-3 pb-2 border-b border-line mb-3">
        {label}
      </div>
      {children}
    </div>
  );
}
