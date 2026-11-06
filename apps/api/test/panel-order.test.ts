import { mergePanelOrder } from '@jevi-ops/shared';
import { expect, it } from 'vitest';

const registry = [
  { id: 'frame', defaultEnabled: true },
  { id: 'weather', defaultEnabled: true },
  { id: 'recent-activity', defaultEnabled: true },
  { id: 'domain-pulse', defaultEnabled: false },
];

it('inserts missing panels in registry order when there are no saved settings', () => {
  expect(mergePanelOrder(null, registry)).toEqual(
    registry.map(({ id, defaultEnabled }) => ({ id, enabled: defaultEnabled })),
  );
});

it('keeps saved order and visibility, drops duplicates and inserts missing panels', () => {
  expect(mergePanelOrder([
    { id: 'domain-pulse', enabled: true },
    { id: 'retired', enabled: true },
    { id: 'weather', enabled: false },
    { id: 'weather', enabled: true },
  ], registry)).toEqual([
    { id: 'frame', enabled: true },
    { id: 'domain-pulse', enabled: true },
    { id: 'weather', enabled: false },
    { id: 'recent-activity', enabled: true },
  ]);
});
