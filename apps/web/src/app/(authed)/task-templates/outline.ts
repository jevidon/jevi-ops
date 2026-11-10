import type { TaskTemplateEntry } from '@jevi-ops/shared';

// The template editor's outline model. A template is edited as a flat,
// ordered list of rows; indentation is the structure:
//
//   a row's parent is the nearest row above it with a smaller depth.
//
// Every function here is pure and returns a new array (or the same array when
// the operation is not available), so the component stays a thin shell and the
// rules can be tested without a DOM. The saved shape is unchanged: toEntries()
// produces the same { key, title, notes, parent_key } entries as before, in
// display order.
//
// Invariant, kept by every operation: the first row has depth 0, and no row is
// more than one level deeper than the row above it.

export interface OutlineRow { key: string; title: string; notes: string | null; depth: number }

/** Project pages show tasks and one level of subtasks, so the editor stops there. */
export const MAX_DEPTH = 1;
export const MAX_ROWS = 200;

export const blankRow = (key: string, depth = 0): OutlineRow => ({ key, title: '', notes: null, depth });
const isBlank = (row: OutlineRow) => !row.title.trim();

/**
 * Stored entries to rows: a depth-first walk from parent_key that keeps array
 * order among siblings. Stored children can sit anywhere in the array, so this
 * never assumes they follow their parent. An entry whose parent is missing
 * loads as a main task.
 */
export function toRows(entries: TaskTemplateEntry[]): OutlineRow[] {
  const keys = new Set(entries.map(entry => entry.key));
  const children = new Map<string | null, TaskTemplateEntry[]>();
  for (const entry of entries) {
    const parent = entry.parent_key !== null && keys.has(entry.parent_key) ? entry.parent_key : null;
    children.set(parent, [...(children.get(parent) ?? []), entry]);
  }
  const rows: OutlineRow[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const entry of children.get(parent) ?? []) {
      if (seen.has(entry.key)) continue;
      seen.add(entry.key);
      rows.push({ key: entry.key, title: entry.title, notes: entry.notes, depth });
      walk(entry.key, depth + 1);
    }
  };
  walk(null, 0);
  // Unreachable only if stored parents form a cycle, which the schema rejects.
  // Keep such rows visible as main tasks instead of dropping them.
  for (const entry of entries) if (!seen.has(entry.key)) rows.push({ key: entry.key, title: entry.title, notes: entry.notes, depth: 0 });
  return rows;
}

/**
 * Rows to entries for saving. Blank-title rows are placeholders and are
 * dropped; their children move up one level, to the blank row's own parent.
 */
export function toEntries(rows: OutlineRow[]): TaskTemplateEntry[] {
  const parents: (string | null)[] = [];
  const entries: TaskTemplateEntry[] = [];
  for (const row of rows) {
    const parent = row.depth > 0 ? parents[row.depth - 1] ?? null : null;
    parents.length = row.depth;
    if (isBlank(row)) { parents[row.depth] = parent; continue; }
    parents[row.depth] = row.key;
    entries.push({ key: row.key, title: row.title.trim(), notes: row.notes?.trim() ? row.notes : null, parent_key: parent });
  }
  return entries;
}

/** Index just past the row's subtree (the row plus every deeper row directly below it). */
export function subtreeEnd(rows: OutlineRow[], index: number): number {
  let end = index + 1;
  while (end < rows.length && rows[end]!.depth > rows[index]!.depth) end++;
  return end;
}
export const hasChildren = (rows: OutlineRow[], index: number) => subtreeEnd(rows, index) > index + 1;

function shift(rows: OutlineRow[], from: number, to: number, by: number): OutlineRow[] {
  return rows.map((row, i) => i >= from && i < to ? { ...row, depth: row.depth + by } : row);
}
/** Restore the invariant after rows were removed or inserted. */
function normalize(rows: OutlineRow[]): OutlineRow[] {
  let above = -1;
  return rows.map(row => {
    const depth = Math.max(0, Math.min(row.depth, above + 1));
    above = depth;
    return depth === row.depth ? row : { ...row, depth };
  });
}

/** Indent needs a row above to sit under, and room under the depth limit for the whole subtree. */
export function canIndent(rows: OutlineRow[], index: number): boolean {
  const row = rows[index];
  const above = rows[index - 1];
  if (!row || !above || row.depth > above.depth) return false;
  const deepest = Math.max(...rows.slice(index, subtreeEnd(rows, index)).map(r => r.depth));
  return deepest + 1 <= MAX_DEPTH;
}
export function indent(rows: OutlineRow[], index: number): OutlineRow[] {
  return canIndent(rows, index) ? shift(rows, index, subtreeEnd(rows, index), 1) : rows;
}

export const canOutdent = (rows: OutlineRow[], index: number) => (rows[index]?.depth ?? 0) > 0;
/**
 * Outdent moves the row and its subtree one level left and nothing moves
 * vertically, so siblings that were below it at the old depth now read, and
 * save, as its subtasks.
 */
export function outdent(rows: OutlineRow[], index: number): OutlineRow[] {
  return canOutdent(rows, index) ? shift(rows, index, subtreeEnd(rows, index), -1) : rows;
}

/** Start index of the previous sibling under the same parent, or -1. */
export function previousSibling(rows: OutlineRow[], index: number): number {
  const depth = rows[index]?.depth ?? 0;
  let at = index - 1;
  while (at >= 0 && rows[at]!.depth > depth) at--;
  return at >= 0 && rows[at]!.depth === depth ? at : -1;
}
/** Start index of the next sibling under the same parent, or -1. */
export function nextSibling(rows: OutlineRow[], index: number): number {
  if (!rows[index]) return -1;
  const end = subtreeEnd(rows, index);
  return end < rows.length && rows[end]!.depth === rows[index]!.depth ? end : -1;
}
export function moveUp(rows: OutlineRow[], index: number): OutlineRow[] {
  const sibling = previousSibling(rows, index);
  if (sibling < 0) return rows;
  const end = subtreeEnd(rows, index);
  return [...rows.slice(0, sibling), ...rows.slice(index, end), ...rows.slice(sibling, index), ...rows.slice(end)];
}
export function moveDown(rows: OutlineRow[], index: number): OutlineRow[] {
  const sibling = nextSibling(rows, index);
  if (sibling < 0) return rows;
  const siblingEnd = subtreeEnd(rows, sibling);
  return [...rows.slice(0, index), ...rows.slice(sibling, siblingEnd), ...rows.slice(index, sibling), ...rows.slice(siblingEnd)];
}

/** Remove one row. Its subtasks stay where they are and move up a level. */
export function remove(rows: OutlineRow[], index: number, newKey: () => string): OutlineRow[] {
  if (!rows[index]) return rows;
  const next = normalize(shift(rows, index + 1, subtreeEnd(rows, index), -1).filter((_, i) => i !== index));
  return next.length ? next : [blankRow(newKey())];
}

/**
 * A new blank row directly below. Under a row that has subtasks it becomes the
 * first subtask, which is where the cursor visually is.
 */
export function insertAfter(rows: OutlineRow[], index: number, key: string): OutlineRow[] {
  const row = rows[index];
  if (!row || rows.length >= MAX_ROWS) return rows;
  const depth = hasChildren(rows, index) ? row.depth + 1 : row.depth;
  return [...rows.slice(0, index + 1), blankRow(key, depth), ...rows.slice(index + 1)];
}
export function append(rows: OutlineRow[], key: string): OutlineRow[] {
  return rows.length >= MAX_ROWS ? rows : [...rows, blankRow(key)];
}

/**
 * Pasted text to outline lines, or null when it is a single line and should
 * paste as ordinary text. One task per non-empty line. Leading bullets,
 * numbers and checkbox markers are stripped; leading whitespace (two spaces
 * or one tab per level) sets depth relative to the shallowest line.
 */
export function parsePaste(text: string): { title: string; depth: number }[] | null {
  if (!/[\r\n]/.test(text)) return null;
  const lines = text.split(/\r\n|\r|\n/).flatMap(line => {
    const lead = line.match(/^[\t ]*/)![0].replace(/\t/g, '  ').length;
    const title = line.trim().replace(/^(?:[-*•–]\s+|\d+[.)]\s+)?(?:\[[ xX]?\]\s+)?/, '').trim().slice(0, 500);
    return title ? [{ title, level: Math.floor(lead / 2) }] : [];
  });
  if (!lines.length) return null;
  const shallowest = Math.min(...lines.map(line => line.level));
  return lines.map(line => ({ title: line.title, depth: line.level - shallowest }));
}

/**
 * Insert pasted lines at the row at `index`: a blank row is replaced,
 * otherwise the lines go after that row's subtree, as its siblings. Depths
 * are relative to the current row and clamped to the depth limit. Returns
 * null when the result would exceed the row limit, so nothing is truncated.
 */
export function insertPasted(rows: OutlineRow[], index: number, lines: { title: string; depth: number }[], newKey: () => string): { rows: OutlineRow[]; lastKey: string } | null {
  const row = rows[index];
  if (!row || !lines.length) return null;
  const replace = isBlank(row) && !row.notes?.trim() && !hasChildren(rows, index);
  if (rows.length + lines.length - (replace ? 1 : 0) > MAX_ROWS) return null;
  const made = lines.map(line => ({ key: newKey(), title: line.title, notes: null, depth: Math.min(row.depth + line.depth, Math.max(MAX_DEPTH, row.depth)) }));
  const at = replace ? index : subtreeEnd(rows, index);
  const next = normalize([...rows.slice(0, at), ...made, ...rows.slice(replace ? index + 1 : at)]);
  return { rows: next, lastKey: made[made.length - 1]!.key };
}
