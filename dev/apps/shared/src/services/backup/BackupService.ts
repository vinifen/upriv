import type { VaultBackupEntry, VaultBackupListing, VaultBackupSaved } from "../../domain/backups";
import type { VaultPathWriteResult } from "./pathWriteResult";

/** A vault's backups, by key: `<folder>/[saves/]<file>`, never a path. */
export interface BackupService {
  /** One section per folder, each checked with its own limit. */
  listBackups(vaultId: string): Promise<VaultBackupListing>;
  deleteBackups(vaultId: string, keys: readonly string[]): Promise<void>;
  promoteToSave(vaultId: string, key: string): Promise<void>;
  /** Name a backup, which pins it, or take its name away (`""`). Returns it as it is now. */
  renameBackup(vaultId: string, key: string, name: string): Promise<VaultBackupEntry>;
  /** Stop listing a folder that cannot be reached; its files stay where they are. */
  forgetFolder(vaultId: string, folder: string): Promise<void>;
  /**
   * Zip the closed vault straight into Saves where its backups go, as the job
   * `job`. Refused while it is open or busy. Rejects with `job_cancelled` after
   * `JobService.cancel`.
   */
  saveNow(vaultId: string, job: string): Promise<VaultBackupSaved>;
  /**
   * Copy the backups named by `keys` into the folder `destDir`, as the job
   * `job`: one keeps its file name, several become one zip of those files.
   * Core takes the next free number when the name is in the folder
   * (`backupExportFilename`). Rejects with `job_cancelled` after
   * `JobService.cancel`, and leaves no file.
   */
  exportTo(
    vaultId: string,
    keys: readonly string[],
    destDir: string,
    job: string,
  ): Promise<VaultPathWriteResult>;
}
