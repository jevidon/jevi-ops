// Preserve the saved order, inserting new panels at their registry position.
export function mergePanelOrder<Id extends string>(
  stored: readonly { id: string; enabled: boolean }[] | null | undefined,
  registry: readonly { id: Id; defaultEnabled: boolean }[],
): Array<{ id: Id; enabled: boolean }> {
  const byId = new Map<string, (typeof registry)[number]>(registry.map((panel) => [panel.id, panel]));
  const merged: Array<{ id: Id; enabled: boolean }> = [];
  const seen = new Set<Id>();

  for (const entry of stored ?? []) {
    const panel = byId.get(entry.id);
    if (panel && !seen.has(panel.id)) {
      merged.push({ id: panel.id, enabled: entry.enabled });
      seen.add(panel.id);
    }
  }

  // After each iteration, the immediately preceding registry panel is present.
  let predecessor = -1;
  for (const panel of registry) {
    const index = merged.findIndex((entry) => entry.id === panel.id);
    if (index === -1) {
      predecessor += 1;
      merged.splice(predecessor, 0, { id: panel.id, enabled: panel.defaultEnabled });
    } else {
      predecessor = index;
    }
  }
  return merged;
}
