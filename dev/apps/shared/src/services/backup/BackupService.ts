import type { VaultBackupEntry } from "../../domain/backups";

export interface BackupService {
  listBackups(vaultId: string): Promise<VaultBackupEntry[]>;
  deleteBackups(vaultId: string, stamps: readonly string[]): Promise<void>;
  promoteToSave(vaultId: string, stamp: string): Promise<void>;
  getBackupBytes(entry: VaultBackupEntry): Promise<Uint8Array>;
}
