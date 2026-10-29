/** On-disk event when a vault is marked hidden. Never attach id or display name. */
export const VAULT_HIDDEN_LOG_EVENT = "vault_hidden" as const;

/** On-disk event when a group is marked hidden. Never attach id or display name. */
export const VAULT_GROUP_HIDDEN_LOG_EVENT = "vault_group_hidden" as const;

/** Renderer/native crash recovered by an Error Boundary. No extra fields. */
export const UI_CRASH_LOG_EVENT = "ui_crash" as const;

/** OS picker cache wipe failed. No URI or path fields. */
export const IMPORT_CACHE_WIPE_FAILED_LOG_EVENT = "import_cache_wipe_failed" as const;

export const ALLOWLISTED_UI_LOG_EVENTS = [
  VAULT_HIDDEN_LOG_EVENT,
  VAULT_GROUP_HIDDEN_LOG_EVENT,
  UI_CRASH_LOG_EVENT,
  IMPORT_CACHE_WIPE_FAILED_LOG_EVENT,
] as const;

export type AllowlistedUiLogEvent = (typeof ALLOWLISTED_UI_LOG_EVENTS)[number];

export function shouldRecordVaultHidden(
  wasHidden: boolean | undefined,
  isHidden: boolean | undefined,
): boolean {
  return Boolean(isHidden) && !wasHidden;
}
