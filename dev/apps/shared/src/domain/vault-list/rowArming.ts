import { isVaultPipelineDisplayBusy, type VaultDisplayStatus, type VaultRowWork } from "../vault";

/**
 * Two-press buttons on a vault row: the first press arms the button (it turns
 * red and pulses), a second press within `ROW_ARM_WINDOW_MS` runs it. Stop
 * asks for the second press while `ui.lifecycle_confirm_stop` is on, Lock
 * while `ui.lifecycle_confirm_lock` is on. Unlock never does: it only opens
 * its password window. Windows never do either.
 */

/** A second press sooner than this is the same double click, not a confirmation. */
export const ROW_ARM_CONFIRM_AFTER_MS = 400;

/** An armed button goes back to normal after this long without a second press. */
export const ROW_ARM_WINDOW_MS = 4_000;

/**
 * Presses are ignored this long after a row button changed what it does
 * (Export → Stop, Stop → Unlock), so a quick second press never lands on the
 * new action.
 */
export const ROW_ROLE_GUARD_MS = 500;

/** What a press on a row button does. */
export type RowPress = "ignore" | "arm" | "run";

export interface RowPressInput {
  now: number;
  /** This button asks for a second press. */
  twoStep: boolean;
  /** When this button was armed; `null` while it is not. */
  armedAt: number | null;
  /** When the button last changed what it does; `null` if it never did. */
  roleChangedAt: number | null;
}

/**
 * What the open/close button of a vault row does now. Work the row can stop
 * puts Stop in its place: `stop`, then `stop_final` in the step it cannot
 * stop, and `stopping` once asked. `busy` is work without a row Stop (a close).
 */
export type VaultRowButtonRole = "unlock" | "lock" | "busy" | "stop" | "stop_final" | "stopping";

export function vaultRowButtonRole(
  status: VaultDisplayStatus,
  work: VaultRowWork | null | undefined,
): VaultRowButtonRole {
  if (work?.stop === "ready") return "stop";
  if (work?.stop === "final") return "stop_final";
  if (work?.stop === "stopping") return "stopping";
  if (status === "open") return "lock";
  if (isVaultPipelineDisplayBusy(status)) return "busy";
  return "unlock";
}

/** Whether this role waits for a second press, from the two System settings switches. */
export function vaultRowButtonTwoStep(
  role: VaultRowButtonRole,
  ui: { lifecycle_confirm_stop: boolean; lifecycle_confirm_lock: boolean },
): boolean {
  if (role === "stop") return ui.lifecycle_confirm_stop;
  if (role === "lock") return ui.lifecycle_confirm_lock;
  return false;
}

export function rowPress({ now, twoStep, armedAt, roleChangedAt }: RowPressInput): RowPress {
  if (roleChangedAt !== null && now - roleChangedAt < ROW_ROLE_GUARD_MS) return "ignore";
  if (!twoStep) return "run";
  if (armedAt === null || now - armedAt >= ROW_ARM_WINDOW_MS) return "arm";
  if (now - armedAt < ROW_ARM_CONFIRM_AFTER_MS) return "ignore";
  return "run";
}
