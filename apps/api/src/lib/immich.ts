import { env } from './env.js';
import { getAppSettings, getAppTz } from './app-settings.js';

// Immich client — journal "photos from this day". Immich runs as its own
// app (see infrastructure/DEPENDENCIES.md §4); we call its HTTP API
// server-side with the x-api-key so the key never reaches the browser.
//
// Endpoints used (Immich v1.106+):
//   POST /api/search/metadata            — assets by takenAfter/takenBefore
//   GET  /api/assets/:id/thumbnail?size= — preview bytes (proxied to the UI)
//   GET  /api/assets/:id/original        — full bytes (attach flow copies
//                                          these into UPLOADS_DIR)

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

/** Download the original asset (for the attach-to-journal copy). */
export async function fetchOriginal(assetId: string): Promise<{ bytes: Buffer; contentType: string }> {
  const cfg = await resolveConfig();
  if (!cfg) throw new Error('immich_not_configured');
  const res = await fetch(
    `${cfg.baseUrl}/api/assets/${encodeURIComponent(assetId)}/original`,
    { headers: { 'x-api-key': cfg.apiKey }, signal: AbortSignal.timeout(60_000) },
  );
  if (!res.ok) throw new Error(`immich_original_failed:${res.status}`);
  return {
    bytes: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get('content-type') ?? 'image/jpeg',
  };
}

// Midnight of `date` in `tz`, as a UTC Date. Same offset technique the
// reminder libs use.
function zonedMidnightUtc(date: string, tz: string): Date {
  const naive = new Date(`${date}T00:00:00`);
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
