import { expect, it } from 'vitest';
import { duplicateEntries, formatEdited, templateSummary } from './template-draft';

const entry = (key: string, title: string, parent_key: string | null = null, notes: string | null = null) => ({ key, title, notes, parent_key });

it('summarises tasks, groups and a four-title peek of the main tasks', () => {
  const entries = [
    entry('docs', 'Documents'), entry('passport', 'Passport', 'docs'), entry('pass', 'Boarding pass', 'docs'),
    entry('tech', 'Electronics'), entry('charger', 'Charger', 'tech'),
    entry('meds', 'Refill prescriptions'), entry('keys', 'Leave keys'), entry('bins', 'Bins out'),
  ];
  expect(templateSummary(entries)).toEqual({ tasks: 8, groups: 2, peek: 'Documents, Electronics, Refill prescriptions, Leave keys…' });
  // Four or fewer main tasks: no ellipsis. No subtasks: no groups.
  expect(templateSummary(entries.slice(5))).toEqual({ tasks: 3, groups: 0, peek: 'Refill prescriptions, Leave keys, Bins out' });
  // An entry whose parent is missing reads as a main task and forms no group.
  expect(templateSummary([entry('lost', 'Orphan', 'gone')])).toEqual({ tasks: 1, groups: 0, peek: 'Orphan' });
});

it('duplicates entries under fresh keys with the same structure and notes', () => {
  const source = [entry('a', 'Documents', null, 'Originals'), entry('b', 'Passport', 'a', 'Check expiry'), entry('c', 'Loose', 'gone')];
  let n = 0;
  const copy = duplicateEntries(source, () => `new-${++n}`);
  expect(copy).toEqual([
    entry('new-1', 'Documents', null, 'Originals'), entry('new-2', 'Passport', 'new-1', 'Check expiry'), entry('new-3', 'Loose', null),
  ]);
  expect(source[1]!.parent_key).toBe('a');
});

it('formats the edit date in the app timezone, adding the year only when it differs', () => {
  const now = new Date('2026-11-11T12:00:00Z');
  // 03:30 UTC on Oct 13 is still Oct 12 in Denver and already Oct 13 in Auckland.
  expect(formatEdited('2026-10-13T03:30:00Z', 'America/Denver', now)).toBe('Oct 12');
  expect(formatEdited('2026-10-13T03:30:00Z', 'Pacific/Auckland', now)).toBe('Oct 13');
  expect(formatEdited('2025-10-13T03:30:00Z', 'America/Denver', now)).toBe('Oct 12, 2025');
  expect(formatEdited('', 'America/Denver', now)).toBe('');
});
