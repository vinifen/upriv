import type { I18nKey } from "../../i18n/catalog";
import { validateWorkspaceGlobalPath, type WorkspaceSystem } from "../workspace";
import type { WorkspacePathIssue } from "../workspace";

/**
 * Where backups go. `[backups.<os>]` in `settings.toml` is the app default;
 * `[backup.<os>]` in a vault's `config.toml` follows it, picks the data folder,
 * or names a folder of its own. Each desktop system keeps its own row, because
 * both files travel with the data folder. Phones have no row: their backups
 * stay in the data folder.
 *
 * A row keeps its `path` while `place` points elsewhere, so going back to
 * `custom` restores it.
 */
export const BACKUP_FOLDER_SYSTEMS = ["linux", "windows", "macos"] as const;

export type BackupFolderSystem = (typeof BACKUP_FOLDER_SYSTEMS)[number];

export type BackupPlace = "data_folder" | "custom";
export type VaultBackupPlace = "inherit" | "data_folder" | "custom";

export interface BackupFolderRow {
  place: BackupPlace;
  path: string;
}

export interface VaultBackupFolderRow {
  place: VaultBackupPlace;
  path: string;
}

export type BackupFolderTable = Record<BackupFolderSystem, BackupFolderRow>;
export type VaultBackupFolders = Record<BackupFolderSystem, VaultBackupFolderRow>;

/** The row of a workspace system. Phones have none. */
export function backupFolderSystem(system: WorkspaceSystem): BackupFolderSystem | null {
  return system === "linux" || system === "windows" || system === "macos" ? system : null;
}

export function appBackupFolders(): BackupFolderTable {
  const row = (): BackupFolderRow => ({ place: "data_folder", path: "" });
  return { linux: row(), windows: row(), macos: row() };
}

export function vaultBackupFolders(): VaultBackupFolders {
  const row = (): VaultBackupFolderRow => ({ place: "inherit", path: "" });
  return { linux: row(), windows: row(), macos: row() };
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** A table from the wire or a form, with every row present. */
export function normalizeAppBackupFolders(raw: unknown): BackupFolderTable {
  const table = (raw ?? {}) as Partial<Record<BackupFolderSystem, Partial<BackupFolderRow>>>;
  const out = appBackupFolders();
  for (const system of BACKUP_FOLDER_SYSTEMS) {
    const row = table[system];
    out[system] = {
      place: row?.place === "custom" ? "custom" : "data_folder",
      path: textOf(row?.path),
    };
  }
  return out;
}

/** A vault's rows from the wire or a form, with every row present. */
export function normalizeVaultBackupFolders(raw: unknown): VaultBackupFolders {
  const table = (raw ?? {}) as Partial<Record<BackupFolderSystem, Partial<VaultBackupFolderRow>>>;
  const out = vaultBackupFolders();
  for (const system of BACKUP_FOLDER_SYSTEMS) {
    const row = table[system];
    const place = row?.place === "custom" || row?.place === "data_folder" ? row.place : "inherit";
    out[system] = { place, path: textOf(row?.path) };
  }
  return out;
}

function chosenPath(app: BackupFolderRow | null, vault: VaultBackupFolderRow | null): string {
  if (vault?.place === "custom") return vault.path.trim();
  if (vault?.place === "inherit" && app?.place === "custom") return app.path.trim();
  return "";
}

/**
 * True when a settings change moves a vault's backups away from a chosen
 * folder. The zips already there stay, and Upriv stops listing them.
 */
export function backupFolderLeftBehind(
  before: { app: BackupFolderRow | null; vault: VaultBackupFolderRow | null },
  after: { app: BackupFolderRow | null; vault: VaultBackupFolderRow | null },
): boolean {
  const was = chosenPath(before.app, before.vault);
  return was !== "" && was !== chosenPath(after.app, after.vault);
}

/** What is wrong with a row before anything is checked on disk. */
export function backupFolderIssue(
  place: BackupPlace | VaultBackupPlace,
  path: string,
  vaultRootPath?: string | null,
): WorkspacePathIssue | null {
  if (place !== "custom") return null;
  if (!path.trim()) return "empty";
  return validateWorkspaceGlobalPath(path, vaultRootPath);
}

export const BACKUP_FOLDER_STATUSES = [
  "ok",
  "missing",
  "no_permission",
  "no_room",
  "file_too_large",
  "not_responding",
  "reserved",
  "other",
] as const;

/** What a chosen folder can do right now (`BackupFolderStatus` in core). */
export type BackupFolderStatus = (typeof BACKUP_FOLDER_STATUSES)[number];

export function parseBackupFolderStatus(value: unknown): BackupFolderStatus | null {
  return BACKUP_FOLDER_STATUSES.find((status) => status === value) ?? null;
}

const BACKUP_FOLDER_STATUS_I18N = {
  ok: "modal.backup.folder.status.ok",
  missing: "modal.backup.folder.status.missing",
  no_permission: "modal.backup.folder.status.no_permission",
  no_room: "modal.backup.folder.status.no_room",
  file_too_large: "modal.backup.folder.status.file_too_large",
  not_responding: "modal.backup.folder.status.not_responding",
  reserved: "modal.backup.folder.status.reserved",
  other: "modal.backup.folder.status.other",
} as const satisfies Record<BackupFolderStatus, I18nKey>;

export function backupFolderStatusI18nKey(status: BackupFolderStatus): I18nKey {
  return BACKUP_FOLDER_STATUS_I18N[status];
}

const BACKUP_FELL_BACK_TOAST_I18N = {
  ok: "toast.backup_fell_back.other",
  missing: "toast.backup_fell_back.missing",
  no_permission: "toast.backup_fell_back.no_permission",
  no_room: "toast.backup_fell_back.no_room",
  file_too_large: "toast.backup_fell_back.file_too_large",
  not_responding: "toast.backup_fell_back.not_responding",
  reserved: "toast.backup_fell_back.reserved",
  other: "toast.backup_fell_back.other",
} as const satisfies Record<BackupFolderStatus, I18nKey>;

/** The toast for a backup that went to the data folder instead of the chosen one. */
export function backupFellBackToastKey(status: BackupFolderStatus): I18nKey {
  return BACKUP_FELL_BACK_TOAST_I18N[status];
}

/** A vault whose backup went to the data folder, and why. */
export interface BackupFellBack {
  name: string;
  status: BackupFolderStatus;
}

/** The one toast of a Close all whose backups went to the data folder. Null when none did. */
export function closeAllFellBackToast(
  fellBack: readonly BackupFellBack[],
): { key: I18nKey; params: Record<string, string> } | null {
  const [only, ...others] = fellBack;
  if (!only) return null;
  if (others.length === 0) {
    return { key: backupFellBackToastKey(only.status), params: { name: only.name } };
  }
  return { key: "toast.backup_fell_back_many", params: { count: String(fellBack.length) } };
}
