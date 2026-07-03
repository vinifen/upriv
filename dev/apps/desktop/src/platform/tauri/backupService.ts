import type { BackupService, VaultBackupEntry } from "@upriv/shared";
import { TAURI_COMMANDS, tauriInvoke } from "@/lib/tauri";
import { resolveVaultRootPath } from "./vaultRoot";

interface BackupEntryDto {
  filename: string;
  createdAt: string;
  sizeBytes?: number;
  saved?: boolean;
}

function mapEntry(row: BackupEntryDto): VaultBackupEntry {
  return {
    filename: row.filename,
    createdAt: row.createdAt,
    sizeBytes: row.sizeBytes,
    saved: row.saved,
  };
}

export function createTauriBackupService(): BackupService {
  return {
    async listBackups(vaultId) {
      const vaultRoot = await resolveVaultRootPath();
      const rows = await tauriInvoke<BackupEntryDto[]>(TAURI_COMMANDS.BACKUP_LIST, {
        vaultRoot,
        vaultId,
      });
      return rows.map(mapEntry);
    },

    async deleteBackups(vaultId, filenames) {
      if (filenames.length === 0) return;
      const vaultRoot = await resolveVaultRootPath();
      await tauriInvoke(TAURI_COMMANDS.BACKUP_DELETE, {
        vaultRoot,
        vaultId,
        filenames: [...filenames],
      });
    },

    async promoteToSave(vaultId, filename) {
      const vaultRoot = await resolveVaultRootPath();
      await tauriInvoke(TAURI_COMMANDS.BACKUP_PROMOTE_SAVE, {
        vaultRoot,
        vaultId,
        filename,
      });
    },

    async getBackupBytes(vaultId, entry) {
      const vaultRoot = await resolveVaultRootPath();
      const bytes = await tauriInvoke<number[]>(TAURI_COMMANDS.BACKUP_READ_BYTES, {
        vaultRoot,
        vaultId,
        filename: entry.filename,
      });
      return Uint8Array.from(bytes);
    },
  };
}
