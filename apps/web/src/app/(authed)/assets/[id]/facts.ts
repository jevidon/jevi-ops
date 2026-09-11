import { factValue } from '@jevi-ops/shared';

// How a stored fact renders as text — shared by the asset page (what the
// editor shows) and the facts action (what "unchanged" is compared
// against), so an untouched row is recognised as untouched.
export function renderFact(raw: unknown): string {
  const v = factValue(raw);
  if (v != null) return String(v);
  return raw == null ? '' : typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
}

// An object with no scalar `value` — nested specs, arrays — has nothing a
// text box can edit. Rendered read-only; never round-tripped.
export function isStructuredFact(raw: unknown): boolean {
  return raw != null && typeof raw === 'object' && factValue(raw) == null;
}
