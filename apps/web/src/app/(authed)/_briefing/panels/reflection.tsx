import Link from 'next/link';
import { skipResurfacingAction, resetResurfacingAction } from '../../today/actions';
import type { BriefingContext } from '../registry';

// Reflection — the daily resurfaced quote/journal pull-quote. Bespoke boxed
// chrome (surface fill, border-y), so it renders its own <section> rather
// than the PanelFrame shell.

export function ReflectionPanel({ ctx }: { ctx: BriefingContext }) {
  const { resurface, resurfaceExhausted, resurfacingSkipCount } = ctx;
  if (!resurface && !resurfaceExhausted) return null;
  return (
    <section className="mx-5 lg:mx-0 bg-surface border-y border-line py-6 px-5">
      <div className="eyebrow mb-3">Reflection</div>
      {resurface ? (
        <>
          <blockquote className="font-serif text-[19px] italic leading-snug text-ink">
            &ldquo;{resurface.excerpt}&rdquo;
          </blockquote>
          {resurface.source && (
            <div className="mt-3 font-mono text-[11px] uppercase tracking-wider text-ink-3">— {resurface.source}</div>
          )}
          <div className="mt-3 flex items-center gap-4 flex-wrap">
            {resurface.href && (
              <Link href={resurface.href} className="font-mono text-[10px] uppercase tracking-wider text-accent hover:text-accent-ink transition-colors">
                Open in {resurface.kind === 'quote' ? 'Quotes' : 'Journal'} →
              </Link>
            )}
            <form action={skipResurfacingAction}>
              <input type="hidden" name="id" value={resurface.id} />
              <button type="submit" className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors">
                Next →
              </button>
            </form>
            {resurfacingSkipCount > 0 && (
              <form action={resetResurfacingAction}>
                <button type="submit" className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors" title={`${resurfacingSkipCount} skipped today`}>
                  Reset
                </button>
              </form>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="font-serif text-[17px] italic text-ink-2 leading-snug">
            You&rsquo;ve seen every item in today&rsquo;s rotation. Tomorrow&rsquo;s pick will come from the same pool, fresh.
          </p>
          <form action={resetResurfacingAction} className="mt-3">
            <button type="submit" className="font-mono text-[10px] uppercase tracking-wider text-accent hover:text-accent-ink transition-colors">
              Reset rotation now →
            </button>
          </form>
        </>
      )}
    </section>
  );
}
