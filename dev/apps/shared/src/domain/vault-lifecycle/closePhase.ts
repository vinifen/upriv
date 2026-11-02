import { RPC_TIMEOUT_CODE, RpcError } from "../core-rpc/errors";
import { sizedBudgetMs } from "../loading/sizedBudget";
import { delayMs } from "../timing/delay";

/** Step of a running close. */
export type VaultClosePhase = "flush" | "backup";

/** `vault_close_phase` result while `vault_close` runs. */
export interface VaultCloseProgress {
  phase: VaultClosePhase;
  /** Bytes of `store/` the close backup zip copies. `0` until it has measured them. */
  backupBytesTotal: number;
}

export const CLOSE_PHASE_POLL_MS = 400;

/** `null` when no close runs, or the answer is not one. */
export function parseVaultCloseProgress(raw: unknown): VaultCloseProgress | null {
  if (typeof raw !== "object" || raw === null) return null;
  const body = raw as { phase?: unknown; backupBytesTotal?: unknown };
  if (body.phase !== "flush" && body.phase !== "backup") return null;
  const total = body.backupBytesTotal;
  return {
    phase: body.phase,
    backupBytesTotal: typeof total === "number" && Number.isFinite(total) && total > 0 ? total : 0,
  };
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

/** What a running close tells its watcher, each once. */
export interface ClosePhaseEvents {
  /** The close backup started. */
  onBackup: () => void;
  /** The close backup measured `store/`: `bytes` is what it copies. */
  onMeasured: (bytes: number) => void;
}

type Timers = {
  setTimeout?: (fn: () => void, delay: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
};

/**
 * Wait for `work`, the `vault_close` call. While it runs, poll the core close:
 * call `onBackup` when the close backup starts and `onMeasured` once it knows
 * its size, then stop asking. A failed read is skipped; it never fails the close.
 *
 * The wait ends with `rpc_timeout` once `sizedBudgetMs("vaultClose")` has
 * passed since it began: the floor until the backup is measured, then the
 * budget for that size. The call's own timeout is the ceiling, so it never
 * cuts a large close short.
 */
export async function waitForClose<T>(
  work: Promise<T>,
  readProgress: () => Promise<VaultCloseProgress | null>,
  events: ClosePhaseEvents,
  pollMs: number = CLOSE_PHASE_POLL_MS,
): Promise<T> {
  const timers = globalThis as Timers;
  const startedAt = Date.now();
  let budgetMs = sizedBudgetMs("vaultClose", null);
  let deadline: unknown;
  let giveUp: (error: RpcError) => void = () => {};
  const spent = new Promise<never>((_, reject) => {
    giveUp = reject;
  });
  const armDeadline = () => {
    if (deadline !== undefined) timers.clearTimeout?.(deadline);
    deadline = timers.setTimeout?.(
      () => giveUp(new RpcError(RPC_TIMEOUT_CODE, `vault_close: no answer within ${budgetMs}ms`)),
      Math.max(0, startedAt + budgetMs - Date.now()),
    );
  };
  const measured = (bytes: number) => {
    budgetMs = Math.max(budgetMs, sizedBudgetMs("vaultClose", bytes));
    armDeadline();
    events.onMeasured(bytes);
  };
  armDeadline();

  let settled = false;
  const poll = async () => {
    let backup = false;
    while (!settled) {
      let progress: VaultCloseProgress | null = null;
      try {
        progress = await readProgress();
      } catch {
        progress = null;
      }
      if (settled) return;
      if (progress?.phase === "backup" && !backup) {
        backup = true;
        events.onBackup();
      }
      if (backup && progress && progress.backupBytesTotal > 0) {
        measured(progress.backupBytesTotal);
        return;
      }
      await delayMs(pollMs);
    }
  };
  void poll();
  try {
    return await Promise.race([work, spent]);
  } finally {
    settled = true;
    timers.clearTimeout?.(deadline);
  }
}
