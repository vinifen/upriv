/** TOML section ids in `vaults/<id>/config.toml` (order matches prod-example). */
export const VAULT_SETTINGS_SECTIONS = [
  "vault",
  "storage",
  "close",
  "backup",
  "security",
  "seven_zip",
  "policy",
] as const;

export type VaultSettingsSectionId = (typeof VAULT_SETTINGS_SECTIONS)[number];

export type StorageMode = "encrypted_dir" | "plain";
export type CloseDefaultAction = "close" | "seal";
export type BackupMode = "keep_last" | "keep_all";
export type ArchiveMode = "compress_encrypt" | "encrypt_only";
export type EncryptedDirSecurityMode = "always_prompt" | "session_ram" | "ram_on_close_only";
export type PlainSecurityMode = "disk_close" | "disk_open_close";
export type SecurityMode = EncryptedDirSecurityMode | PlainSecurityMode;

/** Two choices shown in settings UI for encrypted_dir (maps to TOML `always_prompt` or `session_ram`). */
export type EncryptedDirSecurityUiMode = "session_ram" | "prompt_open_close";

export function encryptedDirSecurityModeToUi(mode: SecurityMode): EncryptedDirSecurityUiMode {
  if (mode === "session_ram") return "session_ram";
  if (mode === "always_prompt" || mode === "ram_on_close_only") return "prompt_open_close";
  return "session_ram";
}

export function uiToEncryptedDirSecurityMode(ui: EncryptedDirSecurityUiMode): EncryptedDirSecurityMode {
  return ui === "session_ram" ? "session_ram" : "always_prompt";
}
export type WipePattern = "random" | "zeros";
export type SevenZipMethod = "lzma2";

export interface VaultSectionConfig {
  id: string;
  display_name: string;
  order: number;
  vault_file: string;
  store_dir: string;
  backups_dir: string;
  password_hint: string;
  note: string;
  hidden: boolean;
}

export interface VaultSettingsConfig {
  vault: VaultSectionConfig;
  storage: { mode: StorageMode };
  close: { default_action: CloseDefaultAction };
  backup: { enabled: boolean; mode: BackupMode; keep_last: number };
  security: {
    mode: SecurityMode;
    secure_wipe_workspace: boolean;
    wipe_passes: number;
    wipe_pattern: WipePattern;
    /** ISO 8601 UTC; set by app on change-password — not shown in settings UI. */
    password_changed_at?: string;
  };
  auto_close: {
    enabled: boolean;
    idle_minutes: number;
    warn_before_seconds: number;
    close_on_app_exit: boolean;
  };
  seven_zip: {
    encrypt_file_names: boolean;
    archive_mode: ArchiveMode;
    compression_level: number;
    solid: boolean;
    method: SevenZipMethod;
  };
  policy: {
    allow_external_editors: boolean;
    disallow_copy_outside_mount: boolean;
    require_unmount_on_sleep: boolean;
  };
}

export function vaultSettingsEqual(a: VaultSettingsConfig, b: VaultSettingsConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** List fields synced from `[vault]` on save (mock until Tauri `config_save`). */
export interface VaultSettingsListPatch {
  displayName: string;
  order: number;
  note: string;
  hidden: boolean;
}
