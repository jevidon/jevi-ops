import { proceduralIllustration } from '@jevi-ops/shared';

// Engraved spot illustration for a domain.
//
// Renders the domain's stored illustration (LLM-composed, sanitized and
// persisted by the API — see apps/api/src/lib/illustration.ts) when one
// exists, otherwise the deterministic name-seeded procedural motif from
// @jevi-ops/shared. Both producers emit the same contract: inner-SVG
// element markup for a 240×100 canvas, stroke-only, with class="f" on
// faint secondary strokes (mapped to ink tones in globals.css).
//
// dangerouslySetInnerHTML is safe here by construction: stored markup
// only ever comes from the API's allowlist sanitizer (there is no client
// path that writes it), and the procedural markup is generated locally.
//
// tone="accent" re-inks the whole drawing rust for slipping domains —
// tones ride on currentColor, so the same stored art shifts with status.

export function DomainIllustration({
  name,
  svg,
  tone = 'ink',
  crop = false,
}: {
  name: string;
  svg?: string | null;
  tone?: 'ink' | 'accent';
  // The illustration contract keeps strokes inside y 20–80 of the 240×100
  // canvas (safe-crop padding for `slice`). crop trims to that drawn band
  // (with a whisker of margin) so tight placements — the Work section
  // headers — can bottom-align the ground line instead of the empty
  // canvas edge. Applies to committed art too: the composer prompt is
  // tuned against the same band.
  crop?: boolean;
}) {
  const inner = svg && svg.trim() ? svg : proceduralIllustration(name);
  return (
    <svg
      viewBox={crop ? '0 14 240 72' : '0 0 240 100'}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      className={`domain-ill h-full w-full ${
        tone === 'accent' ? 'domain-ill-accent text-accent-slip/80' : 'text-ink-3'
      }`}
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        dangerouslySetInnerHTML={{ __html: inner }}
      />
    </svg>
  );
}
