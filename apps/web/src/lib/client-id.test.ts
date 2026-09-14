import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClientId } from './client-id';

afterEach(() => vi.unstubAllGlobals());

describe('createClientId', () => {
  it('uses native UUID generation when available', () => {
    const randomUUID = vi.fn(() => '12345678-1234-4234-8234-123456789abc');
    vi.stubGlobal('crypto', { randomUUID });
    expect(createClientId()).toBe('12345678-1234-4234-8234-123456789abc');
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it.each([0, 255])('creates a version 4 UUID from secure random bytes over HTTP (byte %i)', (byte) => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => bytes.fill(byte));
    vi.stubGlobal('crypto', { getRandomValues });
    expect(createClientId()).toBe(byte === 0
      ? '00000000-0000-4000-8000-000000000000'
      : 'ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(getRandomValues).toHaveBeenCalledOnce();
    expect(getRandomValues.mock.calls[0]![0]).toHaveLength(16);
  });
});
