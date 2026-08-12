// Engraved spot-art illustrations for the Domains board — Rich tier.
//
// Two producers share one contract (tier locked via the Aug 2026 density
// study: "Rich" — ~35–80 strokes with form hatching, cast shadows, and
// quiet background hints; pictorial motifs; rust tint applied at render
// time):
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
// Fine shading strokes may set stroke-width="0.6" (allowed 0.5–1.5).
// Small shapes may knock out lines beneath them with fill="#FBF8F2"
// (the surface token). No text, no defs, no styles, no transforms.
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

// ─── Element emitters ────────────────────────────────────────────────────
// f = faint (secondary tone); sw = fine stroke-width for shading lines.
interface StrokeOpts { f?: boolean; sw?: number }
const swAttr = (o: StrokeOpts) => (o.sw ? ` stroke-width="${o.sw}"` : '');
const fAttr = (o: StrokeOpts) => (o.f ? ' class="f"' : '');

const ln = (x1: number, y1: number, x2: number, y2: number, o: StrokeOpts = {}) =>
  `<line${fAttr(o)}${swAttr(o)} x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}"/>`;
const circ = (cx: number, cy: number, r: number, o: StrokeOpts & { knockout?: boolean } = {}) =>
  `<circle${fAttr(o)}${swAttr(o)} cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}"${o.knockout ? ` fill="${KNOCKOUT}"` : ''}/>`;
const ell = (cx: number, cy: number, rx: number, ry: number, o: StrokeOpts = {}) =>
  `<ellipse${fAttr(o)}${swAttr(o)} cx="${n(cx)}" cy="${n(cy)}" rx="${n(rx)}" ry="${n(ry)}"/>`;
const path = (d: string, o: StrokeOpts & { dash?: string } = {}) =>
  `<path${fAttr(o)}${swAttr(o)}${o.dash ? ` stroke-dasharray="${o.dash}"` : ''} d="${d}"/>`;
const poly = (pts: Array<[number, number]>, o: StrokeOpts = {}) =>
  `<polyline${fAttr(o)}${swAttr(o)} points="${pts.map(([x, y]) => `${n(x)},${n(y)}`).join(' ')}"/>`;
const rect = (x: number, y: number, w: number, h: number, o: StrokeOpts = {}) =>
  `<rect${fAttr(o)}${swAttr(o)} x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"/>`;

// ─── Texture helpers (the Rich tier's vocabulary) ───────────────────────

/** Parallel hatch strokes filling a slanted band — form shading. */
function hatch(rng: Rng, x: number, y: number, w: number, h: number, count: number, slant = -0.4): string {
  let out = '';
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const hx = x + t * w + (rng() - 0.5) * 1.5;
    const len = h * (0.75 + rng() * 0.25);
    const y0 = y + (h - len) * rng() * 0.5;
    out += ln(hx, y0 + len, hx + slant * len, y0, { f: true, sw: 0.6 });
  }
  return out;
}

/** Pool of short horizontal strokes under an object — cast shadow. */
function shadowPool(rng: Rng, cx: number, y: number, w: number, rows = 2): string {
  let out = '';
  for (let r = 0; r < rows; r++) {
    const rw = w * (1 - r / (rows + 1));
    const seg = 3 + Math.floor(rng() * 3);
    for (let s = 0; s < seg; s++) {
      const sx = cx - rw / 2 + (s / seg) * rw + rng() * 3;
      out += ln(sx, y + r * 2, sx + rw / seg - 3 - rng() * 2, y + r * 2, { f: true, sw: 0.6 });
    }
  }
  return out;
}

/** Grass/gravel ticks along a ground line. */
function groundTicks(rng: Rng, x0: number, x1: number, y: number, count: number): string {
  let out = '';
  for (let i = 0; i < count; i++) {
    const tx = x0 + ((i + 0.5) / count) * (x1 - x0) + (rng() - 0.5) * 4;
    const len = 2.5 + rng() * 3;
    out += ln(tx, y, tx + (rng() - 0.5) * 2, y - len, { f: true, sw: 0.6 });
  }
  return out;
}

/** A distant cloud puff. */
const cloud = (x: number, y: number, s = 1) =>
  path(`M ${n(x)} ${n(y)} q ${n(4 * s)} ${n(-5 * s)} ${n(9 * s)} ${n(-2 * s)} q ${n(5 * s)} ${n(-4 * s)} ${n(9 * s)} ${n(1 * s)}`, { f: true, sw: 0.6 });

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
  // Radio mast on a low hill: guys, radiating arcs, signal ticks, hut.
  beacon(rng) {
    const cx = j(rng, 118, 24);
    const base = 74;
    const top = j(rng, 28, 5);
    let s = '';
    // background: distant ridge + cloud
    s += poly([[30, base - 14], [66, base - 26], [96, base - 16]], { f: true, sw: 0.6 });
    s += cloud(j(rng, 178, 16), j(rng, 26, 6));
    // hill the mast stands on
    s += path(`M ${n(cx - 42)} ${base} Q ${n(cx)} ${n(base - 12)} ${n(cx + 42)} ${base}`, { f: true });
    s += hatch(rng, cx - 26, base - 8, 22, 7, 6, -0.5);
    // mast + guys + platform
    s += ln(cx, base - 6, cx, top);
    s += ln(cx - 14, base - 2, cx, base - 24, { f: true });
    s += ln(cx + 14, base - 2, cx, base - 24, { f: true });
    s += ln(cx - 3.4, top + 8, cx + 3.4, top + 8, { f: true, sw: 0.6 });
    s += circ(cx, top, 2);
    // arcs + signal ticks
    for (let i = 0; i < 3; i++) {
      const r = 10 + i * 9;
      s += path(`M ${n(cx - r)} ${n(top)} A ${r} ${r} 0 0 1 ${n(cx + r)} ${n(top)}`, { f: i > 0 });
      s += ln(cx - r - 2.5, top - 1, cx - r - 4.5, top - 3, { f: true, sw: 0.6 });
      s += ln(cx + r + 2.5, top - 1, cx + r + 4.5, top - 3, { f: true, sw: 0.6 });
    }
    // supply hut + ground
    const hx = cx + 34;
    s += rect(hx, base - 13, 16, 13, { f: true });
    s += poly([[hx - 2, base - 13], [hx + 8, base - 19], [hx + 18, base - 13]], { f: true });
    s += ln(hx + 6, base, hx + 6, base - 8, { f: true, sw: 0.6 });
    s += ln(cx - 58, base, cx + 58, base, { f: true });
    s += groundTicks(rng, cx - 54, cx + 54, base, 7);
    s += shadowPool(rng, cx + 4, base + 2, 40);
    return s;
  },

  // Cottage: hatched roof, window, chimney smoke, hedge, fence, sun.
  roofline(rng) {
    const cx = j(rng, 112, 20);
    const w = j(rng, 34, 6);
    const ridge = j(rng, 30, 4);
    const eave = ridge + 18;
    const ground = 74;
    let s = '';
    // background: sun + cloud + distant fence posts
    s += circ(j(rng, 190, 12), j(rng, 26, 6), 6, { f: true });
    s += cloud(j(rng, 44, 10), j(rng, 26, 5));
    for (let i = 0; i < 4; i++) {
      const fx = cx + w + 26 + i * 9;
      s += ln(fx, ground, fx, ground - 6, { f: true, sw: 0.6 });
      if (i < 3) s += ln(fx, ground - 4.4, fx + 9, ground - 4.4, { f: true, sw: 0.6 });
    }
    // house
    s += poly([[cx - w, eave], [cx, ridge], [cx + w, eave]]);
    s += ln(cx - w + 6, eave - 3, cx - w + 6, ground);
    s += ln(cx + w - 6, eave - 3, cx + w - 6, ground);
    // roof hatch (following the right roof plane)
    for (let i = 1; i <= 6; i++) {
      const t = i / 7;
      s += ln(cx + t * w, ridge + t * (eave - ridge), cx + t * w - 5, ridge + t * (eave - ridge) + 3.4, { f: true, sw: 0.6 });
    }
    // door + window
    s += rect(cx - 5, eave + 8, 10, ground - eave - 8, { f: true });
    s += circ(cx + 2.6, eave + 8 + (ground - eave - 8) / 2, 0.8, { f: true, sw: 0.6 });
    const wx = cx + w * 0.45;
    s += rect(wx - 4, eave + 6, 8, 8, { f: true });
    s += ln(wx, eave + 6, wx, eave + 14, { f: true, sw: 0.6 });
    s += ln(wx - 4, eave + 10, wx + 4, eave + 10, { f: true, sw: 0.6 });
    // chimney + smoke
    const chx = cx + w * 0.45;
    s += ln(chx - 2.4, ridge + 6.6, chx - 2.4, ridge - 3);
    s += ln(chx + 2.4, ridge + 8.6, chx + 2.4, ridge - 3);
    s += ln(chx - 2.4, ridge - 3, chx + 2.4, ridge - 3);
    s += path(`M ${n(chx)} ${n(ridge - 6)} q -3 -4 0 -8 q 3 -4 0 -8`, { f: true, sw: 0.6 });
    // hedge + ground
    s += ln(cx - 78, ground, cx + 78, ground, { f: true });
    for (let i = 0; i < 5; i++) {
      const x = cx - w - 14 - i * 7 + j(rng, 0, 3);
      s += ln(x, ground, x - 3, ground - 7, { f: true, sw: 0.6 });
    }
    s += groundTicks(rng, cx - w - 8, cx + w + 20, ground, 6);
    s += shadowPool(rng, cx + 8, ground + 2, 52);
    return s;
  },

  // Ledger: ruled sheet, coin columns with shadows, a face-on coin, quill.
  ledger(rng) {
    const base = 74;
    const cols = 4 + Math.floor(rng() * 2);
    const start = 118 - (cols * 26) / 2;
    let s = '';
    // sheet rules (top header + faint column rules)
    s += ln(start - 16, 26, start + cols * 26 + 8, 26, { f: true });
    s += ln(start - 16, 30, start + cols * 26 + 8, 30, { f: true, sw: 0.6 });
    for (let c = 0; c <= cols; c++) {
      s += ln(start + c * 26 - 4, 34, start + c * 26 - 4, base - 2, { f: true, sw: 0.6 });
    }
    // coin columns + per-stack shadows
    for (let c = 0; c < cols; c++) {
      const x = start + c * 26 + 8;
      const coins = 2 + Math.floor(rng() * 5);
      for (let i = 0; i < coins; i++) {
        s += ell(x, base - 4 - i * 7, 9, 3, { f: i % 2 === 1 });
      }
      s += ln(x - 8, base + 2.6, x + 4, base + 2.6, { f: true, sw: 0.6 });
      s += ln(x - 5, base + 4.6, x + 7, base + 4.6, { f: true, sw: 0.6 });
    }
    // a face-on coin leaning on the tallest stack + quill in the corner
    const lx = start + cols * 26 + 14;
    s += circ(lx, base - 6, 6);
    s += circ(lx, base - 6, 3.6, { f: true, sw: 0.6 });
    const qx = start - 24;
    s += path(`M ${n(qx)} ${n(base)} Q ${n(qx + 8)} ${n(base - 18)} ${n(qx + 16)} ${n(base - 30)}`, { f: true });
    s += path(`M ${n(qx + 10)} ${n(base - 14)} q 6 -2 10 -8`, { f: true, sw: 0.6 });
    // baseline
    s += ln(start - 16, base, start + cols * 26 + 8, base, { f: true });
    s += groundTicks(rng, start - 12, start + cols * 26 + 4, base, 5);
    return s;
  },

  // Working network: nodes, edges, packet ticks, hub halo, baseline.
  network(rng) {
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < 6; i++) {
      pts.push([40 + i * 32 + j(rng, 0, 18), j(rng, 48, 36)]);
    }
    let s = '';
    // primary chain + secondary faint links
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      s += ln(a[0], a[1], b[0], b[1], { f: true });
      // packet tick riding each edge
      const t = 0.35 + rng() * 0.3;
      const mx = a[0] + (b[0] - a[0]) * t;
      const my = a[1] + (b[1] - a[1]) * t;
      s += ln(mx - 1.6, my - 1.6, mx + 1.6, my + 1.6, { sw: 0.6 });
    }
    const a0 = pts[0]!;
    const b2 = pts[2]!;
    const c5 = pts[5]!;
    s += ln(a0[0], a0[1], b2[0], b2[1], { f: true, sw: 0.6 });
    s += ln(b2[0], b2[1], c5[0], c5[1], { f: true, sw: 0.6 });
    // nodes (+ halo on hub)
    pts.forEach((p, i) => {
      s += circ(p[0], p[1], i === 2 ? 5 : 3, { knockout: true });
      if (i === 2) s += circ(p[0], p[1], 8.6, { f: true, sw: 0.6 });
    });
    // node drop-lines to a faint baseline — grounds the constellation
    const base = 82;
    s += ln(34, base, 206, base, { f: true, sw: 0.6 });
    for (const p of pts) {
      s += ln(p[0], p[1] + (p[1] < base - 30 ? 6 : 4), p[0], base - 1.6, { f: true, sw: 0.6 });
      s += ln(p[0] - 2.4, base, p[0] + 2.4, base, { f: true, sw: 0.6 });
    }
    return s;
  },

  // Family constellation: orbits, bodies with moons, crescent shading, stars.
  orbits(rng) {
    const cx = j(rng, 120, 18);
    const cy = 50;
    let s = '';
    // scattered star ticks
    for (let i = 0; i < 7; i++) {
      const sx = 34 + rng() * 172;
      const sy = 22 + rng() * 20;
      s += ln(sx - 1.6, sy, sx + 1.6, sy, { f: true, sw: 0.6 });
      s += ln(sx, sy - 1.6, sx, sy + 1.6, { f: true, sw: 0.6 });
    }
    // center body with crescent shading
    s += circ(cx, cy, 4.6);
    s += path(`M ${n(cx - 1)} ${n(cy - 4.2)} A 4.4 4.4 0 0 0 ${n(cx - 1)} ${n(cy + 4.2)}`, { f: true, sw: 0.6 });
    s += path(`M ${n(cx - 2.6)} ${n(cy - 3.4)} A 4 4 0 0 0 ${n(cx - 2.6)} ${n(cy + 3.4)}`, { f: true, sw: 0.6 });
    // rings + bodies + one moon each ring
    for (let i = 0; i < 3; i++) {
      const rx = 24 + i * 16;
      const ry = rx * 0.42;
      const a = rng() * Math.PI * 2;
      if (i === 1) {
        s += `<ellipse class="f" stroke-dasharray="3 4" cx="${n(cx)}" cy="${n(cy)}" rx="${n(rx)}" ry="${n(ry)}"/>`;
      } else {
        s += ell(cx, cy, rx, ry, { f: true });
      }
      const bx = cx + Math.cos(a) * rx;
      const by = cy + Math.sin(a) * ry;
      s += circ(bx, by, 2.6, { knockout: true });
      if (i > 0) s += circ(bx + 4.6, by - 3.4, 1.1, { f: true, sw: 0.6 });
    }
    return s;
  },

  // Personal system strata: layered waves, fine interlayers, core bore.
  strata(rng) {
    let s = '';
    const bx = j(rng, 150, 40);
    for (let i = 0; i < 5; i++) {
      const y = 28 + i * 11;
      const amp = 2 + rng() * 3;
      const step = 30;
      let d = `M 24 ${y}`;
      for (let x = 24 + step; x <= 216; x += step) {
        d += ` Q ${n(x - step / 2)} ${n(y + (rng() > 0.5 ? amp : -amp))}, ${x} ${y}`;
      }
      s += path(d, { f: i % 2 === 1 });
      // fine interlayer echo
      if (i < 4) {
        let d2 = `M 24 ${y + 5.5}`;
        for (let x = 24 + step; x <= 216; x += step) {
          d2 += ` Q ${n(x - step / 2)} ${n(y + 5.5 + (rng() > 0.5 ? amp * 0.6 : -amp * 0.6))}, ${x} ${y + 5.5}`;
        }
        s += path(d2, { f: true, sw: 0.6 });
      }
    }
    // bore hole down to a core sample
    s += ln(bx, 24, bx, 76);
    for (let i = 0; i < 5; i++) {
      s += ln(bx - 2.4, 30 + i * 10, bx + 2.4, 30 + i * 10, { sw: 0.6 });
    }
    s += circ(bx, 80, 3.4, { knockout: true });
    s += hatch(rng, bx - 3, 77.4, 6, 5, 3, -0.5);
    return s;
  },

  // Home network mesh: grid, hub with signal arcs, floor shadows, uplink.
  mesh(rng) {
    const ox = j(rng, 82, 10);
    const oy = 34;
    const gap = 24;
    const hubC = Math.floor(rng() * 3);
    const hubR = Math.floor(rng() * 2);
    let s = '';
    for (let r = 0; r < 2; r++) {
      s += ln(ox, oy + r * gap + gap / 2, ox + 3 * gap, oy + r * gap + gap / 2, { f: true });
    }
    for (let c = 0; c < 4; c++) {
      s += ln(ox + c * gap, oy, ox + c * gap, oy + gap, { f: true });
    }
    let hubX = ox;
    let hubY = oy;
    for (let i = 0; i < 8; i++) {
      const c = i % 4;
      const r = Math.floor(i / 4);
      const x = ox + c * gap;
      const y = oy + r * gap + (r ? gap / 2 : -gap / 2) + gap / 2;
      const hub = c === hubC && r === hubR;
      s += circ(x, y, hub ? 4 : 2.5, { knockout: true });
      if (hub) {
        hubX = x; hubY = y;
        s += circ(x, y, 9, { f: true });
        s += path(`M ${n(x - 6)} ${n(y - 10)} A 12 12 0 0 1 ${n(x + 6)} ${n(y - 10)}`, { f: true, sw: 0.6 });
        s += path(`M ${n(x - 9)} ${n(y - 14)} A 17 17 0 0 1 ${n(x + 9)} ${n(y - 14)}`, { f: true, sw: 0.6 });
      }
    }
    // dashed uplink out of the mesh to a wall jack
    const jx = ox + 3 * gap + 34;
    s += path(`M ${n(hubX + 4)} ${n(hubY)} Q ${n(hubX + 30)} ${n(hubY - 14)} ${n(jx)} ${n(hubY - 6)}`, { f: true, dash: '3 4' });
    s += rect(jx + 1, hubY - 10, 7, 8, { f: true });
    // floor line + shadows under the bottom row
    const floor = oy + gap * 2 + 12;
    s += ln(ox - 18, floor, jx + 12, floor, { f: true, sw: 0.6 });
    s += shadowPool(rng, ox + gap, floor - 2, 30);
    s += shadowPool(rng, ox + gap * 2.4, floor - 2, 26);
    return s;
  },

  // Vehicle wheel: spokes, rim shading, road, stones, motion lines.
  wheel(rng) {
    const cx = j(rng, 126, 16);
    const cy = 50;
    const r = j(rng, 23, 3);
    const spokes = 6 + Math.floor(rng() * 3);
    const rot = rng() * Math.PI;
    const road = cy + r + 4;
    let s = '';
    s += circ(cx, cy, r);
    s += circ(cx, cy, r * 0.55, { f: true });
    s += circ(cx, cy, 2);
    for (let i = 0; i < spokes; i++) {
      const a = rot + (i / spokes) * Math.PI * 2;
      s += ln(cx + Math.cos(a) * 3, cy + Math.sin(a) * 3, cx + Math.cos(a) * r * 0.9, cy + Math.sin(a) * r * 0.9, { f: true });
    }
    // rim shading: short radial hatch in the lower-left band
    for (let i = 0; i < 7; i++) {
      const a = Math.PI * 0.62 + i * 0.13;
      s += ln(
        cx + Math.cos(a) * (r * 0.62), cy + Math.sin(a) * (r * 0.62),
        cx + Math.cos(a) * (r * 0.92), cy + Math.sin(a) * (r * 0.92),
        { f: true, sw: 0.6 },
      );
    }
    // motion lines
    for (let i = 0; i < 3; i++) {
      s += ln(cx - r - 36 + j(rng, 0, 6), cy - 9 + i * 8, cx - r - 10, cy - 9 + i * 8, { f: true });
      s += ln(cx - r - 30 + j(rng, 0, 4), cy - 5 + i * 8, cx - r - 14, cy - 5 + i * 8, { f: true, sw: 0.6 });
    }
    // road + stones + shadow
    s += ln(cx - r - 44, road, cx + r + 44, road, { f: true });
    s += shadowPool(rng, cx + 3, road + 2, r * 2.2);
    for (let i = 0; i < 5; i++) {
      const sx2 = cx - r - 34 + rng() * (2 * r + 60);
      s += ell(sx2, road + 6.5, 1.8 + rng() * 1.4, 0.9, { f: true, sw: 0.6 });
    }
    // distant signpost
    const px = cx + r + 30;
    s += ln(px, road, px, road - 16, { f: true });
    s += rect(px, road - 16, 9, 4.6, { f: true });
    return s;
  },

  // Stockpot on the boil: rim, steam, form hatch, shadow, spoon, board.
  pot(rng) {
    const cx = j(rng, 118, 12);
    const rimY = j(rng, 44, 4);
    const baseY = rimY + 29;
    const rx = j(rng, 27, 3);
    let s = '';
    // background shelf with hanging ladle + strainer
    s += ln(40, 24, 196, 24, { f: true, sw: 0.6 });
    s += path(`M 62 24 V 30`, { f: true, sw: 0.6 }) + circ(62, 33, 3, { f: true });
    s += path(`M 74 24 V 32`, { f: true, sw: 0.6 }) + ell(74, 35, 2, 3.4, { f: true });
    // pot
    s += ell(cx, rimY, rx, 5);
    s += path(`M ${n(cx - rx)} ${n(rimY)} V ${n(baseY - 9)} Q ${n(cx - rx)} ${n(baseY)} ${n(cx - rx + 9)} ${n(baseY)} H ${n(cx + rx - 9)} Q ${n(cx + rx)} ${n(baseY)} ${n(cx + rx)} ${n(baseY - 9)} V ${n(rimY)}`);
    s += ln(cx - rx - 7, rimY + 4, cx - rx, rimY + 4);
    s += ln(cx + rx, rimY + 4, cx + rx + 7, rimY + 4);
    s += ell(cx, rimY, rx - 4, 3.4, { f: true, sw: 0.6 });
    // steam
    s += path(`M ${n(cx - 8)} ${n(rimY - 10)} Q ${n(cx - 12)} ${n(rimY - 16)} ${n(cx - 8)} ${n(rimY - 22)}`, { f: true });
    s += path(`M ${n(cx + 8)} ${n(rimY - 9)} Q ${n(cx + 12)} ${n(rimY - 16)} ${n(cx + 8)} ${n(rimY - 23)}`, { f: true });
    s += path(`M ${n(cx)} ${n(rimY - 12)} Q ${n(cx - 4)} ${n(rimY - 19)} ${n(cx)} ${n(rimY - 26)} Q ${n(cx + 4)} ${n(rimY - 32)} ${n(cx)} ${n(rimY - 38)}`, { f: true });
    // form shading on the left wall
    s += hatch(rng, cx - rx + 3, rimY + 6, 14, baseY - rimY - 10, 8, -0.35);
    // ground + shadow
    s += ln(cx - 52, baseY + 6, cx + 52, baseY + 6, { f: true });
    s += shadowPool(rng, cx + 6, baseY + 8, 58);
    s += groundTicks(rng, cx - 50, cx + 50, baseY + 6, 5);
    // spoon + board + salt cellar
    const sx = cx + rx + 9;
    s += path(`M ${n(sx)} ${n(baseY + 4)} L ${n(sx + 18)} ${n(rimY - 8)}`);
    s += ell(sx + 20, rimY - 12, 4, 6);
    s += ln(sx + 16, rimY - 6, sx + 19, rimY - 2, { f: true, sw: 0.6 });
    s += rect(cx - rx - 40, baseY + 1, 30, 5, { f: true });
    s += circ(cx - rx - 25, baseY - 6, 4.6, { f: true });
    s += ln(cx - rx - 25, baseY - 11, cx - rx - 25, baseY - 14, { f: true });
    return s;
  },

  // Fitness pulse: gridded trace, main + echo spike, ringed peak.
  pulse(rng) {
    const y = 52;
    const spike = j(rng, 26, 6);
    const x0 = j(rng, 92, 20);
    const x1 = x0 + 64;
    let s = '';
    // faint chart frame + vertical grid ticks
    s += ln(24, y, 216, y, { f: true });
    s += ln(24, y - 30, 216, y - 30, { f: true, sw: 0.6 });
    s += ln(24, y + 22, 216, y + 22, { f: true, sw: 0.6 });
    for (let i = 0; i < 13; i++) {
      const gx = 28 + i * 15.5;
      s += ln(gx, y - 2, gx, y + 2, { f: true, sw: 0.6 });
    }
    // main trace with two beats (second smaller)
    s += poly([
      [24, y], [x0, y], [x0 + 6, y - 8], [x0 + 12, y + 6],
      [x0 + 18, y - spike], [x0 + 26, y + 12], [x0 + 32, y],
      [x1, y], [x1 + 5, y - 6], [x1 + 10, y + 4],
      [x1 + 15, y - spike * 0.55], [x1 + 21, y + 8], [x1 + 26, y],
      [216, y],
    ]);
    // echo trace, offset and faint
    s += path(
      `M 24 ${n(y + 10)} H ${n(x0 + 2)} L ${n(x0 + 9)} ${n(y + 4)} L ${n(x0 + 16)} ${n(y + 14)} L ${n(x0 + 22)} ${n(y + 8)} H 216`,
      { f: true, sw: 0.6 },
    );
    // ringed main peak + bpm dot
    s += circ(x0 + 18, y - spike, 3.5, { f: true });
    s += circ(x1 + 15, y - spike * 0.55, 2.2, { f: true, sw: 0.6 });
    return s;
  },

  // AI rack: bays, LEDs, side shading, cables to nodes, floor, neighbor.
  rack(rng) {
    const x = j(rng, 94, 10);
    const y = 24;
    const w = 48;
    const h = 54;
    let s = '';
    // background second rack + floor
    s += rect(x - 34, y + 10, 22, h - 10, { f: true });
    s += ln(x - 34, y + 24, x - 12, y + 24, { f: true, sw: 0.6 });
    s += ln(x - 34, y + 40, x - 12, y + 40, { f: true, sw: 0.6 });
    s += ln(30, y + h + 4, 210, y + h + 4, { f: true });
    // main rack
    s += rect(x, y, w, h);
    for (let i = 1; i < 4; i++) s += ln(x, y + (i * h) / 4, x + w, y + (i * h) / 4);
    for (let i = 0; i < 4; i++) {
      const by = y + h / 8 + (i * h) / 4;
      s += circ(x + 7, by, 1.5, { f: true });
      s += ln(x + 14, by - 2.4, x + w - 6, by - 2.4, { f: true, sw: 0.6 });
      s += ln(x + 14, by + 2.4, x + w - 6, by + 2.4, { f: true, sw: 0.6 });
    }
    // side-panel shading + cast shadow
    s += hatch(rng, x + w - 9, y + 3, 8, h - 6, 7, -0.3);
    s += shadowPool(rng, x + w / 2 + 8, y + h + 6, 62);
    // curved cables out to satellite nodes
    const nodes: Array<[number, number]> = [[x + w + 44, 30], [x + w + 52, 52], [x + w + 38, 70], [x - 52, 62]];
    const anchors: Array<[number, number]> = [[x + w, y + 8], [x + w, y + 26], [x + w, y + 44], [x, y + 38]];
    nodes.forEach(([nx, ny], i) => {
      const [ax, ay] = anchors[i]!;
      const midx = (ax + nx) / 2 + (rng() - 0.5) * 10;
      s += path(`M ${n(ax)} ${n(ay)} Q ${n(midx)} ${n(ny + (rng() - 0.5) * 16)} ${n(nx)} ${n(ny)}`, { f: true });
      s += circ(nx, ny, 2.6, { knockout: true });
    });
    return s;
  },

  // Travel: layered ridges, hatched faces, snow caps, sun, plane, route.
  travel(rng) {
    const ground = 72;
    let s = '';
    // far ridge + mid/near ridges
    s += poly([[24, ground - 26], [58, 40], [92, ground - 30], [128, 36], [162, ground - 28], [196, 44], [216, ground - 24]], { f: true, sw: 0.6 });
    s += poly([[24, ground], [64, 34], [96, 58], [126, 26], [162, ground]]);
    s += poly([[150, ground], [178, 48], [208, ground]], { f: true });
    // shaded faces + snow caps
    s += hatch(rng, 64, 40, 22, ground - 44, 7, -0.45);
    s += hatch(rng, 126, 32, 24, ground - 38, 8, -0.45);
    s += path(`M 58 42 L 64 34 L 70 42`, { f: true, sw: 0.6 });
    s += path(`M 120 34 L 126 26 L 133 35`, { f: true, sw: 0.6 });
    // sun + rays + cloud
    const sunX = j(rng, 188, 10);
    const sunY = j(rng, 20, 4);
    s += circ(sunX, sunY, 6, { f: true });
    for (let i = 0; i < 5; i++) {
      const a = -0.4 + i * 0.42;
      s += ln(sunX + Math.cos(a) * 8.4, sunY + Math.sin(a) * 8.4, sunX + Math.cos(a) * 11.6, sunY + Math.sin(a) * 11.6, { f: true, sw: 0.6 });
    }
    s += cloud(j(rng, 44, 10), j(rng, 26, 5));
    // ground, dashed route, plane, foreground ticks
    s += ln(24, ground, 216, ground, { f: true });
    s += path(`M 32 ${n(ground - 4)} Q 100 22 190 26`, { f: true, dash: '3 4' });
    s += path(`M 194 24 l 10 -4 l -7 8 l -2 -3 z M 197 23 l -4 -5`);
    s += groundTicks(rng, 28, 212, ground, 8);
    return s;
  },

  // Fallback field: hatched furrows, risen circles, horizon, shadows.
  field(rng) {
    let s = '';
    // faint horizon + cloud
    s += ln(24, 30, 216, 30, { f: true, sw: 0.6 });
    s += cloud(j(rng, 168, 30), 26);
    // hatched marks in loose furrow rows
    const marks = 18 + Math.floor(rng() * 6);
    for (let i = 0; i < marks; i++) {
      const x = 28 + ((i * 83) % 184) + j(rng, 0, 10);
      const y = 36 + ((i * 47) % 38) + j(rng, 0, 8);
      const len = 5 + rng() * 6;
      s += ln(x, y + len, x + len, y, { f: true, sw: i % 2 ? 0.6 : undefined });
    }
    // risen circles with small cast shadows
    for (let i = 0; i < 3; i++) {
      const cx = j(rng, 60 + i * 60, 40);
      const cy = j(rng, 52, 26);
      const r = 3 + rng() * 3;
      s += circ(cx, cy, r, { knockout: true });
      s += ln(cx - r, cy + r + 2.4, cx + r * 0.6, cy + r + 2.4, { f: true, sw: 0.6 });
    }
    // ground line + ticks
    s += ln(30, 80, 210, 80, { f: true });
    s += groundTicks(rng, 34, 206, 80, 7);
    return s;
  },
};

/**
 * Deterministic fallback drawing for a domain: inner-SVG markup obeying
 * the engraved Rich contract. Seeded from the name unless a seed is given.
 */
export function proceduralIllustration(name: string, seed?: number): string {
  const rng = mulberry32(seed ?? fnv1a(name));
  return MOTIFS[pickMotif(name)](rng);
}
