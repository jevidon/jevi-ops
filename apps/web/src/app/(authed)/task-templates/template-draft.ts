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

/** Field-error key for one task row, so a failure can mark the row itself. */
export const entryField = (key: string) => `entries.${key}`;

export const UNTITLED_NOTE_ERROR = 'Add a title to each task that has a note, or clear the note.';
export const UNTITLED_NOTE_FIELD_ERROR = 'Add a title, or clear this task’s note.';
