import { downloadFiles } from "@/lib/downloadZip";
import { getMockBackupBytes } from "./mockBackups";
import type { VaultBackupEntry } from "./backupTypes";

export function downloadBackupsZip(
  entries: readonly VaultBackupEntry[],
  zipFilename: string,
): void {
  if (entries.length === 0) return;

  downloadFiles(
    entries.map((entry) => ({
      filename: entry.filename,
      data: getMockBackupBytes(entry),
    })),
    zipFilename,
  );
}
