import type { BackupFolderStatus } from "./folders";

/** Which of a vault's two places a backup is in. */
export type BackupLocation = "data_folder" | "chosen";

/** Row in backups modal — mirrors the `backup_list` DTO. */
export interface VaultBackupEntry {
  /** Stamp of `<stamp>-<id>.zip` (under `saves/` when pinned). */
  stamp: string;
  /** On-disk name, `YYYYMMDDHHmmss-<id>.zip`. This selects the zip. */
  fileName?: string;
  /** ISO-8601 from the stamp prefix or filesystem mtime. */
  createdAt: string;
  /** Size of the frozen `store/` tree in bytes (optional in UI). */
  sizeBytes?: number;
  /**
   * Pinned save — skipped by `keep_last` rotation; stored under `saves/` on disk.
   * User promotes a standard backup via `backup_promote`.
   */
  saved?: boolean;
  /** Absent reads as the data folder. */
  location?: BackupLocation;
  /** Where the zip is on this computer. */
  path?: string;
}

/** The chosen folder of a vault, and what it can do right now. */
export interface ChosenBackupFolder {
  /** The folder Upriv keeps this vault's backups in. */
  path: string;
  status: BackupFolderStatus;
}

/**
 * What `backup_list` returns. A folder that fails lists what it can and says
 * why: it never fails the list.
 */
export interface VaultBackupListing {
  backups: VaultBackupEntry[];
  /** Null while this vault's backups go to the data folder. */
  chosen: ChosenBackupFolder | null;
}

/** A finished Back up now. */
export interface VaultBackupSaved {
  backup: VaultBackupEntry;
  /** Why it is in the data folder and not in the chosen folder. */
  fallback: BackupFolderStatus | null;
}
