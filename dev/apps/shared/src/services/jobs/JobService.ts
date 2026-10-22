import type { JobProgress } from "../../domain/jobs";

/** Who asked for a stop, for the log: the Stop button, or a timeout. */
export type JobStopBy = "user" | "timeout";

/**
 * Progress and stop for a long job (vault export, Back up now, data-folder
 * export), by the id its request carried (`newJobId`).
 */
export interface JobService {
  /** How far the job got, or `null` once it ended or before it started. */
  status(job: string): Promise<JobProgress | null>;
  /**
   * Stop the job. Its request rejects with `job_cancelled` and leaves no file.
   * A job still waiting to start ends as soon as it starts. Core logs `by`.
   */
  cancel(job: string, by: JobStopBy): Promise<void>;
}
