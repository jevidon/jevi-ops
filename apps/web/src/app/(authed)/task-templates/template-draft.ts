import type { TaskTemplateEntry } from '@jevi-ops/shared';

/** Blank rows are placeholders. Keep their nonblank children by moving them up. */
export function withoutBlankTasks(entries: TaskTemplateEntry[]): TaskTemplateEntry[] {
  const byKey = new Map(entries.map(entry => [entry.key, entry]));
  return entries.filter(entry => entry.title.trim()).map(entry => {
    let parent = entry.parent_key;
    const seen = new Set([entry.key]);
    while (parent && byKey.has(parent) && !byKey.get(parent)!.title.trim() && !seen.has(parent)) {
      seen.add(parent);
      parent = byKey.get(parent)!.parent_key;
    }
    return { ...entry, parent_key: parent };
  });
}

/** Rows that would lose a written note if dropped as blank placeholders. */
export function untitledWithNotes(entries: TaskTemplateEntry[]): TaskTemplateEntry[] {
  return entries.filter(entry => !entry.title.trim() && entry.notes?.trim());
}

/**
 * What a library row says about a template. A group is a task with at least
 * one subtask. The peek names the first four main tasks, enough to tell two
 * similar lists apart without opening either.
 */
export function templateSummary(entries: TaskTemplateEntry[]): { tasks: number; groups: number; peek: string } {
  const keys = new Set(entries.map(entry => entry.key));
  const groups = new Set(entries.map(entry => entry.parent_key).filter((key): key is string => key !== null && keys.has(key))).size;
  // An entry whose parent is missing would generate as a main task, so it reads as one here.
  const main = entries.filter(entry => entry.parent_key === null || !keys.has(entry.parent_key));
  const peek = main.slice(0, 4).map(entry => entry.title).join(', ') + (main.length > 4 ? '…' : '');
  return { tasks: entries.length, groups, peek };
}

/** "Oct 12" in the app timezone; the year is added once it is not the current one. */
export function formatEdited(iso: string, tz: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const year = (value: Date) => value.toLocaleDateString('en-US', { timeZone: tz, year: 'numeric' });
  return date.toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric', ...(year(date) === year(now) ? {} : { year: 'numeric' }) });
}

/** A copy for "Duplicate": same titles, notes and structure under fresh keys. */
export function duplicateEntries(entries: TaskTemplateEntry[], newKey: () => string): TaskTemplateEntry[] {
  const keys = new Map(entries.map(entry => [entry.key, newKey()]));
  return entries.map(entry => ({ ...entry, key: keys.get(entry.key)!, parent_key: entry.parent_key ? keys.get(entry.parent_key) ?? null : null }));
}

/** Field-error key for one task row, so a failure can mark the row itself. */
export const entryField = (key: string) => `entries.${key}`;

export const UNTITLED_NOTE_ERROR = 'Add a title to each task that has a note, or clear the note.';
export const UNTITLED_NOTE_FIELD_ERROR = 'Add a title, or clear this task’s note.';
