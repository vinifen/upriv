/** On-disk event when a vault is marked hidden. Never attach id or display name. */
export const VAULT_HIDDEN_LOG_EVENT = "vault_hidden" as const;

/** On-disk event when a group is marked hidden. Never attach id or display name. */
export const VAULT_GROUP_HIDDEN_LOG_EVENT = "vault_group_hidden" as const;

/** Renderer/native crash recovered by an Error Boundary. No extra fields. */
export const UI_CRASH_LOG_EVENT = "ui_crash" as const;

/** Vault-group mutations (daemon `log_event`). Prefer id-only fields — never display names. */
export const VAULT_GROUP_LOG_EVENTS = {
  created: "vault_group_created",
  updated: "vault_group_updated",
  deleted: "vault_group_deleted",
  reordered: "vault_groups_reordered",
  groupedVaultsReordered: "vault_group_grouped_vaults_reordered",
  vaultsMoved: "vault_group_vaults_moved",
  hidden: "vault_group_hidden",
  repaired: "vault_groups_repaired",
} as const;

export function shouldRecordVaultHidden(
  wasHidden: boolean | undefined,
  isHidden: boolean | undefined,
): boolean {
  return Boolean(isHidden) && !wasHidden;
}
