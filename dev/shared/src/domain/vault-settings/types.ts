import type { StorageMode } from "../vault";

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

export type CloseDefaultAction = "close" | "seal";
export type BackupMode = "keep_last" | "keep_all";
export type ArchiveMode = "compress_encrypt" | "encrypt_only";
export type EncryptedDirSecurityMode = "always_prompt" | "session_ram" | "ram_on_close_only";
export type PlainSecurityMode = "disk_close" | "disk_open_close";
export type SecurityMode = EncryptedDirSecurityMode | PlainSecurityMode;

/** Password-memory choices in vault settings (encrypted_dir and plain). */
export const SECURITY_UI_MODES = [
  "session_ram",
  "prompt_open_close",
  "disk_close",
  "disk_open_close",
] as const;

export type SecurityUiMode = (typeof SECURITY_UI_MODES)[number];

/** @deprecated Use SECURITY_UI_MODES */
export const ENCRYPTED_DIR_SECURITY_UI_MODES = SECURITY_UI_MODES;
export type EncryptedDirSecurityUiMode = SecurityUiMode;

/** @deprecated Use SECURITY_UI_MODES */
export const PLAIN_SECURITY_UI_MODES = SECURITY_UI_MODES;
export type PlainSecurityUiMode = SecurityUiMode;

export function encryptedDirSecurityModeToUi(mode: SecurityMode): SecurityUiMode {
  return securityModeToUi(mode);
}

export function uiToEncryptedDirSecurityMode(ui: SecurityUiMode): SecurityMode {
  return uiToSecurityMode(ui);
}

export function securityModeToUi(mode: SecurityMode): SecurityUiMode {
  return plainSecurityModeToUi(mode);
}

export function uiToSecurityMode(ui: SecurityUiMode): SecurityMode {
  return uiToPlainSecurityMode(ui);
}

export function plainSecurityModeToUi(mode: SecurityMode): PlainSecurityUiMode {
  if (mode === "disk_open_close") return "disk_open_close";
  if (mode === "disk_close") return "disk_close";
  if (mode === "session_ram") return "session_ram";
  if (mode === "always_prompt" || mode === "ram_on_close_only") return "prompt_open_close";
  return "session_ram";
}

export function uiToPlainSecurityMode(ui: PlainSecurityUiMode): SecurityMode {
  switch (ui) {
    case "session_ram":
      return "session_ram";
    case "prompt_open_close":
      return "always_prompt";
    case "disk_close":
      return "disk_close";
    case "disk_open_close":
      return "disk_open_close";
  }
}

export function isPlainOnlySecurityMode(mode: SecurityMode): mode is PlainSecurityMode {
  return mode === "disk_close" || mode === "disk_open_close";
}

/** Disk session modes are valid for both storage modes; default remains session_ram. */
export function normalizeSecurityModeForStorage(
  _storageMode: StorageMode,
  securityMode: SecurityMode,
): SecurityMode {
  return securityMode;
}

/** Plain storage has no `closed` state — lock always seals. */
export function normalizeClosePolicyForStorage(config: VaultSettingsConfig): VaultSettingsConfig {
  if (config.storage.mode !== "plain" || config.close.default_action === "seal") {
    return config;
  }
  return { ...config, close: { default_action: "seal" } };
}

export function transitionStorageModeClose(
  fromMode: StorageMode,
  fromClose: CloseDefaultAction,
  toMode: StorageMode,
  encryptedClosePreference: CloseDefaultAction,
): { close: CloseDefaultAction; encryptedClosePreference: CloseDefaultAction } {
  if (toMode === fromMode) {
    return {
      close: fromClose,
      encryptedClosePreference: fromMode === "encrypted_dir" ? fromClose : encryptedClosePreference,
    };
  }

  if (toMode === "plain") {
    const savedPreference = fromMode === "encrypted_dir" ? fromClose : encryptedClosePreference;
    return { close: "seal", encryptedClosePreference: savedPreference };
  }

  return { close: encryptedClosePreference, encryptedClosePreference };
}

/** Apply storage mode change; preserve encrypted-dir close preference across plain detours. */
export function patchStorageMode(
  config: VaultSettingsConfig,
  mode: StorageMode,
  encryptedClosePreference: CloseDefaultAction,
): { config: VaultSettingsConfig; encryptedClosePreference: CloseDefaultAction } {
  const { close, encryptedClosePreference: nextPreference } = transitionStorageModeClose(
    config.storage.mode,
    config.close.default_action,
    mode,
    encryptedClosePreference,
  );

  const next: VaultSettingsConfig = {
    ...config,
    storage: { mode },
    close: { default_action: close },
  };

  return {
    config: normalizeClosePolicyForStorage(next),
    encryptedClosePreference: nextPreference,
  };
}

export function patchCloseDefaultAction(
  config: VaultSettingsConfig,
  defaultAction: CloseDefaultAction,
  encryptedClosePreference: CloseDefaultAction,
): { config: VaultSettingsConfig; encryptedClosePreference: CloseDefaultAction } {
  return {
    config: { ...config, close: { default_action: defaultAction } },
    encryptedClosePreference:
      config.storage.mode === "encrypted_dir" ? defaultAction : encryptedClosePreference,
  };
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
  passwordHint?: string;
  storageMode: StorageMode;
  canSeal: boolean;
}

export function vaultCanSealFromStorage(storageMode: StorageMode): boolean {
  return storageMode === "encrypted_dir";
}
