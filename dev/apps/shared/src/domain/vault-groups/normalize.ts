import {
  DEFAULT_GROUPED_VAULT_SORT,
  type GroupedVaultSortMode,
  type VaultListSortDirection,
} from "../vault-list/sort";
import type { VaultGroup } from "./types";

const GROUPED_VAULT_SORT_MODES = new Set<GroupedVaultSortMode>([
  "order",
  "name",
  "state",
  "last_accessed",
]);

function asGroupedVaultSortMode(value: unknown): GroupedVaultSortMode {
  return typeof value === "string" &&
    GROUPED_VAULT_SORT_MODES.has(value as GroupedVaultSortMode)
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

/**
 * Normalize wire / partial group payloads (defaults for grouped-vault sort).
 *
 * Soft migrate: accept legacy camelCase `members` / `memberSort` /
 * `memberSortDirection` (and snake_case TOML-shaped aliases). Prefer new keys
 * when both are present. Output always uses `groupedVaults` / `groupedVaultSort` /
 * `groupedVaultSortDirection`.
 */
export function normalizeVaultGroup(raw: {
  id: string;
  displayName: string;
  order?: number;
  collapsed?: boolean;
  groupedVaults?: unknown;
  /** @deprecated legacy wire/TOML-shaped input */
  members?: unknown;
  grouped_vaults?: unknown;
  groupedVaultSort?: unknown;
  memberSort?: unknown;
  grouped_vault_sort?: unknown;
  member_sort?: unknown;
  groupedVaultSortDirection?: unknown;
  memberSortDirection?: unknown;
  grouped_vault_sort_direction?: unknown;
  member_sort_direction?: unknown;
}): VaultGroup {
  const groupedVaultsRaw =
    raw.groupedVaults ?? raw.grouped_vaults ?? raw.members;
  const sortRaw =
    raw.groupedVaultSort ?? raw.grouped_vault_sort ?? raw.memberSort ?? raw.member_sort;
  const directionRaw =
    raw.groupedVaultSortDirection ??
    raw.grouped_vault_sort_direction ??
    raw.memberSortDirection ??
    raw.member_sort_direction;

  return {
    id: raw.id.trim(),
    displayName: raw.displayName.trim(),
    order: typeof raw.order === "number" ? raw.order : 0,
    collapsed: raw.collapsed === true,
    groupedVaults: asStringArray(groupedVaultsRaw),
    groupedVaultSort: asGroupedVaultSortMode(sortRaw),
    groupedVaultSortDirection: asSortDirection(directionRaw),
  };
}
