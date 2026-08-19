import { BriefLineRow } from '../../today/brief-line';
import { PanelFrame, PanelLink } from '../PanelFrame';
import type { BriefingContext } from '../registry';

// Needs a move — cadence slip cards. The one panel that renders an empty
// state instead of disappearing: "all domains within rhythm" is itself the
// news worth printing.

export function NeedsAMovePanel({ ctx }: { ctx: BriefingContext }) {
  const { briefing } = ctx;
  if (!briefing) return null;
  return (
    <PanelFrame
      eyebrow={<>Needs a move{briefing.brief_lines.length > 0 ? ` · ${briefing.brief_lines.length}` : ''}</>}
      action={<PanelLink href="/work">All work →</PanelLink>}
    >
      {briefing.brief_lines.length === 0 ? (
        <p className="font-serif text-[15px] text-ink-2 italic leading-relaxed">
          Nothing past cadence. Every domain is within its rhythm — rare and worth noticing.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {briefing.brief_lines.map((line) => <BriefLineRow key={line.id} line={line} />)}
        </div>
      )}
    </PanelFrame>
  );
}
