export type {
  StorageMode,
  VaultDisplayStatus,
  VaultPersistence,
  VaultRow,
  VaultSession,
} from "./types";
export {
  STORAGE_MODES,
  assertPlainVaultInvariant,
  isVaultFileManagerEligible,
  resolveVaultCanSeal,
  resolveVaultDisplayStatus,
  resolveVaultListStatus,
  storageModeCanSeal,
  storageModeCloseOnly,
  storageModeHasClosedCache,
  storageModeHasPortableArchive,
  storageModeIsPlaintext,
  storageModeSealOnly,
} from "./types";
export type { VaultLifecycleIntent, VaultLifecycleRequest } from "./lifecycle";
export {
  canRunIdleAutoClose,
  requiresPasswordForLifecycle,
  resolveIdleAutoCloseIntent,
} from "./lifecycle";
export {
  VAULT_DISPLAY_NAME_MAX_LENGTH,
  VAULT_NOTE_MAX_LENGTH,
  VAULT_PASSWORD_HINT_MAX_LENGTH,
} from "./constants";
export {
  displayNameFromArchiveFilename,
  displayNameToVaultId,
  validateDisplayName,
  type DisplayNameValidationCode,
} from "./displayName";
export { displayNameErrorI18nKey, DISPLAY_NAME_ERROR_I18N_KEYS } from "./errors/nameMessages";
export type { DisplayNameErrorI18nKey } from "./errors/nameMessages";
export {
  brandColors,
  vaultStatusColorVar,
  vaultStatusI18nKey,
} from "./statusTokens";
/** Rust wire codes + UI i18n. */
export { isVaultErrorCode, VAULT_ERROR_CODES } from "./errors/codes";
export type { VaultErrorCode } from "./errors/codes";
export { requireVaultErrorI18nKey, vaultErrorI18nKey } from "./errors/messages";
export type { VaultErrorI18nKey } from "./errors/messages";
