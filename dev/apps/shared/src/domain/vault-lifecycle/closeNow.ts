import type { VaultDisplayStatus } from "../vault/types";

/** Close now asks first while the setting is on. An unsaved editor tab always asks. */
export function closeNowNeedsConfirm(askSetting: boolean, hasUnsavedTabs: boolean): boolean {
  return askSetting || hasUnsavedTabs;
}

/** What Close now gives up, as its window lists it. The wipe only exists on a plaintext vault. */
export function closeNowNoticeKeys(plaintext: boolean) {
  return plaintext
    ? ([
        "modal.close_now.no_backup",
        "modal.close_now.changes_lost_plain",
        "modal.close_now.not_wiped",
      ] as const)
    : (["modal.close_now.no_backup", "modal.close_now.changes_lost"] as const);
}

/** A vault Close now can still act on. A waiting close displays `open` here. */
export function closeNowApplies(status: VaultDisplayStatus): boolean {
  return status === "open" || status === "closing";
}
