'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { proceduralIllustration } from '@jevi-ops/shared';

// Header art, fitted to its ink. Motifs frame themselves differently inside
// the 240×100 canvas (strokes typically live in y 20–80, x varies per
// drawing), so a fixed viewBox leaves arbitrary dead margins — the art
// looked detached from the title. This measures the rendered strokes
// (getBBox) and tightens the viewBox to the actual drawing, so every
// motif — procedural or committed — hugs the title and rests on the rule.
// First paint uses the contract band (0 14 240 72); the fit lands before
// the browser paints (useLayoutEffect), and the box has a fixed height so
// nothing shifts.
//
// Two inkings: `tone` (ink, or accent for a slipping domain) is the detail
// page's; `color` inks the drawing in the domain's identity colour — primary
// strokes full, faint strokes at half (globals.css .domain-ill-tinted) — as
// the Work board does, where the drawing replaced the colour chip. `fit` is
// the preserveAspectRatio: the default hangs the art off a title and rests
// it on a rule; the board centres it in a fixed slot, anchored right.
export function FittedArt({ name, svg, tone = 'ink', color, fit = 'xMinYMax meet' }: {
  name: string;
  svg?: string | null;
  tone?: 'ink' | 'accent';
  color?: string;
  fit?: string;
}) {
  const gRef = useRef<SVGGElement>(null);
  const [viewBox, setViewBox] = useState('0 14 240 72');
  const inner = svg && svg.trim() ? svg : proceduralIllustration(name);

  useLayoutEffect(() => {
    const g = gRef.current;
    if (!g) return;
    try {
      const b = g.getBBox();
      if (b.width > 4 && b.height > 4) {
        const pad = 2.5;
        setViewBox(`${b.x - pad} ${b.y - pad} ${b.width + pad * 2} ${b.height + pad * 2}`);
      }
    } catch {
      /* detached/unsupported — keep the contract band */
    }
  }, [inner]);

  return (
    <svg
      viewBox={viewBox}
      preserveAspectRatio={fit}
      aria-hidden="true"
      className={`domain-ill h-full w-auto max-w-full ${
        color ? 'domain-ill-tinted' : tone === 'accent' ? 'domain-ill-accent text-accent-slip/80' : 'text-ink-3'
      }`}
      style={color ? { color } : undefined}
    >
      <g
        ref={gRef}
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        dangerouslySetInnerHTML={{ __html: inner }}
      />
    </svg>
  );
}
