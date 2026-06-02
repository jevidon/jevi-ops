import { z } from 'zod';

// Spec Addendum 02 §3 — notes use a finer-grained source_type instead of
// the old `type` enum. The type field has been removed entirely.

export const NoteSourceTypeSchema = z.enum([
  'own_thought',
  'reading_response',
  'meeting_note',
  'brainstorm',
  'observation',
  'other',
]);

// Image attachments — same shape used on notes + journal_entries. The
// schema is intentionally loose (everything optional except url+path)
// because the API trusts what it stored at upload time; the client
// never crafts these from scratch — it just adds/removes whole
// objects returned by /api/uploads/image.
//
// Location fields are populated server-side at upload time from EXIF
// GPS tags (when present). Phone-camera photos usually carry them;
// photos that came in via messaging apps typically don't. The address
// is a human-readable reverse-geocode of the coords.
export const AttachmentSchema = z.object({
  url: z.string().url(),
  storage_path: z.string().min(1),
  content_type: z.string().optional(),
  size_bytes: z.number().int().nonnegative().optional(),
  alt: z.string().nullable().optional(),
  uploaded_at: z.string().optional(),
  // GPS coordinates pulled from the image's EXIF, if present.
  gps: z.object({
    lat: z.number(),
    lon: z.number(),
  }).nullable().optional(),
  // Human-readable address from reverse geocoding. Free-form — we
  // display it as-is, no parsing.
  location: z.string().nullable().optional(),
});
export type Attachment = z.infer<typeof AttachmentSchema>;

export const NoteSchema = z.object({
  id: z.string().uuid(),
  title: z.string().nullable().optional(),
  body: z.string().min(1),
  source_type: NoteSourceTypeSchema,
  source_reference: z.string().nullable().optional(),
  tags: z.array(z.string()).default([]),
  related_project_id: z.string().uuid().nullable().optional(),
  related_person_id: z.string().uuid().nullable().optional(),
  related_quote_id: z.string().uuid().nullable().optional(),
  needs_review: z.boolean().default(false),
  attachments: z.array(AttachmentSchema).default([]),
  created_at: z.string().datetime({ offset: true }),
});

export const CreateNoteSchema = z.object({
  title: z.string().nullable().optional(),
  body: z.string().min(1),
  source_type: NoteSourceTypeSchema.default('own_thought'),
  // Nullable so clients can clear a previously-set value via PATCH. The
  // alternative — omit the field — would update *only* the non-null fields,
  // making it impossible to wipe a source_reference once it's been set.
  source_reference: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  related_project_id: z.string().uuid().nullable().optional(),
  related_person_id: z.string().uuid().nullable().optional(),
  related_quote_id: z.string().uuid().nullable().optional(),
  needs_review: z.boolean().optional(),
  attachments: z.array(AttachmentSchema).optional(),
});

export const UpdateNoteSchema = CreateNoteSchema.partial().extend({
  resurface_weight: z.number().min(0).optional(),
});
