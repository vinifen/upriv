import type { VaultBackupEntry } from "../../domain/backups";
import type { VaultPathWriteResult } from "./createLiveBackupService";

export interface BackupService {
  listBackups(vaultId: string): Promise<VaultBackupEntry[]>;
  deleteBackups(vaultId: string, stamps: readonly string[]): Promise<void>;
  promoteToSave(vaultId: string, stamp: string): Promise<void>;
  /**
   * Zip the closed vault straight into Saves, as the job `job`. Refused while
   * it is open or busy. Rejects with `job_cancelled` after `JobService.cancel`.
   */
  saveNow(vaultId: string, job: string): Promise<VaultBackupEntry>;
  /**
   * Copy the backups named by `keys` (`backupEntryKey`) into the folder
   * `destDir`, as the job `job`: one keeps its file name, several become one
   * zip of those files. Core takes the next free number when the name is in
   * the folder (`backupExportFilename`). Resolves once the file is in place.
   * Rejects with `job_cancelled` after `JobService.cancel`, and leaves no file.
   */
  exportTo(
    vaultId: string,
    keys: readonly string[],
    destDir: string,
    job: string,
  ): Promise<VaultPathWriteResult>;
}
