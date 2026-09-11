/**
 * Defense in depth: reject unknown IPC methods before they reach the daemon.
 * Product gate remains `upriv-rpc` `handle_rpc` (`unknown_method`).
 * Keep in sync with `@upriv/shared` CORE / DESKTOP_ONLY / SHELL_ONLY command maps.
 */
export const ELECTRON_IPC_METHODS = [
  "app_exit",
  "pick_directory",
  "app_shutdown",
  "app_version",
  "app_settings_get",
  "app_settings_save",
  "app_settings_parse_toml",
  "app_settings_serialize_toml",
  "log_list",
  "log_get",
  "log_delete",
  "log_event",
  "vault_root_resolve",
  "vault_root_setup_default_root",
  "vault_root_setup_path",
  "vault_root_deactivate_alias",
  "vault_root_read_alias",
  "vault_root_default_root_status",
  "vault_root_inspect_path",
  "vault_root_suggested_custom_path",
  "vault_group_list",
  "vault_group_create",
  "vault_group_update",
  "vault_group_delete",
  "vault_group_set_collapsed",
  "vault_group_reorder",
  "vault_group_reorder_grouped_vaults",
  "vault_group_repair",
] as const;
