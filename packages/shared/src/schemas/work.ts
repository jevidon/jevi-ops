// The /work endpoint payload (Addendum 08 §6). Response DTOs — every value is
// computed server-side; the page renders, never curates. Shape mirrors the
// prototype's WORK_DOMAINS.

import type { Urgency } from '../urgency.js';

export interface WorkRollup {
  attention: number;
  open: number;
  overdue: number;
  waiting: number;
}

export interface WorkProjectCard {
  id: string;
  kind: 'target' | 'retainer';
  name: string;
  client: string | null;        // company name when linked
  target: string | null;        // YYYY-MM-DD, target-date projects
  cycle: { day: number; length: number } | null; // retainers with an anchor
  pct: number | null;           // milestone-weighted; null when no milestones
  open: number;
  overdue: number;
  waiting: number;
  waitOn: string | null;        // representative waiting task's "who"
  waitDays: number | null;      // its aging day-count
  recency: string;              // "active 2d ago" / "quiet 14d"
  flagged: boolean;             // an active attention item points at it
  paused: boolean;              // project status = 'paused' (else active)
  urgency: Urgency;             // v2 pill state, derived server-side (never authored)
}

export interface WorkContentRow {
  id: string;
  title: string;
  type: string;                 // content_items.type
  status: string;               // content_items.status
  holder: 'me' | 'editor';
  days: number | null;          // holder_since aging
  move: string | null;          // the "my move" verb, null when waiting/quiet
  target: string | null;        // target_publish_date
  myMoveDue: boolean;           // holder=me AND target within a week or past
  flagged: boolean;
  urgency: Urgency;             // v2 pill state, derived server-side
}

export interface WorkDirect {
  open: number;
  overdue: number;
  waiting: number;
  waitingAging: number;         // direct waiting tasks blocked ≥7 days
  today: number;
}

export interface WorkDomain {
  id: string;
  name: string;
  parked: boolean;
  urgency: Urgency;             // escalated from children — never calmer than a card inside
  rollup: WorkRollup;
  projects: WorkProjectCard[];
  content: WorkContentRow[];
  direct: WorkDirect;
}

export interface WorkPayload {
  domains: WorkDomain[];   // active, ordered: flagged first, then open-work volume
  parked: WorkDomain[];    // parked channels, muted at the bottom
  ideasCount: number;      // status='idea', not archived
}
