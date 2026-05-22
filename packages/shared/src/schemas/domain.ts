import { z } from 'zod';

export const FailurePatternSchema = z.object({
  rule: z.string(),
  value: z.unknown().optional(),
}).passthrough();

export const DomainSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  fruit_definition: z.string().nullable().optional(),
  failure_patterns: z.array(FailurePatternSchema).default([]),
  expected_cadence: z.string().nullable().optional(),
  active: z.boolean(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});
