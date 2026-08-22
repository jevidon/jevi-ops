import type {
  AttentionItem,
  BriefingPayload,
  ResurfacingItem,
  RoutineListItem,
} from '@/lib/api';
import type { Task } from '@jevi-ops/shared';
import type { FeatureFlag } from '@/lib/app-settings';

import { NeedsAMovePanel } from './panels/needs-a-move';
import { SilentClientsPanel } from './panels/silent-clients';
import { AttentionPanel } from './panels/attention';
import { ReflectionPanel } from './panels/reflection';
import { LatestQuotePanel } from './panels/latest-quote';
import { AgendaPanel } from './panels/agenda';
import { DoingPanel } from './panels/doing';
import { RoutinesPanel } from './panels/routines';
import { PinnedPanel } from './panels/pinned';
import { HealthPanel } from './panels/health';

// The Briefing panel registry — the single source of truth for what panels
// exist, which column they live in, and their default order (= registry
// order within a column). The page composes enabled panels from here;
// Settings → Briefing renders its toggle/reorder rows from here. "Panel",
// not "widget" — /api/widget/* is the external Scriptable endpoint.
//
// Panels are server components receiving one shared BriefingContext (data
// the page already fetches). A panel with exclusive data needs (pins,
// agenda, health) fetches it internally — async sibling server components
// render concurrently, and a disabled panel costs zero fetches.

export type PanelId =
  | 'pinned'
  | 'needs-a-move'
  | 'silent-clients'
  | 'attention'
  | 'reflection'
  | 'latest-quote'
  | 'agenda'
  | 'doing'
  | 'health'
  | 'routines';

export interface BriefingContext {
  tz: string;
  today: string;
  briefing: BriefingPayload | null;
  resurface: ResurfacingItem | null;
  resurfaceExhausted: boolean;
  resurfacingSkipCount: number;
  routines: RoutineListItem[];
  routinesFailed: boolean;
  silentClients: AttentionItem[];
  attentionItems: AttentionItem[];
  attentionActiveCount: number;
  railTasks: Task[];
  railOverflow: number;
  top3Count: number;
  rDone: number;
  rTotal: number;
}

export interface PanelDef {
  id: PanelId;
  label: string;
  // Settings-row copy: what the panel shows, in user language.
  description: string;
  column: 'main' | 'rail';
  defaultEnabled: boolean;
  // Panel additionally hidden (here AND in nav-level gating) while this
  // module flag is off. It stays listed in Settings, marked as gated.
  moduleFlag?: FeatureFlag;
  Panel: (props: { ctx: BriefingContext }) => React.ReactNode | Promise<React.ReactNode>;
}

export const PANEL_REGISTRY: PanelDef[] = [
  // ── Main column (the ledger) ────────────────────────────────────────
  {
    id: 'pinned',
    label: 'Pinned',
    description: 'Anything you’ve pinned — tasks, projects, domains, people, companies, content, books, notes, quotes, routines — in your order.',
    column: 'main',
    defaultEnabled: true,
    Panel: PinnedPanel,
  },
  {
    id: 'needs-a-move',
    label: 'Needs a move',
    description: 'Domains past their cadence — the slip cards.',
    column: 'main',
    defaultEnabled: true,
    Panel: NeedsAMovePanel,
  },
  {
    id: 'silent-clients',
    label: 'Silent clients',
    description: 'Clients past their check-in cadence, with inline Log check-in.',
    column: 'main',
    defaultEnabled: true,
    Panel: SilentClientsPanel,
  },
  {
    id: 'attention',
    label: 'Attention',
    description: 'Active attention items — waiting tasks, stuck content, aging ideas.',
    column: 'main',
    defaultEnabled: true,
    Panel: AttentionPanel,
  },
  {
    id: 'reflection',
    label: 'Reflection',
    description: 'The daily resurfaced quote or journal passage.',
    column: 'main',
    defaultEnabled: true,
    Panel: ReflectionPanel,
  },
  {
    id: 'latest-quote',
    label: 'Latest quote',
    description: 'The newest quote in the library.',
    column: 'main',
    defaultEnabled: true,
    Panel: LatestQuotePanel,
  },
  // ── Right rail (ambient, sticky on desktop) ─────────────────────────
  {
    id: 'agenda',
    label: 'Agenda',
    description: 'Today’s timeline — calendar events and tasks due today, interleaved by time.',
    column: 'rail',
    defaultEnabled: true,
    Panel: AgendaPanel,
  },
  {
    id: 'doing',
    label: 'Doing',
    description: 'The actionable task rail — Top 3, overdue, due today.',
    column: 'rail',
    defaultEnabled: true,
    Panel: DoingPanel,
  },
  {
    id: 'health',
    label: 'Health',
    description: 'Latest vitals, next visit, lab flags, active medications.',
    column: 'rail',
    defaultEnabled: true,
    moduleFlag: 'health_module_enabled',
    Panel: HealthPanel,
  },
  {
    id: 'routines',
    label: 'Routines',
    description: 'Today’s routine check-offs.',
    column: 'rail',
    defaultEnabled: true,
    moduleFlag: 'routines_module_enabled',
    Panel: RoutinesPanel,
  },
];

const BY_ID = new Map(PANEL_REGISTRY.map((p) => [p.id, p]));
export const panelDef = (id: string): PanelDef | undefined => BY_ID.get(id as PanelId);

export interface PanelConfigEntry {
  id: PanelId;
  enabled: boolean;
}

// Resolve stored config against the registry: drop retired ids, append any
// panel the stored list doesn't know (new panels ship enabled-per-default
// with zero data migration). Null/absent config → pure registry defaults.
// Used by BOTH the page and the Settings form so they can never disagree.
export function mergePanelConfig(
  stored: Array<{ id: string; enabled: boolean }> | null | undefined,
): PanelConfigEntry[] {
  const out: PanelConfigEntry[] = [];
  for (const e of stored ?? []) {
    const def = BY_ID.get(e.id as PanelId);
    if (def && !out.some((x) => x.id === def.id)) {
      out.push({ id: def.id, enabled: e.enabled });
    }
  }
  for (const p of PANEL_REGISTRY) {
    if (!out.some((x) => x.id === p.id)) out.push({ id: p.id, enabled: p.defaultEnabled });
  }
  return out;
}

// The panels to render for one column, in config order, honoring enabled
// flags and module gates.
export function activePanels(
  config: PanelConfigEntry[],
  column: 'main' | 'rail',
  flags: Partial<Record<FeatureFlag, boolean>>,
): PanelDef[] {
  const defs: PanelDef[] = [];
  for (const entry of config) {
    if (!entry.enabled) continue;
    const def = BY_ID.get(entry.id);
    if (!def || def.column !== column) continue;
    if (def.moduleFlag && flags[def.moduleFlag] !== true) continue;
    defs.push(def);
  }
  return defs;
}
