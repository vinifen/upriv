import { groupedVaultSortOf, type VaultListRootRow } from "./hierarchy";
import { compareDisplayName } from "../vault-list/compare";
import type { VaultListItem } from "../vault-list/types";
import type { VaultListSortDirection } from "../vault-list/sort";
import type { VaultGroup } from "./types";

function rootRowId(row: VaultListRootRow): string {
  return row.kind === "vault" ? `vault:${row.vault.id}` : `group:${row.group.id}`;
}

function swapItems<T>(items: readonly T[], fromIndex: number, toIndex: number): T[] {
  const next = [...items];
  const from = next[fromIndex];
  const to = next[toIndex];
  if (from === undefined || to === undefined) return next;
  next[fromIndex] = to;
  next[toIndex] = from;
  return next;
}

/** Persist `order` so the current display sequence survives the next sort. */
function withRootOrders(
  rows: VaultListRootRow[],
  direction: VaultListSortDirection,
): VaultListRootRow[] {
  const count = rows.length;
  return rows.map((row, index) => {
    const order = direction === "desc" ? count - index : index + 1;
    if (row.kind === "vault") {
      return { kind: "vault", vault: { ...row.vault, order } };
    }
    return {
      kind: "group",
      group: { ...row.group, order },
      groupedVaults: row.groupedVaults,
      hiddenVaultCount: row.hiddenVaultCount,
    };
  });
}

function withHiddenTail(
  visibleRows: VaultListRootRow[],
  hiddenUngrouped: readonly VaultListItem[],
  direction: VaultListSortDirection,
  hiddenGroups: readonly VaultGroup[] = [],
): VaultListRootRow[] {
  const tailVaults = hiddenUngrouped.map((vault): VaultListRootRow => ({ kind: "vault", vault }));
  const tailGroups = hiddenGroups.map((group): VaultListRootRow => ({
    kind: "group",
    group,
    groupedVaults: [],
    hiddenVaultCount: 0,
  }));
  if (tailVaults.length === 0 && tailGroups.length === 0) {
    return withRootOrders(visibleRows, direction);
  }
  return withRootOrders([...visibleRows, ...tailVaults, ...tailGroups], direction);
}

/**
 * Hidden ungrouped vaults omitted from `visibleRows` (when “show hidden” is off).
 * Sorted by current `order` so their relative sequence stays stable at the tail.
 */
export function hiddenUngroupedRootVaults(
  vaults: readonly VaultListItem[],
  groups: readonly VaultGroup[],
  visibleRows: readonly VaultListRootRow[],
): VaultListItem[] {
  const groupedIds = new Set(groups.flatMap((group) => group.groupedVaults));
  const visibleRootVaultIds = new Set(
    visibleRows.filter((row) => row.kind === "vault").map((row) => row.vault.id),
  );
  return vaults
    .filter(
      (vault) =>
        Boolean(vault.hidden) && !groupedIds.has(vault.id) && !visibleRootVaultIds.has(vault.id),
    )
    .sort((a, b) => {
      const orderDiff = (a.order ?? 0) - (b.order ?? 0);
      if (orderDiff !== 0) return orderDiff;
      return compareDisplayName(a.displayName, b.displayName);
    });
}

/**
 * Hidden groups omitted from `visibleRows` (when “show hidden” is off).
 * Sorted by current `order` so their relative sequence stays stable at the tail.
 */
export function hiddenOmittedRootGroups(
  groups: readonly VaultGroup[],
  visibleRows: readonly VaultListRootRow[],
): VaultGroup[] {
  const visibleGroupIds = new Set(
    visibleRows.filter((row) => row.kind === "group").map((row) => row.group.id),
  );
  return groups
    .filter((group) => group.hidden && !visibleGroupIds.has(group.id))
    .sort((a, b) => {
      const orderDiff = a.order - b.order;
      if (orderDiff !== 0) return orderDiff;
      return compareDisplayName(a.displayName, b.displayName);
    });
}

/** Drop onto a member inserts after that id when the group is shown in reverse. */
export function groupedVaultDropInsertsAfter(group: VaultGroup): boolean {
  const sort = groupedVaultSortOf(group);
  return sort.mode === "order" && sort.direction === "desc";
}

/**
 * Swap dragged root row with drop target; reassign vault/group `order` 1…n.
 * `direction` must match the visible list so desc keeps the swapped sequence.
 */
export function reorderRootRows(
  rows: VaultListRootRow[],
  draggedKey: string,
  targetKey: string,
  direction: VaultListSortDirection = "asc",
  hiddenUngrouped: readonly VaultListItem[] = [],
  hiddenGroups: readonly VaultGroup[] = [],
): VaultListRootRow[] {
  if (draggedKey === targetKey) return rows;

  const fromIndex = rows.findIndex((row) => rootRowId(row) === draggedKey);
  const toIndex = rows.findIndex((row) => rootRowId(row) === targetKey);
  if (fromIndex < 0 || toIndex < 0) return rows;

  return withHiddenTail(
    swapItems(rows, fromIndex, toIndex),
    hiddenUngrouped,
    direction,
    hiddenGroups,
  );
}

/** Swap two grouped vaults (array order = display order when sort is `order` asc). */
export function reorderGroupedVaults(
  group: VaultGroup,
  draggedVaultId: string,
  targetVaultId: string,
): VaultGroup {
  if (draggedVaultId === targetVaultId) return group;
  const fromIndex = group.groupedVaults.indexOf(draggedVaultId);
  const toIndex = group.groupedVaults.indexOf(targetVaultId);
  if (fromIndex < 0 || toIndex < 0) return group;
  return { ...group, groupedVaults: swapItems(group.groupedVaults, fromIndex, toIndex) };
}

export type AssignVaultToGroupOptions = {
  /** Insert after `beforeVaultId` (visual-before when the group is order+desc). */
  insertAfter?: boolean;
};

/** Move `vaultId` into `targetGroupId` (exclusive). Optional insert-before for in-list drop. */
export function assignVaultToGroup(
  groups: VaultGroup[],
  vaultId: string,
  targetGroupId: string,
  beforeVaultId?: string | null,
  options?: AssignVaultToGroupOptions,
): VaultGroup[] {
  const insertAfter = options?.insertAfter === true;
  return groups.map((group) => {
    let groupedVaults = group.groupedVaults.filter((id) => id !== vaultId);
    if (group.id !== targetGroupId) {
      if (groupedVaults.length === group.groupedVaults.length) return group;
      return { ...group, groupedVaults };
    }
    if (beforeVaultId) {
      const idx = groupedVaults.indexOf(beforeVaultId);
      if (idx >= 0) {
        const at = insertAfter ? idx + 1 : idx;
        groupedVaults = [...groupedVaults.slice(0, at), vaultId, ...groupedVaults.slice(at)];
      } else {
        groupedVaults = [...groupedVaults, vaultId];
      }
    } else {
      groupedVaults = [...groupedVaults, vaultId];
    }
    return { ...group, groupedVaults };
  });
}

/** Remove `vaultId` from every group's membership (ungroup). */
export function removeVaultFromGroups(groups: VaultGroup[], vaultId: string): VaultGroup[] {
  return groups.map((group) => {
    if (!group.groupedVaults.includes(vaultId)) return group;
    return { ...group, groupedVaults: group.groupedVaults.filter((id) => id !== vaultId) };
  });
}

/**
 * Insert an ungrouped vault as a root row (before `beforeVaultId`, or at the end)
 * and reassign root `order` 1…n for the visible sort direction.
 */
export function insertUngroupedVaultAtRoot(
  rows: VaultListRootRow[],
  vault: VaultListItem,
  beforeVaultId?: string | null,
  direction: VaultListSortDirection = "asc",
  hiddenUngrouped: readonly VaultListItem[] = [],
  hiddenGroups: readonly VaultGroup[] = [],
): VaultListRootRow[] {
  const next = [...rows];
  let insertAt = next.length;
  if (beforeVaultId) {
    const idx = next.findIndex((row) => row.kind === "vault" && row.vault.id === beforeVaultId);
    if (idx >= 0) insertAt = idx;
  }
  next.splice(insertAt, 0, { kind: "vault", vault });
  return withHiddenTail(next, hiddenUngrouped, direction, hiddenGroups);
}

export function rootRowDragKey(row: VaultListRootRow): string {
  return rootRowId(row);
}
