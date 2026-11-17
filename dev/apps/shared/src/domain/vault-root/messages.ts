import { VAULT_ROOT_ERROR_CODES, type VaultRootErrorCode } from "./errors";

/** User-facing i18n keys for data folder errors. */
export const VAULT_ROOT_ERROR_I18N_KEYS = {
  [VAULT_ROOT_ERROR_CODES.NOT_FOUND]: "modal.vault_root_setup.lost",
  [VAULT_ROOT_ERROR_CODES.INCOMPLETE]: "modal.vault_root_setup.error_incomplete",
  [VAULT_ROOT_ERROR_CODES.LIST_INVALID]: "modal.data_folder.list_invalid",
  [VAULT_ROOT_ERROR_CODES.UNAVAILABLE]: "modal.data_folder.unavailable",
  [VAULT_ROOT_ERROR_CODES.BUSY]: "modal.data_folder.blocked_vault_activity",
  [VAULT_ROOT_ERROR_CODES.UNREACHABLE]: "modal.vault_root_setup.error_unreachable",
  [VAULT_ROOT_ERROR_CODES.IO_ERROR]: "modal.vault_root_setup.error_io",
} as const;

export type VaultRootErrorI18nKey = (typeof VAULT_ROOT_ERROR_I18N_KEYS)[VaultRootErrorCode];

export function vaultRootErrorI18nKey(code: VaultRootErrorCode): VaultRootErrorI18nKey {
  return VAULT_ROOT_ERROR_I18N_KEYS[code];
}

/** True for a code this map turns into copy. */
export function isVaultRootMessageCode(code: string): code is VaultRootErrorCode {
  return code in VAULT_ROOT_ERROR_I18N_KEYS;
}
