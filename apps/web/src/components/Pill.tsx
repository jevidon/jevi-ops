import { type Urgency, URGENCY_LABEL } from '@jerad-ops/shared';

// v2 status pill (design handoff, Jul 2026). The one place the palette leaves
// monochrome: four urgency states, each a colour + soft fill + border, plus two
// non-status variants (solid = accent CTA, plain = neutral chip). A leading dot
// echoes the state colour. Pure presentational — a server component by default.
//
// Tokens (tailwind.config.ts): accent/warn/good with -soft (fill) and -line
// (border); quiet uses ink-3 on a line-strong outline.

type PillVariant = Urgency | 'solid' | 'plain';

const VARIANT: Record<PillVariant, string> = {
  over: 'text-accent bg-accent-soft border-accent-line',
  due: 'text-warn bg-warn-soft border-warn-line',
  ok: 'text-good bg-good-soft border-good-line',
  quiet: 'text-ink-3 bg-transparent border-line-strong',
  solid: 'text-bg bg-accent border-accent',
  plain: 'text-ink-2 bg-surface-2 border-transparent',
};

export function Pill({
  state,
  children,
  dot = true,
  className = '',
}: {
  state: PillVariant;
  children?: React.ReactNode;
  // The leading state dot. On by default for the four urgency states; usually
  // off for solid/plain label chips.
  dot?: boolean;
  className?: string;
}) {
  // Default label for the four urgency states; solid/plain must supply children.
  const label = children ?? (state in URGENCY_LABEL ? URGENCY_LABEL[state as Urgency] : null);
  return (
    <span
      className={`inline-flex items-center gap-[5px] h-5 px-2 rounded-full border font-mono text-[9.5px] font-semibold leading-none tracking-[0.07em] uppercase whitespace-nowrap ${VARIANT[state]} ${className}`}
    >
      {dot && <span className="w-[5px] h-[5px] rounded-full bg-current shrink-0" aria-hidden />}
      {label}
    </span>
  );
}
