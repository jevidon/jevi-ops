'use server';

import { uploadsApi, ApiError, type Attachment } from '@/lib/api';

// Server action wrapper around the image upload. Client picks a file,
// passes the FormData here; we forward to the API and return the
// resulting Attachment record. The client component then appends it to
// the parent form's local attachments state.

export type UploadResult =
  | { ok: true; attachment: Attachment }
  | { ok: false; error: string };

export async function uploadImageAction(
  formData: FormData,
  prefix: 'notes' | 'journal' | 'other',
): Promise<UploadResult> {
  const file = formData.get('file');
  if (!(file instanceof Blob) || file.size === 0) {
    return { ok: false, error: 'No file attached.' };
  }
  try {
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
