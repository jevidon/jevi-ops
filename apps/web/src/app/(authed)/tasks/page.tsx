import { tasksApi, ApiError } from '@/lib/api';
import { todayIsoDate } from '@/lib/today';
import { getAppTimezone } from '@/lib/app-settings';
import type { Task } from '@jerad-ops/shared';
import { TasksView } from './tasks-view';

// /tasks — the full task list (v2 redesign). A thin server shell: fetch the
// tasks + the app-tz "today", hand off to the client TasksView which owns the
// facet rail and grouping. Tasks now has its own nav tab (v2).

export const dynamic = 'force-dynamic';

const VIEWS = ['all', 'today', 'upcoming', 'project'] as const;
type View = (typeof VIEWS)[number];

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter } = await searchParams;
  const initialView: View = (VIEWS as readonly string[]).includes(filter ?? '')
    ? (filter as View)
    : 'all';
  const tz = await getAppTimezone();
  const today = todayIsoDate(tz);

  let tasks: Task[] = [];
  let errorMessage: string | null = null;
  try {
    const res = await tasksApi.list();
    tasks = res.tasks;
  } catch (err) {
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  if (errorMessage) {
    return (
      <div className="px-5 lg:px-10 pt-8">
        <h1 className="font-serif text-[40px] font-medium tracking-[-0.022em] text-ink">Tasks</h1>
        <p className="mt-4 font-sans text-[13px] text-ink-3">Couldn&rsquo;t load tasks: {errorMessage}</p>
      </div>
    );
  }

  return <TasksView tasks={tasks} today={today} tz={tz} initialView={initialView} />;
}
