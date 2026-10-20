import type { DataFolderExportJob, DataFolderExportWritten } from "@upriv/shared/react";

/** Export data folder, owned by the vault list so it keeps running while Data folder is closed. */
export interface DataFolderExportControls {
  /** Every vault is closed or in recovery and no vault work runs (`dataFolderCanExport`). */
  canStart: boolean;
  /** The export in flight. */
  job: DataFolderExportJob | null;
  /** The zip the last export wrote, until another one starts or the data folder changes. */
  written: DataFolderExportWritten | null;
  /** True when the export of `<name>.zip` started and took the folder. */
  onStart: (destDir: string, name: string) => boolean;
  onStop: () => void;
}

/**
 * Where the next zip goes and what it is called. The folder, and its
 * storage-access grant, stay while the vault list is up, across exports and
 * when the Data folder window closes; the name starts fresh.
 */
export interface DataFolderExportDestination {
  destDir: string | null;
  picking: boolean;
  pickFailed: boolean;
  /** Opens the folder picker. Only the Choose folder button calls it. */
  choose: () => void;
  /** The window closed: drop a pick still open. The folder and its grant stay. */
  cancelPick: () => void;
  /** As typed. Starts as `upriv-<UTC stamp>`. */
  zipName: string;
  setZipName: (name: string) => void;
  /** A fresh `upriv-<UTC stamp>`: when the window opens and after each export. */
  resetZipName: () => void;
}
