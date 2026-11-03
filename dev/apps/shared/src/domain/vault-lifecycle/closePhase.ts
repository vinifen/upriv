import { delayMs } from "../timing/delay";

/** Step of a running close. */
export type VaultClosePhase = "flush" | "backup";

/**
 * `vault_close_phase`: where one vault's close stands. `open` is core still
 * holding the session with no close started; `closed` is no session and no
 * close.
 */
export type VaultCloseState =
  { state: "open" } | { state: "closing"; phase: VaultClosePhase } | { state: "closed" };

export const CLOSE_PHASE_POLL_MS = 400;

/** `null` when the answer is not one. */
export function parseVaultCloseState(raw: unknown): VaultCloseState | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { state, phase } = raw as { state?: unknown; phase?: unknown };
  if (state === "open" || state === "closed") return { state };
  if (state === "closing" && (phase === "flush" || phase === "backup")) {
    return { state, phase };
  }
  return null;
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
  readState: () => Promise<VaultCloseState | null>,
  events: ClosePhaseEvents,
  pollMs: number = CLOSE_PHASE_POLL_MS,
): Promise<T> {
  let settled = false;
  const poll = async () => {
    while (!settled) {
      let current: VaultCloseState | null = null;
      try {
        current = await readState();
      } catch {
        current = null;
      }
      if (settled) return;
      if (current?.state === "closing" && current.phase === "backup") {
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
