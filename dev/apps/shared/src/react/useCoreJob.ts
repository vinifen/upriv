import { useCallback, useMemo, useRef, useState } from "react";
import { isJobCancelled, newJobId, type JobProgress } from "../domain";
import type { JobService } from "../services";
import { useJobProgress } from "./useJobProgress";

/** A job in flight: what started it, plus its id, progress, and clock. */
export type CoreJob<Meta extends object> = Meta & {
  /** The job id its request carries (`job_status`, `job_cancel`). */
  id: string;
  /** When core started it; `null` while it waits for its lane (queued). */
  startedAt: number | null;
  /** `null` until core answers that it runs. */
  progress: JobProgress | null;
  /** When Stop was asked for; the job is removing what it wrote. `null` until then. */
  stoppingSince: number | null;
};

type RunningJob<Meta extends object> = Meta & { id: string; stoppingSince: number | null };

export interface CoreJobEvents<Meta extends object, Result> {
  onDone: (result: Result, meta: Meta) => void;
  onFailed: (error: unknown, meta: Meta) => void;
  /** The job was stopped and left nothing behind. */
  onCancelled: (meta: Meta) => void;
  /** Core refused the stop (`job_not_stoppable`, the job is finishing). The job goes on. */
  onStopRefused: (error: unknown, meta: Meta) => void;
}

/**
 * One job that core runs and `job_status` measures: a vault export, Back up
 * now, a backup export, Export data folder, or the removal of a leftover
 * folder. The vault list owns it, so it keeps running when the window that
 * started it closes. One at a time. It has no time limit: it ends when it is
 * done, fails, or is stopped.
 */
export function useCoreJob<Meta extends object, Result>(
  jobs: JobService,
  events: CoreJobEvents<Meta, Result>,
) {
  const [running, setRunning] = useState<RunningJob<Meta> | null>(null);
  const jobRef = useRef(running);
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const track = useJobProgress(jobs, running?.id ?? null);
  const job = useMemo<CoreJob<Meta> | null>(
    () => (running ? { ...running, progress: track.progress, startedAt: track.startedAt } : null),
    [running, track],
  );

  const commit = useCallback((next: RunningJob<Meta> | null) => {
    jobRef.current = next;
    setRunning(next);
  }, []);

  /** Run `run` as a new job of `meta`. False while one runs. */
  const start = useCallback(
    (meta: Meta, run: (jobId: string) => Promise<Result>): boolean => {
      if (jobRef.current) return false;
      const id = newJobId();
      commit({ ...meta, id, stoppingSince: null });
      void run(id)
        .then(
          (result) => eventsRef.current.onDone(result, meta),
          (error: unknown) => {
            if (isJobCancelled(error)) eventsRef.current.onCancelled(meta);
            else eventsRef.current.onFailed(error, meta);
          },
        )
        .finally(() => commit(null));
      return true;
    },
    [commit],
  );

  /** Ask the running job to stop. Its result then settles the job. */
  const stop = useCallback(() => {
    const current = jobRef.current;
    if (!current || current.stoppingSince !== null) return;
    commit({ ...current, stoppingSince: Date.now() });
    void jobs.cancel(current.id, "user").catch((error: unknown) => {
      const now = jobRef.current;
      if (now?.id !== current.id) return;
      commit({ ...now, stoppingSince: null });
      eventsRef.current.onStopRefused(error, current);
    });
  }, [commit, jobs]);

  return { job, start, stop };
}
