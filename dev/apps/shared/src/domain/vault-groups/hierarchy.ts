import { resolveVaultDisplayStatus } from "../vault";
import { compareDisplayName, lastAccessedMs, STATE_RANK } from "../vault-list/compare";
import {
  applyGroupedVaultSort,
  applyVaultListSort,
  DEFAULT_GROUPED_VAULT_SORT,
  type GroupedVaultSort,
  type VaultListSort,
  type VaultListSortMode,
} from "../vault-list/sort";
import type { VaultListItem } from "../vault-list/types";
import type { VaultGroup } from "./types";

export type VaultListRootRow =
  | { kind: "vault"; vault: VaultListItem }
  | { kind: "group"; group: VaultGroup; groupedVaults: VaultListItem[]; hiddenVaultCount: number };

function compareName(a: string, b: string): number {
  return compareDisplayName(a, b);
}

function groupLastAccessedMs(groupedVaults: VaultListItem[]): number {
  if (groupedVaults.length === 0) return 0;
  return Math.max(...groupedVaults.map(lastAccessedMs));
}

function groupStateRank(groupedVaults: VaultListItem[]): number {
  if (groupedVaults.length === 0) return STATE_RANK.closed;
  return Math.min(...groupedVaults.map((m) => STATE_RANK[resolveVaultDisplayStatus(m)]));
}

function rootName(row: VaultListRootRow): string {
  return row.kind === "vault" ? row.vault.displayName : row.group.displayName;
}

function rootSortKey(row: VaultListRootRow, mode: VaultListSortMode): number | string {
  switch (mode) {
    case "order":
      return row.kind === "vault" ? (row.vault.order ?? 999) : row.group.order;
    case "name":
    case "groups":
      return rootName(row);
    case "last_accessed":
      return row.kind === "vault"
        ? lastAccessedMs(row.vault)
        : groupLastAccessedMs(row.groupedVaults);
    case "state":
      return row.kind === "vault"
        ? STATE_RANK[resolveVaultDisplayStatus(row.vault)]
        : groupStateRank(row.groupedVaults);
  }
}

function compareRootRows(
  a: VaultListRootRow,
  b: VaultListRootRow,
  mode: VaultListSortMode,
): number {
  if (mode === "groups") {
    // Groups first, then ungrouped vaults; within each kind sort by name.
    if (a.kind !== b.kind) {
      return a.kind === "group" ? -1 : 1;
    }
    return compareName(rootName(a), rootName(b));
  }
  if (mode === "name") {
    return compareName(rootName(a), rootName(b));
  }
  if (mode === "order") {
    const orderDiff = (rootSortKey(a, "order") as number) - (rootSortKey(b, "order") as number);
    if (orderDiff !== 0) return orderDiff;
    return compareName(rootName(a), rootName(b));
  }
  if (mode === "state") {
    const rankDiff = (rootSortKey(a, "state") as number) - (rootSortKey(b, "state") as number);
    if (rankDiff !== 0) return rankDiff;
    return compareName(rootName(a), rootName(b));
  }
  // last_accessed
  const timeDiff =
    (rootSortKey(a, "last_accessed") as number) - (rootSortKey(b, "last_accessed") as number);
  if (timeDiff !== 0) return timeDiff;
  return compareName(rootName(a), rootName(b));
}

export function groupedVaultSortOf(group: VaultGroup): GroupedVaultSort {
  return {
    mode: group.groupedVaultSort ?? DEFAULT_GROUPED_VAULT_SORT.mode,
    direction: group.groupedVaultSortDirection ?? DEFAULT_GROUPED_VAULT_SORT.direction,
  };
}

export type VaultListHierarchyOptions = {
  showHiddenVaults?: boolean;
};

/**
 * Build root rows: ungrouped vaults + group rows (grouped vaults only when resolved).
 * Hierarchy is never flattened — vaults stay inside their group.
 * First group in `groups` wins when a vault id appears in more than one list
 * (matches Rust `sanitize_vault_groups`).
 * Global sort applies to root rows only; in-group order uses each group's groupedVaultSort.
 * Hidden vaults are omitted from rows unless `showHiddenVaults`. Hidden groups
 * omit the whole row (members stay claimed so they do not appear ungrouped).
 * `hiddenVaultCount` is internal (UI must not show a hidden tally — that would
 * leak their presence).
 */
export function applyVaultListHierarchySort(
  vaults: VaultListItem[],
  groups: VaultGroup[],
  sort: VaultListSort,
  options?: VaultListHierarchyOptions,
): VaultListRootRow[] {
  const showHidden = options?.showHiddenVaults ?? false;
  const byId = new Map(vaults.map((v) => [v.id, v]));
  const claimed = new Set<string>();

  const groupRows: VaultListRootRow[] = [];
  for (const group of groups) {
    const inGroupOrder: VaultListItem[] = [];
    let hiddenVaultCount = 0;
    for (const id of group.groupedVaults) {
      if (claimed.has(id)) continue;
      const vault = byId.get(id);
      if (!vault) continue;
      claimed.add(id);
      if (vault.hidden && !showHidden) {
        hiddenVaultCount += 1;
        continue;
      }
      inGroupOrder.push(vault);
    }
    if (group.hidden && !showHidden) {
      continue;
    }
    groupRows.push({
      kind: "group",
      group,
      groupedVaults: applyGroupedVaultSort(inGroupOrder, groupedVaultSortOf(group)),
      hiddenVaultCount,
    });
  }

  const ungrouped = vaults.filter((v) => !claimed.has(v.id) && (showHidden || !v.hidden));
  // Keep ungrouped vault order consistent with flat sort helpers for the vault subset.
  const sortedUngrouped = applyVaultListSort(ungrouped, {
    mode: "order",
    direction: "asc",
  });

  const root: VaultListRootRow[] = [
    ...sortedUngrouped.map((vault): VaultListRootRow => ({ kind: "vault", vault })),
    ...groupRows,
  ];

  const ascending = [...root].sort((a, b) => compareRootRows(a, b, sort.mode));
  return sort.direction === "desc" ? ascending.reverse() : ascending;
}

function vaultListNameMatches(name: string, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return name.toLocaleLowerCase().includes(needle);
}

/**
 * Filter root rows by display name: ungrouped vaults, group names, and vaults
 * inside groups. Empty/whitespace query is a no-op. Collapse state is unchanged
 * so the user can still open and close groups while searching.
 */
export function filterVaultListRowsBySearch(
  rows: VaultListRootRow[],
  query: string,
): VaultListRootRow[] {
  const needle = query.trim();
  if (!needle) return rows;
  const out: VaultListRootRow[] = [];
  for (const row of rows) {
    if (row.kind === "vault") {
      if (vaultListNameMatches(row.vault.displayName, needle)) out.push(row);
      continue;
    }
    const groupMatches = vaultListNameMatches(row.group.displayName, needle);
    const matchingVaults = groupMatches
      ? row.groupedVaults
      : row.groupedVaults.filter((vault) => vaultListNameMatches(vault.displayName, needle));
    if (!groupMatches && matchingVaults.length === 0) continue;
    out.push({ ...row, groupedVaults: matchingVaults });
  }
  return out;
}
