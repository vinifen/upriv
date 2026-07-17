/**
 * Rust RPC method names used by desktop (upriv-daemon) and mobile (native bridge).
 * DX only — handlers live in `upriv-core` / `rpc.rs`. Add vault_* here when porting beta.
 * Keep string values in sync with `upriv-daemon` `handle_rpc` match arms.
 */
export const CORE_RPC_COMMANDS = {
  APP_VERSION: "app_version",
  APP_SETTINGS_GET: "app_settings_get",
  APP_SETTINGS_SAVE: "app_settings_save",
  VAULT_ROOT_RESOLVE: "vault_root_resolve",
  VAULT_ROOT_SETUP_NEARBY: "vault_root_setup_nearby",
  VAULT_ROOT_SETUP_PATH: "vault_root_setup_path",
  VAULT_ROOT_READ_ALIAS: "vault_root_read_alias",
  VAULT_ROOT_NEARBY_STATUS: "vault_root_nearby_status",
  VAULT_ROOT_INSPECT_PATH: "vault_root_inspect_path",
} as const;

/**
 * Daemon lifecycle — desktop/Electron only (`upriv-daemon` stdio). Not used on mobile JNI.
 * Keep in sync with `crates/upriv-daemon/src/rpc.rs`.
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
