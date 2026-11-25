import type { DeviceSystem } from "../device";
import { folderPathIssue, sameFolderPath } from "./paths";
import {
  ROW_NAME_MAX_CHARS,
  type DeviceGroup,
  type DeviceGroups,
  type DeviceId,
  type FolderListPolicy,
  type FolderRow,
  type Selection,
} from "./types";

/**
 * The pure edits a draft makes to one list. Each returns new groups and never
 * changes the ones it was given. A group is made the first time it holds
 * something and stays until Remove device takes it (`removeGroup`): deleting
 * its rows or selecting the default again keeps it.
 */

/** The current device as a list edits it: it has an ID. */
export interface HereDevice {
  id: DeviceId;
  system: DeviceSystem;
}

/** This device's group, or the group it would get. */
export function groupHere<F extends string>(
  groups: DeviceGroups<F>,
  here: HereDevice,
  policy: FolderListPolicy<F>,
): DeviceGroup<F> {
  return (
    groups[here.id] ?? {
      system: here.system,
      selected: policy.fallback,
      next_number: 1,
      rows: [],
    }
  );
}

/** What this device uses: its group's selection, or the list's default. */
export function selectionHere<F extends string>(
  groups: DeviceGroups<F>,
  hereId: DeviceId | null,
  policy: FolderListPolicy<F>,
): Selection<F> {
  return (hereId ? groups[hereId]?.selected : undefined) ?? policy.fallback;
}

/** True while another device has a group in the list: only then does it show devices. */
export function hasOtherDevices<F extends string>(
  groups: DeviceGroups<F>,
  hereId: DeviceId | null,
): boolean {
  return Object.keys(groups).some((id) => id !== hereId);
}

/** The other devices' groups, by system and then ID, the order their names read in. */
export function otherGroups<F extends string>(
  groups: DeviceGroups<F>,
  hereId: DeviceId | null,
): Array<[DeviceId, DeviceGroup<F>]> {
  return Object.entries(groups)
    .filter(([id]) => id !== hereId)
    .sort(([aId, a], [bId, b]) => a.system.localeCompare(b.system) || aId.localeCompare(bId));
}

/** Rows, or a selection other than the list's default: what a group is made for. */
export function holdsSomething<F extends string>(
  group: DeviceGroup<F>,
  policy: FolderListPolicy<F>,
): boolean {
  return group.rows.length > 0 || group.selected !== policy.fallback;
}

function withGroup<F extends string>(
  groups: DeviceGroups<F>,
  id: DeviceId,
  group: DeviceGroup<F>,
  policy: FolderListPolicy<F>,
): DeviceGroups<F> {
  if (!groups[id] && !holdsSomething(group, policy)) return groups;
  return { ...groups, [id]: group };
}

function editGroup<F extends string>(
  groups: DeviceGroups<F>,
  id: DeviceId,
  policy: FolderListPolicy<F>,
  edit: (group: DeviceGroup<F>) => DeviceGroup<F>,
): DeviceGroups<F> {
  const group = groups[id];
  return group ? withGroup(groups, id, edit(group), policy) : groups;
}

/** A row name as kept: trimmed, at most `ROW_NAME_MAX_CHARS` characters. */
export function normalizeRowName(name: string): string {
  return limitRowName(name.trim());
}

/** A row name as typed, cut at `ROW_NAME_MAX_CHARS` characters; core trims it on save. */
function limitRowName(name: string): string {
  return Array.from(name).slice(0, ROW_NAME_MAX_CHARS).join("");
}

/** Add a folder to this device's group and select it. */
export function addRow<F extends string>(
  groups: DeviceGroups<F>,
  here: HereDevice,
  policy: FolderListPolicy<F>,
  path: string,
  name = "",
): { groups: DeviceGroups<F>; number: number } {
  const group = groupHere(groups, here, policy);
  const number = group.next_number;
  const row: FolderRow = { number, name: normalizeRowName(name), path };
  return {
    groups: withGroup(
      groups,
      here.id,
      { ...group, rows: [...group.rows, row], next_number: number + 1, selected: number },
      policy,
    ),
    number,
  };
}

/**
 * Add a folder to another device's group, as text: its selection stays, since
 * only that device chooses. The group must exist.
 */
export function appendRow<F extends string>(
  groups: DeviceGroups<F>,
  id: DeviceId,
  policy: FolderListPolicy<F>,
  path: string,
  name = "",
): { groups: DeviceGroups<F>; number: number } {
  const group = groups[id];
  if (!group) return { groups, number: 0 };
  const number = group.next_number;
  const row: FolderRow = { number, name: normalizeRowName(name), path };
  return {
    groups: withGroup(
      groups,
      id,
      { ...group, rows: [...group.rows, row], next_number: number + 1 },
      policy,
    ),
    number,
  };
}

/** Rename a row, or change its path. Never changes the selection. */
export function updateRow<F extends string>(
  groups: DeviceGroups<F>,
  id: DeviceId,
  number: number,
  patch: { name?: string; path?: string },
  policy: FolderListPolicy<F>,
): DeviceGroups<F> {
  return editGroup(groups, id, policy, (group) => ({
    ...group,
    rows: group.rows.map((row) =>
      row.number === number
        ? {
            ...row,
            // Kept as typed, so a space typed between words stays.
            ...(patch.name !== undefined ? { name: limitRowName(patch.name) } : {}),
            ...(patch.path !== undefined ? { path: patch.path } : {}),
          }
        : row,
    ),
  }));
}

/** Move a row one place up (`-1`) or down (`1`): the order is the priority. */
export function moveRow<F extends string>(
  groups: DeviceGroups<F>,
  id: DeviceId,
  number: number,
  delta: -1 | 1,
  policy: FolderListPolicy<F>,
): DeviceGroups<F> {
  return editGroup(groups, id, policy, (group) => {
    const from = group.rows.findIndex((row) => row.number === number);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= group.rows.length) return group;
    const rows = [...group.rows];
    [rows[from], rows[to]] = [rows[to], rows[from]];
    return { ...group, rows };
  });
}

/**
 * Delete a row. When it was selected, the selection moves to the top row
 * left, or to the list's fallback when none is left.
 */
export function deleteRow<F extends string>(
  groups: DeviceGroups<F>,
  id: DeviceId,
  number: number,
  policy: FolderListPolicy<F>,
): DeviceGroups<F> {
  return editGroup(groups, id, policy, (group) => {
    const rows = group.rows.filter((row) => row.number !== number);
    const selected =
      group.selected === number ? (rows[0]?.number ?? policy.fallback) : group.selected;
    return { ...group, rows, selected };
  });
}

/** Select `selection` on this device. */
export function selectHere<F extends string>(
  groups: DeviceGroups<F>,
  here: HereDevice,
  policy: FolderListPolicy<F>,
  selection: Selection<F>,
): DeviceGroups<F> {
  return withGroup(
    groups,
    here.id,
    { ...groupHere(groups, here, policy), selected: selection },
    policy,
  );
}

/**
 * Remove device: drop another device's group, its rows and its selection.
 * Only this list's setting goes; that device keeps working with the list's
 * default. The current device's group is never removed here.
 */
export function removeGroup<F extends string>(
  groups: DeviceGroups<F>,
  id: DeviceId,
): DeviceGroups<F> {
  const next = { ...groups };
  delete next[id];
  return next;
}

/** Why a row of another device cannot be copied here. */
export type CopyRefusal =
  /** Nothing copies into a phone: its rows are picked, so they hold a grant. */
  | "phone_here"
  /** A phone's row holds that phone's grant. */
  | "phone_row"
  /** The path is not one this device can hold. */
  | "not_valid_here"
  | "already_here";

function isPhone(system: DeviceSystem): boolean {
  return system === "android" || system === "ios";
}

/** Why `row` of `from` cannot be copied into this device's group, or `null`. */
export function copyRefusal<F extends string>(
  groups: DeviceGroups<F>,
  from: DeviceGroup<F>,
  row: FolderRow,
  here: HereDevice,
  policy: FolderListPolicy<F>,
): CopyRefusal | null {
  if (isPhone(here.system)) return "phone_here";
  if (isPhone(from.system)) return "phone_row";
  if (folderPathIssue(here.system, policy.kind, row.path)) return "not_valid_here";
  const mine = groupHere(groups, here, policy);
  if (mine.rows.some((own) => sameFolderPath(here.system, own.path, row.path))) {
    return "already_here";
  }
  return null;
}

/** Copy one row of another device here, keeping its name, and select it. */
export function copyRow<F extends string>(
  groups: DeviceGroups<F>,
  fromId: DeviceId,
  number: number,
  here: HereDevice,
  policy: FolderListPolicy<F>,
): DeviceGroups<F> {
  const from = groups[fromId];
  const row = from?.rows.find((candidate) => candidate.number === number);
  if (!from || !row || copyRefusal(groups, from, row, here, policy)) return groups;
  return addRow(groups, here, policy, row.path, row.name).groups;
}

/**
 * Copy every row of another device that can be copied, and select what that
 * device selected, a fixed choice included. A path already here is not
 * copied again; a selection of it selects the row already here.
 */
export function copyAll<F extends string>(
  groups: DeviceGroups<F>,
  fromId: DeviceId,
  here: HereDevice,
  policy: FolderListPolicy<F>,
): DeviceGroups<F> {
  const from = groups[fromId];
  if (!from) return groups;
  let next = groups;
  let selected: Selection<F> | null = typeof from.selected === "number" ? null : from.selected;
  for (const row of from.rows) {
    const refusal = copyRefusal(next, from, row, here, policy);
    if (refusal === "already_here" && from.selected === row.number) {
      const own = groupHere(next, here, policy).rows.find((candidate) =>
        sameFolderPath(here.system, candidate.path, row.path),
      );
      selected = own?.number ?? null;
    }
    if (refusal) continue;
    const added = addRow(next, here, policy, row.path, row.name);
    next = added.groups;
    if (from.selected === row.number) selected = added.number;
  }
  if (selected === null || (selected === "none" && !policy.allowsNothing)) return next;
  return selectHere(next, here, policy, selected);
}
