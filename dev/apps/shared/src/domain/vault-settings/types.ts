import type { StorageMode } from "../vault/types";
import {
  storageModeHasClosedCache,
  storageModeSealOnly,
} from "../vault/types";

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
/**
 * UI preset for how the `.7z` is built on close/seal.
 * Maps to `[seven_zip] archive_mode` + `compression_level` (7zz `-mx`).
 */
export type CompressionPreset = "none" | "low" | "medium" | "high";

export const COMPRESSION_PRESETS = [
  "none",
  "low",
  "medium",
  "high",
] as const satisfies readonly CompressionPreset[];

/**
 * Persisted `[security] mode` — all five values are valid for every storage mode (PRD §4).
 * UI collapses `always_prompt` + `ram_on_close_only` into one card (`prompt_open_close`).
 */
export type SecurityMode =
  | "always_prompt"
  | "session_ram"
  | "ram_on_close_only"
  | "disk_close"
  | "disk_open_close";

/** Password-memory choices in vault settings (all storage modes). */
export const SECURITY_UI_MODES = [
  "session_ram",
  "prompt_open_close",
  "disk_close",
  "disk_open_close",
] as const;

export type SecurityUiMode = (typeof SECURITY_UI_MODES)[number];

export function uiToSecurityMode(ui: SecurityUiMode): SecurityMode {
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

export function securityModeToUi(mode: SecurityMode): SecurityUiMode {
  if (mode === "disk_open_close") return "disk_open_close";
  if (mode === "disk_close") return "disk_close";
  if (mode === "session_ram") return "session_ram";
  // `always_prompt` and `ram_on_close_only` share one UI card until mobile needs a split.
  if (mode === "always_prompt" || mode === "ram_on_close_only") return "prompt_open_close";
  return "session_ram";
}

/** Password UI options — same list for every storage mode (PRD §4, SDD §3.2.3a). */
export function securityUiModesForStorage(
  _storageMode: StorageMode,
): readonly SecurityUiMode[] {
  return SECURITY_UI_MODES;
}

/**
 * All five persisted security modes are valid for every storage mode.
 * Kept as an explicit hook for future migrations; currently identity.
 */
export function normalizeSecurityModeForStorage(
  _storageMode: StorageMode,
  securityMode: SecurityMode,
): SecurityMode {
  return securityMode;
}

/** Derive UI compression preset from persisted `[seven_zip]` fields. */
export function compressionPresetFromSevenZip(sevenZip: {
  archive_mode: ArchiveMode;
  compression_level: number;
}): CompressionPreset {
  if (sevenZip.archive_mode === "encrypt_only") return "none";
  const level = sevenZip.compression_level;
  if (level <= 3) return "low";
  if (level <= 6) return "medium";
  return "high";
}

/** Drop orphan `compression_level` when not compressing; clamp invalid compress levels (7zz `-mx` is 0..=9). */
export function normalizeSevenZipSection(
  sevenZip: VaultSettingsConfig["seven_zip"],
): VaultSettingsConfig["seven_zip"] {
  if (sevenZip.archive_mode === "encrypt_only") {
    if (sevenZip.compression_level === 0) return sevenZip;
    return { ...sevenZip, compression_level: 0 };
  }
  const raw = sevenZip.compression_level;
  const level = Number.isFinite(raw) ? Math.round(raw) : 5;
  const clamped = Math.max(1, Math.min(9, level));
  if (clamped === sevenZip.compression_level) return sevenZip;
  return { ...sevenZip, compression_level: clamped };
}

/** Map UI compression preset → `[seven_zip] archive_mode` + `compression_level`. */
export function sevenZipPatchFromCompressionPreset(
  preset: CompressionPreset,
): Pick<VaultSettingsConfig["seven_zip"], "archive_mode" | "compression_level"> {
  switch (preset) {
    case "none":
      return { archive_mode: "encrypt_only", compression_level: 0 };
    case "low":
      return { archive_mode: "compress_encrypt", compression_level: 1 };
    case "medium":
      return { archive_mode: "compress_encrypt", compression_level: 5 };
    case "high":
      return { archive_mode: "compress_encrypt", compression_level: 9 };
  }
}

/** Seal-only modes have no `closed` state — lock always seals. */
export function normalizeClosePolicyForStorage(config: VaultSettingsConfig): VaultSettingsConfig {
  if (!storageModeSealOnly(config.storage.mode) || config.close.default_action === "seal") {
    return config;
  }
  return { ...config, close: { default_action: "seal" } };
}

/** Normalize close policy, security mode, and seven_zip fields for the active storage mode. */
export function normalizeVaultSettingsConfig(config: VaultSettingsConfig): VaultSettingsConfig {
  const withClose = normalizeClosePolicyForStorage(config);
  return {
    ...withClose,
    security: {
      ...withClose.security,
      mode: normalizeSecurityModeForStorage(withClose.storage.mode, withClose.security.mode),
    },
    seven_zip: normalizeSevenZipSection(withClose.seven_zip),
  };
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
      encryptedClosePreference: storageModeHasClosedCache(fromMode)
        ? fromClose
        : encryptedClosePreference,
    };
  }

  if (storageModeSealOnly(toMode)) {
    const savedPreference = storageModeHasClosedCache(fromMode)
      ? fromClose
      : encryptedClosePreference;
    return { close: "seal", encryptedClosePreference: savedPreference };
  }

  return { close: encryptedClosePreference, encryptedClosePreference };
}

/** Apply storage mode change; preserve close preference across seal-only detours. */
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
    security: {
      ...config.security,
      mode: normalizeSecurityModeForStorage(mode, config.security.mode),
    },
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
  const nextAction =
    storageModeSealOnly(config.storage.mode) && defaultAction === "close" ? "seal" : defaultAction;
  return {
    config: { ...config, close: { default_action: nextAction } },
    encryptedClosePreference: storageModeHasClosedCache(config.storage.mode)
      ? nextAction
      : encryptedClosePreference,
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

/** List fields synced from `[vault]` on save (mock until `vault_config_save` RPC). */
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
  return storageModeHasClosedCache(storageMode);
}
