import { env } from './env.js';
import { getAppSettings, getAppTz } from './app-settings.js';

// Immich client — journal "photos from this day". Immich runs as its own
// app (see infrastructure/DEPENDENCIES.md §4); we call its HTTP API
// server-side with the x-api-key so the key never reaches the browser.
//
// Endpoints used (Immich v1.106+):
//   POST /api/search/metadata            — assets by takenAfter/takenBefore
//   GET  /api/assets/:id/thumbnail?size= — preview bytes (proxied to the UI;
//                                          also what linked attachments render)
//   GET  /api/assets/:id                 — metadata for linked attachments
//                                          (taken_at / GPS / location)

interface ResolvedImmich {
  baseUrl: string;
  apiKey: string;
}

async function resolveConfig(): Promise<ResolvedImmich | null> {
  const s = await getAppSettings();
  const baseUrl = (s.immich_base_url ?? env.IMMICH_BASE_URL ?? '').replace(/\/$/, '');
  const apiKey = s.immich_api_key ?? env.IMMICH_API_KEY ?? '';
  if (!baseUrl || !apiKey) return null;
  return { baseUrl, apiKey };
}

export async function isImmichConfigured(): Promise<boolean> {
  return (await resolveConfig()) !== null;
}

export async function immichDescription(): Promise<string> {
  const cfg = await resolveConfig();
  return cfg ? cfg.baseUrl : 'base URL / API key not set';
}

export interface ImmichCandidate {
  id: string;
  taken_at: string;
  type: string; // IMAGE | VIDEO
}

/** Assets taken on a given local date (app timezone). */
export async function assetsForDate(date: string): Promise<ImmichCandidate[]> {
  const cfg = await resolveConfig();
  if (!cfg) throw new Error('immich_not_configured');

  // The local day [00:00, 24:00) expressed in UTC.
  const tz = await getAppTz();
  const dayStart = zonedMidnightUtc(date, tz);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const res = await fetch(`${cfg.baseUrl}/api/search/metadata`, {
    method: 'POST',
    headers: {
      'x-api-key': cfg.apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      takenAfter: dayStart.toISOString(),
      takenBefore: dayEnd.toISOString(),
      type: 'IMAGE',
      size: 100,
      withExif: false,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`immich_search_failed:${res.status}`);
  }
  const body = (await res.json()) as {
    assets?: { items?: Array<{ id: string; localDateTime?: string; fileCreatedAt?: string; type?: string }> };
  };
  const items = body.assets?.items ?? [];
  return items.map((a) => ({
    id: a.id,
    taken_at: a.localDateTime ?? a.fileCreatedAt ?? '',
    type: a.type ?? 'IMAGE',
  }));
}

/** Stream an asset's preview thumbnail (bytes + content type). */
export async function fetchThumbnail(assetId: string): Promise<{ bytes: Buffer; contentType: string }> {
  const cfg = await resolveConfig();
  if (!cfg) throw new Error('immich_not_configured');
  const res = await fetch(
    `${cfg.baseUrl}/api/assets/${encodeURIComponent(assetId)}/thumbnail?size=preview`,
    { headers: { 'x-api-key': cfg.apiKey }, signal: AbortSignal.timeout(10_000) },
  );
  if (!res.ok) throw new Error(`immich_thumbnail_failed:${res.status}`);
  return {
    bytes: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get('content-type') ?? 'image/jpeg',
  };
}

export interface ImmichAssetInfo {
  taken_at: string | null;
  gps: { lat: number; lon: number } | null;
  location: string | null;
}

/**
 * Asset metadata from Immich — used to backfill taken_at/gps/location when
 * the attached bytes carry no EXIF (the preview-JPEG fallback strips it).
 */
export async function fetchAssetInfo(assetId: string): Promise<ImmichAssetInfo> {
  const cfg = await resolveConfig();
  if (!cfg) throw new Error('immich_not_configured');
  const res = await fetch(`${cfg.baseUrl}/api/assets/${encodeURIComponent(assetId)}`, {
    headers: { 'x-api-key': cfg.apiKey, Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`immich_asset_info_failed:${res.status}`);
  const body = (await res.json()) as {
    localDateTime?: string;
    exifInfo?: {
      dateTimeOriginal?: string | null;
      latitude?: number | null;
      longitude?: number | null;
      city?: string | null;
      state?: string | null;
      country?: string | null;
    };
  };
  const exif = body.exifInfo;
  const gps =
    typeof exif?.latitude === 'number' && typeof exif?.longitude === 'number'
      ? { lat: exif.latitude, lon: exif.longitude }
      : null;
  const locationParts = [exif?.city, exif?.state, exif?.country].filter(Boolean);
  return {
    // localDateTime is Immich's wall-clock-at-capture field (the Z suffix is
    // convention, NOT UTC — this is what Immich's own timeline displays).
    // taken_at carries that convention: display it with timeZone 'UTC' so
    // the clock time renders verbatim. dateTimeOriginal is a true instant
    // and only a last-resort fallback.
    taken_at: body.localDateTime ?? exif?.dateTimeOriginal ?? null,
    gps,
    location: locationParts.length > 0 ? locationParts.join(', ') : null,
  };
}

// Midnight of `date` in `tz`, as a UTC Date. Same offset technique the
// reminder libs use. The guess MUST be parsed as UTC (trailing Z): a
// bare local-time parse applies the server's own offset on top of the
// app-tz one, shifting the whole day window (6h late on a Denver host).
function zonedMidnightUtc(date: string, tz: string): Date {
  const naive = new Date(`${date}T00:00:00Z`);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = dtf.formatToParts(naive);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  const asUtcMs = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'));
  const offsetMin = (asUtcMs - naive.getTime()) / 60_000;
  return new Date(naive.getTime() - offsetMin * 60_000);
}
