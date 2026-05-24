'use server';

import { uploadsApi, ApiError, type Attachment } from '@/lib/api';

// Server action wrapper around the image upload. Client picks a file
// + supplies a prefix as a FormData field (NOT a separate argument —
// Next.js server actions called programmatically are happiest with a
// single FormData arg; multi-arg signatures have surprising encoding
// edge cases that surface as opaque "server-side exception" errors).
//
// FormData fields expected:
//   - file:   the image blob
//   - prefix: 'notes' | 'journal' | 'other' (controls storage folder)

const VALID_PREFIXES = new Set(['notes', 'journal', 'other']);

export type UploadResult =
  | { ok: true; attachment: Attachment }
  | { ok: false; error: string };

export async function uploadImageAction(formData: FormData): Promise<UploadResult> {
  const file = formData.get('file');
  if (!(file instanceof Blob) || file.size === 0) {
    return { ok: false, error: 'No file attached.' };
  }
  const rawPrefix = String(formData.get('prefix') ?? 'other');
  const prefix: 'notes' | 'journal' | 'other' = VALID_PREFIXES.has(rawPrefix)
    ? (rawPrefix as 'notes' | 'journal' | 'other')
    : 'other';

  try {
    // The api helper forwards the FormData straight through; the
    // prefix lives in the URL query for the upstream API. The form
    // field is also forwarded harmlessly — the API ignores it.
    const attachment = await uploadsApi.image(formData, prefix);
    return { ok: true, attachment };
  } catch (err) {
    if (err instanceof ApiError) {
      const body = err.body as { error?: string; reason?: string } | null;
      const detail = body?.reason ? ` — ${body.reason}` : '';
      return { ok: false, error: `${body?.error ?? `API ${err.status}`}${detail}` };
    }
    return { ok: false, error: (err as Error).message };
  }
}
