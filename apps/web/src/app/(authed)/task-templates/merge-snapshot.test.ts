import { describe, expect, it } from 'vitest';
import { TaskTemplateInputSchema, type TaskTemplateEntry } from '@jevi-ops/shared';
import { diffSnapshot, mergeSnapshot, normalizeTitle } from './merge-snapshot';

// Template entries get keys "t:<title>", project tasks "p:<title>", so a
// result shows where each entry came from.
const from = (prefix: string) => (title: string, parent: string | null = null, notes: string | null = null): TaskTemplateEntry =>
  ({ key: `${prefix}:${title}`, title, notes, parent_key: parent === null ? null : `${prefix}:${parent}` });
const t = from('t');
const p = from('p');
const draw = (entries: TaskTemplateEntry[]) => entries.map(entry => `${entry.title}${entry.parent_key ? ` < ${entries.find(e => e.key === entry.parent_key)?.title ?? '?'}` : ''}`);

const template = [t('Documents'), t('Passport', 'Documents'), t('Sunscreen'), t('Keys')];
const project = [p('Documents'), p('Passport', 'Documents'), p('ESTA printout', 'Documents'), p('Keys'), p('Gift for Sam')];

describe('diffSnapshot', () => {
  it('sorts tasks into added, removed and unchanged by title', () => {
    const diff = diffSnapshot(template, project);
    expect(diff.added.map(e => e.title)).toEqual(['ESTA printout', 'Gift for Sam']);
    expect(diff.removed.map(e => e.title)).toEqual(['Sunscreen']);
    expect(diff.unchanged).toBe(3);
    expect(diff.matches.get('p:Passport')!.key).toBe('t:Passport');
  });

  it('treats titles that differ only in case or spacing as the same task', () => {
    expect(normalizeTitle('  Power   Adapter ')).toBe('power adapter');
    const diff = diffSnapshot([t('Power adapter')], [p('  POWER   adapter ')]);
    expect([diff.added.length, diff.removed.length, diff.unchanged]).toEqual([0, 0, 1]);
  });

  it('pairs duplicate titles off in order and reports the surplus on either side', () => {
    const more = diffSnapshot([t('Charger')], [{ ...p('Charger'), key: 'p:1' }, { ...p('Charger'), key: 'p:2' }]);
    expect([more.unchanged, more.added.map(e => e.key), more.removed]).toEqual([1, ['p:2'], []]);
    const fewer = diffSnapshot([{ ...t('Charger'), key: 't:1' }, { ...t('Charger'), key: 't:2' }], [p('Charger')]);
    expect([fewer.unchanged, fewer.added, fewer.removed.map(e => e.key)]).toEqual([1, [], ['t:2']]);
  });
});

describe('mergeSnapshot', () => {
  it('follows the project: its order and structure, additions in, removals out', () => {
    const merged = mergeSnapshot(template, project);
    expect(draw(merged)).toEqual(['Documents', 'Passport < Documents', 'ESTA printout < Documents', 'Keys', 'Gift for Sam']);
    // Matched entries keep the template's identity; added ones bring the project's.
    expect(merged.map(e => e.key)).toEqual(['t:Documents', 't:Passport', 'p:ESTA printout', 't:Keys', 'p:Gift for Sam']);
    expect(merged[2]!.parent_key).toBe('t:Documents');
  });

  it('reorders the template to match the project', () => {
    expect(draw(mergeSnapshot([t('A'), t('B'), t('C')], [p('C'), p('A'), p('B')]))).toEqual(['C', 'A', 'B']);
  });

  it('keeps the template wording of a matched title', () => {
    expect(mergeSnapshot([t('Power adapter')], [p('POWER ADAPTER')])[0]!.title).toBe('Power adapter');
  });

  it('leaves a skipped addition out and moves its subtasks up to its parent', () => {
    const snapshot = [p('Documents'), p('Visa pack', 'Documents'), p('Photos', 'Visa pack'), p('Form', 'Visa pack'), p('Trip extras'), p('Gift for Sam', 'Trip extras')];
    const merged = mergeSnapshot([t('Documents')], snapshot, { skipAdded: new Set(['p:Visa pack', 'p:Trip extras']) });
    expect(draw(merged)).toEqual(['Documents', 'Photos < Documents', 'Form < Documents', 'Gift for Sam']);
  });

  it('never skips a matched task, even if its key is passed', () => {
    expect(draw(mergeSnapshot(template, project, { skipAdded: new Set(['p:Documents']) }))).toContain('Documents');
  });

  it('keeps a removed entry after its parent subtree when the parent survives', () => {
    const tpl = [t('Documents'), t('Passport', 'Documents'), t('Insurance card', 'Documents'), t('Keys')];
    const snapshot = [p('Documents'), p('Passport', 'Documents'), p('Boarding pass', 'Documents'), p('Keys')];
    const merged = mergeSnapshot(tpl, snapshot, { keepRemoved: new Set(['t:Insurance card']) });
    expect(draw(merged)).toEqual(['Documents', 'Passport < Documents', 'Boarding pass < Documents', 'Insurance card < Documents', 'Keys']);
  });

  it('keeps a removed entry at the end as a main task when its parent is gone or it had none', () => {
    const tpl = [t('Toiletries'), t('Sunscreen', 'Toiletries'), t('Keys'), t('Umbrella')];
    const merged = mergeSnapshot(tpl, [p('Keys')], { keepRemoved: new Set(['t:Sunscreen', 't:Umbrella']) });
    expect(draw(merged)).toEqual(['Keys', 'Sunscreen', 'Umbrella']);
  });

  it('keeps a removed parent together with its removed subtask', () => {
    const tpl = [t('Keys'), t('Toiletries'), t('Sunscreen', 'Toiletries')];
    const merged = mergeSnapshot(tpl, [p('Keys')], { keepRemoved: new Set(['t:Toiletries', 't:Sunscreen']) });
    expect(draw(merged)).toEqual(['Keys', 'Toiletries', 'Sunscreen < Toiletries']);
  });

  it('places a kept entry after a subtree that is not stored contiguously', () => {
    // Project order is by creation time, so a subtask can sit far from its parent.
    const tpl = [t('Documents'), t('Passport', 'Documents'), t('Insurance card', 'Documents'), t('Keys')];
    const snapshot = [p('Documents'), p('Keys'), p('Passport', 'Documents')];
    const merged = mergeSnapshot(tpl, snapshot, { keepRemoved: new Set(['t:Insurance card']) });
    expect(draw(merged)).toEqual(['Documents', 'Keys', 'Passport < Documents', 'Insurance card < Documents']);
  });

  it('protects template notes and only fills in a missing one', () => {
    const tpl = [t('Passport', null, 'Check expiry'), t('Charger'), t('Keys', null, '  ')];
    const snapshot = [p('Passport', null, 'Renewed in March for this trip'), p('Charger', null, 'USB-C'), p('Keys'), p('Adapter', null, 'Type G')];
    expect(mergeSnapshot(tpl, snapshot).map(e => e.notes)).toEqual(['Check expiry', 'USB-C', null, 'Type G']);
  });

  it('with no choices and nothing in common, becomes exactly the project list', () => {
    const snapshot = [p('Tent'), p('Pegs', 'Tent')];
    expect(mergeSnapshot(template, snapshot)).toEqual(snapshot);
  });

  it('produces entries the shared schema accepts', () => {
    const id = () => crypto.randomUUID();
    const [a, b, c, d] = [id(), id(), id(), id()];
    const tpl = [{ key: a, title: 'Documents', notes: null, parent_key: null }, { key: b, title: 'Old', notes: null, parent_key: a }];
    const snapshot = [{ key: c, title: 'documents', notes: null, parent_key: null }, { key: d, title: 'New', notes: 'n', parent_key: c }];
    const merged = mergeSnapshot(tpl, snapshot, { keepRemoved: new Set([b]) });
    expect(TaskTemplateInputSchema.safeParse({ name: 'Packing', entries: merged }).success).toBe(true);
    expect(merged.map(e => [e.title, e.parent_key])).toEqual([['Documents', null], ['New', a], ['Old', a]]);
  });
});
