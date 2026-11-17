import type { DeviceGroups, DeviceSystem, ListChanges } from "../domain";

/**
 * Apply a list's change set to `groups` as core does for a save, for the
 * mocks: a group's removal, rows, next number, and selection. A group the
 * change makes is this device's, on `system`.
 */
export function applyMockListChanges<F extends string>(
  groups: DeviceGroups<F>,
  changes: ListChanges<F>,
  here: { system: DeviceSystem },
): DeviceGroups<F> {
  const next: DeviceGroups<F> = { ...groups };
  for (const [id, change] of Object.entries(changes.groups)) {
    if (change.remove) {
      delete next[id];
      continue;
    }
    const group = next[id] ?? {
      system: here.system,
      selected: change.selected ?? "none",
      next_number: 1,
      rows: [],
    };
    next[id] = {
      ...group,
      ...(change.rows !== undefined ? { rows: change.rows } : {}),
      ...(change.next_number !== undefined ? { next_number: change.next_number } : {}),
      ...(change.selected !== undefined ? { selected: change.selected } : {}),
    };
  }
  return next;
}
