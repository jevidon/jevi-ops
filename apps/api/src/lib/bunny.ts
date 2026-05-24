import { randomUUID } from 'node:crypto';
import { env } from './env.js';

// Thin Bunny Storage client. We talk to Bunny's HTTP API directly —
// PUT to upload, DELETE to remove. The CDN URL is constructed from the
// configured Pull Zone host.
//
// Docs: https://docs.bunny.net/reference/storage-api

export interface StoredAttachment {
  url: string;
  storage_path: string;
  content_type: string;
  size_bytes: number;
  alt: string | null;
  uploaded_at: string;
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
// Files get a random UUID name (unguessable) plus the right extension.
// We never honor a client-provided filename — that's an attack surface.
export async function uploadImage(params: {
  bytes: Buffer;
  contentType: string;
  prefix: 'notes' | 'journal' | 'other';
  alt?: string | null;
}): Promise<StoredAttachment> {
  if (!isBunnyConfigured()) {
    throw new Error('bunny_not_configured');
  }
  const ext = extensionForImage(params.contentType);
  if (!ext) {
    throw new Error(`unsupported_content_type:${params.contentType}`);
  }

  const storage_path = `${params.prefix}/${randomUUID()}.${ext}`;
  const url = `${storageEndpoint()}/${env.BUNNY_STORAGE_ZONE}/${storage_path}`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      AccessKey: env.BUNNY_STORAGE_ACCESS_KEY!,
      'Content-Type': params.contentType,
    },
    body: params.bytes,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`bunny_upload_failed:${res.status}:${body.slice(0, 200)}`);
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
  };
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
