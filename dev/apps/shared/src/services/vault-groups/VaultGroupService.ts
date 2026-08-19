import type {
  VaultGroup,
  VaultGroupCreateInput,
  VaultGroupListResult,
  VaultGroupUpdateInput,
} from "../../domain/vault-groups";

/** Vault groups (`.upriv/vault_groups.toml`) — mock or CORE RPC. */
export interface VaultGroupService {
  list(): Promise<VaultGroupListResult>;

  create(input: VaultGroupCreateInput): Promise<VaultGroup>;

  update(input: VaultGroupUpdateInput): Promise<VaultGroup>;

  delete(id: string): Promise<void>;

  setCollapsed(id: string, collapsed: boolean): Promise<VaultGroup>;

  /** Persist root-level `order` for the listed groups (one round-trip). */
  reorder(orders: { id: string; order: number }[]): Promise<VaultGroup[]>;

  reorderGroupedVaults(id: string, groupedVaults: string[]): Promise<VaultGroup>;

  /** Rewrite a corrupt `vault_groups.toml` as empty valid file. */
  repair(): Promise<void>;
}
