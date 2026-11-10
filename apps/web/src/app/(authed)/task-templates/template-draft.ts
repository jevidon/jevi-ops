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
