import type { JobProgress } from "../../domain/jobs";

/** Who asked for a stop, for the log: the Stop button, or an auto-close set to close on time. */
export type JobStopBy = "user" | "auto_close";

/**
 * Progress and stop for long work (`newJobId`): opening, creating, importing,
 * the password and unlock-RAM change, exports, backups, file imports, and the
 * rest the request names with its `job` id.
 */
export interface JobService {
  /**
   * How far the job got, or `null` before it started (it waits for its lane)
   * and once it ended.
   */
  status(job: string): Promise<JobProgress | null>;
  /**
   * Stop the job. Its request rejects with `job_cancelled` and leaves nothing
   * behind. A job still waiting to start ends as soon as it starts. Rejects
   * with `job_not_stoppable` once the job is in its last step. Core logs `by`.
   */
  cancel(job: string, by: JobStopBy): Promise<void>;
}
