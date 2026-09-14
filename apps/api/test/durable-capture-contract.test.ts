import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CaptureCommandEnvelopeSchema, CaptureCreatePayloadSchema, CaptureListQuerySchema, CaptureReceiptResponseSchema, OperationReceiptSchema,
} from '@jevi-ops/shared';
import { canonicalJson, envelopeDigest } from '../src/lib/capture/digest.js';

// The shared fixture corpus is the cross-language contract: TypeScript and the
// Python capture plugin must both accept these documents and compute the
// same ledger digest. No database needed.

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../packages/shared/fixtures/durable-capture');
const load = (name: string) => JSON.parse(readFileSync(resolve(DIR, name), 'utf8')) as Record<string, unknown>;

describe('durable capture fixtures', () => {
  it('every fixture file is accounted for', () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();
    expect(files).toEqual([
      'create-audio.json', 'create-text.json', 'digest.json', 'error-operation-id-reused.json', 'finalize.json',
      'operation-replay.json', 'receipt-awaiting-media.json', 'receipt-server-saved.json', 'retry.json',
    ]);
  });

  it('command envelopes parse and keep their discriminator', () => {
    expect(CaptureCommandEnvelopeSchema.parse(load('create-text.json')).command).toBe('capture.create');
    expect(CaptureCommandEnvelopeSchema.parse(load('create-audio.json')).command).toBe('capture.create');
    expect(CaptureCommandEnvelopeSchema.parse(load('finalize.json')).command).toBe('capture.finalize');
    expect(CaptureCommandEnvelopeSchema.parse(load('retry.json')).command).toBe('capture.retry_interpretation');
  });

  it('receipts and operation replays parse', () => {
    expect(CaptureReceiptResponseSchema.parse(load('receipt-server-saved.json')).receipt.receipt_kind).toBe('server_saved');
    const awaiting = CaptureReceiptResponseSchema.parse(load('receipt-awaiting-media.json'));
    expect(awaiting.receipt.receipt_kind).toBe('awaiting_media');
    expect(awaiting.receipt.uploads[0]?.resumable).toBe(false);
    const op = OperationReceiptSchema.parse((load('operation-replay.json') as { operation: unknown }).operation);
    expect(op.disposition).toBe('applied');
    expect(CaptureReceiptResponseSchema.parse(op.result).receipt.capture_id).toBe('0b9c8d7e-6f5a-4b3c-8d2e-1f0a9b8c7d6e');
    expect(load('error-operation-id-reused.json').error).toBe('operation_id_reused');
  });

  it('rejects malformed payloads the way the API will', () => {
    const text = CaptureCommandEnvelopeSchema.parse(load('create-text.json'));
    const base = text.payload;
    expect(CaptureCreatePayloadSchema.safeParse({ ...base, text: undefined }).success).toBe(false); // text kind needs text
    expect(CaptureCreatePayloadSchema.safeParse({ ...base, kind: 'audio' }).success).toBe(false); // audio needs attachments
    expect(CaptureCreatePayloadSchema.safeParse({ ...base, modality: 'spoken' }).success).toBe(false); // modality/kind mismatch
    expect(CaptureCreatePayloadSchema.safeParse({ ...base, extra: 1 }).success).toBe(false); // strict
    expect(CaptureCommandEnvelopeSchema.safeParse({ ...text, protocol_version: 2 }).success).toBe(false);
    expect(CaptureCommandEnvelopeSchema.safeParse({ ...text, command: 'capture.delete' }).success).toBe(false);
    expect(CaptureCreatePayloadSchema.parse({ ...base, intent: undefined }).intent).toBe('capture_only');
  });

  it('list query parses comma-separated states', () => {
    expect(CaptureListQuerySchema.parse({ state: 'queued, blocked,legacy', limit: '10' })).toEqual({ state: ['queued', 'blocked', 'legacy'], limit: 10 });
    expect(CaptureListQuerySchema.parse({})).toEqual({ state: undefined, limit: 50 });
    expect(CaptureListQuerySchema.safeParse({ state: 'nope' }).success).toBe(false);
  });

  it('ledger digest matches the shared fixture (canonical JSON, operation_id removed)', () => {
    const digest = load('digest.json') as { fixture: string; canonical: string; sha256: string };
    const envelope = load(digest.fixture);
    const { operation_id: _omit, ...rest } = envelope;
    expect(canonicalJson(rest)).toBe(digest.canonical);
    expect(envelopeDigest(envelope)).toBe(digest.sha256);
    // Identity is the content, not the operation id.
    expect(envelopeDigest({ ...envelope, operation_id: '00000000-0000-4000-8000-000000000000' })).toBe(digest.sha256);
    expect(envelopeDigest({ ...envelope, payload: { ...(envelope.payload as object), text: 'changed' } })).not.toBe(digest.sha256);
  });

  it('canonical JSON sorts keys recursively and preserves array order', () => {
    expect(canonicalJson({ b: [3, { z: 1, a: 2 }], a: 'ü', c: null })).toBe('{"a":"ü","b":[3,{"a":2,"z":1}],"c":null}');
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
});
