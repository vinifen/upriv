import type { VaultListRootRow } from "./hierarchy";
import type { VaultListItem } from "../vault-list/types";
import type { VaultGroup } from "./types";

function rootRowId(row: VaultListRootRow): string {
  return row.kind === "vault" ? `vault:${row.vault.id}` : `group:${row.group.id}`;
}

/**
 * Swap dragged root row with drop target; reassign vault/group `order` 1…n.
 * Only meaningful when root sort is order+asc.
 */
export function reorderRootRows(
  rows: VaultListRootRow[],
  draggedKey: string,
  targetKey: string,
): VaultListRootRow[] {
  if (draggedKey === targetKey) return rows;

  const fromIndex = rows.findIndex((row) => rootRowId(row) === draggedKey);
  const toIndex = rows.findIndex((row) => rootRowId(row) === targetKey);
  if (fromIndex < 0 || toIndex < 0) return rows;

  const next = [...rows];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);

  return next.map((row, index) => {
    const order = index + 1;
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

/** Reorder grouped vaults inside a group (array order = display order). */
export function reorderGroupedVaults(
  group: VaultGroup,
  draggedVaultId: string,
  targetVaultId: string,
): VaultGroup {
  if (draggedVaultId === targetVaultId) return group;
  const groupedVaults = [...group.groupedVaults];
  const fromIndex = groupedVaults.indexOf(draggedVaultId);
  const toIndex = groupedVaults.indexOf(targetVaultId);
  if (fromIndex < 0 || toIndex < 0) return group;
  const [moved] = groupedVaults.splice(fromIndex, 1);
  groupedVaults.splice(toIndex, 0, moved);
  return { ...group, groupedVaults };
}

/** Move `vaultId` into `targetGroupId` (exclusive). Optional insert-before for in-list drop. */
export function assignVaultToGroup(
  groups: VaultGroup[],
  vaultId: string,
  targetGroupId: string,
  beforeVaultId?: string | null,
): VaultGroup[] {
  return groups.map((group) => {
    let groupedVaults = group.groupedVaults.filter((id) => id !== vaultId);
    if (group.id !== targetGroupId) {
      if (groupedVaults.length === group.groupedVaults.length) return group;
      return { ...group, groupedVaults };
    }
    if (beforeVaultId) {
      const idx = groupedVaults.indexOf(beforeVaultId);
      if (idx >= 0) {
        groupedVaults = [...groupedVaults.slice(0, idx), vaultId, ...groupedVaults.slice(idx)];
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
 * and reassign root `order` 1…n.
 */
export function insertUngroupedVaultAtRoot(
  rows: VaultListRootRow[],
  vault: VaultListItem,
  beforeVaultId?: string | null,
): VaultListRootRow[] {
  const next = [...rows];
  let insertAt = next.length;
  if (beforeVaultId) {
    const idx = next.findIndex((row) => row.kind === "vault" && row.vault.id === beforeVaultId);
    if (idx >= 0) insertAt = idx;
  }
  next.splice(insertAt, 0, { kind: "vault", vault });
  return next.map((row, index) => {
    const order = index + 1;
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

export function rootRowDragKey(row: VaultListRootRow): string {
  return rootRowId(row);
}
