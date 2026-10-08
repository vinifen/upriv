import type { I18nKey } from "../../i18n/catalog";
import type { VaultLifecycleIntent } from "../vault/lifecycle";

/** Button labels while unlock is running (UI only — not core phases). */
export const OPENING_PIPELINE_STEP_KEYS = [
  "unlock.step.unlock_keys",
  "unlock.step.open_session",
  "unlock.step.prepare",
  "unlock.step.ready",
] as const satisfies readonly I18nKey[];

/**
 * Labels while lock is running. Live close reports `flush`, then `backup` when
 * core says the close backup zip is being written, then `done`.
 */
export const CLOSING_PIPELINE_STEP_KEYS = [
  "close.step.flush",
  "close.step.write",
  "close.step.backup",
  "close.step.done",
] as const satisfies readonly I18nKey[];

export const CLOSING_FLUSH_STEP = CLOSING_PIPELINE_STEP_KEYS.indexOf("close.step.flush");
export const CLOSING_BACKUP_STEP = CLOSING_PIPELINE_STEP_KEYS.indexOf("close.step.backup");
export const CLOSING_DONE_STEP = CLOSING_PIPELINE_STEP_KEYS.indexOf("close.step.done");

function stepKey(keys: readonly I18nKey[], stepIndex: number): I18nKey {
  const index = Math.min(Math.max(stepIndex, 0), keys.length - 1);
  return keys[index] ?? keys[0]!;
}

/** Confirm-button copy for the in-flight pipeline step. */
export function lifecycleBusyLabelKey(intent: VaultLifecycleIntent, stepIndex: number): I18nKey {
  return intent === "unlock"
    ? stepKey(OPENING_PIPELINE_STEP_KEYS, stepIndex)
    : stepKey(CLOSING_PIPELINE_STEP_KEYS, stepIndex);
}
