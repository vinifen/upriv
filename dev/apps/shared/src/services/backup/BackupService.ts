import type { VaultBackupEntry } from "../../domain/backups";

export interface BackupService {
  listBackups(vaultId: string): Promise<VaultBackupEntry[]>;
  deleteBackups(vaultId: string, filenames: readonly string[]): Promise<void>;
  promoteToSave(vaultId: string, filename: string): Promise<void>;
  getBackupBytes(vaultId: string, entry: VaultBackupEntry): Promise<Uint8Array>;
}
