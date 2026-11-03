export type {
  StorageMode,
  VaultDeleteHold,
  VaultDisplayStatus,
  VaultPipelineListStatus,
  VaultRewrapKind,
  VaultRow,
  VaultRowStop,
  VaultRowWork,
  VaultSession,
} from "./types";
export {
  STORAGE_MODES,
  isVaultBlockingDataFolderChange,
  isVaultBlockingWorkspaceClear,
  isVaultFileManagerEligible,
  isVaultFileManagerRetained,
  isVaultListClosed,
  isVaultDisplayStatusQuiet,
  isVaultPipelineDisplayBusy,
  isVaultOpenCredentialResumeStatus,
  isVaultOpenResumeTarget,
  vaultCloseNowOffered,
  isVaultCloseQueued,
  isVaultListRowUnlockTarget,
  listHasVaultBlockingDataFolderChange,
  listHasVaultBlockingWorkspaceClear,
  resolveVaultDisplayStatus,
  resolveVaultListStatus,
  storageModeIsPlaintext,
  vaultDeleteHold,
  vaultRowJobWork,
  vaultRowWorkClock,
} from "./types";
export type { VaultLifecycleIntent, VaultLifecycleRequest } from "./lifecycle";
export { canRunIdleAutoClose } from "./lifecycle";
export type {
  IdleAutoCloseDecision,
  IdleAutoClosePlan,
  IdleAutoCloseTarget,
  IdleAutoCloseWarning,
  IdleLockResult,
  IdleVaultClock,
} from "./idleAutoClose";
export {
  applyIdleActivity,
  capIdleTimerMs,
  decideIdleAutoClose,
  IDLE_AUTO_CLOSE_MAX_TIMER_MS,
  IDLE_AUTO_CLOSE_MINUTES_MAX,
  IDLE_AUTO_CLOSE_MINUTES_MIN,
  IDLE_AUTO_CLOSE_WARN_SECONDS,
  idleLimitMs,
  idleWarnLeadMs,
  idleWarnLeadSeconds,
  idleWarningText,
  planIdleAutoClose,
  restartIdleClock,
  shiftIdleClocksForWake,
  syncIdleClocks,
} from "./idleAutoClose";
export {
  VAULT_DISPLAY_NAME_MAX_LENGTH,
  VAULT_NOTE_MAX_LENGTH,
  VAULT_PASSWORD_HINT_MAX_LENGTH,
} from "./constants";
export {
  backupVaultDisplayName,
  displayNameFromImportFilename,
  displayNameToVaultId,
  importDisplayNameFromFilename,
  suggestedImportDisplayName,
  suggestValidDisplayName,
  uniqueDisplayName,
  validateDisplayName,
  liveDisplayNameError,
  vaultDisplayLetters,
  type DisplayNameValidationCode,
} from "./displayName";
export { displayNameErrorI18nKey, DISPLAY_NAME_ERROR_I18N_KEYS } from "./errors/nameMessages";
export type { DisplayNameErrorI18nKey } from "./errors/nameMessages";
export {
  VAULT_DELETE_HOLD_I18N_KEY,
  vaultStatusColorVar,
  vaultStatusI18nKey,
  vaultStatusLabelKey,
} from "./statusTokens";
/** Rust wire codes + UI i18n. */
export { isVaultErrorCode, VAULT_ERROR_CODES } from "./errors/codes";
export type { VaultErrorCode } from "./errors/codes";
export {
  errorOnPasswordField,
  isVaultCredentialChallengeI18nKey,
  requireVaultErrorI18nKey,
  vaultErrorI18nKey,
} from "./errors/messages";
export type { VaultErrorI18nKey } from "./errors/messages";
