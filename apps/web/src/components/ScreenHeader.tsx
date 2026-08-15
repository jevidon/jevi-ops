// Reused across all six tabs. Eyebrow + display-serif title + optional meta.
// Mirrors the mockup's editorial pattern: small mono eyebrow over Newsreader.
// On desktop the title scales up and the meta sits inline to the right.

export function ScreenHeader({
  eyebrow,
  title,
  meta,
}: {
  // ReactNode, not string — fork pages (e.g. the maintenance subview's
  // linked eyebrow) pass JSX here. Do not narrow back to string.
  eyebrow: React.ReactNode;
  title: React.ReactNode;
  meta?: string;
}) {
  return (
    <header className="px-5 pt-8 pb-5 lg:px-0 lg:pt-10 lg:pb-6">
      <div className="lg:flex lg:items-end lg:justify-between lg:gap-6">
        <div>
          <div className="eyebrow mb-2">{eyebrow}</div>
          <h1 className="font-serif text-[28px] lg:text-[40px] leading-[1.05] font-medium tracking-[-0.015em] text-ink">
            {title}
          </h1>
        </div>
        {meta && (
          <div className="mt-2 lg:mt-0 font-mono text-meta text-ink-3 lg:pb-1">
            {meta}
          </div>
        )}
      </div>
    </header>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-5 pt-6 pb-2 eyebrow border-b border-line mx-5 -mx-5">{children}</div>
  );
}
