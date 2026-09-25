import type { VaultSettingsConfig } from "../vault-settings/types";
import type { VaultPipelineListStatus, VaultRow } from "../vault/types";
import { normalizeStoredName } from "../format/storedName";
import { isWindowsReservedName } from "../format/windowsReserved";

export type VaultExportFormat = "store_zip" | "seven_zip";

/** Ordinary `.zip` of `store/` — not a custom file type (SECURITY-CRYPTO). */
export const DEFAULT_VAULT_EXPORT_FORMAT: VaultExportFormat = "store_zip";

/** Format + 7z options for `getExportBytes` (zip ignores `sevenZip` / `password`). */
export interface VaultExportRequest {
  format: VaultExportFormat;
  sevenZip?: VaultSettingsConfig["seven_zip"];
  /** 7-Zip AES password; also unlocks `store/` so logical files can be decrypted. */
  password?: string;
}
// eslint-disable-next-line no-control-regex
const UNSAFE_FILENAME_CHARS = /[/\\<>:"|?*\u0000-\u001f\u007f-\u009f]/g;

/**
 * Filename sanitize for the OS save dialog (mirrors Rust `sanitize_filename_base`).
 * Illegal characters become `_` so `Notes: 2026` stays recognizable instead of
 * collapsing to the generic fallback. Does **not** change the vault `display_name`.
 */
export function sanitizeExportFilenameBase(displayName: string): string {
  const replaced = normalizeStoredName(displayName).replace(UNSAFE_FILENAME_CHARS, "_").trim();
  if (!replaced || replaced === "." || replaced === "..") return "vault";
  if (isWindowsReservedName(replaced)) return "vault";
  return replaced;
}

/**
 * Suggested download name = vault **display name** (not registry id).
 * Encrypted vault zip: `{name}.zip`. Portable 7-Zip: `{name}.7z`.
 */
export function vaultExportFilename(displayName: string, format: VaultExportFormat): string {
  const name = sanitizeExportFilenameBase(displayName);
  return format === "store_zip" ? `${name}.zip` : `${name}.7z`;
}

export type ExportFilenameSanitizeKind = "unchanged" | "adjusted" | "fallback";

/**
 * How `sanitizeExportFilenameBase` treated `displayName`.
 * `fallback` is the generic `"vault"` stem (empty, `.` / `..`, reserved device).
 */
export function exportFilenameSanitizeKind(displayName: string): ExportFilenameSanitizeKind {
  const trimmed = normalizeStoredName(displayName);
  const base = sanitizeExportFilenameBase(displayName);
  if (base === trimmed) return "unchanged";
  if (base === "vault") return "fallback";
  return "adjusted";
}

export type VaultExportPipelineStatus = VaultPipelineListStatus;

/**
 * Single-vault export (`.zip` of `store/` or `.7z`). This vault must be
 * closed. Opening, closing, creating, queued, recovery, and an open session
 * cannot export. Other vaults may stay open.
 */
export function vaultCanExport(
  vault: Pick<VaultRow, "id" | "session">,
  pipeline: VaultExportPipelineStatus = {},
): boolean {
  if (pipeline.openingVaultIds?.includes(vault.id)) return false;
  if (pipeline.closingVaultIds?.includes(vault.id)) return false;
  if (pipeline.creatingVaultIds?.includes(vault.id)) return false;
  if (pipeline.queuedVaultIds?.includes(vault.id)) return false;
  return vault.session !== "open" && vault.session !== "closing" && vault.session !== "recovery";
}
