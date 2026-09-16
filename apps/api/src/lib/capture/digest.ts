import { createHash } from 'node:crypto';

// Canonical JSON + digest for the operation ledger. The same operation_id
// must carry the same command: the digest is computed over the envelope
// with operation_id removed, so a client retry (same id, same content)
// replays and a reuse (same id, different content) is rejected.
//
// Canonical form: object keys sorted (recursively), arrays in order, no
// whitespace, UTF-8, non-ASCII left unescaped. This matches Python's
// json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
// so the Hermes plugin computes identical digests (see the digest fixture in
// packages/shared/fixtures/durable-capture/).

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('canonical_json_non_finite_number');
    if (value === undefined) throw new Error('canonical_json_undefined');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Digest of a command envelope's semantic content (everything but operation_id). */
export function envelopeDigest(envelope: Record<string, unknown>): string {
  const { operation_id: _omit, ...rest } = envelope;
  return sha256Hex(canonicalJson(rest));
}
