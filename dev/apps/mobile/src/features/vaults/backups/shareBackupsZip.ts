import { cacheDirectory, getInfoAsync, makeDirectoryAsync } from "expo-file-system";
import { isAvailableAsync, shareAsync } from "expo-sharing";
import {
  backupEntryFileName,
  backupEntryKey,
  type VaultBackupEntry,
  type VaultPathWriteResult,
} from "@upriv/shared";
import { fsPathFromFileUri } from "@/lib/fileUri";

const BACKUP_CACHE_DIR = "upriv-backups/";

export interface ShareBackupsZipFns {
  exportSnapshotsToPath: (
    stamps: readonly string[],
    destPath: string,
  ) => Promise<VaultPathWriteResult>;
}

function safeEntryName(name: string): string {
  return name.replace(/[/\\]/g, "_").replace(/^\.+/, "_");
}

/** Copy one snapshot zip, or a zip of several, into cache and open the share sheet. */
export async function shareBackupsZip(
  entries: readonly VaultBackupEntry[],
  vaultId: string,
  bundleName: string,
  fns: ShareBackupsZipFns,
): Promise<void> {
  if (entries.length === 0) return;
  const root = cacheDirectory;
  if (!root) {
    throw new Error("cacheDirectory unavailable");
  }
  const dir = `${root}${BACKUP_CACHE_DIR}`;
  await makeDirectoryAsync(dir, { intermediates: true });
  const filename =
    entries.length === 1
      ? safeEntryName(backupEntryFileName(entries[0], vaultId))
      : safeEntryName(bundleName);
  const uri = `${dir}${filename}`;
  const destPath = fsPathFromFileUri(uri);
  await fns.exportSnapshotsToPath(
    entries.map((entry) => backupEntryKey(entry, vaultId)),
    destPath,
  );
  const info = await getInfoAsync(uri);
  if (!info.exists) {
    throw new Error("backup zip was not written");
  }
  if (!(await isAvailableAsync())) {
    throw new Error("sharing unavailable on this device");
  }
  await shareAsync(uri, {
    mimeType: "application/zip",
    UTI: "public.zip-archive",
    dialogTitle: filename,
  });
}
