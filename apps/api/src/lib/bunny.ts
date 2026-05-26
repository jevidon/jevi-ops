import { randomUUID } from 'node:crypto';
import exifr from 'exifr';
import { env } from './env.js';
import { getAppTz } from './app-settings.js';

// Thin Bunny Storage client. We talk to Bunny's HTTP API directly —
// PUT to upload, DELETE to remove. The CDN URL is constructed from the
// configured Pull Zone host.
//
// On upload we also try to extract EXIF GPS coordinates and
// reverse-geocode them to a human-readable address (via OpenStreetMap
// Nominatim — no API key required). Both steps fail silently: missing
// GPS, geocoding hiccup, or rate-limiting just means no location on
// that attachment.
//
// Docs: https://docs.bunny.net/reference/storage-api
//       https://nominatim.org/release-docs/develop/api/Reverse/

export interface StoredAttachment {
  url: string;
  storage_path: string;
  content_type: string;
  size_bytes: number;
  alt: string | null;
  uploaded_at: string;
  gps?: { lat: number; lon: number } | null;
  location?: string | null;
}

export function isBunnyConfigured(): boolean {
  return Boolean(
    env.BUNNY_STORAGE_ZONE &&
    env.BUNNY_STORAGE_ACCESS_KEY &&
    env.BUNNY_CDN_HOST,
  );
}

// Compose the storage-region-aware endpoint. Bunny's default region (no
// prefix) is Frankfurt; "ny", "la", "sg", "syd" map to other regions.
function storageEndpoint(): string {
  const region = (env.BUNNY_STORAGE_REGION ?? '').trim().toLowerCase();
  const prefix = region ? `${region}.` : '';
  return `https://${prefix}storage.bunnycdn.com`;
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
  'image/heic': 'heic',
  'image/heif': 'heif',
};

export function extensionForImage(mime: string): string | null {
  return EXT_BY_MIME[mime.toLowerCase()] ?? null;
}

// Upload a buffer to Bunny Storage and return the CDN-facing URL +
// storage path. `prefix` is the logical folder ("notes", "journal").
//
// Filename shape: `YYYYMMDD-<slug>-<rand4>.<ext>`. The date prefix uses
// the photo's EXIF DateTimeOriginal when available (so the file name
// reflects when the photo was taken, not when it was uploaded — much
// nicer for browsing storage); falls back to today. The slug comes
// from a hint the caller passes (note title or first words of the
// body), slugified. The 4-character suffix prevents collisions on
// same-day same-title uploads. We never honor a client-provided raw
// filename — that's an attack surface; only the *hint* gets slugified.
//
// EXIF GPS extraction + reverse geocoding happen in parallel with the
// upload itself, so they don't slow it down. Both are best-effort —
// missing GPS, network blip, or rate limit just means no location on
// the returned record. The upload always succeeds.
export async function uploadImage(params: {
  bytes: Buffer;
  contentType: string;
  prefix: 'notes' | 'journal' | 'other';
  alt?: string | null;
  // Free-form text the server slugifies into the filename. Notes pass
  // the title; journal entries pass the first few words of the body.
  // Empty/missing → "untitled".
  titleHint?: string | null;
}): Promise<StoredAttachment> {
  if (!isBunnyConfigured()) {
    throw new Error('bunny_not_configured');
  }
  const ext = extensionForImage(params.contentType);
  if (!ext) {
    throw new Error(`unsupported_content_type:${params.contentType}`);
  }

  // EXIF date + GPS + geocode in parallel with the upload. All decoration;
  // if any step fails the upload itself still succeeds with sensible
  // defaults (today's date, no location).
  const exifDatePromise = extractDateTaken(params.bytes).catch(() => null);
  const geocodePromise = extractAndGeocode(params.bytes).catch(() => null);

  // The filename needs the date, so wait on it before composing the path.
  const exifDate = await exifDatePromise;
  const datePart = formatYYYYMMDD(exifDate ?? new Date(), await getAppTz());
  const slug = slugifyForFilename(params.titleHint ?? '');
  const suffix = randomUUID().slice(0, 4);
  const storage_path = `${params.prefix}/${datePart}-${slug}-${suffix}.${ext}`;
  const url = `${storageEndpoint()}/${env.BUNNY_STORAGE_ZONE}/${storage_path}`;

  const [uploadRes, location] = await Promise.all([
    fetch(url, {
      method: 'PUT',
      headers: {
        AccessKey: env.BUNNY_STORAGE_ACCESS_KEY!,
        'Content-Type': params.contentType,
      },
      body: params.bytes,
    }),
    geocodePromise,
  ]);

  if (!uploadRes.ok) {
    const body = await uploadRes.text().catch(() => '');
    throw new Error(`bunny_upload_failed:${uploadRes.status}:${body.slice(0, 200)}`);
  }

  // Public CDN URL via the Pull Zone host. Strip any accidental
  // protocol prefix on BUNNY_CDN_HOST in case the user pasted the full
  // URL into their env.
  const cdnHost = (env.BUNNY_CDN_HOST ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const cdnUrl = `https://${cdnHost}/${storage_path}`;

  return {
    url: cdnUrl,
    storage_path,
    content_type: params.contentType,
    size_bytes: params.bytes.byteLength,
    alt: params.alt?.trim() || null,
    uploaded_at: new Date().toISOString(),
    gps: location?.gps ?? null,
    location: location?.address ?? null,
  };
}

// ─── EXIF + reverse geocoding ──────────────────────────────────────────
//
// Pull GPS from EXIF (exifr reads from a Buffer just fine), then
// reverse-geocode via OpenStreetMap's Nominatim service. Nominatim is
// free and requires no API key, but does ask for a User-Agent
// identifying the consumer and limits us to ~1 req/sec — fine for
// personal-use upload frequency.

interface ExtractedLocation {
  gps: { lat: number; lon: number };
  address: string | null;
}

async function extractAndGeocode(bytes: Buffer): Promise<ExtractedLocation | null> {
  // exifr.gps() returns { latitude, longitude } or null. It's
  // resilient to non-image inputs (returns null) so we don't need
  // a content-type pre-check.
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

// EXIF DateTimeOriginal → JS Date. exifr.parse() returns a parsed
// object with .DateTimeOriginal as a Date. Some photos only have
// CreateDate or ModifyDate; we try in order of "most authoritative."
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
      'User-Agent': 'jerad-ops/1.0 (https://dashboard.jeradhill.com)',
      Accept: 'application/json',
    },
    // Short timeout — if Nominatim is slow, drop the location rather
    // than make the user wait. AbortController via signal-with-timeout.
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { display_name?: string };
  return body.display_name?.trim() || null;
}

// Delete a stored file by its storage_path. Best-effort: 404 means it
// was already gone, which is also fine. Returns true on success or
// already-deleted; false on any other failure.
export async function deleteImage(storage_path: string): Promise<boolean> {
  if (!isBunnyConfigured()) return false;
  const url = `${storageEndpoint()}/${env.BUNNY_STORAGE_ZONE}/${storage_path}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { AccessKey: env.BUNNY_STORAGE_ACCESS_KEY! },
  });
  return res.ok || res.status === 404;
}
