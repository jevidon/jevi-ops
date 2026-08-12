// Engraved spot-art illustrations for the Domains board.
//
// Two producers share one contract (picked via the Aug 2026 style sampler:
// standard density, pictorial motifs, rust tint applied at render time):
//
//   1. The LLM composer (apps/api/src/lib/illustration.ts) asks the
//      configured model to draw within this contract and sanitizes the
//      result. That's the primary path — persisted on the domain row.
//   2. This procedural library — the fallback when no illustration is
//      stored yet or a model render fails validation, and the visual
//      baseline the composer's prompt is tuned against.
//
// The contract: a 240×100 canvas (meaningful geometry inside x 24–216,
// y 20–80 so `slice` scaling can crop safely), stroke-only line work
// rendered by a wrapper that applies fill="none" stroke="currentColor"
// stroke-width="1". Two tones: primary strokes inherit the wrapper color;
// secondary strokes carry class="f" (mapped to the faint ink by CSS).
// Small shapes may knock out lines beneath them with fill="#FBF8F2"
// (the surface token). No text, no defs, no styles.
//
// Everything here is deterministic: geometry is jittered by a PRNG seeded
// from the domain name, so a domain's fallback drawing is stable across
// renders (no hydration drift) and changes only if the domain is renamed.

export interface DomainIllustration {
  /** Sanitized inner-SVG markup (elements only; no <svg> wrapper). */
  svg: string;
  style: 'engraved';
  source: 'llm' | 'procedural';
  generated_at: string;
}

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;
/** Jitter value v by ±amt/2. */
const j = (rng: Rng, v: number, amt: number) => v + (rng() - 0.5) * amt;
/** Round for tidy markup. */
const n = (v: number) => Math.round(v * 100) / 100;

// Knockout fill — matches the `surface` design token the cards sit on.
const KNOCKOUT = '#FBF8F2';

// Element helpers. `f` = faint (secondary tone).
const ln = (x1: number, y1: number, x2: number, y2: number, f = false) =>
  `<line${f ? ' class="f"' : ''} x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}"/>`;
const circ = (cx: number, cy: number, r: number, opts: { f?: boolean; knockout?: boolean } = {}) =>
  `<circle${opts.f ? ' class="f"' : ''} cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}"${opts.knockout ? ` fill="${KNOCKOUT}"` : ''}/>`;
const ell = (cx: number, cy: number, rx: number, ry: number, f = false) =>
  `<ellipse${f ? ' class="f"' : ''} cx="${n(cx)}" cy="${n(cy)}" rx="${n(rx)}" ry="${n(ry)}"/>`;
const path = (d: string, opts: { f?: boolean; dash?: string } = {}) =>
  `<path${opts.f ? ' class="f"' : ''}${opts.dash ? ` stroke-dasharray="${opts.dash}"` : ''} d="${d}"/>`;
const poly = (pts: Array<[number, number]>, f = false) =>
  `<polyline${f ? ' class="f"' : ''} points="${pts.map(([x, y]) => `${n(x)},${n(y)}`).join(' ')}"/>`;
const rect = (x: number, y: number, w: number, h: number, f = false) =>
  `<rect${f ? ' class="f"' : ''} x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"/>`;

type Motif =
  | 'beacon' | 'roofline' | 'ledger' | 'network' | 'orbits' | 'strata'
  | 'mesh' | 'wheel' | 'pot' | 'pulse' | 'rack' | 'travel' | 'field';

const KEYWORDS: Array<[Motif, RegExp]> = [
  ['beacon', /emergen|prepar|safety|alert/],
  ['ledger', /financ|tax|money|budget|invoic|account/],
  ['mesh', /network|router|wifi|internet/],
  ['rack', /\bai\b|artificial|infrastruct|comput|machine|model|automat/],
  ['roofline', /home|property|house|estate|garden/],
  ['orbits', /famil|kid|child|parent|people/],
  ['strata', /personal|operating|system|\bos\b|admin|life/],
  ['wheel', /vehicle|car\b|auto|motor|bike/],
  ['pot', /cook|food|kitchen|recipe|meal|nutrition/],
  ['pulse', /fitness|health|gym|run|sport|body/],
  ['travel', /travel|trip|experienc|adventure|holiday/],
  ['network', /consult|client|business|work|career/],
];

export function pickMotif(name: string): Motif {
  const lower = name.toLowerCase();
  for (const [motif, re] of KEYWORDS) {
    if (re.test(lower)) return motif;
  }
  return 'field';
}

// ─── Motifs ──────────────────────────────────────────────────────────────

const MOTIFS: Record<Motif, (rng: Rng) => string> = {
  // Radio mast with radiating arcs — the emergency beacon.
  beacon(rng) {
    const cx = j(rng, 120, 30);
    const base = 78;
    const top = j(rng, 30, 6);
    const arcs = 3 + Math.floor(rng() * 2);
    const out: string[] = [
      ln(cx, base, cx, top),
      ln(cx - 14, base, cx, base - 22, true),
      ln(cx + 14, base, cx, base - 22, true),
      ln(cx - 60, base, cx + 60, base, true),
      circ(cx, top, 2),
    ];
    for (let i = 0; i < arcs; i++) {
      const r = 10 + i * 9;
      out.push(path(`M ${n(cx - r)} ${n(top)} A ${r} ${r} 0 0 1 ${n(cx + r)} ${n(top)}`, { f: i > 0 }));
    }
    return out.join('');
  },

  // Gable, chimney, ground line, and a low hedge of hatch marks.
  roofline(rng) {
    const cx = j(rng, 118, 24);
    const w = j(rng, 34, 8);
    const ridge = j(rng, 32, 5);
    const eave = ridge + 18;
    const ground = 76;
    const out: string[] = [
      ln(cx - 78, ground, cx + 78, ground, true),
      poly([[cx - w, eave], [cx, ridge], [cx + w, eave]]),
      ln(cx - w + 6, eave - 3, cx - w + 6, ground),
      ln(cx + w - 6, eave - 3, cx + w - 6, ground),
      rect(cx - 5, eave + 8, 10, ground - eave - 8, true),
      ln(cx + w * 0.45, ridge + 7, cx + w * 0.45, ridge - 2),
    ];
    for (let i = 0; i < 7; i++) {
      const x = cx + w + 14 + i * 7 + j(rng, 0, 3);
      out.push(ln(x, ground, x + 3, ground - 7, true));
    }
    return out.join('');
  },

  // Ruled columns with stacked coin ellipses — the ledger.
  ledger(rng) {
    const base = 76;
    const cols = 4 + Math.floor(rng() * 2);
    const start = 120 - (cols * 26) / 2;
    const out: string[] = [
      ln(start - 16, base, start + cols * 26 + 8, base, true),
      ln(start - 16, 26, start + cols * 26 + 8, 26, true),
    ];
    for (let c = 0; c < cols; c++) {
      const x = start + c * 26 + 8;
      const coins = 2 + Math.floor(rng() * 5);
      for (let i = 0; i < coins; i++) {
        out.push(ell(x, base - 4 - i * 7, 9, 3, i % 2 === 1));
      }
    }
    return out.join('');
  },

  // Scattered nodes joined by straight edges — the working network.
  network(rng) {
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < 6; i++) {
      pts.push([40 + i * 32 + j(rng, 0, 18), j(rng, 50, 40)]);
    }
    const out: string[] = [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      out.push(ln(a[0], a[1], b[0], b[1], true));
    }
    const a = pts[0]!;
    const b = pts[2]!;
    out.push(ln(a[0], a[1], b[0], b[1], true));
    pts.forEach((p, i) => out.push(circ(p[0], p[1], i === 2 ? 5 : 3, { knockout: true })));
    return out.join('');
  },

  // Concentric orbits with small bodies — the family constellation.
  orbits(rng) {
    const cx = j(rng, 120, 20);
    const cy = 50;
    const out: string[] = [circ(cx, cy, 3)];
    for (let i = 0; i < 3; i++) {
      const rx = 22 + i * 16;
      const ry = rx * 0.42;
      const a = rng() * Math.PI * 2;
      out.push(ell(cx, cy, rx, ry, true));
      out.push(circ(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, 2.5));
    }
    return out.join('');
  },

  // Stacked sediment lines — the layers a personal system sits on.
  strata(rng) {
    const out: string[] = [];
    for (let i = 0; i < 5; i++) {
      const y = 30 + i * 11;
      const amp = 2 + rng() * 3;
      const step = 30;
      let d = `M 24 ${y}`;
      for (let x = 24 + step; x <= 216; x += step) {
        d += ` Q ${n(x - step / 2)} ${n(y + (rng() > 0.5 ? amp : -amp))}, ${x} ${y}`;
      }
      out.push(path(d, { f: i % 2 === 1 }));
    }
    return out.join('');
  },

  // Orthogonal grid of nodes with one ringed hub — the home network.
  mesh(rng) {
    const ox = j(rng, 84, 12);
    const oy = 32;
    const gap = 24;
    const hubC = Math.floor(rng() * 3);
    const hubR = Math.floor(rng() * 2);
    const out: string[] = [];
    for (let r = 0; r < 2; r++) {
      out.push(ln(ox, oy + r * gap + gap / 2, ox + 3 * gap, oy + r * gap + gap / 2, true));
    }
    for (let c = 0; c < 4; c++) {
      out.push(ln(ox + c * gap, oy, ox + c * gap, oy + gap, true));
    }
    for (let i = 0; i < 8; i++) {
      const c = i % 4;
      const r = Math.floor(i / 4);
      const x = ox + c * gap;
      const y = oy + r * gap + (r ? gap / 2 : -gap / 2) + gap / 2;
      const hub = c === hubC && r === hubR;
      out.push(circ(x, y, hub ? 4 : 2.5, { knockout: true }));
      if (hub) out.push(circ(x, y, 9, { f: true }));
    }
    return out.join('');
  },

  // Spoked wheel with motion lines.
  wheel(rng) {
    const cx = j(rng, 128, 20);
    const cy = 52;
    const r = j(rng, 24, 4);
    const spokes = 6 + Math.floor(rng() * 3);
    const rot = rng() * Math.PI;
    const out: string[] = [
      circ(cx, cy, r),
      circ(cx, cy, r * 0.55, { f: true }),
      circ(cx, cy, 2),
    ];
    for (let i = 0; i < spokes; i++) {
      const a = rot + (i / spokes) * Math.PI * 2;
      out.push(ln(
        cx + Math.cos(a) * 3, cy + Math.sin(a) * 3,
        cx + Math.cos(a) * r * 0.9, cy + Math.sin(a) * r * 0.9, true,
      ));
    }
    for (let i = 0; i < 3; i++) {
      out.push(ln(cx - r - 34 + j(rng, 0, 6), cy - 8 + i * 8, cx - r - 10, cy - 8 + i * 8, true));
    }
    return out.join('');
  },

  // Stockpot on the boil — rim, body, handles, steam, spoon.
  pot(rng) {
    const cx = j(rng, 120, 16);
    const rimY = j(rng, 45, 4);
    const baseY = rimY + 29;
    const rx = j(rng, 27, 4);
    const out: string[] = [
      ell(cx, rimY, rx, 5),
      path(`M ${n(cx - rx)} ${n(rimY)} V ${n(baseY - 9)} Q ${n(cx - rx)} ${n(baseY)} ${n(cx - rx + 9)} ${n(baseY)} H ${n(cx + rx - 9)} Q ${n(cx + rx)} ${n(baseY)} ${n(cx + rx)} ${n(baseY - 9)} V ${n(rimY)}`),
      ln(cx - rx - 7, rimY + 4, cx - rx, rimY + 4),
      ln(cx + rx, rimY + 4, cx + rx + 7, rimY + 4),
      path(`M ${n(cx - 8)} ${n(rimY - 10)} Q ${n(cx - 12)} ${n(rimY - 16)} ${n(cx - 8)} ${n(rimY - 22)}`, { f: true }),
      path(`M ${n(cx + 8)} ${n(rimY - 9)} Q ${n(cx + 12)} ${n(rimY - 16)} ${n(cx + 8)} ${n(rimY - 23)}`, { f: true }),
      path(`M ${n(cx)} ${n(rimY - 12)} Q ${n(cx - 4)} ${n(rimY - 19)} ${n(cx)} ${n(rimY - 26)} Q ${n(cx + 4)} ${n(rimY - 32)} ${n(cx)} ${n(rimY - 38)}`, { f: true }),
      ln(cx - 50, baseY + 6, cx + 50, baseY + 6, true),
    ];
    // Hatch shading down the pot's left side.
    for (let i = 0; i < 4; i++) {
      const x = cx - rx + 6 + i * 7;
      out.push(ln(x, rimY + 7, x - 6 + i, rimY + 16 + i * 2, true));
    }
    // Spoon leaning against the pot.
    const sx = cx + rx + 9;
    out.push(path(`M ${n(sx)} ${n(baseY + 4)} L ${n(sx + 18)} ${n(rimY - 8)}`));
    out.push(ell(sx + 20, rimY - 12, 4, 6));
    return out.join('');
  },

  // EKG trace over a faint baseline.
  pulse(rng) {
    const y = 52;
    const spike = j(rng, 26, 8);
    const x0 = j(rng, 96, 24);
    return [
      ln(24, y, 216, y, true),
      poly([
        [24, y], [x0, y], [x0 + 6, y - 8], [x0 + 12, y + 6],
        [x0 + 18, y - spike], [x0 + 26, y + 12], [x0 + 32, y],
        [216, y],
      ]),
      circ(x0 + 18, y - spike, 3.5, { f: true }),
    ].join('');
  },

  // Server rack with blinking bays, linked out to satellite nodes.
  rack(rng) {
    const x = j(rng, 96, 12);
    const y = 24;
    const w = 48;
    const h = 56;
    const out: string[] = [rect(x, y, w, h)];
    for (let i = 1; i < 4; i++) {
      out.push(ln(x, y + i * 14, x + w, y + i * 14));
    }
    for (let i = 0; i < 4; i++) {
      const by = y + 7 + i * 14;
      out.push(circ(x + 7, by, 1.5, { f: true }));
      out.push(ln(x + 16, by, x + w - 6, by, true));
    }
    // Traces out to satellite nodes, jittered.
    const t1 = j(rng, 30, 8);
    const t2 = j(rng, 74, 8);
    out.push(path(`M ${n(x + w)} ${n(y + 18)} H ${n(x + w + 24)} V ${n(t1)} H ${n(x + w + 40)}`, { f: true }));
    out.push(circ(x + w + 43, t1, 2.5));
    out.push(path(`M ${n(x + w)} ${n(y + 38)} H ${n(x + w + 28)} V ${n(t2)} H ${n(x + w + 38)}`, { f: true }));
    out.push(circ(x + w + 41, t2, 2.5));
    out.push(path(`M ${n(x)} ${n(y + 24)} H ${n(x - 22)} V ${n(j(rng, 60, 12))} H ${n(x - 34)}`, { f: true }));
    out.push(circ(x - 37, j(rng, 60, 0), 2.5));
    out.push(path(`M ${n(x)} ${n(y + 8)} H ${n(x - 26)}`, { f: true }));
    out.push(circ(x - 29, y + 8, 2.5));
    return out.join('');
  },

  // Mountain range, sun, a plane on a dashed route.
  travel(rng) {
    const ground = 74;
    const peaks: Array<[number, number]> = [[30, ground]];
    let x = 30;
    while (x < 130) {
      x += 24 + rng() * 20;
      peaks.push([Math.min(x, 142), j(rng, 44, 22)]);
    }
    peaks.push([142, ground]);
    const px = j(rng, 192, 10);
    const py = j(rng, 28, 6);
    return [
      poly(peaks),
      poly([[142, ground], [168, j(rng, 54, 8)], [192, ground]], true),
      ln(24, ground, 216, ground, true),
      path(`M 34 ${n(ground - 6)} Q 100 ${n(20 + j(rng, 0, 8))} ${n(px - 6)} ${n(py + 4)}`, { f: true, dash: '3 4' }),
      path(`M ${n(px)} ${n(py)} l 10 -4 l -7 8 l -2 -3 z M ${n(px + 3)} ${n(py - 1)} l -4 -5`),
      circ(j(rng, 172, 16), j(rng, 18, 4), 6, { f: true }),
      path(`M ${n(j(rng, 54, 10))} ${n(j(rng, 28, 6))} q 4 -5 9 -2 q 5 -4 9 1`, { f: true }),
    ].join('');
  },

  // Fallback: a hatched field with a few risen circles. Abstract, but
  // seeded — every unnamed-category domain still reads distinct.
  field(rng) {
    const marks = 16 + Math.floor(rng() * 8);
    const out: string[] = [];
    for (let i = 0; i < marks; i++) {
      const x = 28 + ((i * 83) % 184) + j(rng, 0, 10);
      const y = 30 + ((i * 47) % 44) + j(rng, 0, 8);
      const len = 5 + rng() * 6;
      out.push(ln(x, y + len, x + len, y, true));
    }
    for (let i = 0; i < 3; i++) {
      out.push(circ(j(rng, 60 + i * 60, 40), j(rng, 50, 30), 3 + rng() * 3));
    }
    return out.join('');
  },
};

/**
 * Deterministic fallback drawing for a domain: inner-SVG markup obeying
 * the engraved contract. Seeded from the name unless a seed is given.
 */
export function proceduralIllustration(name: string, seed?: number): string {
  const rng = mulberry32(seed ?? fnv1a(name));
  return MOTIFS[pickMotif(name)](rng);
}
