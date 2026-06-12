/**
 * Keys under `[ui]` in vault-root `settings.toml` (prod-example/.upriv/settings.toml).
 */
export const UI_SETTINGS_KEYS = {
  vaultListSort: "vault_list_sort",
  vaultListSortDirection: "vault_list_sort_direction",
  vaultListView: "vault_list_view",
  alwaysShowHiddenVaults: "always_show_hidden_vaults",
  fileManagerDockExpanded: "file_manager_dock_expanded",
} as const;
