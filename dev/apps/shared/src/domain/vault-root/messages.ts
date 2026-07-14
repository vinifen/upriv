import { VAULT_ROOT_ERROR_CODES, type VaultRootErrorCode } from "./errors";

/** User-facing i18n keys for vault-root setup / discovery errors. */
export const VAULT_ROOT_ERROR_I18N_KEYS = {
  [VAULT_ROOT_ERROR_CODES.NOT_FOUND]: "modal.vault_root_setup.error_not_found",
  [VAULT_ROOT_ERROR_CODES.INCOMPLETE]: "modal.vault_root_setup.error_incomplete",
  [VAULT_ROOT_ERROR_CODES.ALIAS_INVALID]: "modal.vault_root_setup.error_alias_invalid",
  [VAULT_ROOT_ERROR_CODES.IO_ERROR]: "modal.vault_root_setup.error_io",
} as const;

export type VaultRootErrorI18nKey =
  (typeof VAULT_ROOT_ERROR_I18N_KEYS)[VaultRootErrorCode];

export function vaultRootErrorI18nKey(code: VaultRootErrorCode): VaultRootErrorI18nKey {
  return VAULT_ROOT_ERROR_I18N_KEYS[code];
}
