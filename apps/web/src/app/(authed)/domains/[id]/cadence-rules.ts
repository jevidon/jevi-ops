// Shared constants for the cadence rule editor. Lives in its own file
// (not actions.ts) because `'use server'` files can only export async
// functions — constants and types fail the build otherwise.

export const CADENCE_RULE_TYPES = [
  'none',
  'days_since_journal',
  'days_since_publish',
  'no_activity_days',
] as const;
export type CadenceRuleType = (typeof CADENCE_RULE_TYPES)[number];

export const CADENCE_RULE_LABELS: Record<CadenceRuleType, string> = {
  none: 'None — unconfigured',
  days_since_journal: 'Days since a journal entry',
  days_since_publish: 'Days since publish (content_items)',
  no_activity_days: 'Days since project activity (activity_log)',
};

export const PRIMARY_CADENCE_RULES: Set<string> = new Set(
  CADENCE_RULE_TYPES.filter((r) => r !== 'none'),
);
