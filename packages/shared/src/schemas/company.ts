import { z } from 'zod';

// Companies (Addendum 05 §4) — client/vendor/partner orgs. People and
// projects link to a company; conversations roll their occurred_at up
// into companies.last_interaction_at (Phase 2). Mirrors migration 0033.

export const CompanyRelationshipTypeSchema = z.enum([
  'active_client', 'past_client', 'prospect',
  'vendor', 'partner', 'brand_deal', 'other',
]);
export type CompanyRelationshipType = z.infer<typeof CompanyRelationshipTypeSchema>;

export const CompanySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  domain_id: z.string().uuid().nullable().optional(),
  relationship_type: CompanyRelationshipTypeSchema.nullable().optional(),
  website: z.string().nullable().optional(),
  primary_email: z.string().nullable().optional(),
  primary_phone: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  first_engagement_at: z.string().date().nullable().optional(),
  last_interaction_at: z.string().datetime({ offset: true }).nullable().optional(),
  next_review_at: z.string().date().nullable().optional(),
  // Silent-client check-in cadence in days (migration 0045). Null → rule
  // default 30. Only consulted for active_client companies.
  checkin_interval_days: z.number().int().positive().nullable().optional(),
  active: z.boolean(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});
export type Company = z.infer<typeof CompanySchema>;

// All optional fields .nullable() so a PATCH can explicitly clear them,
// matching the project/person convention.
export const CreateCompanySchema = z.object({
  name: z.string().min(1),
  domain_id: z.string().uuid().nullable().optional(),
  relationship_type: CompanyRelationshipTypeSchema.nullable().optional(),
  website: z.string().nullable().optional(),
  primary_email: z.string().nullable().optional(),
  primary_phone: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  first_engagement_at: z.string().date().nullable().optional(),
  next_review_at: z.string().date().nullable().optional(),
  checkin_interval_days: z.number().int().positive().nullable().optional(),
  active: z.boolean().optional(),
});

export const UpdateCompanySchema = CreateCompanySchema.partial();

// ─── project_contacts (additional contacts beyond primary) ────────────

export const ProjectContactSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  person_id: z.string().uuid(),
  role: z.string().nullable().optional(),
  created_at: z.string().datetime({ offset: true }),
});
export type ProjectContact = z.infer<typeof ProjectContactSchema>;

export const CreateProjectContactSchema = z.object({
  person_id: z.string().uuid(),
  role: z.string().nullable().optional(),
});
