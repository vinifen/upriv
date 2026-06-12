import { downloadFilesAsZip } from "@/lib/downloadZip";
import type { VaultRow } from "@upriv/shared";
import {
  listVaultsBlockingBulkExport,
  listVaultsReadyForBulkExport,
  vaultArchiveFilename,
  vaultArchiveZipEntryPath,
  vaultBlocksBulkExport,
} from "@upriv/shared";
import { getMockVaultArchiveBytes } from "@/platform/mocks/data/vaultArchive";

export {
  getMockVaultArchiveBytes,
  listVaultsBlockingBulkExport,
  listVaultsReadyForBulkExport,
  vaultArchiveFilename,
  vaultArchiveZipEntryPath,
  vaultBlocksBulkExport,
};

export function downloadVaultsZip(vaults: readonly VaultRow[], zipFilename: string): void {
  if (vaults.length === 0) return;

  downloadFilesAsZip(
    vaults.map((vault) => ({
      filename: vaultArchiveZipEntryPath(vault),
      data: getMockVaultArchiveBytes(vault),
    })),
    zipFilename,
  );
}
