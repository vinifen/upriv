import type { VaultBackupEntry } from "../../domain/backups";
import type { VaultPathWriteResult } from "./createLiveBackupService";

export interface BackupService {
  listBackups(vaultId: string): Promise<VaultBackupEntry[]>;
  deleteBackups(vaultId: string, stamps: readonly string[]): Promise<void>;
  promoteToSave(vaultId: string, stamp: string): Promise<void>;
  getBackupBytes(vaultId: string, entry: VaultBackupEntry): Promise<Uint8Array>;
  /** Stream a zip of the frozen `store/` tree to `destPath` (no NDJSON payload). */
  exportToPath(
    vaultId: string,
    entry: VaultBackupEntry,
    destPath: string,
  ): Promise<VaultPathWriteResult>;
  /**
   * One stamp copies that snapshot `.zip`. Several stamps write one zip whose
   * entries are those snapshot files.
   */
  exportSnapshotsToPath(
    vaultId: string,
    stamps: readonly string[],
    destPath: string,
  ): Promise<VaultPathWriteResult>;
}
