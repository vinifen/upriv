import type { VaultDisplayStatus } from "../vault";
import { resolveVaultDisplayStatus } from "../vault";
import type { VaultListItem } from "./types";
import { parseLastAccessedMs } from "./lastAccessed";
import { sortVaultsByOrder } from "./order";

export type VaultListSortMode = "order" | "name" | "state" | "last_accessed";
export type VaultListSortDirection = "asc" | "desc";

export interface VaultListSort {
  mode: VaultListSortMode;
  direction: VaultListSortDirection;
}

/** Matches future `[ui] vault_list_sort` in settings.toml */
export const DEFAULT_VAULT_LIST_SORT: VaultListSort = { mode: "order", direction: "asc" };

const STATE_RANK: Record<VaultDisplayStatus, number> = {
  open: 0,
  opening: 1,
  closing: 2,
  closed: 3,
  sealed: 4,
  recovery: 5,
};

function compareName(a: VaultListItem, b: VaultListItem): number {
  const aFirst = (a.displayName[0] ?? "").toLowerCase();
  const bFirst = (b.displayName[0] ?? "").toLowerCase();
  const byFirst = aFirst.localeCompare(bFirst);
  if (byFirst !== 0) return byFirst;
  return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" });
}

function compareState(a: VaultListItem, b: VaultListItem): number {
  const rankA = STATE_RANK[resolveVaultDisplayStatus(a)];
  const rankB = STATE_RANK[resolveVaultDisplayStatus(b)];
  if (rankA !== rankB) return rankA - rankB;
  return compareName(a, b);
}

/** Future: max(last_store_write_at, last_close_ok_at) from persistence.json */
function lastAccessedMs(vault: VaultListItem): number {
  return parseLastAccessedMs(vault.lastAccessedAt) ?? 0;
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

/** Drag reorder only when list follows config `order` ascending (PRD §3.7.1). */
export function canReorderVaultList(sort: VaultListSort): boolean {
  return sort.mode === "order" && sort.direction === "asc";
}
