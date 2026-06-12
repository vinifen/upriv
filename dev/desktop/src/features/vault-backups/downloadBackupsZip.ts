import type { VaultBackupEntry } from "@upriv/shared";
import { downloadFiles } from "@/lib/downloadZip";

/** Download selected backups as a zip (mock bytes until Tauri reads real `.7z`). */
export async function downloadBackupsZip(
  entries: readonly VaultBackupEntry[],
  zipName: string,
  getBackupBytes: (entry: VaultBackupEntry) => Promise<Uint8Array>,
): Promise<void> {
  const files = await Promise.all(
    entries.map(async (entry) => ({
      filename: entry.filename,
      data: await getBackupBytes(entry),
    })),
  );
  downloadFiles(files, zipName);
}
