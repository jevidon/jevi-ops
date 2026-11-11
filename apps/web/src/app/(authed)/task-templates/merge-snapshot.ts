import type { TaskTemplateEntry } from '@jevi-ops/shared';

// Updating a template from a project. Nothing links a project's tasks back to
// the template entries they were copied from, so the two lists are compared
// by title. Everything here is pure: the panel shows diffSnapshot() and saves
// mergeSnapshot() through the ordinary template update.

/** Titles match when they differ only in case or spacing. */
export const normalizeTitle = (title: string) => title.trim().replace(/\s+/g, ' ').toLowerCase();

export interface SnapshotDiff {
  /** Project tasks the template does not have. */
  added: TaskTemplateEntry[];
  /** Template entries the project no longer has. */
  removed: TaskTemplateEntry[];
  unchanged: number;
  /** Snapshot key → the template entry it matched. */
  matches: Map<string, TaskTemplateEntry>;
}

/**
 * Compare a template with a project snapshot. Duplicate titles pair off in
 * order: the first unmatched project task with the first unmatched entry.
 */
export function diffSnapshot(template: TaskTemplateEntry[], snapshot: TaskTemplateEntry[]): SnapshotDiff {
  const unmatched = new Map<string, TaskTemplateEntry[]>();
  for (const entry of template) {
    const title = normalizeTitle(entry.title);
    unmatched.set(title, [...(unmatched.get(title) ?? []), entry]);
  }
  const matches = new Map<string, TaskTemplateEntry>();
  const added: TaskTemplateEntry[] = [];
  for (const task of snapshot) {
    const match = unmatched.get(normalizeTitle(task.title))?.shift();
    if (match) matches.set(task.key, match); else added.push(task);
  }
  const matched = new Set([...matches.values()].map(entry => entry.key));
  return { added, removed: template.filter(entry => !matched.has(entry.key)), unchanged: matches.size, matches };
}

const hasNote = (entry: TaskTemplateEntry) => Boolean(entry.notes?.trim());

/**
 * The template after the update.
 *
 * - Order and structure follow the project.
 * - A matched entry keeps the template's key, title and note. If the template
 *   had no note and the project task has one, the project's note is taken, so
 *   reusable notes are never overwritten by notes written for one occasion.
 * - An added task comes across as it is, unless its key is in `skipAdded`;
 *   then it is left out and its subtasks move up to its parent.
 * - A removed entry is dropped, unless its key is in `keepRemoved`; then it
 *   stays, directly after its original parent's subtree when that parent is
 *   still in the result, otherwise at the end as a main task.
 */
export function mergeSnapshot(
  template: TaskTemplateEntry[],
  snapshot: TaskTemplateEntry[],
  choices: { skipAdded?: ReadonlySet<string>; keepRemoved?: ReadonlySet<string> } = {},
): TaskTemplateEntry[] {
  const { matches, removed } = diffSnapshot(template, snapshot);
  const skip = choices.skipAdded ?? new Set<string>();
  const keep = choices.keepRemoved ?? new Set<string>();
  const byKey = new Map(snapshot.map(task => [task.key, task]));
  const included = (task: TaskTemplateEntry) => matches.has(task.key) || !skip.has(task.key);
  const resultKey = (task: TaskTemplateEntry) => matches.get(task.key)?.key ?? task.key;
  // The nearest ancestor that is still in the result; a skipped parent's
  // subtasks land on its own parent.
  const parentOf = (task: TaskTemplateEntry): string | null => {
    const seen = new Set<string>();
    let parent = task.parent_key ? byKey.get(task.parent_key) : undefined;
    while (parent && !included(parent) && !seen.has(parent.key)) {
      seen.add(parent.key);
      parent = parent.parent_key ? byKey.get(parent.parent_key) : undefined;
    }
    return parent && included(parent) ? resultKey(parent) : null;
  };

  const result: TaskTemplateEntry[] = [];
  for (const task of snapshot) {
    if (!included(task)) continue;
    const match = matches.get(task.key);
    result.push(match
      ? { key: match.key, title: match.title, notes: hasNote(match) ? match.notes : hasNote(task) ? task.notes : null, parent_key: parentOf(task) }
      : { key: task.key, title: task.title, notes: task.notes, parent_key: parentOf(task) });
  }

  // Template order, so a kept parent is already placed when its kept subtask arrives.
  for (const entry of removed) {
    if (!keep.has(entry.key)) continue;
    const parentAt = entry.parent_key ? result.findIndex(placed => placed.key === entry.parent_key) : -1;
    if (parentAt < 0) { result.push({ ...entry, parent_key: null }); continue; }
    const parents = new Map(result.map(placed => [placed.key, placed.parent_key]));
    const under = (key: string | null): boolean => {
      const seen = new Set<string>();
      for (let at = key; at && !seen.has(at); at = parents.get(at) ?? null) { if (at === entry.parent_key) return true; seen.add(at); }
      return false;
    };
    let end = parentAt + 1;
    result.forEach((placed, index) => { if (under(placed.parent_key)) end = Math.max(end, index + 1); });
    result.splice(end, 0, { ...entry });
  }
  return result;
}
