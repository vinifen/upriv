let nextJob = 0;

/**
 * A fresh id for one long job (vault export, Back up now, data-folder export).
 * Core keeps a stop for an id that has not started yet, so an id is never
 * reused, also after the window reloads while core keeps running.
 */
export function newJobId(): string {
  nextJob += 1;
  const random = Math.random().toString(36).slice(2, 10);
  return `job-${Date.now().toString(36)}-${nextJob.toString(36)}-${random}`;
}
