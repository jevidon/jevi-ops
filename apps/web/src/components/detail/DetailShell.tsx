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
  art,
  state,
  actions,
  below,
  titleClass = 'text-[40px]',
}: {
  crumb: React.ReactNode;
  name: string;
  color?: string | null;
  // Optional spot art (the domain engraving) hanging off the title, same as the
  // Work page's section headers. Desktop only — mobile keeps the band tight.
  art?: React.ReactNode;
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
          {art && (
            <span className="hidden lg:block h-[48px] max-w-[190px] shrink-0 self-end overflow-hidden opacity-80" aria-hidden>
              {art}
            </span>
          )}
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

// ─── Split stat band (Aug 2026) ──────────────────────────────────────────────
// The stat strip's sibling for pages whose description deserves the read
// surface: prose left, a compact right-aligned stat ledger in a NARROW right
// column (fixed 340px, so labels sit close to their values rather than
// stranded across a half-width row). Callers fall back to StatStrip when
// there's no description — the empty state is exactly the old strip.
export function SplitStatBand({
  label = 'About',
  text,
  children,
}: {
  label?: string;
  text: string;
  children: React.ReactNode; // LedgerRow list
}) {
  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] border-b border-line-strong bg-bg">
      <div className="px-5 lg:px-8 py-5">
        <div className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-ink-3 mb-2">{label}</div>
        <p className="font-sans text-[13.5px] text-ink-2 leading-relaxed max-w-[62ch] whitespace-pre-wrap">{text}</p>
      </div>
      <div className="border-t border-line lg:border-t-0 lg:border-l lg:border-line-strong px-5 py-2 self-center lg:self-stretch lg:flex lg:flex-col lg:justify-center">
        <div>{children}</div>
      </div>
    </div>
  );
}

// One ledger row: mono label · serif value · optional mono meta tail.
export function LedgerRow({
  k,
  v,
  meta,
  tone,
}: {
  k: string;
  v: React.ReactNode;
  meta?: React.ReactNode;
  tone?: 'accent' | 'warn';
}) {
  const toneCls = tone === 'accent' ? 'text-accent' : tone === 'warn' ? 'text-warn' : 'text-ink';
  return (
    <div className="flex items-baseline justify-between gap-4 py-[7px] border-b border-line last:border-b-0">
      <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-ink-3 shrink-0">{k}</span>
      <span className={`font-serif text-[15px] tabular-nums text-right min-w-0 ${toneCls}`}>
        {v}
        {meta && <span className="ml-1.5 font-mono text-[10px] tracking-normal text-ink-4">{meta}</span>}
      </span>
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
