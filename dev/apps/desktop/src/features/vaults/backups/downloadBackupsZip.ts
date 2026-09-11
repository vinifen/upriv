import type { VaultBackupEntry } from "@upriv/shared";
import { downloadFiles } from "@/lib/downloadZip";

/** Download selected backup trees as a zip (mock bytes until desktop copies frozen `contents/`). */
export async function downloadBackupsZip(
  entries: readonly VaultBackupEntry[],
  zipName: string,
  getBackupBytes: (entry: VaultBackupEntry) => Promise<Uint8Array>,
): Promise<void> {
  const files = await Promise.all(
    entries.map(async (entry) => ({
      filename: entry.stamp,
      data: await getBackupBytes(entry),
    })),
  );
  downloadFiles(files, zipName);
}
