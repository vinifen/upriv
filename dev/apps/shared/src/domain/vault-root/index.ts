export type {
  AppDistribution,
  IncompleteReplacePolicy,
  VaultRootBootstrapPrefs,
  VaultRootDirStatus,
  DefaultRootStatusResult,
  VaultRootAliasInfo,
  VaultRootInspectResult,
  VaultRootPresentationState,
  VaultRootResolveResult,
  VaultRootResolveSource,
} from "./types";
export { VAULT_ROOT_ALIAS_FILE } from "./types";
export { VAULT_ROOT_ERROR_CODES, isVaultRootErrorCode } from "./errors";
export type { VaultRootErrorCode } from "./errors";
export { VAULT_ROOT_ERROR_I18N_KEYS, vaultRootErrorI18nKey } from "./messages";
export type { VaultRootErrorI18nKey } from "./messages";
export {
  parseDefaultRootStatus,
  parseVaultRootInspect,
  parseVaultRootResolve,
} from "./parse";
export {
  VAULT_ROOT_GATE_IDLE,
  confirmNotesForReplacePolicy,
  isVaultRootDraftDirty,
  vaultRootGateFromState,
} from "./settingsIntent";
export type {
  VaultRootConfirmAction,
  VaultRootDiskStatus,
  VaultRootSettingsGate,
} from "./settingsIntent";
