/**
 * Rust RPC method names used by desktop (upriv-daemon) and mobile (native bridge).
 * DX only — handlers live in `upriv-core` / `rpc.rs`. Add vault_* here when porting beta.
 */
export const CORE_RPC_COMMANDS = {
  APP_VERSION: "app_version",
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
} as const;

export type CoreRpcCommand = (typeof CORE_RPC_COMMANDS)[keyof typeof CORE_RPC_COMMANDS];
export type DesktopOnlyRpcCommand =
  (typeof DESKTOP_ONLY_RPC_COMMANDS)[keyof typeof DESKTOP_ONLY_RPC_COMMANDS];
export type ShellOnlyRpcCommand =
  (typeof SHELL_ONLY_RPC_COMMANDS)[keyof typeof SHELL_ONLY_RPC_COMMANDS];
