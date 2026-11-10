import { describe, expect, it } from 'vitest';
import { TaskTemplateInputSchema, type TaskTemplateEntry } from '@jevi-ops/shared';
import {
  append, canIndent, canOutdent, indent, insertAfter, insertPasted, MAX_ROWS, moveDown, moveUp, nextSibling, outdent, parsePaste,
  previousSibling, remove, toEntries, toRows, type OutlineRow,
} from './outline';

// Rows are written as an indented sketch: two spaces per level, key = title.
const sketch = (text: string): OutlineRow[] => text.split('\n').filter(line => line.trim()).map(line => {
  const title = line.trim();
  return { key: title, title, notes: null, depth: (line.length - line.trimStart().length) / 2 };
});
const draw = (rows: OutlineRow[]) => rows.map(row => '  '.repeat(row.depth) + (row.title || '·')).join('\n');
const at = (rows: OutlineRow[], title: string) => rows.findIndex(row => row.title === title);
const entry = (key: string, parent_key: string | null = null, notes: string | null = null): TaskTemplateEntry => ({ key, title: key, notes, parent_key });
const newKey = (() => { let n = 0; return () => `new-${++n}`; })();

const packing = sketch(`
Documents
  Passport
  Boarding pass
Electronics
  Charger
Refill prescriptions`);

describe('toRows and toEntries', () => {
  it('walks stored entries depth-first, wherever children sit in the array', () => {
    // Children stored before and far from their parents, as the card editor could leave them.
    const stored = [entry('Charger', 'Electronics'), entry('Documents'), entry('Electronics'), entry('Passport', 'Documents', 'Check expiry'), entry('Adapter', 'Electronics')];
    const rows = toRows(stored);
    expect(draw(rows)).toBe('Documents\n  Passport\nElectronics\n  Charger\n  Adapter');
    expect(rows[1]!.notes).toBe('Check expiry');
  });

  it('round-trips structure, notes and order, and produces a valid payload', () => {
    const stored = [entry('Documents', null, 'Originals'), entry('Passport', 'Documents', 'Check expiry'), entry('Electronics'), entry('Charger', 'Electronics'), entry('Loose')];
    expect(toEntries(toRows(stored))).toEqual(stored);
    // Out-of-order input comes back in display order with the same relationships.
    const shuffled = [stored[3]!, stored[4]!, stored[1]!, stored[0]!, stored[2]!];
    const back = toEntries(toRows(shuffled));
    expect(back.map(e => e.key)).toEqual(['Loose', 'Documents', 'Passport', 'Electronics', 'Charger']);
    expect(Object.fromEntries(back.map(e => [e.key, e.parent_key]))).toEqual(Object.fromEntries(stored.map(e => [e.key, e.parent_key])));
  });

  it('loads an orphan as a main task and keeps deeper legacy nesting at its real depth', () => {
    const rows = toRows([entry('Orphan', 'gone'), entry('A'), entry('B', 'A'), entry('C', 'B')]);
    expect(draw(rows)).toBe('Orphan\nA\n  B\n    C');
    expect(toEntries(rows).map(e => e.parent_key)).toEqual([null, null, 'A', 'B']);
  });

  it('keeps rows reachable only through a parent cycle instead of dropping them', () => {
    const rows = toRows([entry('A', 'B'), entry('B', 'A'), entry('C')]);
    expect(rows.map(row => row.title).sort()).toEqual(['A', 'B', 'C']);
  });

  it('drops blank rows on save, moves their children up a level, trims titles and empties blank notes', () => {
    const rows: OutlineRow[] = [
      { key: 'a', title: '  Documents ', notes: '   ', depth: 0 },
      { key: 'blank', title: '   ', notes: null, depth: 1 },
      { key: 'b', title: 'Passport', notes: 'Check expiry', depth: 1 },
      { key: 'top-blank', title: '', notes: null, depth: 0 },
      { key: 'c', title: 'Under a blank', notes: null, depth: 1 },
    ];
    expect(toEntries(rows)).toEqual([
      { key: 'a', title: 'Documents', notes: null, parent_key: null },
      { key: 'b', title: 'Passport', notes: 'Check expiry', parent_key: 'a' },
      { key: 'c', title: 'Under a blank', notes: null, parent_key: null },
    ]);
  });

  it('produces entries the shared schema accepts', () => {
    const rows = sketch('Documents\n  Passport\nKeys').map(row => ({ ...row, key: crypto.randomUUID() }));
    expect(TaskTemplateInputSchema.safeParse({ name: 'Packing', entries: toEntries(rows) }).success).toBe(true);
  });
});

describe('indent and outdent', () => {
  it('indents a task under the row above, and only one level deep', () => {
    const rows = sketch('A\nB\nC');
    expect(canIndent(rows, 0)).toBe(false);
    expect(draw(indent(rows, 1))).toBe('A\n  B\nC');
    // Already a subtask: the depth limit refuses a second level.
    const nested = indent(rows, 1);
    expect(canIndent(nested, 1)).toBe(false);
    expect(indent(nested, 1)).toBe(nested);
    expect(canIndent(nested, 2)).toBe(true);
    expect(draw(indent(nested, 2))).toBe('A\n  B\n  C');
  });

  it('refuses to indent a task that has subtasks, since they would pass the limit', () => {
    const rows = sketch('A\nB\n  C');
    expect(canIndent(rows, 1)).toBe(false);
    expect(indent(rows, 1)).toBe(rows);
  });

  it('outdents in place, so later siblings become its subtasks', () => {
    const rows = sketch('A\n  B\n  C\nD');
    expect(canOutdent(rows, 0)).toBe(false);
    expect(outdent(rows, 0)).toBe(rows);
    const next = outdent(rows, 1);
    expect(draw(next)).toBe('A\nB\n  C\nD');
    expect(toEntries(next).find(e => e.key === 'C')!.parent_key).toBe('B');
  });

  it('lets legacy deep rows move left but never deeper', () => {
    const rows = toRows([entry('A'), entry('B', 'A'), entry('C', 'B')]);
    expect(canIndent(rows, 2)).toBe(false);
    expect(draw(outdent(rows, 2))).toBe('A\n  B\n  C');
    // Outdenting a nested parent carries its subtree.
    expect(draw(outdent(rows, 1))).toBe('A\nB\n  C');
  });
});

describe('moving', () => {
  it('swaps with the sibling above or below, carrying subtasks', () => {
    expect(draw(moveDown(packing, at(packing, 'Documents')))).toBe('Electronics\n  Charger\nDocuments\n  Passport\n  Boarding pass\nRefill prescriptions');
    expect(draw(moveUp(packing, at(packing, 'Refill prescriptions')))).toBe('Documents\n  Passport\n  Boarding pass\nRefill prescriptions\nElectronics\n  Charger');
    expect(draw(moveUp(packing, at(packing, 'Boarding pass')))).toBe('Documents\n  Boarding pass\n  Passport\nElectronics\n  Charger\nRefill prescriptions');
  });

  it('stops at the edge of its group', () => {
    expect(previousSibling(packing, at(packing, 'Documents'))).toBe(-1);
    expect(nextSibling(packing, at(packing, 'Refill prescriptions'))).toBe(-1);
    // A subtask does not jump into the next group.
    expect(nextSibling(packing, at(packing, 'Boarding pass'))).toBe(-1);
    expect(previousSibling(packing, at(packing, 'Charger'))).toBe(-1);
    expect(moveDown(packing, at(packing, 'Boarding pass'))).toBe(packing);
    expect(moveUp(packing, at(packing, 'Charger'))).toBe(packing);
  });
});

describe('insert and remove', () => {
  it('inserts a sibling below, or a first subtask under a task that has subtasks', () => {
    expect(draw(insertAfter(packing, at(packing, 'Passport'), 'x'))).toBe('Documents\n  Passport\n  ·\n  Boarding pass\nElectronics\n  Charger\nRefill prescriptions');
    expect(draw(insertAfter(packing, at(packing, 'Documents'), 'x'))).toBe('Documents\n  ·\n  Passport\n  Boarding pass\nElectronics\n  Charger\nRefill prescriptions');
    expect(draw(insertAfter(packing, at(packing, 'Refill prescriptions'), 'x'))).toMatch(/Refill prescriptions\n·$/);
    expect(draw(append(packing, 'x'))).toMatch(/Refill prescriptions\n·$/);
  });

  it('removes a task and promotes its subtasks in place', () => {
    expect(draw(remove(packing, at(packing, 'Documents'), newKey))).toBe('Passport\nBoarding pass\nElectronics\n  Charger\nRefill prescriptions');
    expect(draw(remove(packing, at(packing, 'Passport'), newKey))).toBe('Documents\n  Boarding pass\nElectronics\n  Charger\nRefill prescriptions');
    // Removing a legacy nested parent lifts its subtree one level.
    expect(draw(remove(toRows([entry('A'), entry('B', 'A'), entry('C', 'B')]), 1, newKey))).toBe('A\n  C');
  });

  it('leaves one blank row when the last task is removed', () => {
    const rows = remove(sketch('Only'), 0, () => 'fresh');
    expect(rows).toEqual([{ key: 'fresh', title: '', notes: null, depth: 0 }]);
  });

  it('refuses to grow past the row limit', () => {
    const full = Array.from({ length: MAX_ROWS }, (_, i) => ({ key: `k${i}`, title: `Task ${i}`, notes: null, depth: 0 }));
    expect(insertAfter(full, 3, 'x')).toBe(full);
    expect(append(full, 'x')).toBe(full);
    expect(insertPasted(full, 3, [{ title: 'One more', depth: 0 }], newKey)).toBeNull();
    // Exactly reaching the limit is allowed; one past it is not.
    const nearly = full.slice(0, MAX_ROWS - 2);
    expect(insertPasted(nearly, 0, [{ title: 'a', depth: 0 }, { title: 'b', depth: 0 }], newKey)!.rows).toHaveLength(MAX_ROWS);
    expect(insertPasted(nearly, 0, [{ title: 'a', depth: 0 }, { title: 'b', depth: 0 }, { title: 'c', depth: 0 }], newKey)).toBeNull();
  });
});

describe('paste', () => {
  it('leaves a single line alone', () => {
    expect(parsePaste('Passport')).toBeNull();
    expect(parsePaste('\n  \n')).toBeNull();
  });

  it('makes one task per line and strips bullets, numbers and checkboxes', () => {
    expect(parsePaste('- Passport\n* Boarding pass\n• Charger\n1. Adapter\n2) Headphones\n[ ] Keys\n- [x] Bins out\n\nPlain')).toEqual(
      ['Passport', 'Boarding pass', 'Charger', 'Adapter', 'Headphones', 'Keys', 'Bins out', 'Plain'].map(title => ({ title, depth: 0 })),
    );
    // A leading dash that is part of the text, not a bullet, stays.
    expect(parsePaste('-10 degree bag\nT-shirt')!.map(line => line.title)).toEqual(['-10 degree bag', 'T-shirt']);
  });

  it('reads leading whitespace as nesting, relative to the shallowest line', () => {
    expect(parsePaste('    Documents\n      - Passport\n\t\t\tBoarding pass\n    Keys\r\n')).toEqual([
      { title: 'Documents', depth: 0 }, { title: 'Passport', depth: 1 }, { title: 'Boarding pass', depth: 1 }, { title: 'Keys', depth: 0 },
    ]);
  });

  it('replaces a blank row, or inserts after the current task and its subtasks', () => {
    const lines = parsePaste('Toiletries\n  Toothbrush\nUmbrella')!;
    const blank = [...packing, { key: 'blank', title: '', notes: null, depth: 0 }];
    const replaced = insertPasted(blank, blank.length - 1, lines, newKey)!;
    expect(draw(replaced.rows)).toMatch(/Refill prescriptions\nToiletries\n  Toothbrush\nUmbrella$/);
    expect(replaced.rows.some(row => row.key === 'blank')).toBe(false);
    expect(replaced.rows.at(-1)!.key).toBe(replaced.lastKey);
    const after = insertPasted(packing, at(packing, 'Documents'), lines, newKey)!;
    expect(draw(after.rows)).toBe('Documents\n  Passport\n  Boarding pass\nToiletries\n  Toothbrush\nUmbrella\nElectronics\n  Charger\nRefill prescriptions');
  });

  it('clamps pasted nesting to the depth limit and to the row above', () => {
    // Pasted into a subtask: everything lands as a subtask, never deeper.
    const inside = insertPasted(packing, at(packing, 'Passport'), parsePaste('Visa\n  Photocopy\n    Spare')!, newKey)!;
    expect(draw(inside.rows)).toBe('Documents\n  Passport\n  Visa\n  Photocopy\n  Spare\n  Boarding pass\nElectronics\n  Charger\nRefill prescriptions');
    // A paste that starts indented cannot begin deeper than one below the row above.
    const first = insertPasted([{ key: 'blank', title: '', notes: null, depth: 0 }], 0, [{ title: 'Child first', depth: 1 }, { title: 'Then parent', depth: 0 }], newKey)!;
    expect(draw(first.rows)).toBe('Child first\nThen parent');
  });
});
