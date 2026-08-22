import Link from 'next/link';

// The shared shell for Briefing panels — extracts the section-header pattern
// the page previously hand-rolled per section: an eyebrow row with an
// optional right-side action, then content. Panels with bespoke chrome
// (Reflection's surface box, Latest quote's bordered card) render their own
// <section> instead; what matters for layout is that every panel's root is a
// <section> (or null), because the column containers space panels with a
// `section + section` sibling selector — a panel that renders null leaves no
// node and no stray gap.

export function PanelLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
    >
      {children}
    </Link>
  );
}

export function PanelFrame({
  eyebrow,
  action,
  headerGap = 'mb-3',
  children,
}: {
  eyebrow: React.ReactNode;
  action?: React.ReactNode;
  // Tailwind margin class between header and content (per-panel rhythm).
  headerGap?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="px-5 lg:px-0">
      <div className={`flex items-baseline justify-between ${headerGap}`}>
        <div className="eyebrow">{eyebrow}</div>
        {action}
      </div>
      {children}
    </section>
  );
}
