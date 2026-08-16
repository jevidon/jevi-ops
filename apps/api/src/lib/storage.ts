import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import exifr from 'exifr';
import { env } from './env.js';
import { getAppTz } from './app-settings.js';
import type { StoredAttachment } from '../db/schema.js';

// Local image storage — files land under UPLOADS_DIR (a NAS volume in
// prod) and are served by the API at /uploads/<storage_path> via
// @fastify/static. Replaces the Bunny CDN client; the StoredAttachment
// shape is unchanged, so rows written by the Bunny era (absolute
// b-cdn.net URLs) keep rendering as long as that account exists, while
// new rows point at this API.
//
// On upload we also try to extract EXIF GPS coordinates and
// reverse-geocode them to a human-readable address (via OpenStreetMap
// Nominatim — no API key required). Both steps fail silently: missing
// GPS, geocoding hiccup, or rate-limiting just means no location on
// that attachment.

export type { StoredAttachment };

export function isStorageConfigured(): boolean {
  return Boolean(env.UPLOADS_DIR);
}

export function uploadsDir(): string {
  if (!env.UPLOADS_DIR) throw new Error('storage_not_configured');
  return env.UPLOADS_DIR;
}

// Public origin of the API — used to build the absolute URL stored on the
// attachment record (the web app renders it directly).
function apiPublicOrigin(): string {
  const base = env.API_PUBLIC_URL ?? `http://localhost:${env.API_PORT}`;
  return base.replace(/\/$/, '');
}

// Translate a content-type to a sensible file extension. We trust the
// browser-provided MIME type (it sniffs the actual bytes for most
// common formats); allowing only a known whitelist keeps us from
// storing executables or random blobs.
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

export function extensionForImage(mime: string): string | null {
  return EXT_BY_MIME[mime.toLowerCase()] ?? null;
}

// Write a buffer under UPLOADS_DIR and return the served URL + storage
// path. `prefix` is the logical folder ("notes", "journal").
//
// Filename shape: `YYYYMMDD-<slug>-<rand4>.<ext>`. The date prefix uses
// the photo's EXIF DateTimeOriginal when available (so the file name
// reflects when the photo was taken, not when it was uploaded); falls
// back to today. The slug comes from a hint the caller passes (note
// title or first words of the body), slugified. The 4-character suffix
// prevents collisions on same-day same-title uploads. We never honor a
// client-provided raw filename — that's an attack surface; only the
// *hint* gets slugified.
export async function uploadImage(params: {
  bytes: Buffer;
  contentType: string;
  prefix: 'notes' | 'journal' | 'other';
  alt?: string | null;
  titleHint?: string | null;
}): Promise<StoredAttachment> {
  if (!isStorageConfigured()) {
    throw new Error('storage_not_configured');
  }
  const ext = extensionForImage(params.contentType);
  if (!ext) {
    throw new Error(`unsupported_content_type:${params.contentType}`);
  }

  // EXIF date + GPS + geocode run alongside the write. All decoration; if
  // any step fails the upload still succeeds with sensible defaults
  // (today's date, no location).
  const exifDatePromise = extractDateTaken(params.bytes).catch(() => null);
  const geocodePromise = extractAndGeocode(params.bytes).catch(() => null);

  const exifDate = await exifDatePromise;
  const datePart = formatYYYYMMDD(exifDate ?? new Date(), await getAppTz());
  const slug = slugifyForFilename(params.titleHint ?? '');
  const suffix = randomUUID().slice(0, 4);
  const storage_path = `${params.prefix}/${datePart}-${slug}-${suffix}.${ext}`;

  // Defense in depth: the path is fully server-composed, but normalize and
  // confine it to UPLOADS_DIR anyway.
  const absolute = normalize(join(uploadsDir(), storage_path));
  if (!absolute.startsWith(normalize(uploadsDir()))) {
    throw new Error('storage_path_escape');
  }

  const [, location] = await Promise.all([
    (async () => {
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, params.bytes);
    })(),
    geocodePromise,
  ]);

  return {
    url: `${apiPublicOrigin()}/uploads/${storage_path}`,
    storage_path,
    content_type: params.contentType,
    size_bytes: params.bytes.byteLength,
    alt: params.alt?.trim() || null,
    uploaded_at: new Date().toISOString(),
    gps: location?.gps ?? null,
    location: location?.address ?? null,
    taken_at: exifDate ? wallClockIso(exifDate) : null,
  };
}

// ─── EXIF + reverse geocoding ──────────────────────────────────────────

interface ExtractedLocation {
  gps: { lat: number; lon: number };
  address: string | null;
}

async function extractAndGeocode(bytes: Buffer): Promise<ExtractedLocation | null> {
  let gps: { latitude?: number; longitude?: number } | null;
  try {
    gps = await exifr.gps(bytes);
  } catch {
    return null;
  }
  if (!gps || typeof gps.latitude !== 'number' || typeof gps.longitude !== 'number') {
    return null;
  }
  const coords = { lat: gps.latitude, lon: gps.longitude };
  const address = await reverseGeocode(coords.lat, coords.lon).catch(() => null);
  return { gps: coords, address };
}

// EXIF DateTimeOriginal → JS Date, trying fields in order of "most
// authoritative."
async function extractDateTaken(bytes: Buffer): Promise<Date | null> {
  try {
    const parsed = await exifr.parse(bytes, {
      pick: ['DateTimeOriginal', 'CreateDate', 'ModifyDate'],
    });
    if (!parsed) return null;
    const candidate = parsed.DateTimeOriginal ?? parsed.CreateDate ?? parsed.ModifyDate;
    if (candidate instanceof Date && !Number.isNaN(candidate.getTime())) {
      return candidate;
    }
    return null;
  } catch {
    return null;
  }
}

// taken_at convention: the capture wall-clock time with a Z suffix that
// means "as written", NOT UTC (same convention as Immich's localDateTime).
// EXIF has no timezone, and exifr hands back a Date whose *local* getters
// hold the EXIF digits — serialize those directly. toISOString() would
// shift them through the server's timezone. Display with timeZone 'UTC'.
function wallClockIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}Z`;
}

// YYYYMMDD in the app's configured TZ so the filename matches the day
// the user thinks the photo was taken. UTC would surprise overnight.
function formatYYYYMMDD(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${g('year')}${g('month')}${g('day')}`;
}

// Slugify free text for use in filenames. Lowercase, ASCII-only,
// hyphen-separated, capped at 4 words. Strips diacritics so "café"
// becomes "cafe" rather than "caf-" (which would lose the e entirely).
const MAX_WORDS = 4;
const MAX_CHARS = 40;
function slugifyForFilename(raw: string): string {
  const normalized = raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')   // strip combining diacritics
    .toLowerCase()
    .replace(/['']/g, '')              // squash apostrophes (joe's → joes)
    .replace(/[^a-z0-9]+/g, '-')       // anything else → hyphen
    .replace(/^-+|-+$/g, '')           // trim leading/trailing
    .replace(/-{2,}/g, '-');           // collapse runs
  if (!normalized) return 'untitled';
  const truncated = normalized.split('-').slice(0, MAX_WORDS).join('-');
  return truncated.length > MAX_CHARS ? truncated.slice(0, MAX_CHARS).replace(/-+$/, '') : truncated;
}

async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
  // Nominatim's reverse endpoint. zoom=18 gives building-level
  // precision; "addressdetails=0" because we just want display_name.
  const url = new URL('https://nominatim.openstreetmap.org/reverse');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('lat', lat.toFixed(6));
  url.searchParams.set('lon', lon.toFixed(6));
  url.searchParams.set('zoom', '18');
  url.searchParams.set('addressdetails', '0');

  const res = await fetch(url.toString(), {
    headers: {
      // Nominatim TOS asks for an identifying User-Agent.
      'User-Agent': 'jevi-ops/1.0 (self-hosted)',
      Accept: 'application/json',
    },
    // Short timeout — if Nominatim is slow, drop the location rather
    // than make the user wait.
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { display_name?: string };
  return body.display_name?.trim() || null;
}

// Delete a stored file by its storage_path. Best-effort: missing file
// counts as success (already gone). Bunny-era rows (paths that only exist
// on the CDN) simply return false.
export async function deleteImage(storage_path: string): Promise<boolean> {
  if (!isStorageConfigured()) return false;
  const absolute = normalize(join(uploadsDir(), storage_path));
  if (!absolute.startsWith(normalize(uploadsDir()))) return false;
  try {
    await unlink(absolute);
    return true;
  } catch (err) {
    return (err as { code?: string }).code === 'ENOENT';
  }
}
