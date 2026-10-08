import { delayMs } from "../timing/delay";

/** `vault_close_phase` result while `vault_close` runs. */
export type VaultClosePhase = "flush" | "backup";

export const CLOSE_PHASE_POLL_MS = 400;

export function parseVaultClosePhase(raw: unknown): VaultClosePhase | null {
  if (typeof raw !== "object" || raw === null) return null;
  const phase = (raw as { phase?: unknown }).phase;
  return phase === "flush" || phase === "backup" ? phase : null;
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
