import { useEffect, useState } from "react";
import type { JobProgress } from "../domain";
import type { JobService } from "../services";
import { scheduleInterval } from "./schedule";

/** How often a running job is asked how far it got. */
export const JOB_PROGRESS_POLL_MS = 1_000;

/**
 * How far the job `id` got, asked every `JOB_PROGRESS_POLL_MS` while `id` is
 * set. `null` until that job's first answer, and while `id` is `null`.
 * Progress is advisory: a failed ask keeps the last answer, and the job's own
 * request reports how it ended.
 */
export function useJobProgress(jobs: JobService, id: string | null): JobProgress | null {
  const [answer, setAnswer] = useState<{ id: string; progress: JobProgress } | null>(null);

  useEffect(() => {
    if (id === null) return;
    let current = true;
    let asking = false;
    const ask = () => {
      if (asking) return;
      asking = true;
      void jobs
        .status(id)
        .then(
          (progress) => {
            if (current && progress) setAnswer({ id, progress });
          },
          () => {
            /* The next ask may answer. */
          },
        )
        .finally(() => {
          asking = false;
        });
    };
    ask();
    const stop = scheduleInterval(ask, JOB_PROGRESS_POLL_MS);
    return () => {
      current = false;
      stop();
    };
  }, [id, jobs]);

  return answer !== null && answer.id === id ? answer.progress : null;
}
