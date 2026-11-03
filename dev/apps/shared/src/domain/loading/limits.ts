/**
 * How long Upriv waits for work.
 *
 * - Work the person can stop (a job: an export, an import, opening a vault,
 *   the password change, …) and closing a vault (Close now is its stop) have
 *   no time limit: they run until they end or the person stops them.
 * - Every other call has one limit, `OPERATION_LIMIT_MS`, then an error and
 *   Retry. It only ends a wait that is stuck; nothing on screen counts it down.
 * - Folder and file pickers and install prompts wait for the person:
 *   `NO_DEADLINE_MS`.
 *
 * Long work shows how long it has been running (`formatElapsed`), never an
 * estimate of how long it may take.
 */

/** The one limit for a call the person cannot stop. */
export const OPERATION_LIMIT_MS = 600_000;

/** No deadline: a job, a close, or a dialog that waits for the person. */
export const NO_DEADLINE_MS = 0;

/** Delay before a spinner or the elapsed time appears, so fast work never flashes one. */
export const LOADING_APPEAR_DELAY_MS = 1_000;

/** `m:ss`, then `h:mm:ss` from one hour on. */
export function formatElapsed(elapsedMs: number): string {
  const totalSec = Math.max(0, Math.floor(elapsedMs / 1000));
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const ss = seconds.toString().padStart(2, "0");
  if (hours > 0) return `${hours}:${minutes.toString().padStart(2, "0")}:${ss}`;
  return `${minutes}:${ss}`;
}
