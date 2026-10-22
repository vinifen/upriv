import type { JobProgressCopy } from "../jobs/progress";
import { listHasVaultBlockingDataFolderChange } from "../vault/types";
import type { VaultPipelineListStatus, VaultRow } from "../vault/types";
import { exportFolderIssue, type ExportFolderIssue } from "../workspace";
import { dataFolderZipNameFromInput, dataFolderZipNameIssue } from "./zipName";

/** Export a copy while its zip is written: bytes of the data folder done of the total. */
export const DATA_FOLDER_EXPORT_PROGRESS_COPY: JobProgressCopy = {
  measuring: "modal.data_folder_export.measuring",
  copying: "modal.data_folder_export.progress",
  finishing: "modal.data_folder_export.finishing",
};

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

/** The step Export a copy still needs, first one first. */
export type DataFolderExportPending = ExportFolderIssue | "name";

/**
 * What the chosen Export a copy still needs before Export can run. While it is
 * not `null` the option carries the attention border and Export stays off.
 * `typedName` is the name field as typed.
 */
export function dataFolderExportPending(
  destDir: string | null,
  typedName: string,
): DataFolderExportPending | null {
  const folderIssue = exportFolderIssue(destDir);
  if (folderIssue) return folderIssue;
  if (dataFolderZipNameIssue(dataFolderZipNameFromInput(typedName))) return "name";
  return null;
}
