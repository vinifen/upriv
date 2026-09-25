import type { StorageMode } from "../vault/types";
import { normalizeStoredName } from "../format/storedName";
import { normalizeMountWorkspacePath } from "../workspace";

export type { KdfParams, KdfUnlockPreset } from "./kdf";
export {
  CONFIG_TOML_KDF_ANNOTATION,
  CONFIG_TOML_GROUPS_ANNOTATION,
  createVaultChoosesKdf,
  DEFAULT_KDF_UNLOCK_PRESET,
  KDF_UNLOCK_PRESETS,
  kdfParamsFromPreset,
  kdfPresetIsDowngrade,
  normalizeKdfUnlockPreset,
  parseKdfUnlockPreset,
} from "./kdf";

/** TOML section ids in `vaults/<id>/config.toml`. Lock is always close. */
export const VAULT_SETTINGS_SECTIONS = [
  "vault",
  "storage",
  "mount",
  "auto_close",
  "backup",
  "security",
  "policy",
] as const;

export type VaultSettingsSectionId = (typeof VAULT_SETTINGS_SECTIONS)[number];

/** Both modes export; compression is chosen at export, not here. */
export function vaultSettingsSectionsForStorage(
  _mode: StorageMode,
): readonly VaultSettingsSectionId[] {
  return VAULT_SETTINGS_SECTIONS;
}
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

/**
 * Persisted `[security] mode`. `ram_on_close_only` is a legacy TOML value from the
 * `.7z`-on-close era; load/save maps it to `session_ram` (close uses session keys).
 */
export type SecurityMode =
  "always_prompt" | "session_ram" | "ram_on_close_only" | "disk_close" | "disk_open_close";

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
  if (mode === "always_prompt") return "prompt_open_close";
  // `session_ram` and legacy `ram_on_close_only` (close no longer needs the password string).
  return "session_ram";
}

/** Password UI options — same list for every storage mode (PRD §4, SDD §3.2.3a). */
export function securityUiModesForStorage(_storageMode: StorageMode): readonly SecurityUiMode[] {
  return SECURITY_UI_MODES;
}

/** Persist a supported mode; rewrite legacy `ram_on_close_only` to `session_ram`. */
export function normalizeSecurityModeForStorage(
  _storageMode: StorageMode,
  securityMode: SecurityMode,
): SecurityMode {
  if (securityMode === "ram_on_close_only") return "session_ram";
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

/** Normalize security mode, mount path, and seven_zip. */
export function normalizeVaultSettingsConfig(config: VaultSettingsConfig): VaultSettingsConfig {
  return {
    ...config,
    vault: {
      ...config.vault,
      display_name: normalizeStoredName(config.vault.display_name),
    },
    mount: {
      workspace_path: normalizeMountWorkspacePath(config.mount?.workspace_path),
    },
    security: {
      ...config.security,
      mode: normalizeSecurityModeForStorage(config.storage.mode, config.security.mode),
    },
    seven_zip: normalizeSevenZipSection(config.seven_zip),
  };
}

/** Apply storage mode change. */
export function patchStorageMode(
  config: VaultSettingsConfig,
  mode: StorageMode,
): VaultSettingsConfig {
  return normalizeVaultSettingsConfig({
    ...config,
    storage: { mode },
    security: {
      ...config.security,
      mode: normalizeSecurityModeForStorage(mode, config.security.mode),
    },
  });
}

export type WipePattern = "random" | "zeros";
export type SevenZipMethod = "lzma2";

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
  storage: { mode: StorageMode };
  /**
   * Where this vault’s open mount appears.
   * `workspace_path`: `"default"` inherits app `[workspace].path`; otherwise an absolute path.
   */
  mount: {
    workspace_path: string;
  };
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

/** Export-time 7z defaults (create persists these so export can hydrate). */
export const DEFAULT_SEVEN_ZIP: VaultSettingsConfig["seven_zip"] = {
  encrypt_file_names: true,
  archive_mode: "encrypt_only",
  compression_level: 0,
  solid: false,
  method: "lzma2",
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
  storageMode: StorageMode;
}
