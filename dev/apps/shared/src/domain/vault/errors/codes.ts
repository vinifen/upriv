/**
 * Vault wire codes from `upriv-rpc` (`map_core_err`).
 *
 * Mid-session integrity (vault layer): `vault_not_found` when the root is valid
 * but `vaults/<id>` is gone — do **not** reopen VaultRootGate (root still OK).
 * See AGENT.md § mid-session integrity.
 */
export const VAULT_ERROR_CODES = {
  /** Mapped in Rust `UprivError::VaultNotFound`. */
  NOT_FOUND: "vault_not_found",
  WRONG_PASSWORD: "wrong_password",
  VAULT_ALREADY_OPEN: "vault_already_open",
  VAULT_NOT_OPEN: "vault_not_open",
  VAULT_ALREADY_EXISTS: "vault_already_exists",
  VAULT_UNLOCK_BLOCKED: "vault_unlock_blocked",
  INSUFFICIENT_RAM: "insufficient_ram",
  VAULT_STORE_INVALID: "vault_store_invalid",
  /** Change-password / KDF rewrap blocked until SECURITY-CRYPTO landmine P0. */
  REWRAP_UNAVAILABLE: "vault_rewrap_unavailable",
  /** Corrupt `.upriv/vault_groups.toml` (list soft-fails with `invalid: true`; mutations may Err). */
  GROUPS_INVALID: "vault_groups_invalid",
  GROUP_NOT_FOUND: "vault_group_not_found",
  /** Android SAF tree is the active root — path `vault_*` RPCs must not run. */
  SAF_UNAVAILABLE: "vault_saf_unavailable",
  /** `upriv_plain` workspace extract/wipe is not implemented. */
  PLAIN_UNAVAILABLE: "upriv_plain_unavailable",
  /** Config save refused while session open / mid-close (edit-policy quiet targets). */
  CONFIG_BUSY: "vault_config_busy",
} as const;

export type VaultErrorCode = (typeof VAULT_ERROR_CODES)[keyof typeof VAULT_ERROR_CODES];

const VAULT_ERROR_CODE_VALUES = new Set<string>(Object.values(VAULT_ERROR_CODES));

export function isVaultErrorCode(code: string): code is VaultErrorCode {
  return VAULT_ERROR_CODE_VALUES.has(code);
}
