import { resolveVaultDisplayStatus } from "../vault";
import { compareDisplayName, lastAccessedMs, STATE_RANK } from "./compare";
import type { VaultListItem } from "./types";
import { sortVaultsByOrder } from "./order";

/** Global vault-list sort (root rows: ungrouped vaults + groups). */
export type VaultListSortMode = "order" | "name" | "state" | "last_accessed" | "groups";

/** In-group vault sort — same as global except `groups` (N/A inside a group). */
export type GroupedVaultSortMode = "order" | "name" | "state" | "last_accessed";

export type VaultListSortDirection = "asc" | "desc";

export interface VaultListSort {
  mode: VaultListSortMode;
  direction: VaultListSortDirection;
}

export interface GroupedVaultSort {
  mode: GroupedVaultSortMode;
  direction: VaultListSortDirection;
}

/** Matches `[ui].vault_list_sort` in settings.toml */
export const DEFAULT_VAULT_LIST_SORT: VaultListSort = { mode: "order", direction: "asc" };

/** Default in-group order follows `groupedVaults[]` array order. */
export const DEFAULT_GROUPED_VAULT_SORT: GroupedVaultSort = {
  mode: "order",
  direction: "asc",
};

export const GROUPED_VAULT_SORT_MODES: GroupedVaultSortMode[] = [
  "order",
  "name",
  "state",
  "last_accessed",
];

function compareName(a: VaultListItem, b: VaultListItem): number {
  return compareDisplayName(a.displayName, b.displayName);
}

function compareState(a: VaultListItem, b: VaultListItem): number {
  const rankA = STATE_RANK[resolveVaultDisplayStatus(a)];
  const rankB = STATE_RANK[resolveVaultDisplayStatus(b)];
  if (rankA !== rankB) return rankA - rankB;
  return compareName(a, b);
}

function compareLastAccessed(a: VaultListItem, b: VaultListItem): number {
  const diff = lastAccessedMs(a) - lastAccessedMs(b);
  if (diff !== 0) return diff;
  return compareName(a, b);
}

function sortAscending(vaults: VaultListItem[], mode: VaultListSortMode): VaultListItem[] {
  const list = [...vaults];
  switch (mode) {
    case "order":
      return sortVaultsByOrder(list);
    case "name":
    case "groups":
      // Flat lists have no group rows — `groups` falls back to name.
      return list.sort(compareName);
    case "state":
      return list.sort(compareState);
    case "last_accessed":
      return list.sort(compareLastAccessed);
  }
}

export function applyVaultListSort(vaults: VaultListItem[], sort: VaultListSort): VaultListItem[] {
  const ascending = sortAscending(vaults, sort.mode);
  return sort.direction === "desc" ? [...ascending].reverse() : ascending;
}

/**
 * Sort vaults inside a group.
 * `order` uses the `groupedVaults[]` array order (not vault.order).
 */
export function applyGroupedVaultSort(
  vaultsInGroupOrder: VaultListItem[],
  sort: GroupedVaultSort,
): VaultListItem[] {
  if (sort.mode === "order") {
    return sort.direction === "desc" ? [...vaultsInGroupOrder].reverse() : vaultsInGroupOrder;
  }
  return applyVaultListSort(vaultsInGroupOrder, sort);
}

/** Drag reorder when the list is sorted by config `order` (either direction). */
export function canReorderVaultList(sort: VaultListSort): boolean {
  return sort.mode === "order";
}

/** In-group drag reorder when that group's sort is `order` (either direction). */
export function canReorderGroupedVaults(sort: GroupedVaultSort): boolean {
  return sort.mode === "order";
}
