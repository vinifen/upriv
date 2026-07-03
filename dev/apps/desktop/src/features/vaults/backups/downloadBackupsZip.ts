import type { VaultBackupEntry } from "@upriv/shared";
import { downloadFiles } from "@/lib/downloadZip";

/** Download selected backups as a zip. */
export async function downloadBackupsZip(
  vaultId: string,
  entries: readonly VaultBackupEntry[],
  zipName: string,
  getBackupBytes: (vaultId: string, entry: VaultBackupEntry) => Promise<Uint8Array>,
): Promise<void> {
  const files = await Promise.all(
    entries.map(async (entry) => ({
      filename: entry.filename,
      data: await getBackupBytes(vaultId, entry),
    })),
  );
  downloadFiles(files, zipName);
}
