import type { VaultPathWriteResult } from "../backup/createLiveBackupService";

/** The whole data folder as one zip: `<name>.zip`, unzipping to `<name>/.upriv/`. */
export interface DataFolderService {
  /**
   * Zip `.upriv` into the folder `destDir` as `<name>.zip` (`name` without the
   * extension, see `dataFolderZipNameIssue`), as the job `job`. Resolves once
   * the zip is in place. Rejects with `job_cancelled` after `JobService.cancel`,
   * and with `data_folder_export_name_taken` when that zip is already there.
   */
  exportTo(destDir: string, name: string, job: string): Promise<VaultPathWriteResult>;
}
