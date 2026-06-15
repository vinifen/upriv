import { downloadFilesAsZip } from "@/lib/downloadZip";
import type { VaultRow } from "@upriv/shared";
import {
  listVaultsBlockingBulkExport,
  listVaultsReadyForBulkExport,
  vaultArchiveFilename,
  vaultArchiveZipEntryPath,
  vaultBlocksBulkExport,
} from "@upriv/shared";

export {
  listVaultsBlockingBulkExport,
  listVaultsReadyForBulkExport,
  vaultArchiveFilename,
  vaultArchiveZipEntryPath,
  vaultBlocksBulkExport,
};

export async function downloadVaultsZip(
  vaults: readonly VaultRow[],
  zipFilename: string,
  getArchiveBytes: (vault: VaultRow) => Promise<Uint8Array>,
): Promise<void> {
  if (vaults.length === 0) return;

  const files = await Promise.all(
    vaults.map(async (vault) => ({
      filename: vaultArchiveZipEntryPath(vault),
      data: await getArchiveBytes(vault),
    })),
  );

  downloadFilesAsZip(files, zipFilename);
}
