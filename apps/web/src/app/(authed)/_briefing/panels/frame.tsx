import { FrameImage } from './frame-image';
import type { BriefingContext } from '../registry';

// Frame — the Agenda's hero image (Agenda layout v2): a rotating feed from
// the tailnet (Settings → Agenda sets the URL; null hides the panel).
// Deliberately chrome-free — no eyebrow, no action link — the picture IS
// the panel; a hairline border is all the framing it gets.

export function FramePanel({ ctx }: { ctx: BriefingContext }) {
  if (!ctx.agendaImageUrl) return null;
  return (
    <section className="px-5 lg:px-0">
      <FrameImage src={ctx.agendaImageUrl} />
    </section>
  );
}
