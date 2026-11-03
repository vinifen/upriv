import { delayMs } from "../timing/delay";

/** Step of a running close. */
export type VaultClosePhase = "flush" | "backup";

/** `vault_close_phase` result while `vault_close` runs. */
export interface VaultCloseProgress {
  phase: VaultClosePhase;
}

export const CLOSE_PHASE_POLL_MS = 400;

/** `null` when no close runs, or the answer is not one. */
export function parseVaultCloseProgress(raw: unknown): VaultCloseProgress | null {
  if (typeof raw !== "object" || raw === null) return null;
  const phase = (raw as { phase?: unknown }).phase;
  if (phase !== "flush" && phase !== "backup") return null;
  return { phase };
}

/** `vault_close_hurry` result: true when a close was running to hear it. */
export function parseVaultCloseHurry(raw: unknown): boolean {
  return typeof raw === "object" && raw !== null && (raw as { running?: unknown }).running === true;
}

/**
 * Tell a close to hurry until one running hears it, or `wanted` ends. A close
 * still waiting in the queue has not started, so it is asked again. A failed
 * call counts as not heard.
 */
export async function askCloseToHurry(
  hurry: () => Promise<boolean>,
  wanted: () => boolean,
  pollMs: number = CLOSE_PHASE_POLL_MS,
): Promise<void> {
  while (wanted()) {
    const heard = await hurry().catch(() => false);
    if (heard) return;
    await delayMs(pollMs);
  }
}

/** What a running close tells its watcher, once. */
export interface ClosePhaseEvents {
  /** The close backup started. */
  onBackup: () => void;
}

/**
 * Wait for `work`, the `vault_close` call. While it runs, poll the core close
 * and call `onBackup` when its backup starts, then stop asking. A failed read
 * is skipped; it never fails the close. A close has no time limit: Close now
 * is its stop.
 */
export async function waitForClose<T>(
  work: Promise<T>,
  readProgress: () => Promise<VaultCloseProgress | null>,
  events: ClosePhaseEvents,
  pollMs: number = CLOSE_PHASE_POLL_MS,
): Promise<T> {
  let settled = false;
  const poll = async () => {
    while (!settled) {
      let progress: VaultCloseProgress | null = null;
      try {
        progress = await readProgress();
      } catch {
        progress = null;
      }
      if (settled) return;
      if (progress?.phase === "backup") {
        events.onBackup();
        return;
      }
      await delayMs(pollMs);
    }
  };
  void poll();
  try {
    return await work;
  } finally {
    settled = true;
  }
}
