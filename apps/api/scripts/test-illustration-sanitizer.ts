#!/usr/bin/env -S tsx
// Contract tests for the illustration sanitizer + procedural library.
// Run: pnpm --filter @jevi-ops/api exec tsx scripts/test-illustration-sanitizer.ts
import { sanitizeIllustration } from '../src/lib/illustration.js';
import { proceduralIllustration } from '@jevi-ops/shared';

let pass = 0;
let fail = 0;
function expect(label: string, cond: boolean) {
  if (cond) { pass++; }
  else { fail++; console.error(`✗ ${label}`); }
}

// ─── Hostile inputs must be rejected (null), never partially stripped ───
const hostile: Array<[string, string]> = [
  ['script tag', '<line x1="0" y1="0" x2="1" y2="1"/><script>alert(1)</script><circle cx="5" cy="5" r="2"/><line x1="2" y1="2" x2="3" y2="3"/>'],
  ['event handler', '<circle cx="5" cy="5" r="2" onload="alert(1)"/><line x1="0" y1="0" x2="1" y2="1"/><line x1="2" y1="2" x2="3" y2="3"/>'],
  ['href/a tag', '<a href="https://evil"><circle cx="5" cy="5" r="2"/></a><line x1="0" y1="0" x2="1" y2="1"/><line x1="2" y1="2" x2="3" y2="3"/>'],
  ['image tag', '<image href="https://evil/x.png" x="0" y="0" width="10" height="10"/><line x1="0" y1="0" x2="1" y2="1"/><line x1="2" y1="2" x2="3" y2="3"/>'],
  ['style attr', '<circle cx="5" cy="5" r="2" style="fill:red"/><line x1="0" y1="0" x2="1" y2="1"/><line x1="2" y1="2" x2="3" y2="3"/>'],
  ['style tag', '<style>*{fill:red}</style><line x1="0" y1="0" x2="1" y2="1"/><line x1="2" y1="2" x2="3" y2="3"/><circle cx="5" cy="5" r="2"/>'],
  ['foreignObject', '<foreignObject><div>x</div></foreignObject><line x1="0" y1="0" x2="1" y2="1"/><line x1="2" y1="2" x2="3" y2="3"/><circle cx="5" cy="5" r="2"/>'],
  ['arbitrary fill', '<circle cx="5" cy="5" r="2" fill="red"/><line x1="0" y1="0" x2="1" y2="1"/><line x1="2" y1="2" x2="3" y2="3"/>'],
  ['url() in fill', '<circle cx="5" cy="5" r="2" fill="url(#x)"/><line x1="0" y1="0" x2="1" y2="1"/><line x1="2" y1="2" x2="3" y2="3"/>'],
  ['text content', '<line x1="0" y1="0" x2="1" y2="1"/>hello<line x1="2" y1="2" x2="3" y2="3"/><circle cx="5" cy="5" r="2"/>'],
  ['comment', '<!-- hi --><line x1="0" y1="0" x2="1" y2="1"/><line x1="2" y1="2" x2="3" y2="3"/><circle cx="5" cy="5" r="2"/>'],
  ['out-of-bounds coord', '<line x1="0" y1="0" x2="9999" y2="1"/><line x1="2" y1="2" x2="3" y2="3"/><circle cx="5" cy="5" r="2"/>'],
  ['out-of-bounds in d', '<path d="M 0 0 L 5000 5000"/><line x1="2" y1="2" x2="3" y2="3"/><circle cx="5" cy="5" r="2"/>'],
  ['script chars in d', '<path d="M 0 0 Ljavascript:alert(1)"/><line x1="2" y1="2" x2="3" y2="3"/><circle cx="5" cy="5" r="2"/>'],
  ['unclosed g', '<g><line x1="0" y1="0" x2="1" y2="1"/><line x1="2" y1="2" x2="3" y2="3"/><circle cx="5" cy="5" r="2"/>'],
  ['mismatched close', '<g><line x1="0" y1="0" x2="1" y2="1"/></rect><line x1="2" y1="2" x2="3" y2="3"/><circle cx="5" cy="5" r="2"/>'],
  ['nested non-g children', '<rect x="0" y="0" width="4" height="4"><circle cx="1" cy="1" r="1"/></rect><line x1="2" y1="2" x2="3" y2="3"/><circle cx="5" cy="5" r="2"/>'],
  ['too few elements', '<line x1="0" y1="0" x2="1" y2="1"/>'],
  ['too many elements', Array.from({ length: 61 }, (_, i) => `<line x1="${i}" y1="0" x2="${i}" y2="1"/>`).join('')],
  ['transform smuggle', '<circle cx="5" cy="5" r="2" transform="translate(1 1)"/><line x1="0" y1="0" x2="1" y2="1"/><line x1="2" y1="2" x2="3" y2="3"/>'],
  ['bad class', '<circle cx="5" cy="5" r="2" class="f x"/><line x1="0" y1="0" x2="1" y2="1"/><line x1="2" y1="2" x2="3" y2="3"/>'],
  ['empty', ''],
];
for (const [label, input] of hostile) {
  expect(`reject: ${label}`, sanitizeIllustration(input) === null);
}

// ─── Valid contract output must pass ────────────────────────────────────
const valid = '<ellipse cx="120" cy="45" rx="27" ry="5"/><path d="M 93 45 V 65 Q 93 74 102 74 H 138 Q 147 74 147 65 V 45"/><line class="f" x1="70" y1="80" x2="170" y2="80"/><path class="f" stroke-dasharray="3 4" d="M 34 68 Q 100 20 196 30"/><circle cx="187" cy="30" r="2.5" fill="#FBF8F2"/><g><line x1="99" y1="52" x2="95" y2="58"/><line x1="106" y1="52" x2="100" y2="61"/></g>';
expect('accept: valid markup', sanitizeIllustration(valid) !== null);
expect('accept: open/close shape pair', sanitizeIllustration('<rect x="0" y="0" width="4" height="4"></rect><line x1="2" y1="2" x2="3" y2="3"/><circle cx="5" cy="5" r="2"/>') !== null);
expect('idempotent', sanitizeIllustration(sanitizeIllustration(valid)!) === sanitizeIllustration(valid));

// ─── Every procedural motif must satisfy the same contract ──────────────
const NAMES = [
  'Emergency Preparedness', 'New Zealand Home & Property', 'Cross-Border Finance & Tax',
  'New Zealand Consulting', 'Family & Kids', 'Personal Operating System', 'Home Networking',
  'Vehicle', 'Cooking & Food', 'Fitness & Health', 'AI Infrastructure', 'Travel & Experiences',
  'Some Unmatched Topic',
];
for (const name of NAMES) {
  const svg = proceduralIllustration(name);
  expect(`procedural passes sanitizer: ${name}`, sanitizeIllustration(svg) !== null);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
