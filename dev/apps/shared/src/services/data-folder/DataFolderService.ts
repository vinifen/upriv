import type { DataFolderExportProgress } from "../../domain/data-folder-export";
import type { VaultPathWriteResult } from "../backup/createLiveBackupService";

/** The whole data folder as one zip: `upriv-<stamp>.zip`, unzipping to `upriv-<stamp>/.upriv/`. */
export interface DataFolderService {
  /**
   * Zip `.upriv` into the folder `destDir`. Resolves once the zip is in place.
   * Rejects with `data_folder_export_cancelled` after {@link cancelExport}.
   */
  exportTo(destDir: string): Promise<VaultPathWriteResult>;
  /** Bytes copied by the running export, or `null` when none runs. */
  exportProgress(): Promise<DataFolderExportProgress | null>;
  /** Stop the running export. Its partial zip is removed. False when none ran. */
  cancelExport(): Promise<boolean>;
}
