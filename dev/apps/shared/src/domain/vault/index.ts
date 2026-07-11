export type {
  StorageMode,
  VaultDisplayStatus,
  VaultPersistence,
  VaultRow,
  VaultSession,
} from "./types";
export {
  assertPlainVaultInvariant,
  isVaultFileManagerEligible,
  resolveVaultCanSeal,
  resolveVaultDisplayStatus,
  resolveVaultListStatus,
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
export {
  brandColors,
  vaultStatusColorVar,
  vaultStatusI18nKey,
} from "./statusTokens";
/** Rust wire codes + UI i18n. Name maps live in `errors/nameMessages.ts` (internal to this domain). */
export { VAULT_ERROR_CODES } from "./errors/codes";
export type { VaultErrorCode } from "./errors/codes";
export { requireVaultErrorI18nKey, vaultErrorI18nKey } from "./errors/messages";
export type { VaultErrorI18nKey } from "./errors/messages";
