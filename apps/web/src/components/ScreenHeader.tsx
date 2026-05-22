// Reused across all six tabs. Eyebrow + display-serif title + optional meta.
// Mirrors the mockup's editorial pattern: small mono eyebrow over Newsreader.

export function ScreenHeader({
  eyebrow,
  title,
  meta,
}: {
  eyebrow: string;
  title: string;
  meta?: string;
}) {
  return (
    <header className="px-5 pt-8 pb-5">
      <div className="eyebrow mb-2">{eyebrow}</div>
      <h1 className="font-serif text-[28px] leading-[1.08] font-medium tracking-[-0.01em] text-ink">
        {title}
      </h1>
      {meta && <div className="mt-2 font-mono text-meta text-ink-3">{meta}</div>}
    </header>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-5 pt-6 pb-2 eyebrow border-b border-line mx-5 -mx-5">{children}</div>
  );
}
