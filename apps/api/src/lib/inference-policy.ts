import { env } from './env.js';

// Local-only inference policy for the durable capture pipeline.
//
// Private capture content (transcripts, text, images) may only be sent to an
// approved self-hosted STT/LLM endpoint. "OpenAI-compatible" is a protocol,
// not a privacy guarantee, so the configured base URL is checked against an
// explicit allowlist before every model call the capture flow makes. A
// missing or unapproved endpoint leaves the capture saved and blocked; there
// is no cloud fallback.
//
// Allowed by default: loopback on any port, http or https. Additional origins
// (a tailnet LLM box, a LAN whisper server) are opted in through
// LOCAL_INFERENCE_ORIGINS, a comma-separated list of origins such as
// "http://100.101.102.103:8080,https://whisper.home.arpa".

export type InferenceKind = 'llm' | 'stt';

export class InferencePolicyError extends Error {
  constructor(public readonly code: 'endpoint_not_configured' | 'endpoint_not_approved', public readonly kind: InferenceKind, message: string) {
    super(message);
    this.name = 'InferencePolicyError';
  }
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

function normalizeOrigin(value: string): string | null {
  try {
    const u = new URL(value.trim());
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** Origins beyond loopback that the operator has explicitly approved. */
export function approvedInferenceOrigins(source: string | undefined = env.LOCAL_INFERENCE_ORIGINS): string[] {
  if (!source) return [];
  return source.split(',').map(normalizeOrigin).filter((o): o is string => o !== null);
}

export function isApprovedEndpoint(baseUrl: string | null | undefined, extraOrigins: string[] = approvedInferenceOrigins()): boolean {
  if (!baseUrl) return false;
  let u: URL;
  try { u = new URL(baseUrl); } catch { return false; }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return false;
  if (LOOPBACK_HOSTS.has(u.hostname)) return true;
  return extraOrigins.includes(u.origin);
}

/** Throws unless baseUrl is an approved self-hosted endpoint. */
export function assertApprovedEndpoint(kind: InferenceKind, baseUrl: string | null | undefined): void {
  if (!baseUrl) throw new InferencePolicyError('endpoint_not_configured', kind, `No ${kind} endpoint is configured.`);
  if (!isApprovedEndpoint(baseUrl)) {
    throw new InferencePolicyError('endpoint_not_approved', kind, `The configured ${kind} endpoint is not an approved local origin. Add it to LOCAL_INFERENCE_ORIGINS to allow it.`);
  }
}
