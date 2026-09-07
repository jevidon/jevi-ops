import { z } from 'zod';

// The markdown overview document (0050) that assets, projects, and domains
// carry beside their one-line description. Saved with optimistic
// concurrency: a PATCH sends `doc_md` with the `doc_version` it was written
// against; a mismatch is a 409 doc_conflict carrying the current body and
// version, never a silent overwrite. Every saved version is kept in
// doc_revisions.

export const DOC_ENTITY_TYPES = ['asset', 'project', 'domain'] as const;
export const DocEntityTypeSchema = z.enum(DOC_ENTITY_TYPES);
export type DocEntityType = z.infer<typeof DocEntityTypeSchema>;

// The fields the three entity schemas share.
export const docFields = {
  doc_md: z.string().nullable().optional(),
  doc_version: z.number().int().positive().optional(),
};

// On an update: `doc_md` is the new body (null clears it); `doc_version`
// is the version the writer last saw. Omit `doc_version` for an
// unconditional write (imports).
export const docUpdateFields = {
  doc_md: z.string().max(200_000).nullable().optional(),
  doc_version: z.number().int().positive().optional(),
};

export const DocRevisionSchema = z.object({
  id: z.string().uuid(),
  entity_type: DocEntityTypeSchema,
  entity_id: z.string().uuid(),
  version: z.number().int().positive(),
  body: z.string().nullable(),
  actor: z.string().nullable(),
  created_at: z.string().datetime({ offset: true }),
});
export type DocRevision = z.infer<typeof DocRevisionSchema>;

export const DocConflictSchema = z.object({
  error: z.literal('doc_conflict'),
  doc_md: z.string().nullable(),
  doc_version: z.number().int(),
  message: z.string(),
});
