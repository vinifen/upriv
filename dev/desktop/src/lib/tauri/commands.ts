/** Tauri command names — keep in sync with `src-tauri/src/lib.rs`. */
export const TAURI_COMMANDS = {
  APP_VERSION: "app_version",
  VAULT_LIST: "vault_list",
  VAULT_OPEN: "vault_open",
  VAULT_CLOSE: "vault_close",
  VAULT_SEAL: "vault_seal",
  VAULT_OPEN_WORKSPACE: "vault_open_workspace",
  VAULT_STATUS: "vault_status",
  VAULT_REORDER: "vault_reorder",
  VAULT_DELETE: "vault_delete",
  BACKUP_LIST: "backup_list",
  BACKUP_DELETE: "backup_delete",
} as const;

export type TauriCommand = (typeof TAURI_COMMANDS)[keyof typeof TAURI_COMMANDS];
