import type { BackupService, VaultBackupEntry } from "@upriv/shared";
import { getMockBackupBytes, getMockBackupsForVault } from "@/platform/mocks/data/backups";

const runtimeBackups = new Map<string, VaultBackupEntry[]>();

function backupsForVault(vaultId: string): VaultBackupEntry[] {
  const runtime = runtimeBackups.get(vaultId);
  if (runtime) return structuredClone(runtime);
  const seed = getMockBackupsForVault(vaultId);
  runtimeBackups.set(vaultId, structuredClone(seed));
  return structuredClone(seed);
}

/** Prototype backup service — in-memory until Tauri `backup_*` commands. */
export const mockBackupService: BackupService = {
  async listBackups(vaultId) {
    return backupsForVault(vaultId);
  },

  async deleteBackups(vaultId, filenames) {
    if (filenames.length === 0) return;
    const remove = new Set(filenames);
    const next = backupsForVault(vaultId).filter((entry) => !remove.has(entry.filename));
    runtimeBackups.set(vaultId, next);
  },

  async promoteToSave(vaultId, filename) {
    const next = backupsForVault(vaultId).map((entry) =>
      entry.filename === filename && !entry.saved ? { ...entry, saved: true } : entry,
    );
    runtimeBackups.set(vaultId, next);
  },

  async getBackupBytes(_vaultId, entry) {
    return getMockBackupBytes(entry);
  },
};
