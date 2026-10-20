import type { DataFolderExportProgress } from "../../domain/data-folder-export";
import type { VaultPathWriteResult } from "../backup/createLiveBackupService";

/** The whole data folder as one zip: `<name>.zip`, unzipping to `<name>/.upriv/`. */
export interface DataFolderService {
  /**
   * Zip `.upriv` into the folder `destDir` as `<name>.zip` (`name` without the
   * extension, see `dataFolderZipNameIssue`). Resolves once the zip is in place.
   * Rejects with `data_folder_export_cancelled` after {@link cancelExport}, and
   * with `data_folder_export_name_taken` when that zip is already there.
   */
  exportTo(destDir: string, name: string): Promise<VaultPathWriteResult>;
  /** Bytes copied by the running export, or `null` when none runs. */
  exportProgress(): Promise<DataFolderExportProgress | null>;
  /** Stop the running export. Its partial zip is removed. False when none ran. */
  cancelExport(): Promise<boolean>;
  /**
   * A picked folder the window no longer holds: replaced by another pick, or
   * the window closed. Android drops the access the folder picker took; a
   * folder an export is still writing into is released when that export ends.
   * An export never releases its folder by itself, so it stays for the next one.
   */
  releaseDestination?(destDir: string): void;
}
