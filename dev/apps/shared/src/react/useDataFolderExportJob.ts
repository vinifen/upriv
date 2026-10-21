import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LOADING_BUDGET_MS,
  isJobCancelled,
  isRpcTimeout,
  newJobId,
  type JobProgress,
} from "../domain";
import type { DataFolderService, JobService, VaultPathWriteResult } from "../services";
import { useJobProgress } from "./useJobProgress";
import { useLoadingBudget } from "./useLoadingBudget";

/** The export in flight. */
export interface DataFolderExportJob {
  /** The job id its request carries (`job_status`, `job_cancel`). */
  id: string;
  startedAt: number;
  /** `null` until the first answer. */
  progress: JobProgress | null;
  /** Stop was asked for. The export is removing its partial zip. */
  stopping: boolean;
}

type RunningExport = Omit<DataFolderExportJob, "progress">;

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
 * open, and new vaults wait.
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
  const [running, setRunning] = useState<RunningExport | null>(null);
  const [written, setWritten] = useState<VaultPathWriteResult | null>(null);
  const jobRef = useRef(running);
  const genRef = useRef(0);
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const progress = useJobProgress(jobs, running?.id ?? null);
  const job = useMemo(() => (running ? { ...running, progress } : null), [running, progress]);
  const budget = useLoadingBudget(running !== null, LOADING_BUDGET_MS.dataFolderExport, {
    startedAt: running?.startedAt,
  });

  const commit = useCallback((next: RunningExport | null) => {
    jobRef.current = next;
    setRunning(next);
  }, []);

  /** Tell core to stop `id` after a timeout. Its result is ignored. */
  const stopInCore = useCallback(
    (id: string) => {
      void jobs.cancel(id, "timeout").catch(() => {
        /* The export result is ignored either way. */
      });
    },
    [jobs],
  );

  /** Start an export of `<name>.zip` into `destDir`. False while one runs. */
  const start = useCallback(
    (destDir: string, name: string): boolean => {
      if (!service || jobRef.current) return false;
      const gen = ++genRef.current;
      const id = newJobId();
      setWritten(null);
      commit({ id, startedAt: Date.now(), stopping: false });
      void service
        .exportTo(destDir, name, id)
        .then(
          (result) => {
            if (gen !== genRef.current) return;
            setWritten(result);
            eventsRef.current.onExported(result);
          },
          (error: unknown) => {
            if (gen !== genRef.current) return;
            if (isJobCancelled(error)) {
              eventsRef.current.onCancelled();
            } else if (isRpcTimeout(error)) {
              // The call gave up before the budget did; core still runs the copy.
              stopInCore(id);
              eventsRef.current.onTimedOut();
            } else {
              eventsRef.current.onFailed(error);
            }
          },
        )
        .finally(() => {
          if (gen === genRef.current) commit(null);
        });
      return true;
    },
    [commit, service, stopInCore],
  );

  /** Ask the running export to stop. Its result then settles the job. */
  const stop = useCallback(() => {
    const current = jobRef.current;
    if (!current || current.stopping) return;
    commit({ ...current, stopping: true });
    void jobs.cancel(current.id, "user").catch(() => {
      /* The export result still settles the job. */
    });
  }, [commit, jobs]);

  useEffect(() => {
    const current = jobRef.current;
    if (!budget.timedOut || !current) return;
    genRef.current += 1;
    commit(null);
    stopInCore(current.id);
    eventsRef.current.onTimedOut();
  }, [budget.timedOut, commit, stopInCore]);

  const clearWritten = useCallback(() => setWritten(null), []);

  return { job, written, clearWritten, start, stop };
}
