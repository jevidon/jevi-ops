import { and, count, desc, eq, inArray, isNotNull, isNull, ne } from 'drizzle-orm';
import type {
  WorkPayload, WorkDomain, WorkProjectCard, WorkContentRow, WorkDirect, WorkRollup, WorkAssetCard,
} from '@jevi-ops/shared/schemas';
import {
  urgencyFromCounts, parentUrgency, contentUrgency, moveVerb, maintenanceDueState, maintenanceTracked, maintenanceUrgency,
  type Urgency, type MaintenanceDueStatus, type MaintenanceDataState,
} from '@jevi-ops/shared';
import type { Db } from './db.js';
import {
  activity_log, assets as assetsTable, attention_items, companies as companiesTable, content_items,
  maintenance_items, people, projects as projectsTable, stewardship_domains, tasks as tasksTable,
} from '../db/schema.js';
import { getAppSettings } from './app-settings.js';
import { latestReadingRowByAsset } from './meter-readings.js';
import { todayInTz, formatInTz } from './tz.js';

// The Work page's computed manager's map. Ported from upstream jerad-ops
// v2.0.0 (Addendum 08 §5-6), re-expressed against Drizzle. One aggregation:
// projects + domains + in-flight content + attention flags, per domain, with
// the ordering that is part of the contract. Nothing here is curated.
//
// Client resolution (CRM port, 0041): the project card's `client` reads the
// linked company's name first, falling back to the primary contact person's
// name for projects that never got a company link. Null renders no line.

const IN_FLIGHT_CONTENT = ['outline', 'filming', 'editing', 'derivatives_pending'];
const SHIPPED_CONTENT = ['published', 'done'];

interface TaskRow {
  id: string; domain_id: string; project_id: string | null;
  status: string; due_date: string | null; waiting_since: string | null; waiting_on: string | null;
}

export async function buildWork(db: Db): Promise<WorkPayload> {
  const settings = await getAppSettings();
  const tz = settings.timezone;
  const today = todayInTz(tz);

  const [domains, projects, tasks, content, children, attn, activity, ideasRow, assetRows, maintItems] = await Promise.all([
    db.query.stewardship_domains.findMany({
      columns: { id: true, name: true, parked: true },
      where: and(eq(stewardship_domains.active, true), eq(stewardship_domains.is_system, false)),
    }),
    db.query.projects.findMany({
      columns: {
        id: true, name: true, domain_id: true, engagement_type: true,
        target_date: true, retainer_anchor_day: true, status: true,
        primary_contact_id: true, company_id: true, asset_id: true,
      },
      with: { milestones: { columns: { weight: true, status: true } } },
      where: inArray(projectsTable.status, ['active', 'paused']),
    }),
    db.query.tasks.findMany({
      columns: {
        id: true, domain_id: true, project_id: true, status: true,
        due_date: true, waiting_since: true, waiting_on: true,
      },
      where: ne(tasksTable.status, 'done'),
    }),
    db.query.content_items.findMany({
      columns: {
        id: true, title: true, type: true, status: true, holder: true,
        holder_since: true, target_publish_date: true, domain_id: true, parent_id: true,
      },
      where: and(inArray(content_items.status, IN_FLIGHT_CONTENT), isNull(content_items.archived_at)),
    }),
    // Children (for the "harvest N shorts" verb) — short-clip derivatives.
    // Archived children aren't harvestable; bound the row count.
    db.query.content_items.findMany({
      columns: { parent_id: true, type: true, status: true },
      where: and(isNotNull(content_items.parent_id), isNull(content_items.archived_at)),
      limit: 2000,
    }),
    db.query.attention_items.findMany({
      columns: { source_type: true, source_id: true, urgency: true },
      where: eq(attention_items.status, 'active'),
    }),
    // Explicit limit — latest-per-project needs the recent window only.
    db.query.activity_log.findMany({
      columns: { project_id: true, logged_at: true },
      orderBy: desc(activity_log.logged_at),
      limit: 5000,
    }),
    db.select({ n: count() }).from(content_items)
      .where(and(eq(content_items.status, 'idea'), isNull(content_items.archived_at)))
      .then((rows) => rows[0]),
    // Assigned, active assets (0049) — assignment is what promotes an asset
    // into a domain; unassigned ones live only under /maintenance/assets.
    db.query.assets.findMany({
      columns: { id: true, name: true, kind: true, domain_id: true, meter_unit: true, lifecycle: true, attachments: true },
      where: and(isNotNull(assetsTable.domain_id), eq(assetsTable.lifecycle, 'active')),
    }),
    // Their tracked maintenance items (shared maintenanceTracked scope) —
    // counted with the same due-state the API lists use, so a card never
    // disagrees with the asset page.
    db.query.maintenance_items.findMany({
      columns: {
        id: true, asset_id: true, policy: true, interval_days: true, interval_months: true,
        interval_meter: true, lead_days: true, lead_meter: true, next_due_date: true, next_due_meter: true, active: true,
      },
      where: and(eq(maintenance_items.active, true), isNotNull(maintenance_items.asset_id)),
    }),
  ]);

  // Latest (non-voided) reading per assigned asset, one query.
  const assetIds = assetRows.map((a) => a.id);
  const readings = await latestReadingRowByAsset(db, assetIds);
  const itemsByAsset = groupBy(maintItems, (i) => i.asset_id ?? '');
  const assetProjectCount = new Map<string, number>();
  for (const p of projects) {
    if (p.asset_id) assetProjectCount.set(p.asset_id, (assetProjectCount.get(p.asset_id) ?? 0) + 1);
  }
  const assetName = new Map(assetRows.map((a) => [a.id, a.name]));
  const itemAsset = new Map(maintItems.map((i) => [i.id, i.asset_id]));

  // Client names: companies first, contact people as fallback (see header).
  const companyIds = [...new Set(projects.map((p) => p.company_id).filter((v): v is string => v != null))];
  const companyNames = new Map<string, string>();
  if (companyIds.length > 0) {
    const rows = await db.query.companies.findMany({
      columns: { id: true, name: true },
      where: inArray(companiesTable.id, companyIds),
    });
    for (const c of rows) companyNames.set(c.id, c.name);
  }
  const contactIds = [...new Set(projects.map((p) => p.primary_contact_id).filter((v): v is string => v != null))];
  const clientNames = new Map<string, string>();
  if (contactIds.length > 0) {
    const clients = await db.query.people.findMany({
      columns: { id: true, name: true },
      where: inArray(people.id, contactIds),
    });
    for (const c of clients) clientNames.set(c.id, c.name);
  }

  // Flagged sets by source.
  const flaggedProjects = new Set<string>();
  const flaggedDomains = new Set<string>();
  const flaggedContent = new Set<string>();
  // Assets flag from their own attention (reading nag) or any of their
  // items' (maintenance_due) — resolved to the asset id.
  const flaggedAssets = new Set<string>();
  // Highest attention urgency per domain-scoped item — floors the domain pill
  // so the Work chip can never read calmer than an active domain attention
  // item that Today already shows as slipping. high → over, otherwise due.
  const domainAttnUrgency = new Map<string, Urgency>();
  for (const a of attn) {
    if (a.source_type === 'project') flaggedProjects.add(a.source_id);
    else if (a.source_type === 'domain') {
      flaggedDomains.add(a.source_id);
      const floor: Urgency = a.urgency === 'high' ? 'over' : 'due';
      if (domainAttnUrgency.get(a.source_id) !== 'over') domainAttnUrgency.set(a.source_id, floor);
    } else if (a.source_type === 'content') flaggedContent.add(a.source_id);
    else if (a.source_type === 'asset') flaggedAssets.add(a.source_id);
    else if (a.source_type === 'maintenance_item') {
      const aid = itemAsset.get(a.source_id);
      if (aid) flaggedAssets.add(aid);
    }
  }

  // Flagged content can be in ANY status (idea/published/…), not just the
  // in-flight rows we render — resolve each to its domain for the rollup badge.
  const flaggedContentByDomain = new Map<string, number>();
  if (flaggedContent.size > 0) {
    const fcRows = await db.query.content_items.findMany({
      columns: { id: true, domain_id: true },
      where: inArray(content_items.id, [...flaggedContent]),
    });
    for (const c of fcRows) {
      if (c.domain_id) flaggedContentByDomain.set(c.domain_id, (flaggedContentByDomain.get(c.domain_id) ?? 0) + 1);
    }
  }

  // Latest activity per project (rows arrive newest-first).
  const latestActivity = new Map<string, string>();
  for (const a of activity) {
    if (a.project_id && !latestActivity.has(a.project_id)) latestActivity.set(a.project_id, a.logged_at);
  }

  // Unpublished short-clip child counts per parent (for the harvest verb).
  const unpublishedShorts = new Map<string, number>();
  for (const c of children) {
    if (!c.parent_id || c.type !== 'short_clip' || SHIPPED_CONTENT.includes(c.status)) continue;
    unpublishedShorts.set(c.parent_id, (unpublishedShorts.get(c.parent_id) ?? 0) + 1);
  }

  const projectsByDomain = groupBy(projects, (p) => p.domain_id ?? '');
  const contentByDomain = groupBy(content, (c) => c.domain_id ?? '');
  const tasksByDomain = groupBy(tasks as TaskRow[], (t) => t.domain_id);
  const assetsByDomain = groupBy(assetRows, (a) => a.domain_id ?? '');

  const DUE_RANK: Record<MaintenanceDueStatus, number> = { ok: 0, due_soon: 1, due: 2, overdue: 3 };
  const DATA_RANK: Record<MaintenanceDataState, number> = { complete: 0, stale_reading: 1, needs_reading: 2, needs_baseline: 3 };

  // The asset card (0049): counts + worst due state + data confidence from
  // the shared predicate, urgency from maintenanceUrgency. Sorted over →
  // due → ok → quiet, then name.
  const assetCard = (a: (typeof assetRows)[number]): WorkAssetCard => {
    const latest = readings.get(a.id) ?? null;
    const counts = { total: 0, overdue: 0, due: 0, due_soon: 0 };
    let worst: MaintenanceDueStatus | null = null;
    let data: MaintenanceDataState = 'complete';
    for (const item of itemsByAsset.get(a.id) ?? []) {
      // The queries above already narrow to active items on active assets;
      // the shared predicate is the contract the asset page reads too.
      if (!maintenanceTracked(item, a)) continue;
      const s = maintenanceDueState({
        todayIso: today,
        latestMeter: latest?.reading ?? null,
        latestReadingOn: latest?.recorded_on ?? null,
        staleDays: settings.meter_stale_days,
        item,
      });
      counts.total += 1;
      if (s.status === 'overdue') counts.overdue += 1;
      else if (s.status === 'due') counts.due += 1;
      else if (s.status === 'due_soon') counts.due_soon += 1;
      if (worst == null || DUE_RANK[s.status] > DUE_RANK[worst]) worst = s.status;
      if (DATA_RANK[s.data] > DATA_RANK[data]) data = s.data;
    }
    const projectCount = assetProjectCount.get(a.id) ?? 0;
    const hero = a.attachments?.[0]?.url ?? null;
    return {
      id: a.id,
      name: a.name,
      kind: a.kind,
      meter_unit: a.meter_unit,
      latest_reading: latest?.reading ?? null,
      latest_reading_days_ago: latest ? daysBetween(latest.recorded_on, today) : null,
      maintenance: counts,
      worst,
      data,
      projects: projectCount,
      hero,
      flagged: flaggedAssets.has(a.id),
      urgency: maintenanceUrgency(worst, projectCount > 0),
    };
  };
  const URGENCY_RANK: Record<Urgency, number> = { over: 0, due: 1, ok: 2, quiet: 3 };

  const build = (d: { id: string; name: string; parked: boolean }): WorkDomain => {
    const domTasks = tasksByDomain.get(d.id) ?? [];
    const tasksByProject = groupBy(domTasks, (t) => t.project_id ?? '__direct__');

    const assetCards: WorkAssetCard[] = (assetsByDomain.get(d.id) ?? []).map(assetCard);
    assetCards.sort((a, b) =>
      URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency] || a.name.localeCompare(b.name),
    );

    const projectCards: WorkProjectCard[] = (projectsByDomain.get(d.id) ?? []).map((p) => {
      const pt = tasksByProject.get(p.id) ?? [];
      const counts = bucketTasks(pt, today);
      const rep = representativeWaiting(pt, today);
      const isRetainer = p.engagement_type === 'retainer';
      return {
        id: p.id,
        kind: isRetainer ? 'retainer' : 'target',
        name: p.name,
        asset: p.asset_id && assetName.has(p.asset_id) ? { id: p.asset_id, name: assetName.get(p.asset_id)! } : null,
        client:
          (p.company_id ? companyNames.get(p.company_id) : undefined)
          ?? (p.primary_contact_id ? clientNames.get(p.primary_contact_id) : undefined)
          ?? null,
        target: isRetainer ? null : p.target_date,
        cycle: isRetainer && p.retainer_anchor_day ? computeCycle(p.retainer_anchor_day, today) : null,
        pct: isRetainer ? null : progressPct(p.milestones ?? []),
        open: counts.open,
        overdue: counts.overdue,
        waiting: counts.waiting,
        waitOn: rep?.waiting_on ?? null,
        waitDays: rep?.days ?? null,
        recency: recencyLabel(latestActivity.get(p.id), today, tz),
        flagged: flaggedProjects.has(p.id),
        paused: p.status === 'paused',
        // Pill state, derived here (never authored). A near/past target is a
        // "due" state even with nothing open — a deadline is a state, not a task.
        urgency: urgencyFromCounts({
          overdue: counts.overdue,
          dueToday: counts.today,
          open: counts.open,
          waiting: counts.waiting,
          targetNear:
            !isRetainer && p.target_date != null && daysBetween(today, p.target_date) <= 7,
        }),
      };
    });
    // Card order: flagged first, then target proximity (soonest target first,
    // undated last); retainers sort after by name.
    projectCards.sort((a, b) => {
      if (a.flagged !== b.flagged) return a.flagged ? -1 : 1;
      const at = a.target ?? '9999-12-31';
      const bt = b.target ?? '9999-12-31';
      return at.localeCompare(bt) || a.name.localeCompare(b.name);
    });

    const contentRows: WorkContentRow[] = (contentByDomain.get(d.id) ?? []).map((c) => {
      const holder = c.holder === 'editor' ? 'editor' : 'me';
      // My-move content whose target publish date is within a week or already
      // past — the needs-attention threshold for self-held work (§5).
      const myMoveDue =
        holder === 'me' &&
        c.target_publish_date != null &&
        daysBetween(today, c.target_publish_date) <= 7;
      const holderDays = c.holder_since
        ? daysBetween(formatInTz(new Date(c.holder_since), tz), today)
        : null;
      return {
        id: c.id,
        title: c.title,
        type: c.type,
        status: c.status,
        holder,
        days: holderDays,
        move: holder === 'me' ? moveVerb(c.status, c.type, unpublishedShorts.get(c.id) ?? 0) : null,
        target: c.target_publish_date,
        myMoveDue,
        flagged: flaggedContent.has(c.id),
        // Pill state: my-move past its publish target is overdue; near-target
        // (myMoveDue) or stuck ≥7d with the editor is due; else on track.
        urgency: contentUrgency({
          holder,
          target: c.target_publish_date,
          myMoveDue,
          days: holderDays,
          today,
        }),
      };
    });

    const directTasks = tasksByProject.get('__direct__') ?? [];
    const dc = bucketTasks(directTasks, today);
    const direct: WorkDirect = {
      open: dc.open, overdue: dc.overdue, waiting: dc.waiting, waitingAging: dc.waitingAging, today: dc.today,
    };

    // Rollup: totals across the whole domain + a distinct-flagged-object count.
    // Task counts already include the maintenance sweep's generated tasks,
    // so assets add only their flag — never a second count of the same work.
    const all = bucketTasks(domTasks, today);
    const flaggedCount =
      (flaggedDomains.has(d.id) ? 1 : 0) +
      projectCards.filter((p) => p.flagged).length +
      assetCards.filter((a) => a.flagged).length +
      (flaggedContentByDomain.get(d.id) ?? 0);
    const rollup: WorkRollup = { attention: flaggedCount, open: all.open, overdue: all.overdue, waiting: all.waiting };

    // Domain pill escalates from its children, so it can never read calmer
    // than a card inside it — a slipping vehicle counts. An active
    // domain-scoped attention item is injected as a pseudo-child so the
    // chip agrees with Today.
    const domainAttnFloor = domainAttnUrgency.get(d.id);
    const urgency = parentUrgency(
      { overdue: all.overdue, dueToday: all.today, open: all.open, waiting: all.waiting },
      [
        ...assetCards.map((a) => a.urgency),
        ...projectCards.map((p) => p.urgency),
        ...contentRows.map((c) => c.urgency),
        ...(domainAttnFloor ? [domainAttnFloor] : []),
      ],
    );

    return {
      id: d.id, name: d.name, parked: d.parked, urgency, rollup,
      assets: assetCards, projects: projectCards, content: contentRows, direct,
    };
  };

  const active = domains.filter((d) => !d.parked).map(build);
  const parked = domains.filter((d) => d.parked).map(build);

  // Domain order: attention-flagged first, then by open-work volume.
  const workVolume = (w: WorkDomain) =>
    w.rollup.open + w.rollup.waiting + w.assets.length + w.projects.length + w.content.length;
  active.sort((a, b) => {
    if ((a.rollup.attention > 0) !== (b.rollup.attention > 0)) return a.rollup.attention > 0 ? -1 : 1;
    return workVolume(b) - workVolume(a) || a.name.localeCompare(b.name);
  });
  parked.sort((a, b) => a.name.localeCompare(b.name));

  return { domains: active, parked, ideasCount: ideasRow?.n ?? 0 };
}

// ─── helpers ─────────────────────────────────────────────────────────────

function groupBy<T>(arr: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const item of arr) {
    const k = key(item);
    const g = m.get(k);
    if (g) g.push(item);
    else m.set(k, [item]);
  }
  return m;
}

function bucketTasks(ts: TaskRow[], today: string) {
  let open = 0, overdue = 0, waiting = 0, waitingAging = 0, todayCount = 0;
  for (const t of ts) {
    if (t.status === 'waiting') {
      waiting++;
      // Blocked ≥7 days — the needs-attention threshold (Addendum 08 §5/§9).
      if (t.waiting_since && daysBetween(t.waiting_since, today) >= 7) waitingAging++;
      continue;
    }
    if (t.status === 'open') {
      open++;
      if (t.due_date && t.due_date < today) overdue++;
      if (t.due_date === today) todayCount++;
    }
  }
  return { open, overdue, waiting, waitingAging, today: todayCount };
}

// Oldest waiting task = the one to surface on the card.
function representativeWaiting(ts: TaskRow[], today: string): { waiting_on: string | null; days: number } | null {
  let best: { waiting_on: string | null; days: number } | null = null;
  for (const t of ts) {
    if (t.status !== 'waiting') continue;
    const days = t.waiting_since ? daysBetween(t.waiting_since, today) : 0;
    if (!best || days > best.days) best = { waiting_on: t.waiting_on, days };
  }
  return best;
}

function progressPct(milestones: { weight: number; status: string }[]): number | null {
  const total = milestones.reduce((s, m) => s + m.weight, 0);
  if (total === 0) return null;
  const done = milestones.filter((m) => m.status === 'done').reduce((s, m) => s + m.weight, 0);
  return Math.round((done / total) * 100);
}

function daysBetween(fromYmd: string, toYmd: string): number {
  const [ay, am, ad] = fromYmd.split('-').map((s) => parseInt(s, 10));
  const [by, bm, bd] = toYmd.split('-').map((s) => parseInt(s, 10));
  return Math.round((Date.UTC(by!, bm! - 1, bd!) - Date.UTC(ay!, am! - 1, ad!)) / 86_400_000);
}

function recencyLabel(latestIso: string | undefined, today: string, tz: string): string {
  if (!latestIso) return 'no activity yet';
  const days = daysBetween(formatInTz(new Date(latestIso), tz), today);
  if (days <= 0) return 'active today';
  if (days <= 3) return `active ${days}d ago`;
  return `quiet ${days}d`;
}

// Retainer cycle position (§4). Day-of-month anchor, clamped to month end.
function computeCycle(anchorDay: number, todayYmd: string): { day: number; length: number } {
  const [y, m, d] = todayYmd.split('-').map((s) => parseInt(s, 10));
  const daysInMonth = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate(); // mm 1-12
  const clamp = (yy: number, mm: number) => Math.min(anchorDay, daysInMonth(yy, mm));

  const todayUtc = Date.UTC(y!, m! - 1, d!);
  const thisAnchor = Date.UTC(y!, m! - 1, clamp(y!, m!));

  let csY: number, csM: number;
  if (thisAnchor <= todayUtc) { csY = y!; csM = m!; }
  else if (m! === 1) { csY = y! - 1; csM = 12; }
  else { csY = y!; csM = m! - 1; }
  const cycleStart = Date.UTC(csY, csM - 1, clamp(csY, csM));

  const nY = csM === 12 ? csY + 1 : csY;
  const nM = csM === 12 ? 1 : csM + 1;
  const nextAnchor = Date.UTC(nY, nM - 1, clamp(nY, nM));

  const length = Math.round((nextAnchor - cycleStart) / 86_400_000);
  const day = Math.round((todayUtc - cycleStart) / 86_400_000) + 1; // day 1 = anchor day
  return { day, length };
}
