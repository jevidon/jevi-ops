import { z } from 'zod';
import { CompleteVisitSchema } from './visit.js';

export const SourceSubjectSchema = z.object({
  asset_id: z.string().uuid().optional(),
  session_id: z.string().uuid().optional(),
}).refine((v) => Boolean(v.asset_id) !== Boolean(v.session_id), 'Choose one asset or onboarding session.');

export const CreateSourceNoteSchema = z.object({
  subject: SourceSubjectSchema,
  label: z.string().trim().min(1).max(255),
  kind: z.enum(['text', 'link']),
  text: z.string().max(200_000).optional(),
  url: z.string().url().max(4096).optional(),
}).superRefine((v, ctx) => {
  if (v.kind === 'text' && !v.text?.trim()) ctx.addIssue({ code: 'custom', path: ['text'], message: 'Enter source text.' });
  if (v.kind === 'link' && (!v.url || !/^https?:\/\//i.test(v.url))) ctx.addIssue({ code: 'custom', path: ['url'], message: 'Use an HTTP or HTTPS source URL.' });
  if (v.url) {
    try {
      const u = new URL(v.url);
      if (u.username || u.password) ctx.addIssue({ code: 'custom', path: ['url'], message: 'Source URLs cannot contain credentials.' });
    } catch { /* The URL validator already reports malformed values. */ }
  }
});

// Raw/approximate evidence survives even when it cannot form a service event.
export const SourceCandidateSchema = z.object({
  label: z.string().trim().min(1).max(255),
  date_text: z.string().max(100).nullable().optional(),
  date_precision: z.enum(['exact', 'month', 'year', 'unknown']).default('unknown'),
  original_reading: z.number().nonnegative().nullable().optional(),
  original_unit: z.enum(['km', 'mi']).nullable().optional(),
  source_location: z.string().max(255).nullable().optional(),
  original_span: z.string().max(20_000).nullable().optional(),
  notes: z.string().max(20_000).nullable().optional(),
  visit: CompleteVisitSchema.optional(),
}).strict();
export const CreateSourceCandidateSchema = z.object({
  operation_key: z.string().min(1).max(200),
  subject: SourceSubjectSchema,
  candidate: SourceCandidateSchema,
});
export const UpdateSourceCandidateSchema = z.object({
  expected_revision: z.number().int().positive(),
  candidate: SourceCandidateSchema,
});
export const AcceptSourceCandidateSchema = z.object({
  expected_revision: z.number().int().positive(),
  operation_key: z.string().min(1).max(200),
  visit: CompleteVisitSchema.extend({ visited_on: z.string().date() }),
  date_confirmed: z.boolean().default(false),
  unit_conversion_confirmed: z.boolean().default(false),
});
export type SourceSubject = z.infer<typeof SourceSubjectSchema>;
export type SourceCandidate = z.infer<typeof SourceCandidateSchema>;
