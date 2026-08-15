// One-off generator for PWA icons. Renders an SVG mark to PNG at the
// sizes Android (192/512), iOS (180), and Apple splash (a few) want.
//
// Design: rust square (#B8442B) with a cream serif J — high-contrast,
// recognizable on a crowded home screen. The J is sized to fit inside
// the maskable-safe inner 80% (radius 40% of canvas) so iOS's rounded-
// square clip and Android's circle clip both leave the mark intact.
//
// Run: pnpm -F @jevi-ops/web exec node scripts/generate-icons.mjs

import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

const BRAND = {
  bg: '#B8442B',    // accent rust — the full-bleed maskable background
  fg: '#F6F2EA',    // warm linen — the J itself
};

// SVG factory. `inset` is the optional padding around the mark; iOS
// Home Screen icons look better with a slightly tighter J than the
// edge-to-edge fill the OS will clip. The default 0 keeps maskable
// safe-area happy because the J already sits within the inner 80%.
function svgIcon(size, { fillBg = true, jScale = 0.74 } = {}) {
  // The serif J is positioned and sized by metrics we measured against
  // Newsreader: x at 50%, y baseline at ~64% of canvas height, font size
  // tuned so the visible glyph spans ~50% of the canvas vertically.
  const fontSize = Math.round(size * jScale);
  const y = Math.round(size * 0.74);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      ${fillBg ? `<rect width="${size}" height="${size}" fill="${BRAND.bg}"/>` : ''}
      <text x="50%" y="${y}" text-anchor="middle"
            font-family="Newsreader, Georgia, 'Times New Roman', serif"
            font-size="${fontSize}" font-weight="500"
            fill="${BRAND.fg}">J</text>
    </svg>`,
    'utf-8',
  );
}

// Render an SVG buffer to PNG at the requested pixel size.
async function renderPng(svgBuffer, size, outPath) {
  await sharp(svgBuffer, { density: 384 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(outPath);
  console.log(`  → ${path.relative(PUBLIC_DIR, outPath)}`);
}

async function main() {
  await mkdir(PUBLIC_DIR, { recursive: true });

  // ── Android / generic maskable PWA icons ────────────────────────────
  // 192 = required minimum, 512 = required, both used by Chrome on Android.
  console.log('Generating PNG icons…');
  await renderPng(svgIcon(512), 192, path.join(PUBLIC_DIR, 'icon-192.png'));
  await renderPng(svgIcon(512), 512, path.join(PUBLIC_DIR, 'icon-512.png'));

  // ── Apple touch icon (iOS Add to Home Screen) ───────────────────────
  // iOS doesn't use the manifest's icons; it looks for
  // /apple-touch-icon.png explicitly. 180×180 is the modern target.
  await renderPng(svgIcon(512), 180, path.join(PUBLIC_DIR, 'apple-touch-icon.png'));

  // ── Favicons (older browsers) ───────────────────────────────────────
  // The /icon.svg route in /app already covers modern browsers; this is
  // belt-and-suspenders for tabs/bookmarks on macOS Safari + Firefox.
  await renderPng(svgIcon(512), 32, path.join(PUBLIC_DIR, 'favicon-32.png'));
  await renderPng(svgIcon(512), 16, path.join(PUBLIC_DIR, 'favicon-16.png'));

  // Also drop a standalone maskable-safe SVG for any consumer that
  // accepts SVG icons (some Android launchers, desktop PWAs).
  await writeFile(
    path.join(PUBLIC_DIR, 'icon-mask.svg'),
    svgIcon(512).toString('utf-8'),
    'utf-8',
  );
  console.log(`  → icon-mask.svg`);

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
