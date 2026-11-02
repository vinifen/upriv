import { useCallback, useState } from "react";
import type { DataFolderService, JobService, VaultPathWriteResult } from "../services";
import { useCoreJob, type CoreJob } from "./useCoreJob";

/** The export in flight. */
export type DataFolderExportJob = CoreJob<Record<never, never>>;

export interface DataFolderExportJobEvents {
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
 * Export data folder, owned by the vault list so it keeps running when its
 * modal closes. While `job` is set every row shows `exporting` and refuses to
 * open, and new vaults wait. Its budget grows with the size of the data folder
 * (`sizedBudgetMs("dataFolderExport")`).
 *
 * `written` is the last zip until another export starts or `clearWritten`
 * drops it: the Data folder window drops it when it opens and when it closes,
 * so its saved line belongs to the window that saw the export finish.
 */
export function useDataFolderExportJob(
  service: DataFolderService | undefined,
  jobs: JobService,
  events: DataFolderExportJobEvents,
) {
  const [written, setWritten] = useState<VaultPathWriteResult | null>(null);
  const {
    job,
    start: startJob,
    stop,
  } = useCoreJob<Record<never, never>, VaultPathWriteResult>(jobs, "dataFolderExport", {
    onDone: (result) => {
      setWritten(result);
      events.onExported(result);
    },
    onFailed: (error) => events.onFailed(error),
    onCancelled: () => events.onCancelled(),
    onTimedOut: () => events.onTimedOut(),
  });

  /** Start an export of `<name>.zip` into `destDir`. False while one runs. */
  const start = useCallback(
    (destDir: string, name: string): boolean => {
      if (!service) return false;
      const started = startJob({}, (id) => service.exportTo(destDir, name, id));
      if (started) setWritten(null);
      return started;
    },
    [service, startJob],
  );

  const clearWritten = useCallback(() => setWritten(null), []);

  return { job, written, clearWritten, start, stop };
}
