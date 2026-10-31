import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LOADING_BUDGET_MS,
  isJobCancelled,
  isRpcTimeout,
  newJobId,
  type JobProgress,
} from "../domain";
import type { BackupService, JobService, VaultPathWriteResult } from "../services";
import { useJobProgress } from "./useJobProgress";
import { useLoadingBudget } from "./useLoadingBudget";

/** One backup export in flight. */
export interface BackupExportJob {
  /** The job id its request carries (`job_status`, `job_cancel`). */
  id: string;
  vaultId: string;
  /** The backups being copied (`backupEntryKey`). */
  keys: readonly string[];
  startedAt: number;
  /** `null` until the first answer. */
  progress: JobProgress | null;
  /** Stop was asked for. The export is removing its partial file. */
  stopping: boolean;
}

type RunningExport = Omit<BackupExportJob, "progress">;

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
 * of any vault. The vault stays free: a backup is a frozen file.
 */
export function useBackupExportJob(
  backupService: BackupService,
  jobs: JobService,
  events: BackupExportJobEvents,
) {
  const [running, setRunning] = useState<RunningExport | null>(null);
  const jobRef = useRef(running);
  const genRef = useRef(0);
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const progress = useJobProgress(jobs, running?.id ?? null);
  const job = useMemo(() => (running ? { ...running, progress } : null), [running, progress]);
  const budget = useLoadingBudget(running !== null, LOADING_BUDGET_MS.backupExport, {
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

  /** Start copying the backups `keys` into `destDir`. False while one runs. */
  const start = useCallback(
    (vaultId: string, keys: readonly string[], destDir: string): boolean => {
      if (jobRef.current || keys.length === 0) return false;
      const gen = ++genRef.current;
      const id = newJobId();
      commit({ id, vaultId, keys, startedAt: Date.now(), stopping: false });
      void backupService
        .exportTo(vaultId, keys, destDir, id)
        .then(
          (result) => {
            if (gen === genRef.current) eventsRef.current.onExported(result);
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
    [backupService, commit, stopInCore],
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

  return { job, start, stop };
}
