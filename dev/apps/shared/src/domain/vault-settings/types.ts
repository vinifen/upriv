import type { StorageMode } from "../vault/types";
import type { KdfUnlockPreset } from "./kdf";
import { normalizeStoredName } from "../format/storedName";
import {
  ENCRYPTED_FOLDER_SWITCHES,
  VAULT_BACKUP_LIST,
  VAULT_UNLOCKED_LIST,
  parseDeviceGroups,
  type DeviceGroups,
  type EncryptedFolderSwitch,
  type VaultBackupChoice,
  type VaultUnlockedFolder,
} from "../folder-lists";

export type { KdfParams, KdfUnlockPreset } from "./kdf";
export {
  CONFIG_TOML_KDF_ANNOTATION,
  CONFIG_TOML_GROUPS_ANNOTATION,
  createVaultChoosesStoreSettings,
  DEFAULT_KDF_OTHER_PRESET,
  DEFAULT_KDF_UNLOCK_PRESET,
  KDF_UNLOCK_MAIN_PRESETS,
  KDF_UNLOCK_OTHER_PRESETS,
  KDF_UNLOCK_PRESETS,
  kdfParamsFromPreset,
  kdfPresetIsDowngrade,
  kdfPresetIsOther,
  normalizeKdfUnlockPreset,
  parseKdfUnlockPreset,
} from "./kdf";

/**
 * Preference sections of vault settings, Backup before Auto-close as the
 * create window lists them. Lock is always close. The storage value has its
 * own screen (Storage), which takes the password.
 */
export const VAULT_SETTINGS_SECTIONS = [
  "vault",
  "unlocked_folder",
  "backup",
  "auto_close",
] as const;

export type VaultSettingsSectionId = (typeof VAULT_SETTINGS_SECTIONS)[number];
export type BackupMode = "keep_last" | "keep_all";
export type ArchiveMode = "compress_encrypt" | "encrypt_only";
/**
 * UI preset for how the export `.7z` is built.
 * Maps to `[seven_zip] archive_mode` + `compression_level`.
 */
export type CompressionPreset = "none" | "low" | "medium" | "high";

export const COMPRESSION_PRESETS = [
  "none",
  "low",
  "medium",
  "high",
] as const satisfies readonly CompressionPreset[];

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

/** Drop orphan `compression_level` when not compressing; clamp invalid compress levels. */
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

const ENCRYPTED_SWITCHES = new Set<EncryptedFolderSwitch>(ENCRYPTED_FOLDER_SWITCHES);

/** Normalize display name, the lists, and seven_zip. */
export function normalizeVaultSettingsConfig(config: VaultSettingsConfig): VaultSettingsConfig {
  const encrypted = config.unlocked_folder?.encrypted;
  return {
    ...config,
    vault: {
      ...config.vault,
      display_name: normalizeStoredName(config.vault.display_name),
    },
    unlocked_folder: {
      encrypted: encrypted && ENCRYPTED_SWITCHES.has(encrypted) ? encrypted : "inherit",
      devices: parseDeviceGroups(config.unlocked_folder?.devices, VAULT_UNLOCKED_LIST),
    },
    backup: {
      ...config.backup,
      devices: parseDeviceGroups(config.backup?.devices, VAULT_BACKUP_LIST),
    },
    seven_zip: normalizeSevenZipSection(config.seven_zip),
  };
}

/** What a plain-text vault puts in its folder while open. The file manager holds everything. */
export type PlainFiles = "chosen" | "whole";

/**
 * A vault's storage value (core `VaultStorage`). The vault's sealed index
 * holds it and decides; `config.toml` holds this copy for what runs before
 * the password. Only the Storage screen changes it, with the password.
 */
export interface VaultStorage {
  mode: StorageMode;
  plain_files: PlainFiles;
}

export type WipePattern = "random" | "zeros";

/**
 * `[auto_close] when_busy`: `wait` closes once nothing keeps the vault open (a
 * file manager import, a send to a plain-text folder); `close` stops that
 * work and closes on time.
 */
export type AutoCloseWhenBusy = "wait" | "close";

export const AUTO_CLOSE_WHEN_BUSY = [
  "wait",
  "close",
] as const satisfies readonly AutoCloseWhenBusy[];

export interface VaultSectionConfig {
  id: string;
  display_name: string;
  order: number;
  password_hint: string;
  note: string;
  hidden: boolean;
}

export interface VaultSettingsConfig {
  vault: VaultSectionConfig;
  storage: VaultStorage;
  /** `[unlocked_folder]`: the encrypted switch, and the vault's list per device. */
  unlocked_folder: VaultUnlockedFolder;
  backup: {
    enabled: boolean;
    mode: BackupMode;
    keep_last: number;
    /** Close skips a zip when vault files match the last backup still on disk. */
    skip_unchanged: boolean;
    /**
     * With `skip_unchanged`: files that did not change still get a zip while
     * no backup in the folder in use holds the vault as it is (the store was
     * rewritten since, or its last zip is in another folder or gone).
     */
    keep_current: boolean;
    /** The vault's backup folder list, per device. */
    devices: DeviceGroups<VaultBackupChoice>;
  };
  security: {
    wipe_passes: number;
    wipe_pattern: WipePattern;
    /** ISO 8601 UTC; set by app on change-password — not shown in settings UI. */
    password_changed_at?: string;
  };
  auto_close: {
    enabled: boolean;
    /** Minutes without activity inside Upriv before this vault closes. */
    idle_minutes: number;
    /** What happens when the time is up while work keeps the vault open. */
    when_busy: AutoCloseWhenBusy;
  };
  file_manager: {
    /** Ask before deleting a file or folder. "Don't ask again" turns it off. */
    confirm_delete: boolean;
  };
  seven_zip: {
    encrypt_file_names: boolean;
    archive_mode: ArchiveMode;
    compression_level: number;
    solid: boolean;
  };
  /**
   * `[importing]`: an import fills the vault and has not finished. Only core
   * writes and drops it; a settings save keeps what the file holds.
   */
  importing?: { started_at: string };
}

/** Export-time 7z defaults (create persists these so export can hydrate). */
export const DEFAULT_SEVEN_ZIP: VaultSettingsConfig["seven_zip"] = {
  encrypt_file_names: true,
  archive_mode: "encrypt_only",
  compression_level: 0,
  solid: false,
};

export function vaultSettingsEqual(a: VaultSettingsConfig, b: VaultSettingsConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** True when only `[vault].id` / `display_name` differ (rename path already persisted those). */
export function vaultSettingsEqualIgnoringIdentity(
  a: VaultSettingsConfig,
  b: VaultSettingsConfig,
): boolean {
  return vaultSettingsEqual(
    { ...a, vault: { ...a.vault, id: "", display_name: "" } },
    { ...b, vault: { ...b.vault, id: "", display_name: "" } },
  );
}

/** List fields synced from `[vault]` on save (`vault_config_save` / `vault_rename`). */
export interface VaultSettingsListPatch {
  /** Effective vault id after save (may differ from the modal’s previous id when renamed). */
  id: string;
  displayName: string;
  order: number;
  note: string;
  hidden: boolean;
  passwordHint?: string;
  /** Set after an unlock-RAM change. Omitted saves leave the list row's preset. */
  unlockPreset?: KdfUnlockPreset;
}
