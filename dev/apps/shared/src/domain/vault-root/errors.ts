/**
 * Vault-root discovery / setup wire codes from upriv-core / daemon.
 * Keep in sync with `upriv-daemon` `map_core_err` and locales.
 */
export const VAULT_ROOT_ERROR_CODES = {
  NOT_FOUND: "vault_root_not_found",
  INCOMPLETE: "vault_root_incomplete",
  ALIAS_INVALID: "vault_root_alias_invalid",
  IO_ERROR: "io_error",
} as const;

export type VaultRootErrorCode =
  (typeof VAULT_ROOT_ERROR_CODES)[keyof typeof VAULT_ROOT_ERROR_CODES];

const VAULT_ROOT_ERROR_CODE_VALUES = new Set<string>(Object.values(VAULT_ROOT_ERROR_CODES));

export function isVaultRootErrorCode(code: string): code is VaultRootErrorCode {
  return VAULT_ROOT_ERROR_CODE_VALUES.has(code);
}
