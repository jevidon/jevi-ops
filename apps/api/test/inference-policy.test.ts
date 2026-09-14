import { describe, expect, it } from 'vitest';
import { approvedInferenceOrigins, assertApprovedEndpoint, InferencePolicyError, isApprovedEndpoint } from '../src/lib/inference-policy.js';

// Local-only inference policy: loopback always, listed origins by opt-in,
// everything else refused. No database needed.

describe('inference policy', () => {
  it('approves loopback on any port and scheme', () => {
    for (const url of ['http://127.0.0.1:8080/v1', 'http://localhost:11434/v1', 'https://localhost/v1', 'http://[::1]:8000/v1']) {
      expect(isApprovedEndpoint(url, []), url).toBe(true);
    }
  });

  it('refuses cloud, LAN, other loopback addresses and credentialed URLs by default', () => {
    for (const url of ['https://api.openai.com/v1', 'https://api.anthropic.com', 'http://192.168.1.20:8080/v1', 'http://127.0.0.2:8080/v1', 'http://user:pw@127.0.0.1:8080/v1', 'ftp://127.0.0.1/x', 'not a url', '']) {
      expect(isApprovedEndpoint(url, []), url).toBe(false);
    }
  });

  it('parses LOCAL_INFERENCE_ORIGINS into origins and matches exact origin only', () => {
    const origins = approvedInferenceOrigins(' http://100.101.102.103:8080/v1/ignored , https://whisper.home.arpa, junk, http://u:p@10.0.0.1 ');
    expect(origins).toEqual(['http://100.101.102.103:8080', 'https://whisper.home.arpa']);
    expect(isApprovedEndpoint('http://100.101.102.103:8080/v1', origins)).toBe(true);
    expect(isApprovedEndpoint('http://100.101.102.103:8081/v1', origins)).toBe(false); // different port
    expect(isApprovedEndpoint('http://whisper.home.arpa/v1', origins)).toBe(false); // scheme differs
    expect(isApprovedEndpoint('https://whisper.home.arpa/v1/audio', origins)).toBe(true);
  });

  it('throws typed errors for missing and unapproved endpoints', () => {
    expect(() => assertApprovedEndpoint('stt', null)).toThrow(InferencePolicyError);
    try { assertApprovedEndpoint('stt', null); } catch (e) { expect((e as InferencePolicyError).code).toBe('endpoint_not_configured'); }
    try { assertApprovedEndpoint('llm', 'https://api.openai.com/v1'); } catch (e) { expect((e as InferencePolicyError).code).toBe('endpoint_not_approved'); }
    expect(() => assertApprovedEndpoint('llm', 'http://127.0.0.1:8080/v1')).not.toThrow();
  });
});
