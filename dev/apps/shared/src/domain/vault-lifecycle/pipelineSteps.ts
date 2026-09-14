import type { I18nKey } from "../../i18n/catalog";
import type { VaultLifecycleIntent } from "../vault/lifecycle";

/** Button labels while unlock is running (UI only — not core phases). */
export const OPENING_PIPELINE_STEP_KEYS = [
  "unlock.step.unlock_keys",
  "unlock.step.open_session",
  "unlock.step.prepare",
  "unlock.step.ready",
] as const satisfies readonly I18nKey[];

/** Button labels while lock is running (UI only — not core phases). */
export const CLOSING_PIPELINE_STEP_KEYS = [
  "close.step.flush",
  "close.step.write",
  "close.step.lock",
  "close.step.done",
] as const satisfies readonly I18nKey[];

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
