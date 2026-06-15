/** Tauri command names — extend alongside `dev/src-tauri/src/lib.rs` handlers. */
export const TAURI_COMMANDS = {
  APP_VERSION: "app_version",
} as const;

export type TauriCommand = (typeof TAURI_COMMANDS)[keyof typeof TAURI_COMMANDS];
