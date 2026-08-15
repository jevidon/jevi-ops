// Urgency derivation (v2 design handoff, Jul 2026) — the four-state model that
// drives every status pill: overdue · due today · on track · quiet.
//
// The handoff's rule that matters most: NEVER author a summary count; derive it.
// Lives in @jevi-ops/shared so the SERVER (buildWork) derives each object's
// urgency ONCE from the full task list and ships it in the /api/work payload —
// the web app never re-derives, so a domain pill can never disagree with a card
// inside it. Pure functions, no React.

export type Urgency = 'over' | 'due' | 'ok' | 'quiet';

export const URGENCY_LABEL: Record<Urgency, string> = {
  over: 'Overdue',
  due: 'Due today',
  ok: 'On track',
  quiet: 'Quiet',
};

// Worst-first rank, so a set of states can be reduced to the most urgent.
const RANK: Record<Urgency, number> = { over: 3, due: 2, ok: 1, quiet: 0 };

export function worst(states: Urgency[]): Urgency {
  return states.reduce<Urgency>((acc, s) => (RANK[s] > RANK[acc] ? s : acc), 'quiet');
}

export interface UrgencyCounts {
  overdue: number;
  dueToday?: number;
  open: number;
  waiting: number;
  // A deadline is a state, not a task: a project whose target is within a week
  // reads "due" even with nothing open (mirrors work-view's my-move-near-target).
  targetNear?: boolean;
}

// One object's urgency from its own counts.
export function urgencyFromCounts(c: UrgencyCounts): Urgency {
  if (c.overdue > 0) return 'over';
  if ((c.dueToday ?? 0) > 0 || c.targetNear) return 'due';
  if (c.open === 0 && c.waiting === 0) return 'quiet';
  return 'ok';
}

// Content pill state (shared by buildWork and the Content page). Content has no
// "overdue task" concept — its urgency is its publish target (for my-move work)
// plus the editor-aging signal. myMoveDue = holder 'me' AND target within 7 days
// or past; days = holder-aging in days. Caller supplies both (they need the app
// tz to compute correctly).
export function contentUrgency(c: {
  holder: 'me' | 'editor';
  target: string | null;
  myMoveDue: boolean;
  days: number | null;
  today: string;
}): Urgency {
  if (c.holder === 'me' && c.target != null && c.target < c.today) return 'over';
  if (c.myMoveDue || (c.holder === 'editor' && c.days != null && c.days >= 7)) return 'due';
  return 'ok';
}

// The my-move verb for a content item held by me (shared by buildWork's content
// rows and the Content detail page's primary button, so the two never diverge).
// Lowercase phrasing; callers capitalise. Returns null when there's no move to
// make from this status. buildWork never passes 'idea' (idea items aren't
// in-flight), so the detail page handles that case itself.
export function moveVerb(status: string, type: string, unpublishedShorts: number): string | null {
  switch (status) {
    case 'outline':
      return type === 'article' || type === 'newsletter' ? 'write it' : 'outline done — film it';
    case 'filming': return 'finish filming';
    case 'editing': return 'finish the edit';
    case 'derivatives_pending':
      return unpublishedShorts > 0 ? `harvest ${unpublishedShorts} shorts` : 'harvest shorts';
    default: return null;
  }
}

// A parent's urgency, computed so it can NEVER read calmer than a child — the
// domainStatus escalation from the handoff. `children` are the already-derived
// urgencies of the projects + content inside it.
export function parentUrgency(
  own: { overdue: number; dueToday?: number; open: number; waiting: number },
  children: Urgency[],
): Urgency {
  if (own.overdue > 0 || children.includes('over')) return 'over';
  if ((own.dueToday ?? 0) > 0 || children.includes('due')) return 'due';
  if (own.open === 0 && own.waiting === 0 && children.length === 0) return 'quiet';
  return 'ok';
}
