import type { VaultBackupEntry } from "@upriv/shared";
import { shareFiles } from "@/lib/shareZip";

/** Share selected backup trees (one file as-is; several as a zip). */
export async function shareBackupsZip(
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
  await shareFiles(files, zipName);
}
