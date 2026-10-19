/** Bytes copied by a running data-folder export (`data_folder_export_status`). */
export interface DataFolderExportProgress {
  bytesDone: number;
  /** Measured before the copy starts. `0` while that measure runs. */
  bytesTotal: number;
}

/** Wire `data_folder_export_status`. `null` when no export runs. */
export function parseDataFolderExportStatus(raw: unknown): DataFolderExportProgress | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as { running?: unknown; bytesDone?: unknown; bytesTotal?: unknown };
  if (record.running !== true) return null;
  const bytesDone = typeof record.bytesDone === "number" ? record.bytesDone : 0;
  const bytesTotal = typeof record.bytesTotal === "number" ? record.bytesTotal : 0;
  return { bytesDone, bytesTotal };
}

/** File name of the written zip, from its path on either system. */
export function dataFolderZipName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** Whole percent copied, or `null` while the size is still being measured. */
export function dataFolderExportPercent(progress: DataFolderExportProgress | null): number | null {
  if (!progress || progress.bytesTotal <= 0) return null;
  const ratio = Math.min(1, Math.max(0, progress.bytesDone / progress.bytesTotal));
  return Math.floor(ratio * 100);
}
