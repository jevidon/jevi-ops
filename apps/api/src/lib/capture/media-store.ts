import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readdir, readFile, realpath, rename, stat, unlink } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { CaptureMediaType } from '@jevi-ops/shared';
import { env } from '../env.js';

// Private, durable storage for capture media (audio/images saved before any
// model runs). Mirrors lib/private-sources.ts: a 0700 directory outside the
// public uploads root, 0600 files under server-composed UUID keys, and a
// containment re-check on every read. Nothing here is ever served by the
// static /uploads route.
//
// Durability boundary for one object:
//   temp <id>.<random>.part  (O_EXCL, 0600) → write → fsync(file)
//   → rename to <id> → fsync(directory) → only then the DB row flips.
// A crash between rename and the DB update leaves a verified file with a
// "reserved" row; the next upload/finalize adopts it (hash re-checked). A
// crash before rename leaves a .part file that the next attempt removes.

export class CaptureMediaError extends Error {
  constructor(public status: number, public code: string, message: string, public details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'CaptureMediaError';
  }
}

export const STALE_PART_MS = 10 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Indirection so failure-injection tests can break one persistence step
// (write, fsync, rename, directory sync) without mocking node:fs globally.
export const mediaFs = {
  open,
  rename,
  unlink,
  async fsyncDirectory(dir: string): Promise<void> {
    const handle = await open(dir, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  },
};

function inside(parent: string, child: string): boolean {
  const p = relative(parent, child);
  return p === '' || (!p.startsWith('..') && !isAbsolute(p));
}

function overlaps(a: string, b: string): boolean {
  return inside(a, b) || inside(b, a);
}

export function isCaptureMediaConfigured(): boolean {
  return Boolean(env.CAPTURE_MEDIA_DIR);
}

export async function captureMediaDirectory(options: { create?: boolean } = {}): Promise<string> {
  const configured = env.CAPTURE_MEDIA_DIR;
  if (!configured) throw new CaptureMediaError(503, 'capture_media_not_configured', 'Set CAPTURE_MEDIA_DIR to a private directory outside public image storage.');
  const root = resolve(configured);
  const others = [env.UPLOADS_DIR, process.env.PRIVATE_SOURCES_DIR].filter((d): d is string => Boolean(d)).map((d) => resolve(d));
  for (const other of others) {
    if (overlaps(other, root)) throw new CaptureMediaError(503, 'capture_media_overlaps', 'Capture media must live outside UPLOADS_DIR and PRIVATE_SOURCES_DIR.');
  }
  if (options.create !== false) await mkdir(root, { recursive: true, mode: 0o700 });
  const actual = await realpath(root);
  for (const other of others) {
    const real = await realpath(other).catch(() => other);
    if (overlaps(real, actual)) throw new CaptureMediaError(503, 'capture_media_overlaps', 'Capture media must live outside UPLOADS_DIR and PRIVATE_SOURCES_DIR.');
  }
  return actual;
}

export function sha256Of(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Magic-byte check: the declared media type must match the content. */
export function validateMediaBytes(bytes: Buffer, declared: CaptureMediaType): void {
  const p = bytes.subarray(0, 16);
  const ascii = (from: number, to: number) => p.toString('ascii', from, to);
  const ok = declared === 'audio/webm' ? p[0] === 0x1a && p[1] === 0x45 && p[2] === 0xdf && p[3] === 0xa3
    : declared === 'audio/mp4' || declared === 'audio/m4a' ? ascii(4, 8) === 'ftyp'
    : declared === 'audio/wav' ? ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE'
    : declared === 'audio/ogg' ? ascii(0, 4) === 'OggS'
    : declared === 'image/jpeg' ? p[0] === 0xff && p[1] === 0xd8 && p[2] === 0xff
    : declared === 'image/png' ? p.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : declared === 'image/webp' ? ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP'
    : false;
  if (!ok) throw new CaptureMediaError(415, 'media_type_mismatch', `The uploaded bytes are not ${declared}.`);
}

export interface ExpectedMedia { sha256: string; size_bytes: number }

function assertMatches(bytes: Buffer, expected: ExpectedMedia): void {
  if (bytes.length !== expected.size_bytes || sha256Of(bytes) !== expected.sha256) {
    throw new CaptureMediaError(409, 'media_digest_mismatch', 'The uploaded bytes do not match the reserved size and sha256.', { expected_size_bytes: expected.size_bytes, received_size_bytes: bytes.length });
  }
}

function assertKey(key: string): void {
  if (!UUID_RE.test(key)) throw new CaptureMediaError(500, 'capture_media_key_invalid', 'Capture media reference is invalid.');
}

/** True when the final object exists and matches the reservation. */
export async function verifyStoredMedia(attachmentId: string, expected: ExpectedMedia): Promise<boolean> {
  assertKey(attachmentId);
  const dir = await captureMediaDirectory();
  const path = await realpath(join(dir, attachmentId)).catch(() => null);
  if (!path || !inside(dir, path)) return false;
  const bytes = await readFile(path).catch(() => null);
  if (!bytes) return false;
  return bytes.length === expected.size_bytes && sha256Of(bytes) === expected.sha256;
}

async function removeStaleParts(dir: string, attachmentId: string, now = Date.now()): Promise<void> {
  const names = await readdir(dir).catch(() => [] as string[]);
  for (const name of names) {
    if (!name.startsWith(`${attachmentId}.`) || !name.endsWith('.part')) continue;
    const info = await stat(join(dir, name)).catch(() => null);
    if (info && now - info.mtimeMs > STALE_PART_MS) await mediaFs.unlink(join(dir, name)).catch(() => {});
  }
}

function storageFailure(err: unknown): CaptureMediaError {
  const code = (err as { code?: string })?.code;
  if (code === 'ENOSPC') return new CaptureMediaError(507, 'capture_storage_full', 'The capture media volume is out of space. The reservation is kept; retry after freeing space.');
  return new CaptureMediaError(500, 'capture_storage_failed', 'Writing the capture media failed. The reservation is kept; retry with the same attachment_id.', { cause: code ?? 'unknown' });
}

/**
 * Verify bytes against the reservation and place them durably under the
 * attachment id. Returns `adopted: true` when a matching object already
 * existed (a retry after a crash, or a concurrent upload that won).
 */
export async function writeVerifiedMedia(attachmentId: string, bytes: Buffer, expected: ExpectedMedia): Promise<{ adopted: boolean }> {
  assertKey(attachmentId);
  assertMatches(bytes, expected);
  const dir = await captureMediaDirectory();
  const final = join(dir, attachmentId);
  await removeStaleParts(dir, attachmentId);
  const existing = await readFile(final).catch(() => null);
  if (existing) {
    if (existing.length === expected.size_bytes && sha256Of(existing) === expected.sha256) return { adopted: true };
    // A verified object is never overwritten; a differing object under this
    // id means a reservation was reused, which the DB layer forbids.
    throw new CaptureMediaError(409, 'media_object_conflict', 'A different object already exists for this attachment.');
  }
  const temp = join(dir, `${attachmentId}.${randomUUID()}.part`);
  try {
    const handle = await mediaFs.open(temp, 'wx', 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await mediaFs.rename(temp, final);
    try {
      await mediaFs.fsyncDirectory(dir);
    } catch (err) {
      // Some filesystems refuse fsync on a directory handle; the rename
      // itself is atomic there. Anything else is a real durability failure.
      const code = (err as { code?: string })?.code;
      if (code !== 'EINVAL' && code !== 'EPERM' && code !== 'EISDIR') throw err;
    }
    return { adopted: false };
  } catch (err) {
    await mediaFs.unlink(temp).catch(() => {});
    if (err instanceof CaptureMediaError) throw err;
    throw storageFailure(err);
  }
}

export async function readCaptureMedia(storageKey: string): Promise<Buffer> {
  assertKey(storageKey);
  const dir = await captureMediaDirectory();
  const path = await realpath(join(dir, storageKey)).catch(() => null);
  if (!path || !inside(dir, path)) throw new CaptureMediaError(404, 'media_bytes_unavailable', 'The stored media bytes are unavailable.');
  return readFile(path);
}
