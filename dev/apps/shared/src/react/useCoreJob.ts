import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  isJobCancelled,
  isRpcTimeout,
  newJobId,
  sizedBudgetMs,
  type JobProgress,
  type SizedWorkKind,
} from "../domain";
import type { JobService } from "../services";
import { useJobProgress } from "./useJobProgress";
import { useLoadingBudget } from "./useLoadingBudget";

/** A job in flight: what started it, plus its id, clock, progress, and budget. */
export type CoreJob<Meta extends object> = Meta & {
  /** The job id its request carries (`job_status`, `job_cancel`). */
  id: string;
  startedAt: number;
  /** `null` until the first answer. */
  progress: JobProgress | null;
  /** Stop was asked for. The job is removing its partial file. */
  stopping: boolean;
  /** `sizedBudgetMs` for the bytes core measured; the floor until then. */
  budgetMs: number;
};

type RunningJob<Meta extends object> = Meta & { id: string; startedAt: number; stopping: boolean };

export interface CoreJobEvents<Meta extends object, Result> {
  onDone: (result: Result, meta: Meta) => void;
  onFailed: (error: unknown, meta: Meta) => void;
  /** The user stopped the job and it left no file. */
  onCancelled: (meta: Meta) => void;
  /**
   * The budget or the call's own timeout ran out. Core is told to stop, and a
   * later result is ignored.
   */
  onTimedOut: (meta: Meta) => void;
}

/**
 * One job of `work` that core runs and `job_status` measures: a vault export,
 * Back up now, a backup export, or Export data folder. The vault list owns it,
 * so it keeps running when the window that started it closes. One at a time.
 *
 * Its budget grows with the bytes core reports (`sizedBudgetMs`). When the
 * budget or the call's own timeout runs out, core is told to stop
 * (`job_cancel`), so it does not keep writing after the UI gave up.
 */
export function useCoreJob<Meta extends object, Result>(
  jobs: JobService,
  work: SizedWorkKind,
  events: CoreJobEvents<Meta, Result>,
) {
  const [running, setRunning] = useState<RunningJob<Meta> | null>(null);
  const jobRef = useRef(running);
  const genRef = useRef(0);
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const progress = useJobProgress(jobs, running?.id ?? null);
  const budgetMs = sizedBudgetMs(work, progress?.bytesTotal);
  const job = useMemo<CoreJob<Meta> | null>(
    () => (running ? { ...running, progress, budgetMs } : null),
    [budgetMs, progress, running],
  );
  const budget = useLoadingBudget(running !== null, budgetMs, {
    startedAt: running?.startedAt,
  });

  const commit = useCallback((next: RunningJob<Meta> | null) => {
    jobRef.current = next;
    setRunning(next);
  }, []);

  /** Tell core to stop `id` after a timeout. Its result is ignored. */
  const stopInCore = useCallback(
    (id: string) => {
      void jobs.cancel(id, "timeout").catch(() => {
        /* The job's result is ignored either way. */
      });
    },
    [jobs],
  );

  /** Run `run` as a new job of `meta`. False while one runs. */
  const start = useCallback(
    (meta: Meta, run: (jobId: string) => Promise<Result>): boolean => {
      if (jobRef.current) return false;
      const gen = ++genRef.current;
      const id = newJobId();
      commit({ ...meta, id, startedAt: Date.now(), stopping: false });
      void run(id)
        .then(
          (result) => {
            if (gen === genRef.current) eventsRef.current.onDone(result, meta);
          },
          (error: unknown) => {
            if (gen !== genRef.current) return;
            if (isJobCancelled(error)) {
              eventsRef.current.onCancelled(meta);
            } else if (isRpcTimeout(error)) {
              // The call gave up before the budget did; core still runs the job.
              stopInCore(id);
              eventsRef.current.onTimedOut(meta);
            } else {
              eventsRef.current.onFailed(error, meta);
            }
          },
        )
        .finally(() => {
          if (gen === genRef.current) commit(null);
        });
      return true;
    },
    [commit, stopInCore],
  );

  /** Ask the running job to stop. Its result then settles the job. */
  const stop = useCallback(() => {
    const current = jobRef.current;
    if (!current || current.stopping) return;
    commit({ ...current, stopping: true });
    void jobs.cancel(current.id, "user").catch(() => {
      /* The job's result still settles it. */
    });
  }, [commit, jobs]);

  useEffect(() => {
    const current = jobRef.current;
    if (!budget.timedOut || !current) return;
    genRef.current += 1;
    commit(null);
    stopInCore(current.id);
    eventsRef.current.onTimedOut(current);
  }, [budget.timedOut, commit, stopInCore]);

  return { job, start, stop };
}
