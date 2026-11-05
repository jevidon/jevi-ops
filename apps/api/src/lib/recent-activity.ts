import { INBOX_DOMAIN_ID } from '@jevi-ops/shared';
import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { content_items, projects, stewardship_domains, tasks } from '../db/schema.js';
import type { RecentActivityEntry, RecentActivityKind, RecentActivityPayload } from '../routes/briefing.js';
import type { Db } from './db.js';
import { addDays, formatInTz, startOfLocalDayIso } from './tz.js';

const WINDOW_DAYS = 7;
const LIMIT = 30;

const LABELS: Record<RecentActivityKind, string> = {
  task_added: 'Added',
  task_captured: 'Captured',
  task_completed: 'Completed',
  task_waiting: 'Waiting',
  content_added: 'New content',
};

const CONTENT_TYPES: Record<string, string> = {
  video: 'Video',
  article: 'Article',
  short_clip: 'Short clip',
  podcast_episode: 'Podcast episode',
  newsletter: 'Newsletter',
  course: 'Course',
};

export async function buildRecentActivity(db: Db, tz: string, now = new Date()): Promise<RecentActivityPayload> {
  const today = formatInTz(now, tz);
  const yesterday = addDays(today, -1);
  const firstDay = addDays(today, 1 - WINDOW_DAYS);
  const nextDay = addDays(today, 1);
  const windowStart = startOfLocalDayIso(firstDay, tz);
  const windowEnd = startOfLocalDayIso(nextDay, tz);
  const dayFormat = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric',
  });
  const timeFormat = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });

  const taskRows = () => db.select({
    id: tasks.id,
    title: tasks.title,
    source: tasks.source,
    createdAt: tasks.created_at,
    completedAt: tasks.completed_at,
    waitingSince: tasks.waiting_since,
    waitingOn: tasks.waiting_on,
    domainId: tasks.domain_id,
    domain: stewardship_domains.name,
    project: projects.name,
  }).from(tasks)
    .leftJoin(projects, eq(tasks.project_id, projects.id))
    .innerJoin(stewardship_domains, eq(tasks.domain_id, stewardship_domains.id));

  // Read one extra row per query to detect overflow. Match the timestamp
  // precision and tie order of the merged feed before applying each limit.
  const [added, completed, waiting, content] = await Promise.all([
    taskRows()
      .where(and(gte(tasks.created_at, windowStart), lt(tasks.created_at, windowEnd), inArray(tasks.source, ['manual', 'voice', 'email'])))
      .orderBy(desc(sql`date_trunc('milliseconds', ${tasks.created_at})`), asc(sql`case when ${tasks.source} = 'manual' then 0 else 1 end`), asc(tasks.id))
      .limit(LIMIT + 1),
    taskRows()
      .where(and(eq(tasks.status, 'done'), gte(tasks.completed_at, windowStart), lt(tasks.completed_at, windowEnd)))
      .orderBy(desc(sql`date_trunc('milliseconds', ${tasks.completed_at})`), asc(tasks.id))
      .limit(LIMIT + 1),
    taskRows()
      .where(and(eq(tasks.status, 'waiting'), gte(tasks.waiting_since, firstDay), lt(tasks.waiting_since, nextDay)))
      .orderBy(desc(tasks.waiting_since), asc(tasks.id))
      .limit(LIMIT + 1),
    db.select({
      id: content_items.id,
      title: content_items.title,
      type: content_items.type,
      createdAt: content_items.created_at,
      domain: stewardship_domains.name,
    }).from(content_items)
      .leftJoin(stewardship_domains, eq(content_items.domain_id, stewardship_domains.id))
      .where(and(gte(content_items.created_at, windowStart), lt(content_items.created_at, windowEnd), isNull(content_items.archived_at)))
      .orderBy(desc(sql`date_trunc('milliseconds', ${content_items.created_at})`), asc(content_items.id))
      .limit(LIMIT + 1),
  ]);

  function dateLabels(at: string, waitingDay?: string) {
    const day = waitingDay ?? formatInTz(new Date(at), tz);
    // Format the local calendar date directly, without converting it again.
    const dateLabel = dayFormat.format(new Date(`${day}T00:00:00Z`)).replace(',', '');
    const prefix = day === today ? 'Today · ' : day === yesterday ? 'Yesterday · ' : '';
    return { day, day_label: prefix + dateLabel, time_label: waitingDay ? null : timeFormat.format(new Date(at)) };
  }

  function taskEntry(task: (typeof added)[number], kind: RecentActivityKind, at: string, waitingDay?: string): RecentActivityEntry {
    const inInbox = task.domainId === INBOX_DOMAIN_ID;
    const label = task.project
      ? (inInbox ? task.project : `${task.domain} › ${task.project}`)
      : (inInbox ? 'Inbox' : task.domain);
    return {
      id: `${kind}:${task.id}`,
      kind,
      label: LABELS[kind],
      title: task.title,
      href: `/tasks/${task.id}`,
      location: { label, inbox: inInbox && !task.project },
      detail: waitingDay && task.waitingOn ? `on ${task.waitingOn}` : null,
      at,
      ...dateLabels(at, waitingDay),
    };
  }

  const entries: RecentActivityEntry[] = [
    ...added.map((task) => taskEntry(task, task.source === 'manual' ? 'task_added' : 'task_captured', task.createdAt)),
    // The query bounds exclude null completion timestamps and waiting dates.
    ...completed.map((task) => taskEntry(task, 'task_completed', task.completedAt!)),
    ...waiting.map((task) => taskEntry(task, 'task_waiting', startOfLocalDayIso(task.waitingSince!, tz), task.waitingSince!)),
    ...content.map((item): RecentActivityEntry => ({
      id: `content_added:${item.id}`,
      kind: 'content_added',
      label: LABELS.content_added,
      title: item.title,
      href: `/content/${item.id}`,
      location: { label: item.domain ? `Content › ${item.domain}` : 'Content', inbox: false },
      detail: CONTENT_TYPES[item.type] ?? null,
      at: item.createdAt,
      ...dateLabels(item.createdAt),
    })),
  ];

  entries.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  return { window_days: WINDOW_DAYS, entries: entries.slice(0, LIMIT), truncated: entries.length > LIMIT };
}
