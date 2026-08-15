import type { Urgency } from '@jerad-ops/shared';

// Contact-silence → the four urgency pill states (v2 CRM). Shared by People and
// Companies. Never-contacted reads "quiet", not "overdue" — a person with no
// logged conversation isn't necessarily a lapsed relationship.
export function silenceUrgency(days: number | null): Urgency {
  if (days == null) return 'quiet';
  if (days >= 30) return 'over';
  if (days >= 14) return 'due';
  if (days <= 3) return 'ok';
  return 'quiet';
}

// Duration only — the pill's COLOUR carries the urgency. Avoid the word
// "Quiet" here: it's one of the four state names, so pairing it with an
// over/due-coloured pill reads as a contradiction ("Quiet 45d" in red).
export function silenceLabel(days: number | null): string {
  if (days == null) return 'No contact';
  if (days === 0) return 'Today';
  return `${days}d`;
}
