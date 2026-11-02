import { useCallback } from "react";
import type { BackupService, JobService, VaultPathWriteResult } from "../services";
import { useCoreJob, type CoreJob } from "./useCoreJob";

/** One backup export in flight. */
export type BackupExportJob = CoreJob<{
  vaultId: string;
  /** The backups being copied (`backupEntryKey`). */
  keys: readonly string[];
}>;

export interface BackupExportJobEvents {
  onExported: (result: VaultPathWriteResult) => void;
  onFailed: (error: unknown) => void;
  /** The user stopped the export and it left no file. */
  onCancelled: () => void;
  /**
   * The budget or the call's own timeout ran out. The export is told to stop,
   * and a later result is ignored.
   */
  onTimedOut: () => void;
}

/**
 * Backup export, owned by the vault list so it keeps running when the Backups
 * modal closes and that modal shows it again when it reopens. One at a time,
 * of any vault. The vault stays free: a backup is a frozen file. Its budget
 * grows with the bytes of the chosen backups (`sizedBudgetMs("backupExport")`).
 */
export function useBackupExportJob(
  backupService: BackupService,
  jobs: JobService,
  events: BackupExportJobEvents,
) {
  const {
    job,
    start: startJob,
    stop,
  } = useCoreJob<{ vaultId: string; keys: readonly string[] }, VaultPathWriteResult>(
    jobs,
    "backupExport",
    {
      onDone: (result) => events.onExported(result),
      onFailed: (error) => events.onFailed(error),
      onCancelled: () => events.onCancelled(),
      onTimedOut: () => events.onTimedOut(),
    },
  );

  /** Start copying the backups `keys` into `destDir`. False while one runs. */
  const start = useCallback(
    (vaultId: string, keys: readonly string[], destDir: string): boolean => {
      if (keys.length === 0) return false;
      return startJob({ vaultId, keys }, (id) =>
        backupService.exportTo(vaultId, keys, destDir, id),
      );
    },
    [backupService, startJob],
  );

  return { job, start, stop };
}
