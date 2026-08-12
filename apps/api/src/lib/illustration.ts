import { proceduralIllustration } from '@jevi-ops/shared';
import { chatComplete, isLlmConfigured } from './llm.js';
import type { DomainIllustration } from '../db/schema.js';

// LLM-composed engraved spot art for the Domains board.
//
// The configured model (local OpenAI-compatible or Anthropic — same
// chatComplete() surface the voice parser uses) is asked to draw a small
// pictorial illustration for a domain as raw SVG elements, under the
// locked style contract picked via the Aug 2026 sampler: standard
// density, recognizable objects, engraved newspaper line work. The
// output is then forced through a strict allowlist sanitizer — the model
// never gets to put anything on a page that this file didn't reserialize
// itself. On any failure (model unconfigured, unreachable, or output
// that won't validate after one retry) we fall back to the deterministic
// procedural motif from @jevi-ops/shared, so regeneration always
// succeeds; `source` tells the caller which path drew the picture.

const STYLE_SYSTEM = `You are an engraver drawing spot illustrations for a personal operations dashboard with a warm, editorial, newspaper-like design. You draw in thin ink strokes — the look of classic newspaper spot art or a fine pen engraving.

Canvas and composition:
- The canvas is 240 wide by 100 tall. Keep all meaningful geometry inside x 24–216, y 20–80 (edges may be cropped).
- Compose ONE recognizable pictorial subject for the given topic (an object or small scene), centered-ish, and give it real engraving texture — rich density, roughly 35 to 80 strokes total:
  · form shading: a band of parallel hatch strokes following the subject's shadowed side (short faint lines, slanted with the surface);
  · a cast shadow under the subject: two rows of short horizontal faint strokes pooling toward one side;
  · a ground line with a few grass/gravel ticks;
  · one or two quiet background hints (a shelf line, a distant silhouette, a second ridge, a cloud) — background stays faint and sparse, never busy;
  · one or two small props that belong to the scene.

Technical contract (strict):
- Output ONLY raw SVG element markup. No <svg> wrapper, no XML declaration, no code fences, no commentary.
- Allowed elements: line, path, polyline, polygon, circle, ellipse, rect, g.
- The renderer applies fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" to everything. Do not set colors. Main outlines stay at the default width (do not set stroke-width on them); fine shading/hatch strokes may set stroke-width="0.6" (allowed range 0.5–1.5).
- Two tones only: primary strokes are plain elements; secondary/shading strokes get class="f" (faint). Use faint for hatching, shadows, ground lines, and background; keep the subject's outline primary.
- fill is forbidden except fill="#FBF8F2" on a small shape that must knock out lines passing behind it, or fill="none".
- stroke-dasharray like "3 4" is allowed for dotted routes or guide lines.
- No text, no defs, no style, no script, no images, no transforms, no ids, no comments. Attribute values are plain numbers (or path/points data).

Example fragment of valid output (topic "sailing" — subject outline, then hatch shading, shadow, ground, background hint):
<path d="M 96 70 H 150 L 142 78 H 104 Z"/><line x1="122" y1="70" x2="122" y2="26"/><path d="M 122 28 Q 152 44 124 66"/><path class="f" d="M 122 32 L 100 66 H 120"/><line class="f" stroke-width="0.6" x1="128" y1="34" x2="126" y2="44"/><line class="f" stroke-width="0.6" x1="133" y1="38" x2="131" y2="48"/><line class="f" stroke-width="0.6" x1="138" y1="43" x2="136" y2="53"/><line class="f" stroke-width="0.6" x1="98" y1="81" x2="118" y2="81"/><line class="f" stroke-width="0.6" x1="124" y1="81" x2="146" y2="81"/><line class="f" stroke-width="0.6" x1="104" y1="83" x2="138" y2="83"/><line class="f" x1="60" y1="78" x2="186" y2="78"/><path class="f" d="M 52 34 q 4 -5 9 -2 q 5 -4 9 1"/><path class="f" stroke-width="0.6" d="M 178 30 q 3 -4 7 -1 q 4 -3 7 1"/>`;

function userPrompt(d: { name: string; description: string | null }): string {
  return [
    `Topic: ${d.name}`,
    d.description ? `Context: ${d.description}` : null,
    `Draw the spot illustration now. Raw SVG elements only.`,
  ].filter(Boolean).join('\n');
}

// ─── Sanitizer ───────────────────────────────────────────────────────────
// Tokenizes the markup and reserializes it from parsed parts; anything
// not explicitly allowlisted is a rejection (null), not a strip — a
// model that colors outside the lines gets redrawn, not patched up.

const ALLOWED_TAGS = new Set(['g', 'line', 'path', 'polyline', 'polygon', 'circle', 'ellipse', 'rect']);

const NUM = /^-?\d+(\.\d+)?$/;
const ATTR_RULES: Record<string, RegExp> = {
  x: NUM, y: NUM, x1: NUM, y1: NUM, x2: NUM, y2: NUM,
  cx: NUM, cy: NUM, r: NUM, rx: NUM, ry: NUM, width: NUM, height: NUM,
  points: /^[-\d.,\s]+$/,
  d: /^[MmLlHhVvQqCcSsTtAaZz\s\d.,+-]+$/,
  'stroke-dasharray': /^[\d.\s,]+$/,
  // Fine shading strokes (Rich contract): 0.5–1.5. Regex admits 0–2 and
  // the numeric bound below keeps values sane; the prompt pins the range.
  'stroke-width': /^[0-2](\.\d+)?$/,
  class: /^f$/,
  fill: /^(none|#FBF8F2)$/,
};

// Rich tier (density study, Aug 2026): ~35–80 strokes expected; cap well
// above so a slightly-over model drawing isn't wasted.
const MAX_ELEMENTS = 120;
const MIN_ELEMENTS = 3;
// Generous bounds around the 240×100 canvas — reject runaway geometry.
const COORD_MIN = -60;
const COORD_MAX = 320;

const TAG_RE = /^<(\/?)([a-zA-Z]+)((?:\s+[a-zA-Z][a-zA-Z0-9-]*="[^"<>]*")*)\s*(\/?)>$/;
const ATTR_RE = /([a-zA-Z][a-zA-Z0-9-]*)="([^"]*)"/g;

function numbersInBounds(value: string): boolean {
  const nums = value.match(/-?\d+(\.\d+)?/g) ?? [];
  return nums.every((raw) => {
    const v = Number(raw);
    return Number.isFinite(v) && v >= COORD_MIN && v <= COORD_MAX;
  });
}

/**
 * Validate + normalize inner-SVG markup against the engraved contract.
 * Returns the reserialized markup, or null if anything is off-contract.
 */
export function sanitizeIllustration(raw: string): string | null {
  const src = raw.trim();
  if (!src) return null;

  const out: string[] = [];
  const stack: string[] = [];
  let elementCount = 0;
  let i = 0;

  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) { i++; continue; }
    // Any non-whitespace text content (or a comment/CDATA/entity) is
    // off-contract — only elements are allowed.
    if (ch !== '<') return null;
    const close = src.indexOf('>', i);
    if (close === -1) return null;
    const tagSrc = src.slice(i, close + 1);
    i = close + 1;

    const m = TAG_RE.exec(tagSrc);
    if (!m) return null;
    const [, closing, name, attrSrc, selfClosing] = m;
    const tag = name!.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return null;

    if (closing) {
      if (attrSrc || selfClosing) return null;
      if (stack.pop() !== tag) return null;
      out.push(`</${tag}>`);
      continue;
    }

    const attrs: string[] = [];
    let am: RegExpExecArray | null;
    ATTR_RE.lastIndex = 0;
    while ((am = ATTR_RE.exec(attrSrc ?? '')) !== null) {
      const attrName = am[1]!.toLowerCase();
      const attrValue = am[2]!;
      const rule = ATTR_RULES[attrName];
      if (!rule || !rule.test(attrValue)) return null;
      if (attrName !== 'class' && attrName !== 'fill' && !numbersInBounds(attrValue)) return null;
      attrs.push(`${attrName}="${attrValue}"`);
    }

    const serialized = `<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}`;
    if (tag !== 'g') elementCount++;
    if (elementCount > MAX_ELEMENTS) return null;

    if (selfClosing) {
      out.push(`${serialized}/>`);
    } else if (tag === 'g') {
      // Only groups may stay open and contain children.
      stack.push(tag);
      out.push(`${serialized}>`);
    } else {
      // A non-self-closed shape must close immediately (no children).
      const closeTag = `</${tag}>`;
      let k = i;
      while (k < src.length && /\s/.test(src[k]!)) k++;
      if (src.slice(k, k + closeTag.length).toLowerCase() !== closeTag) return null;
      i = k + closeTag.length;
      out.push(`${serialized}/>`);
    }
  }

  if (stack.length > 0) return null;
  if (elementCount < MIN_ELEMENTS) return null;
  return out.join('');
}

/** Pull element markup out of a model reply that may include fences or an <svg> wrapper. */
function extractMarkup(text: string): string | null {
  let s = text.trim();
  const fence = /```(?:svg|xml|html)?\s*([\s\S]*?)```/.exec(s);
  if (fence) s = fence[1]!.trim();
  const svgOpen = s.search(/<svg\b[^>]*>/i);
  if (svgOpen !== -1) {
    const openEnd = s.indexOf('>', svgOpen);
    const svgClose = s.lastIndexOf('</svg>');
    if (openEnd === -1 || svgClose === -1 || svgClose < openEnd) return null;
    s = s.slice(openEnd + 1, svgClose).trim();
  } else {
    // Trim any prose before the first tag / after the last one.
    const first = s.indexOf('<');
    const last = s.lastIndexOf('>');
    if (first === -1 || last === -1 || last < first) return null;
    s = s.slice(first, last + 1);
  }
  return s || null;
}

/**
 * Compose an illustration for a domain. Tries the configured LLM (one
 * retry on invalid output), falls back to the procedural motif. Always
 * returns a drawing.
 */
export async function composeDomainIllustration(d: {
  name: string;
  description: string | null;
}): Promise<Pick<DomainIllustration, 'svg' | 'source'>> {
  if (await isLlmConfigured()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await chatComplete({
          system: STYLE_SYSTEM,
          messages: [{ role: 'user', content: userPrompt(d) }],
          maxTokens: 4000,
          effort: 'low',
        });
        const markup = extractMarkup(res.text);
        const svg = markup ? sanitizeIllustration(markup) : null;
        if (svg) return { svg, source: 'llm' };
      } catch {
        // Unreachable model / provider error — no point retrying the
        // same failure mode twice; fall through to the fallback.
        break;
      }
    }
  }
  return { svg: proceduralIllustration(d.name, randomSeed()), source: 'procedural' };
}

// Procedural fallback seeds are random (not name-derived) on explicit
// regeneration so "Redraw" visibly re-rolls even without a model. The
// implicit fallback on the board (no stored illustration at all) stays
// name-seeded inside the web component — stable until first generation.
function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff);
}
