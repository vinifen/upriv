import { useEffect, useState } from "react";
import type { JobProgress } from "../domain";
import type { JobService } from "../services";
import { scheduleInterval } from "./schedule";

/** How often a running job is asked how far it got. */
export const JOB_PROGRESS_POLL_MS = 1_000;

/** What `job_status` told so far about one job. */
export interface JobTrack {
  /** The last answer while it ran; `null` until the first one. */
  progress: JobProgress | null;
  /**
   * When core was first seen running it. `null` while the job is queued: the
   * request waits for its lane, and that wait is not counted as work.
   */
  startedAt: number | null;
}

const NOT_STARTED: JobTrack = { progress: null, startedAt: null };

/**
 * Ask how far the job `id` got every `JOB_PROGRESS_POLL_MS` while `id` is
 * set. A job core does not list yet is queued. Progress is advisory: a failed
 * ask keeps the last answer, and the job's own request reports how it ended.
 */
export function useJobProgress(jobs: JobService, id: string | null): JobTrack {
  const [answer, setAnswer] = useState<{ id: string; track: JobTrack } | null>(null);

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
            if (!current || !progress) return;
            setAnswer((previous) => ({
              id,
              track: {
                progress,
                startedAt:
                  previous?.id === id && previous.track.startedAt !== null
                    ? previous.track.startedAt
                    : Date.now(),
              },
            }));
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

  return answer !== null && answer.id === id ? answer.track : NOT_STARTED;
}
