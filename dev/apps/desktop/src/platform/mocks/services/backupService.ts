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

/** Prototype backup service — in-memory until `backup_*` RPC. */
export const mockBackupService: BackupService = {
  async listBackups(vaultId) {
    return backupsForVault(vaultId);
  },

  async deleteBackups(vaultId, stamps) {
    if (stamps.length === 0) return;
    const remove = new Set(stamps);
    const next = backupsForVault(vaultId).filter((entry) => !remove.has(entry.stamp));
    runtimeBackups.set(vaultId, next);
  },

  async promoteToSave(vaultId, stamp) {
    const next = backupsForVault(vaultId).map((entry) =>
      entry.stamp === stamp && !entry.saved ? { ...entry, saved: true } : entry,
    );
    runtimeBackups.set(vaultId, next);
  },

  async getBackupBytes(entry) {
    return getMockBackupBytes(entry);
  },
};
