// Domain identity colours (v2 design handoff, Jul 2026). A client-side map —
// no migration — used ONLY as an 11px chip in a domain header and a 3px bar
// on project cards. Not data: domains carry no colour column.
//
// Fork note: upstream keyed this by its own hardcoded domain names. This is
// a first-install product, so instead of a name map we hash the normalised
// name into a fixed editorial palette — every domain gets a stable, muted
// colour on any install, and a rename just re-rolls its chip. Pin a specific
// domain by adding it to PINNED.

const PINNED: Record<string, string> = {
  // 'my domain name': '#2F5D8A',
};

// The v2 handoff palette — muted, editorial, legible as an 11px chip on linen.
const PALETTE = [
  '#2F5D8A', // slate blue
  '#6B5B95', // dusk violet
  '#3B6A52', // moss
  '#A8763E', // ochre
  '#8A4B3C', // clay
  '#4A6B70', // pond
  '#8A6A2F', // brass
  '#5C5470', // graphite violet
];

// Neutral swatch for anything that opts out (unused today; kept for callers).
export const DOMAIN_COLOR_FALLBACK = '#B6AFA4'; // ink-4

export function domainColor(name: string): string {
  const key = name.trim().toLowerCase().replace(/\s+/g, ' ');
  if (PINNED[key]) return PINNED[key];
  // djb2 — tiny, deterministic, good spread for short strings.
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length]!;
}
