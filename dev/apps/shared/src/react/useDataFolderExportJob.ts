import { useCallback, useEffect, useRef, useState } from "react";
import {
  LOADING_BUDGET_MS,
  isJobCancelled,
  isRpcTimeout,
  newJobId,
  type JobProgress,
} from "../domain";
import type { DataFolderService, JobService, VaultPathWriteResult } from "../services";
import { useLoadingBudget } from "./useLoadingBudget";
import { scheduleInterval } from "./schedule";

/** How often a running export is asked how far it got. */
export const DATA_FOLDER_EXPORT_POLL_MS = 1_000;

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

/** The zip an export wrote, and the folder the user chose for it. */
export interface DataFolderExportWritten {
  result: VaultPathWriteResult;
  destDir: string;
}

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
 * `dataFolderKey` names the data folder in use. `written` is the last zip
 * until another export starts, and only while that data folder stays in use.
 */
export function useDataFolderExportJob(
  service: DataFolderService | undefined,
  jobs: JobService,
  events: DataFolderExportJobEvents,
  dataFolderKey: string,
) {
  const [job, setJob] = useState<DataFolderExportJob | null>(null);
  const [written, setWritten] = useState<{
    dataFolderKey: string;
    zip: DataFolderExportWritten;
  } | null>(null);
  const jobRef = useRef(job);
  const genRef = useRef(0);
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const dataFolderKeyRef = useRef(dataFolderKey);
  dataFolderKeyRef.current = dataFolderKey;
  const running = job !== null;
  const budget = useLoadingBudget(running, LOADING_BUDGET_MS.dataFolderExport, {
    startedAt: job?.startedAt,
  });

  const commit = useCallback((next: DataFolderExportJob | null) => {
    jobRef.current = next;
    setJob(next);
  }, []);

  const patch = useCallback(
    (gen: number, change: Partial<DataFolderExportJob>) => {
      const current = jobRef.current;
      if (!current || gen !== genRef.current) return;
      commit({ ...current, ...change });
    },
    [commit],
  );

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
      // A data folder switch waits for the export, so this is the folder copied.
      const copiedKey = dataFolderKeyRef.current;
      setWritten(null);
      commit({ id, startedAt: Date.now(), progress: null, stopping: false });
      void service
        .exportTo(destDir, name, id)
        .then(
          (result) => {
            if (gen !== genRef.current) return;
            setWritten({ dataFolderKey: copiedKey, zip: { result, destDir } });
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
    patch(genRef.current, { stopping: true });
    void jobs.cancel(current.id, "user").catch(() => {
      /* The export result still settles the job. */
    });
  }, [jobs, patch]);

  const runningId = job?.id ?? null;
  useEffect(() => {
    if (runningId === null) return;
    const gen = genRef.current;
    let asking = false;
    const ask = () => {
      if (asking) return;
      asking = true;
      void jobs
        .status(runningId)
        .then(
          (progress) => {
            if (progress) patch(gen, { progress });
          },
          () => {
            /* Progress is advisory. The export result reports failures. */
          },
        )
        .finally(() => {
          asking = false;
        });
    };
    ask();
    return scheduleInterval(ask, DATA_FOLDER_EXPORT_POLL_MS);
  }, [jobs, patch, runningId]);

  useEffect(() => {
    const current = jobRef.current;
    if (!budget.timedOut || !current) return;
    genRef.current += 1;
    commit(null);
    stopInCore(current.id);
    eventsRef.current.onTimedOut();
  }, [budget.timedOut, commit, stopInCore]);

  return {
    job,
    written: written?.dataFolderKey === dataFolderKey ? written.zip : null,
    start,
    stop,
  };
}
