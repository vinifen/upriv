import type { GroupedVaultSortMode, VaultListSortDirection } from "../vault-list/sort";

/** One group in `.upriv/vault_groups.toml` (`[[group]]`). */
export interface VaultGroup {
  id: string;
  displayName: string;
  /** Root list position key when global sort mode is `order`. */
  order: number;
  collapsed: boolean;
  /** When true the group row is omitted unless show-hidden is on. */
  hidden: boolean;
  /** Vault ids in manual in-group order (used when groupedVaultSort is `order`). */
  groupedVaults: string[];
  /** How vaults inside this group are ordered (independent of global list sort). */
  groupedVaultSort: GroupedVaultSortMode;
  groupedVaultSortDirection: VaultListSortDirection;
}

/** Result of `vault_group_list` (camelCase wire). */
export interface VaultGroupListResult {
  groups: VaultGroup[];
  /** True when `vault_groups.toml` is corrupt — UI shows Repair/Dismiss on the vault list. */
  invalid: boolean;
  droppedOrphans?: number;
  droppedDuplicateAssignments?: number;
}

export interface VaultGroupCreateInput {
  id: string;
  displayName: string;
  groupedVaults?: string[];
  groupedVaultSort?: GroupedVaultSortMode;
  groupedVaultSortDirection?: VaultListSortDirection;
  hidden?: boolean;
}

export interface VaultGroupUpdateInput {
  id: string;
  displayName?: string;
  collapsed?: boolean;
  order?: number;
  groupedVaults?: string[];
  groupedVaultSort?: GroupedVaultSortMode;
  groupedVaultSortDirection?: VaultListSortDirection;
  hidden?: boolean;
}
