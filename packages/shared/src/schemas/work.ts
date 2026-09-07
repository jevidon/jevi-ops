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
  asset: { id: string; name: string } | null; // the asset this work groups under (0049)
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

// An asset assigned to the domain (0049) — the asset is the area. Only
// active, ASSIGNED assets ride in the payload; unassigned ones live under
// /maintenance/assets. Counts come from the same maintenanceDueState the
// API lists use, so a card never disagrees with the asset page.
export interface WorkAssetCard {
  id: string;
  name: string;
  kind: string;                 // display only — nothing branches on it
  meter_unit: string | null;
  latest_reading: number | null;
  latest_reading_days_ago: number | null;
  maintenance: { total: number; overdue: number; due: number; due_soon: number };
  worst: 'ok' | 'due_soon' | 'due' | 'overdue' | null; // null = no active items
  // Data confidence across the asset's meter-axis items: the worst of them.
  data: 'complete' | 'needs_baseline' | 'needs_reading' | 'stale_reading';
  projects: number;             // active + paused projects grouped under it
  hero: string | null;          // attachments[0].url
  flagged: boolean;             // an active attention item points at it or its items
  urgency: Urgency;
}

export interface WorkDomain {
  id: string;
  name: string;
  parked: boolean;
  urgency: Urgency;             // escalated from children — never calmer than a card inside
  rollup: WorkRollup;
  assets: WorkAssetCard[];      // assigned, active assets (0049)
  projects: WorkProjectCard[];
  content: WorkContentRow[];
  direct: WorkDirect;
}

export interface WorkPayload {
  domains: WorkDomain[];   // active, ordered: flagged first, then open-work volume
  parked: WorkDomain[];    // parked channels, muted at the bottom
  ideasCount: number;      // status='idea', not archived
}
