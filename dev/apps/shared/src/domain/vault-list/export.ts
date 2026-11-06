import type { I18nKey } from "../../i18n/catalog";
import type { VaultSettingsConfig } from "../vault-settings/types";
import type { VaultPipelineListStatus, VaultRow } from "../vault/types";
import { fileNameOfPath } from "../format/fileName";
import { normalizeStoredName } from "../format/storedName";
import { isWindowsReservedName } from "../format/windowsReserved";
import type { JobProgress, JobProgressCopy } from "../jobs/progress";
import { isLifecyclePasswordPresent } from "../vault-create/validate";
import { exportFolderIssue, type ExportFolderIssue } from "../workspace";

export type VaultExportFormat = "store_zip" | "seven_zip" | "plain_zip";

/** The formats that decrypt the vault, so the person types its password. */
export type VaultExportPasswordFormat = Exclude<VaultExportFormat, "store_zip">;

/** Ordinary `.zip` of `store/` — not a custom file type (SECURITY-CRYPTO). */
export const DEFAULT_VAULT_EXPORT_FORMAT: VaultExportFormat = "store_zip";

/** The Export window while its file is written: bytes of the vault done of the total. */
export const VAULT_EXPORT_PROGRESS_COPY: JobProgressCopy = {
  measuring: "vault.export.dialog.measuring",
  copying: "vault.export.dialog.progress",
  finishing: "vault.export.dialog.finishing",
};

/** What `.upriv-config/` carries in a `.7z` or a plain-text `.zip`. */
export interface VaultExportInclude {
  /** The file manager layout (`.upriv-workspace.json`). */
  workspace: boolean;
  /** The vault's settings (`config.toml`). */
  settings: boolean;
}

/** An export carries both until a toggle turns one off. */
export const DEFAULT_VAULT_EXPORT_INCLUDE: VaultExportInclude = {
  workspace: true,
  settings: true,
};

/** What a vault export wrote. */
export interface VaultExportResult {
  path: string;
  size: number;
  /**
   * Files a `.7z` or plain-text `.zip` holds with zeros where their data was
   * missing or damaged, as the file manager names them (`/docs/a.txt`). Every
   * file goes in, so each one is still found where it was. Empty for a zip of
   * the encrypted vault, which copies it as it is.
   */
  unreadable: string[];
}

/** Wire answer of `vault_export`; null when it is not one. */
export function parseVaultExportResult(raw: unknown): VaultExportResult | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as { path?: unknown; size?: unknown; unreadable?: unknown };
  if (typeof record.path !== "string" || typeof record.size !== "number") return null;
  const unreadable = Array.isArray(record.unreadable)
    ? record.unreadable.filter((path): path is string => typeof path === "string")
    : [];
  return { path: record.path, size: record.size, unreadable };
}

/** Names an export toast lists before it stops counting. */
const UNREADABLE_NAMES_SHOWN = 3;

/**
 * The names of the files an export kept with zeros, for its toast: the first
 * few by file name, then an ellipsis.
 */
export function vaultExportUnreadableNames(unreadable: readonly string[]): string {
  const names = unreadable.slice(0, UNREADABLE_NAMES_SHOWN).map(fileNameOfPath);
  return unreadable.length > UNREADABLE_NAMES_SHOWN ? `${names.join(", ")}, …` : names.join(", ");
}

/** Format + options for `exportToFolder`. A store zip uses none of them. */
export interface VaultExportRequest {
  format: VaultExportFormat;
  sevenZip?: VaultSettingsConfig["seven_zip"];
  /**
   * Unlocks `store/` so logical files can be decrypted. For a `.7z` it is also
   * the 7-Zip AES password; a plain-text `.zip` has none.
   */
  password?: string;
  include?: VaultExportInclude;
}

/** The step the chosen export option still needs, first one first. */
export type VaultExportPending = "password" | ExportFolderIssue;

/**
 * What the chosen format still needs before Export can run: the vault
 * password for `.7z` and plain-text `.zip` (checked by the export itself), then
 * the folder the file goes into. While it is not `null` that option carries the
 * attention border and Export stays off.
 */
export function vaultExportPending(
  format: VaultExportFormat,
  folder: string | null,
  password: string,
): VaultExportPending | null {
  if (format !== "store_zip" && !isLifecyclePasswordPresent(password)) return "password";
  return exportFolderIssue(folder);
}

/** A vault export in flight, as its Export window shows it. */
export interface VaultExportRun {
  format: VaultExportFormat;
  /** When core started it; `null` while it waits for its lane (queued). */
  startedAt: number | null;
  /** `null` until core first answers `job_status`. */
  progress: JobProgress | null;
  /** When Stop export was pressed; the export call has not settled yet. `null` until then. */
  stoppingSince: number | null;
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
 * registry id). Either zip: `{name}.zip`. Portable 7-Zip: `{name}.7z`. A
 * plain-text zip holds its files at its root, so unpacking it gives `{name}/`
 * with the files inside. While that name is taken core adds the next free `number`
 * (`{name} 2.zip`), the same way (`vault_export_file_stem`, `NumberedExportName`).
 */
export function vaultExportFilename(
  displayName: string,
  format: VaultExportFormat,
  number = 1,
): string {
  const stem = sanitizeExportFilenameBase(displayName);
  const name = number > 1 ? `${stem} ${number}` : stem;
  return format === "seven_zip" ? `${name}.7z` : `${name}.zip`;
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

/** How long the export toast stays when it also names files kept with zeros. */
export const VAULT_EXPORT_UNREADABLE_TOAST_MS = 12_000;

/**
 * The toast after a vault export: the name it saved the file under and, when
 * some files could not be read in full, which ones the export holds with
 * zeros. `durationMs` is null for the usual toast length.
 */
export function vaultExportToast(
  target: { displayName: string; format: VaultExportFormat },
  written: VaultExportResult,
  tr: (key: I18nKey, params?: Record<string, string>) => string,
): { message: string; durationMs: number | null } {
  // A file already used the name: core saved this one with a number.
  const savedAs = vaultExportSavedAs(target.displayName, target.format, written.path);
  const saved = savedAs
    ? tr("vault.export.success_numbered", {
        filename: vaultExportFilename(target.displayName, target.format),
        name: target.displayName,
        saved: savedAs,
      })
    : tr("vault.export.success", { name: target.displayName });
  if (written.unreadable.length === 0) return { message: saved, durationMs: null };
  const kept = tr("vault.export.kept_unreadable", {
    count: String(written.unreadable.length),
    names: vaultExportUnreadableNames(written.unreadable),
  });
  return { message: `${saved} ${kept}`, durationMs: VAULT_EXPORT_UNREADABLE_TOAST_MS };
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
 * Single-vault export (`.zip` of `store/`, `.7z`, or plain-text `.zip`). This
 * vault must be closed. Opening, closing, creating, queued, recovery, an open session, and
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
