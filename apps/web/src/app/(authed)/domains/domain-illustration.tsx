import { useId } from 'react';
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

// Banner variant for the Work page's domain sections: the same 240×100
// motif tiled horizontally as an engraved frieze (134×56 tiles — the
// motif at natural aspect), filling whatever width the section has.
// Same tone contract as DomainIllustration; the caller owns the fade-out
// mask and opacity.
export function DomainFrieze({
  name,
  svg,
  tone = 'ink',
}: {
  name: string;
  svg?: string | null;
  tone?: 'ink' | 'accent';
}) {
  const pid = useId();
  const inner = svg && svg.trim() ? svg : proceduralIllustration(name);
  return (
    <svg
      aria-hidden="true"
      className={`domain-ill h-full w-full ${
        tone === 'accent' ? 'domain-ill-accent text-accent-slip/80' : 'text-ink-3'
      }`}
    >
      <defs>
        <pattern id={pid} patternUnits="userSpaceOnUse" width="134" height="56" viewBox="0 0 240 100">
          <g
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinecap="round"
            dangerouslySetInnerHTML={{ __html: inner }}
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${pid})`} />
    </svg>
  );
}

export function DomainIllustration({
  name,
  svg,
  tone = 'ink',
}: {
  name: string;
  svg?: string | null;
  tone?: 'ink' | 'accent';
}) {
  const inner = svg && svg.trim() ? svg : proceduralIllustration(name);
  return (
    <svg
      viewBox="0 0 240 100"
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
