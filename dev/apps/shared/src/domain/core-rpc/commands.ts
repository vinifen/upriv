/**
 * Rust RPC method names used by desktop (`upriv-daemon`) and mobile (`upriv-ffi`).
 * DX only — handlers live in `upriv-rpc` (`handle_rpc`). Keep vault_* in this map.
 * Keep string values in sync with `upriv-rpc` match arms.
 * Parity fixture (not runtime): `tests/rpc-methods.json` — TS + Rust tests only.
 */
export const CORE_RPC_COMMANDS = {
  APP_VERSION: "app_version",
  APP_SETTINGS_GET: "app_settings_get",
  APP_SETTINGS_SAVE: "app_settings_save",
  /**
   * Pure `settings.toml` → `AppSettingsConfig` parse (no disk access). Used by
   * the Android SAF flow: Kotlin reads `.upriv/settings.toml` via DocumentFile,
   * Rust owns the TOML → wire mapping so mobile stays identical to desktop.
   */
  APP_SETTINGS_PARSE_TOML: "app_settings_parse_toml",
  /**
   * Pure `AppSettingsConfig` → `settings.toml` serialization preserving
   * `[package]` and `[app].last_opened_vault` from the previous body (when
   * passed). Symmetric with `APP_SETTINGS_PARSE_TOML` for the SAF flow.
   */
  APP_SETTINGS_SERIALIZE_TOML: "app_settings_serialize_toml",
  LOG_LIST: "log_list",
  LOG_GET: "log_get",
  LOG_DELETE: "log_delete",
  /**
   * Append a allowlisted event to the session log. UI events take no fields —
   * never send vault id, display name, paths, or stack traces.
   */
  LOG_EVENT: "log_event",
  VAULT_ROOT_RESOLVE: "vault_root_resolve",
  VAULT_ROOT_SETUP_DEFAULT_ROOT: "vault_root_setup_default_root",
  VAULT_ROOT_SETUP_PATH: "vault_root_setup_path",
  /**
   * Deactivate `.upriv-root` aliases only — does not create or open a vault-root.
   * Used by Android SAF custom-root setup so internal `filesDir` does not gain a
   * second `.upriv/` from `vault_root_setup_default_root`.
   */
  VAULT_ROOT_DEACTIVATE_ALIAS: "vault_root_deactivate_alias",
  VAULT_ROOT_READ_ALIAS: "vault_root_read_alias",
  VAULT_ROOT_DEFAULT_ROOT_STATUS: "vault_root_default_root_status",
  VAULT_ROOT_INSPECT_PATH: "vault_root_inspect_path",
  VAULT_ROOT_SUGGESTED_CUSTOM_PATH: "vault_root_suggested_custom_path",
  VAULT_GROUP_LIST: "vault_group_list",
  VAULT_GROUP_CREATE: "vault_group_create",
  VAULT_GROUP_UPDATE: "vault_group_update",
  VAULT_GROUP_DELETE: "vault_group_delete",
  VAULT_GROUP_SET_COLLAPSED: "vault_group_set_collapsed",
  VAULT_GROUP_REORDER: "vault_group_reorder",
  VAULT_GROUP_REORDER_GROUPED_VAULTS: "vault_group_reorder_grouped_vaults",
  VAULT_GROUP_REPAIR: "vault_group_repair",
  VAULT_LIST: "vault_list",
  VAULT_CREATE: "vault_create",
  VAULT_OPEN: "vault_open",
  VAULT_CLOSE: "vault_close",
  VAULT_CONFIG_GET: "vault_config_get",
  VAULT_CONFIG_SAVE: "vault_config_save",
  /** Deep rename: display name + folder/`[vault].id` migration (vault closed). */
  VAULT_RENAME: "vault_rename",
} as const;

/**
 * Daemon lifecycle — desktop/Electron only (`upriv-daemon` stdio). Not used on mobile.
 * Keep in sync with `upriv-rpc` + `upriv-daemon` wire (`app_shutdown`).
 */
export const DESKTOP_ONLY_RPC_COMMANDS = {
  APP_SHUTDOWN: "app_shutdown",
} as const;

/**
 * Electron main process — never sent to `upriv-daemon` (handled in `apps/electron/src/main.ts`).
 */
export const SHELL_ONLY_RPC_COMMANDS = {
  APP_EXIT: "app_exit",
  PICK_DIRECTORY: "pick_directory",
} as const;

export type CoreRpcCommand = (typeof CORE_RPC_COMMANDS)[keyof typeof CORE_RPC_COMMANDS];
export type DesktopOnlyRpcCommand =
  (typeof DESKTOP_ONLY_RPC_COMMANDS)[keyof typeof DESKTOP_ONLY_RPC_COMMANDS];
export type ShellOnlyRpcCommand =
  (typeof SHELL_ONLY_RPC_COMMANDS)[keyof typeof SHELL_ONLY_RPC_COMMANDS];
