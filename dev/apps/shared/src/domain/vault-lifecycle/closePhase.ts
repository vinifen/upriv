import { delayMs } from "../timing/delay";

/** `vault_close_phase` result while `vault_close` runs. */
export type VaultClosePhase = "flush" | "backup";

export const CLOSE_PHASE_POLL_MS = 400;

export function parseVaultClosePhase(raw: unknown): VaultClosePhase | null {
  if (typeof raw !== "object" || raw === null) return null;
  const phase = (raw as { phase?: unknown }).phase;
  return phase === "flush" || phase === "backup" ? phase : null;
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

/**
 * Poll the core close phase while `work` runs and call `onBackup` once when the
 * close backup starts. A failed read is skipped; it never fails the close.
 */
export async function watchClosePhase<T>(
  work: Promise<T>,
  readPhase: () => Promise<VaultClosePhase | null>,
  onBackup: () => void,
  pollMs: number = CLOSE_PHASE_POLL_MS,
): Promise<T> {
  let settled = false;
  const poll = async () => {
    while (!settled) {
      let phase: VaultClosePhase | null = null;
      try {
        phase = await readPhase();
      } catch {
        phase = null;
      }
      if (settled) return;
      if (phase === "backup") {
        onBackup();
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
