// One-shot: rasterize the favicon/app-icon PNG set in public/ from the
// canonical mark SVG at src/app/icon.svg (Record Rose, mark study Aug 2026).
// Run from apps/web:  node scripts/generate-icons.mjs
//
// apple-touch-icon gets square corners (rx=0): iOS applies its own corner
// mask, and baked-in rounded corners would show dark notches on some
// launchers. Everything else keeps the tile's rx=7 rounding.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcSvgPath = path.join(here, '../src/app/icon.svg');
const outDir = path.join(here, '../public');

const svg = readFileSync(srcSvgPath, 'utf8');
const squareSvg = svg.replace('rx="7"', 'rx="0"');

const targets = [
  { file: 'favicon-16.png', size: 16, source: svg },
  { file: 'favicon-32.png', size: 32, source: svg },
  { file: 'icon-192.png', size: 192, source: svg },
  { file: 'icon-512.png', size: 512, source: svg },
  { file: 'apple-touch-icon.png', size: 180, source: squareSvg },
];

for (const t of targets) {
  // Density scales librsvg's rasterization so the 32-unit viewBox renders
  // crisp at the target pixel size (72dpi is the SVG default at 1:1).
  const density = (72 * t.size) / 32;
  await sharp(Buffer.from(t.source), { density })
    .resize(t.size, t.size)
    .png()
    .toFile(path.join(outDir, t.file));
  console.log(`wrote public/${t.file} (${t.size}px)`);
}
