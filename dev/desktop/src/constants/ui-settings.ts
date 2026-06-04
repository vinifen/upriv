/**
 * Keys under `[ui]` in vault-root `settings.toml` (prod-example/.upriv/settings.toml).
 * Not read by the desktop UI yet — documented for upcoming Tauri wiring.
 */
export const UI_SETTINGS_KEYS = {
  vaultListSort: "vault_list_sort",
  vaultListSortDirection: "vault_list_sort_direction",
  vaultListView: "vault_list_view",
} as const;

export type UiSettingsVaultListSort = "order" | "name" | "state" | "last_accessed";
export type UiSettingsVaultListSortDirection = "asc" | "desc";
export type UiSettingsVaultListView = "default" | "large" | "compact" | "blocks";
