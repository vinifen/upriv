import { listHasVaultBlockingDataFolderChange } from "../vault/types";
import type { VaultPipelineListStatus, VaultRow } from "../vault/types";
import { isAbsoluteFilesystemPath } from "../workspace";
import { dataFolderZipNameFromInput, dataFolderZipNameIssue } from "./zipName";

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
export type DataFolderExportPending = "folder" | "folder_not_absolute" | "name";

/**
 * What the chosen Export a copy still needs before Export can run. While it is
 * not `null` the option carries the attention border and Export stays off.
 * `typedName` is the name field as typed.
 */
export function dataFolderExportPending(
  destDir: string | null,
  typedName: string,
): DataFolderExportPending | null {
  const folder = destDir?.trim() ?? "";
  if (!folder) return "folder";
  if (!isAbsoluteFilesystemPath(folder)) return "folder_not_absolute";
  if (dataFolderZipNameIssue(dataFolderZipNameFromInput(typedName))) return "name";
  return null;
}
