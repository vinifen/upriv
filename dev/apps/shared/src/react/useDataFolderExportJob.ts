import { useCallback, useEffect, useRef, useState } from "react";
import {
  LOADING_BUDGET_MS,
  isDataFolderExportCancelled,
  type DataFolderExportProgress,
} from "../domain";
import type { DataFolderService, VaultPathWriteResult } from "../services";
import { useLoadingBudget } from "./useLoadingBudget";
import { scheduleInterval } from "./schedule";

/** How often a running export is asked how far it got. */
export const DATA_FOLDER_EXPORT_POLL_MS = 1_000;

/** The export in flight. */
export interface DataFolderExportJob {
  startedAt: number;
  /** `null` until the first answer. */
  progress: DataFolderExportProgress | null;
  /** Stop was asked for. The export is removing its partial zip. */
  stopping: boolean;
}

export interface DataFolderExportJobEvents {
  onExported: (result: VaultPathWriteResult) => void;
  onFailed: (error: unknown) => void;
  /** The user stopped the export and it left no file. */
  onCancelled: () => void;
  /** The budget ran out. The export is told to stop, and a later result is ignored. */
  onTimedOut: () => void;
}

/**
 * Export data folder, owned by the vault list so it keeps running when its
 * modal closes. While `job` is set every row shows `exporting` and refuses to
 * open, and new vaults wait.
 */
export function useDataFolderExportJob(
  service: DataFolderService | undefined,
  events: DataFolderExportJobEvents,
) {
  const [job, setJob] = useState<DataFolderExportJob | null>(null);
  const jobRef = useRef(job);
  const genRef = useRef(0);
  const eventsRef = useRef(events);
  eventsRef.current = events;
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

  /** Start an export into `destDir`. False while one runs. */
  const start = useCallback(
    (destDir: string): boolean => {
      if (!service || jobRef.current) return false;
      const gen = ++genRef.current;
      commit({ startedAt: Date.now(), progress: null, stopping: false });
      void service
        .exportTo(destDir)
        .then(
          (result) => {
            if (gen === genRef.current) eventsRef.current.onExported(result);
          },
          (error: unknown) => {
            if (gen !== genRef.current) return;
            if (isDataFolderExportCancelled(error)) eventsRef.current.onCancelled();
            else eventsRef.current.onFailed(error);
          },
        )
        .finally(() => {
          if (gen === genRef.current) commit(null);
        });
      return true;
    },
    [commit, service],
  );

  /** Ask the running export to stop. Its result then settles the job. */
  const stop = useCallback(() => {
    const current = jobRef.current;
    if (!service || !current || current.stopping) return;
    patch(genRef.current, { stopping: true });
    void service.cancelExport().catch(() => {
      /* The export result still settles the job. */
    });
  }, [patch, service]);

  useEffect(() => {
    if (!running || !service) return;
    const gen = genRef.current;
    let asking = false;
    const ask = () => {
      if (asking) return;
      asking = true;
      void service
        .exportProgress()
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
  }, [patch, running, service]);

  useEffect(() => {
    if (!budget.timedOut || !running) return;
    genRef.current += 1;
    commit(null);
    void service?.cancelExport().catch(() => {
      /* Nothing else to stop. */
    });
    eventsRef.current.onTimedOut();
  }, [budget.timedOut, commit, running, service]);

  return { job, start, stop };
}
