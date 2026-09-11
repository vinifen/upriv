import type { VaultSettingsConfig } from "../vault-settings/types";
import type { VaultRow } from "../vault/types";
import { isWindowsReservedName } from "../format/windowsReserved";

export type VaultExportFormat = "contents_zip" | "seven_zip";

/** Ordinary `.zip` of `contents/` — not a custom file type (SECURITY-CRYPTO). */
export const DEFAULT_VAULT_EXPORT_FORMAT: VaultExportFormat = "contents_zip";

/** Format + 7z options for `getExportBytes` (zip ignores `sevenZip`). */
export interface VaultExportRequest {
  format: VaultExportFormat;
  sevenZip?: VaultSettingsConfig["seven_zip"];
}
// eslint-disable-next-line no-control-regex
const UNSAFE_FILENAME_CHARS = /[/\\<>:"|?*\u0000-\u001f\u007f-\u009f]/g;

/**
 * Filename sanitize for the OS save dialog (mirrors Rust `sanitize_filename_base`).
 * Illegal characters become `_` so `Notes: 2026` stays recognizable instead of
 * collapsing to the generic fallback. Does **not** change the vault `display_name`.
 */
export function sanitizeExportFilenameBase(displayName: string): string {
  const replaced = displayName.trim().replace(UNSAFE_FILENAME_CHARS, "_").trim();
  if (!replaced || replaced === "." || replaced === "..") return "vault";
  if (isWindowsReservedName(replaced)) return "vault";
  return replaced;
}

/**
 * Suggested download name = vault **display name** (not registry id).
 * Encrypted contents zip: `{name}.zip`. Portable 7-Zip: `{name}.7z`.
 */
export function vaultExportFilename(displayName: string, format: VaultExportFormat): string {
  const name = sanitizeExportFilenameBase(displayName);
  return format === "contents_zip" ? `${name}.zip` : `${name}.7z`;
}

export type ExportFilenameSanitizeKind = "unchanged" | "adjusted" | "fallback";

/**
 * How `sanitizeExportFilenameBase` treated `displayName`.
 * `fallback` is the generic `"vault"` stem (empty, `.` / `..`, reserved device).
 */
export function exportFilenameSanitizeKind(displayName: string): ExportFilenameSanitizeKind {
  const trimmed = displayName.trim();
  const base = sanitizeExportFilenameBase(displayName);
  if (base === trimmed) return "unchanged";
  if (base === "vault") return "fallback";
  return "adjusted";
}

export type VaultExportPipelineStatus = {
  openingVaultIds?: readonly string[];
  closingVaultIds?: readonly string[];
};

/**
 * Single-vault export (`.zip` of `contents/` or `.7z`). Closing, opening, and recovery cannot export.
 * Open vaults may export after flushing `contents/`.
 */
export function vaultCanExport(
  vault: Pick<VaultRow, "id" | "session">,
  pipeline: VaultExportPipelineStatus = {},
): boolean {
  if (pipeline.openingVaultIds?.includes(vault.id)) return false;
  if (pipeline.closingVaultIds?.includes(vault.id)) return false;
  return vault.session !== "closing" && vault.session !== "recovery";
}
