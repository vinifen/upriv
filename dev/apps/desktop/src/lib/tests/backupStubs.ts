import type { BackupService, VaultBackupEntry, VaultBackupListing } from "@upriv/shared";

/** A backup of the vault `notes` in the data folder's section. */
export function backupEntry(
  stamp: string,
  patch: Partial<VaultBackupEntry> = {},
): VaultBackupEntry {
  const fileName = patch.fileName ?? `${stamp}-notes.zip`;
  const saved = patch.saved ?? false;
  return {
    key: `data/${saved ? "saves/" : ""}${fileName}`,
    stamp,
    fileName,
    name: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    sizeBytes: 1,
    saved,
    path: `/data/.upriv/vaults/notes/backups/${saved ? "saves/" : ""}${fileName}`,
    lowerUnlockRam: false,
    ...patch,
  };
}

/** Every backup in the data folder's section. */
export function dataFolderListing(entries: VaultBackupEntry[]): VaultBackupListing {
  return {
    sections: [
      {
        folder: "data",
        kind: "data_folder",
        path: "/data/.upriv/vaults/notes/backups",
        device: null,
        status: "ok",
        entries,
      },
    ],
  };
}

/** A backup service that lists nothing and does nothing, with `overrides`. */
export function backupServiceStub(overrides: Partial<BackupService> = {}): BackupService {
  return {
    listBackups: async () => dataFolderListing([]),
    deleteBackups: async () => undefined,
    promoteToSave: async () => undefined,
    renameBackup: async (_vaultId, key) => backupEntry(key),
    forgetFolder: async () => undefined,
    saveNow: async () => ({ backup: backupEntry("20260101000000", { saved: true }), switches: [] }),
    exportTo: async (_vaultId, _keys, destDir) => ({ path: destDir, size: 0 }),
    ...overrides,
  };
}
