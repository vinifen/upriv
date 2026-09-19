import {
  DEFAULT_GROUPED_VAULT_SORT,
  type GroupedVaultSortMode,
  type VaultListSortDirection,
} from "../vault-list/sort";
import { normalizeStoredName } from "../format/storedName";
import type { VaultGroup } from "./types";

const GROUPED_VAULT_SORT_MODES = new Set<GroupedVaultSortMode>([
  "order",
  "name",
  "state",
  "last_accessed",
]);

function asGroupedVaultSortMode(value: unknown): GroupedVaultSortMode {
  return typeof value === "string" && GROUPED_VAULT_SORT_MODES.has(value as GroupedVaultSortMode)
    ? (value as GroupedVaultSortMode)
    : DEFAULT_GROUPED_VAULT_SORT.mode;
}

function asSortDirection(value: unknown): VaultListSortDirection {
  return value === "desc" ? "desc" : "asc";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((m): m is string => typeof m === "string")
        .map((m) => m.trim())
        .filter((m) => m.length > 0)
    : [];
}

/** Normalize wire / partial group payloads (defaults for grouped-vault sort). */
export function normalizeVaultGroup(raw: {
  id: string;
  displayName?: string;
  order?: number;
  collapsed?: boolean;
  groupedVaults?: unknown;
  grouped_vaults?: unknown;
  groupedVaultSort?: unknown;
  grouped_vault_sort?: unknown;
  groupedVaultSortDirection?: unknown;
  grouped_vault_sort_direction?: unknown;
  hidden?: unknown;
}): VaultGroup {
  const groupedVaultsRaw = raw.groupedVaults ?? raw.grouped_vaults;
  const sortRaw = raw.groupedVaultSort ?? raw.grouped_vault_sort;
  const directionRaw = raw.groupedVaultSortDirection ?? raw.grouped_vault_sort_direction;

  const id = raw.id.trim();
  const displayName = normalizeStoredName(raw.displayName ?? "") || id;

  return {
    id,
    displayName,
    order: typeof raw.order === "number" ? raw.order : 0,
    collapsed: raw.collapsed === true,
    hidden: raw.hidden === true,
    groupedVaults: asStringArray(groupedVaultsRaw),
    groupedVaultSort: asGroupedVaultSortMode(sortRaw),
    groupedVaultSortDirection: asSortDirection(directionRaw),
  };
}
