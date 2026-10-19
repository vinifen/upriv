import { listHasVaultBlockingDataFolderChange } from "../vault/types";
import type { VaultPipelineListStatus, VaultRow } from "../vault/types";

/**
 * Export data folder copies every vault, so each one must be closed or in
 * recovery with no work running on it, and no open, close, or create may be
 * on its way. Core refuses the rest (`data_folder_busy`).
 */
export function dataFolderCanExport(
  vaults: readonly VaultRow[],
  pipeline: VaultPipelineListStatus = {},
): boolean {
  if (pipeline.dataFolderExporting) return false;
  const inFlight = [
    pipeline.openingVaultIds,
    pipeline.closingVaultIds,
    pipeline.creatingVaultIds,
    pipeline.queuedVaultIds,
  ];
  if (inFlight.some((ids) => (ids?.length ?? 0) > 0)) return false;
  return !listHasVaultBlockingDataFolderChange(vaults, pipeline);
}
