import type { VaultPathWriteResult } from "@upriv/shared";
import type { DataFolderExportJob } from "@upriv/shared/react";
import type { ExportFolder } from "@/hooks/useExportFolder";

/** Export data folder, owned by the vault list so it keeps running while Data folder is closed. */
export interface DataFolderExportControls {
  /** Every vault is closed or in recovery and no vault work runs (`dataFolderCanExport`). */
  canStart: boolean;
  /** The export in flight. */
  job: DataFolderExportJob | null;
  /** The zip the last export wrote, until another one starts or `clearWritten`. */
  written: VaultPathWriteResult | null;
  /** The Data folder window opened or closed: its saved line goes. */
  clearWritten: () => void;
  /** True when the export of `<name>.zip` started and took the folder. */
  onStart: (destDir: string, name: string) => boolean;
  onStop: () => void;
}

/**
 * Where the next zip goes and what it is called. The folder stays while the
 * vault list is up, across exports and when the Data folder window closes;
 * the name starts fresh.
 */
export interface DataFolderExportDestination {
  folder: ExportFolder;
  /** As typed. Starts as `upriv-<UTC stamp>`. */
  zipName: string;
  setZipName: (name: string) => void;
  /** A fresh `upriv-<UTC stamp>`: when the window opens and after each export. */
  resetZipName: () => void;
}
