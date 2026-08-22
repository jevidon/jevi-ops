import Link from 'next/link';
import type { BriefingContext } from '../registry';

// Latest quote — the single newest quote in the library. Suppressed when
// it's the same item Reflection is already showing. Bespoke bordered-card
// chrome, so it renders its own <section>.

export function LatestQuotePanel({ ctx }: { ctx: BriefingContext }) {
  const quote = ctx.briefing?.latest_quote;
  if (!quote || quote.id === ctx.resurface?.id) return null;
  return (
    <section className="mx-5 lg:mx-0 border border-line py-5 px-5">
      <div className="eyebrow mb-3">Latest quote</div>
      <blockquote className="font-serif text-[17px] italic leading-snug text-ink">
        &ldquo;{quote.text}&rdquo;
      </blockquote>
      {(quote.source_author || quote.source_reference) && (
        <div className="mt-3 font-mono text-[11px] uppercase tracking-wider text-ink-3">
          — {[quote.source_author, quote.source_reference].filter(Boolean).join(' · ')}
        </div>
      )}
      <div className="mt-3 flex items-center gap-4 flex-wrap">
        <Link href={quote.href} className="font-mono text-[10px] uppercase tracking-wider text-accent hover:text-accent-ink transition-colors">
          Open quote →
        </Link>
        {quote.source_url && (
          <a href={quote.source_url} target="_blank" rel="noopener noreferrer" className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors">
            Open source ↗
          </a>
        )}
      </div>
    </section>
  );
}
