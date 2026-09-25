import { downloadFiles } from "@/lib/downloadZip";
import { isElectronRenderer } from "@/lib/invoke";
import { rpcPickSaveFile } from "@/lib/rpc";
import type { VaultBackupEntry, VaultPathWriteResult } from "@upriv/shared";

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
  bundleName: string,
  fns: DownloadBackupsZipFns,
): Promise<PickedBackupDownload | "cancelled"> {
  if (entries.length === 0) return "cancelled";
  const singleName = `${entries[0].stamp}.zip`;
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
          entries.map((entry) => entry.stamp),
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
          filename: `${entry.stamp}.zip`,
          data: await fns.getBackupBytes(entry),
        })),
      );
      downloadFiles(files, fileName);
    },
  };
}
