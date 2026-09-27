import { downloadFiles } from "@/lib/downloadZip";
import { isElectronRenderer } from "@/lib/invoke";
import { rpcPickSaveFile } from "@/lib/rpc";
import {
  backupBundleEntryName,
  backupEntryFileName,
  backupEntryKey,
  type VaultBackupEntry,
  type VaultPathWriteResult,
} from "@upriv/shared";

export interface DownloadBackupsZipFns {
  getBackupBytes: (entry: VaultBackupEntry) => Promise<Uint8Array>;
  exportSnapshotsToPath: (
    stamps: readonly string[],
    destPath: string,
  ) => Promise<VaultPathWriteResult>;
}

export interface PickedBackupDownload {
  destPath: string | null;
  write: () => Promise<void>;
}

/** Ask where to save, then return a write that copies one zip or bundles several. */
export async function pickBackupDownload(
  entries: readonly VaultBackupEntry[],
  vaultId: string,
  bundleName: string,
  fns: DownloadBackupsZipFns,
): Promise<PickedBackupDownload | "cancelled"> {
  if (entries.length === 0) return "cancelled";
  const singleName = backupEntryFileName(entries[0], vaultId);
  const fileName = entries.length === 1 ? singleName : bundleName;

  if (isElectronRenderer()) {
    const destPath = await rpcPickSaveFile({
      title: fileName,
      defaultPath: fileName,
      filters: [{ name: "Zip archive", extensions: ["zip"] }],
    });
    if (!destPath) return "cancelled";
    return {
      destPath,
      write: async () => {
        await fns.exportSnapshotsToPath(
          entries.map((entry) => backupEntryKey(entry, vaultId)),
          destPath,
        );
      },
    };
  }

  return {
    destPath: null,
    write: async () => {
      const files = await Promise.all(
        entries.map(async (entry) => ({
          filename: backupBundleEntryName(entry, vaultId, entries),
          data: await fns.getBackupBytes(entry),
        })),
      );
      downloadFiles(files, fileName);
    },
  };
}
