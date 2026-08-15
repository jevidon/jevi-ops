// Domain identity colours (v2 design handoff, Jul 2026). A client-side map —
// no migration, per Jerad's call — used ONLY as an 11px chip in a domain header
// and a 3px bar on project cards. Not data: domains carry no colour column.
//
// Keyed by NORMALISED NAME (lowercased, whitespace-collapsed). Name-keying is
// the pragmatic choice without DB access to the live UUIDs; the trade-off is
// that a renamed domain falls back to neutral until its entry is updated here.
// Unmapped domains (per-channel domains, Inbox, anything new) get `null` → the
// caller renders a neutral swatch. THE COLOUR ASSIGNMENTS ARE A FIRST PASS —
// confirm against the real domain list.

const COLORS: Record<string, string> = {
  'hill media group': '#2F5D8A',
  'jerad hill photography': '#6B5B95',
  photography: '#6B5B95',
  life: '#A8763E',
  'jerad hill (personal)': '#3B6A52', // renamed to Life in 0007; alias kept
  'field notes': '#8A4B3C',
  'site nitro': '#4A6B70',
  'tech with jerad': '#8A6A2F',
};

// Neutral swatch for any domain without an assigned colour.
export const DOMAIN_COLOR_FALLBACK = '#B6AFA4'; // ink-4

export function domainColor(name: string): string {
  const key = name.trim().toLowerCase().replace(/\s+/g, ' ');
  return COLORS[key] ?? DOMAIN_COLOR_FALLBACK;
}
