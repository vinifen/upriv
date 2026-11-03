import type { PendingPlainConfirm } from "./types";

export interface FinishPlainOpen {
  vaultId: string;
  password: string;
  /** The job both steps run as, so one Stop ends the whole open. */
  job: string;
  open: (vaultId: string, password: string, job: string) => Promise<unknown>;
  confirm: (vaultId: string, path: string, job: string) => Promise<void>;
  close: (vaultId: string) => Promise<void>;
  pendingOf: (raw: unknown) => PendingPlainConfirm | null;
}

/**
 * Unlock, then accept the folder core already checked. The place was chosen
 * before the password, so nothing asks again. A failed or stopped confirm
 * drops the keys.
 */
export async function finishPlainOpen(steps: FinishPlainOpen): Promise<void> {
  const raw = await steps.open(steps.vaultId, steps.password, steps.job);
  const pending = steps.pendingOf(raw);
  if (!pending) return;
  try {
    await steps.confirm(steps.vaultId, pending.path, steps.job);
  } catch (error) {
    await steps.close(steps.vaultId).catch(() => undefined);
    throw error;
  }
}
