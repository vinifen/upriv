import type { VaultSettingsConfig } from "../vault-settings/types";
import type { VaultPipelineListStatus, VaultRow } from "../vault/types";
import { fileNameOfPath } from "../format/fileName";
import { normalizeStoredName } from "../format/storedName";
import { isWindowsReservedName } from "../format/windowsReserved";
import type { JobProgress, JobProgressCopy } from "../jobs/progress";
import { isLifecyclePasswordPresent } from "../vault-create/validate";
import { exportFolderIssue, type ExportFolderIssue } from "../workspace";

export type VaultExportFormat = "store_zip" | "seven_zip";

/** Ordinary `.zip` of `store/` — not a custom file type (SECURITY-CRYPTO). */
export const DEFAULT_VAULT_EXPORT_FORMAT: VaultExportFormat = "store_zip";

/** The Export window while its file is written: bytes of the vault done of the total. */
export const VAULT_EXPORT_PROGRESS_COPY: JobProgressCopy = {
  measuring: "vault.export.dialog.measuring",
  copying: "vault.export.dialog.progress",
  finishing: "vault.export.dialog.finishing",
};

/** Format + 7z options for `exportToFolder` (zip ignores `sevenZip` / `password`). */
export interface VaultExportRequest {
  format: VaultExportFormat;
  sevenZip?: VaultSettingsConfig["seven_zip"];
  /** 7-Zip AES password; also unlocks `store/` so logical files can be decrypted. */
  password?: string;
}

/** The step the chosen export option still needs, first one first. */
export type VaultExportPending = "password" | ExportFolderIssue;

/**
 * What the chosen format still needs before Export can run: the vault
 * password for `.7z` (checked by the export itself), then the folder the file
 * goes into. While it is not `null` that option carries the attention border
 * and Export stays off.
 */
export function vaultExportPending(
  format: VaultExportFormat,
  folder: string | null,
  sevenZipPassword: string,
): VaultExportPending | null {
  if (format === "seven_zip" && !isLifecyclePasswordPresent(sevenZipPassword)) return "password";
  return exportFolderIssue(folder);
}

/** A vault export in flight, as its Export window shows it. */
export interface VaultExportRun {
  format: VaultExportFormat;
  startedAt: number;
  /** `null` until core first answers `job_status`. */
  progress: JobProgress | null;
  /** Stop export was pressed; the export call has not settled yet. */
  stopping?: boolean;
}

// eslint-disable-next-line no-control-regex
const UNSAFE_FILENAME_CHARS = /[/\\<>:"|?*\u0000-\u001f\u007f-\u009f]/g;

/**
 * The export file name's stem (mirrors Rust `sanitize_filename_base`).
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
 * The file an export writes into its folder: the vault **display name** (not
 * registry id). Encrypted vault zip: `{name}.zip`. Portable 7-Zip: `{name}.7z`.
 * While that name is taken core adds the next free `number` (`{name} 2.zip`),
 * the same way (`vault_export_file_stem`, `NumberedExportName`).
 */
export function vaultExportFilename(
  displayName: string,
  format: VaultExportFormat,
  number = 1,
): string {
  const stem = sanitizeExportFilenameBase(displayName);
  const name = number > 1 ? `${stem} ${number}` : stem;
  return format === "store_zip" ? `${name}.zip` : `${name}.7z`;
}

/**
 * The name core saved the export under when its own name was already in the
 * folder (`{name} 2.zip`), or `null` when it kept that name. `writtenPath` is
 * the path the export answered with.
 */
export function vaultExportSavedAs(
  displayName: string,
  format: VaultExportFormat,
  writtenPath: string,
): string | null {
  const saved = fileNameOfPath(writtenPath);
  return saved === vaultExportFilename(displayName, format) ? null : saved;
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
 * closed. Opening, closing, creating, queued, recovery, an open session, and
 * an export, backup, or rewrap already running cannot export. Neither can any
 * vault while the data folder is exported. Other vaults may stay open.
 */
export function vaultCanExport(
  vault: Pick<VaultRow, "id" | "session">,
  pipeline: VaultExportPipelineStatus = {},
): boolean {
  if (pipeline.dataFolderExporting) return false;
  if (pipeline.openingVaultIds?.includes(vault.id)) return false;
  if (pipeline.closingVaultIds?.includes(vault.id)) return false;
  if (pipeline.creatingVaultIds?.includes(vault.id)) return false;
  if (pipeline.queuedVaultIds?.includes(vault.id)) return false;
  if (pipeline.exportingVaultIds?.includes(vault.id)) return false;
  if (pipeline.backupJobVaultIds?.includes(vault.id)) return false;
  if (pipeline.passwordChangeVaultIds?.includes(vault.id)) return false;
  if (pipeline.kdfChangeVaultIds?.includes(vault.id)) return false;
  return vault.session !== "open" && vault.session !== "closing" && vault.session !== "recovery";
}

/**
 * Whether the row menu lists Export: this vault can start one, or its own
 * export is running and the item opens that export's window again.
 */
export function vaultExportMenuShown(
  vault: Pick<VaultRow, "id" | "session">,
  pipeline: VaultExportPipelineStatus = {},
): boolean {
  if (pipeline.exportingVaultIds?.includes(vault.id)) return true;
  return vaultCanExport(vault, pipeline);
}
