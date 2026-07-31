/**
 * Planned vault wire codes — not yet all implemented in upriv-daemon `rpc.rs`.
 * Add Rust handlers and locales in the same PR when porting vault RPCs.
 *
 * Mid-session integrity (vault layer): `vault_not_found` when the root is valid
 * but `vaults/<id>` is gone — do **not** reopen VaultRootGate (root still OK).
 * See AGENT.md § mid-session integrity.
 */
export const VAULT_ERROR_CODES = {
  /** Reserved — mapped in Rust `UprivError::VaultNotFound`; construct when vault_* RPCs land. */
  NOT_FOUND: "vault_not_found",
  WRONG_PASSWORD: "wrong_password",
  VAULT_ALREADY_OPEN: "vault_already_open",
  SYNC_MISMATCH: "sync_mismatch",
} as const;

export type VaultErrorCode = (typeof VAULT_ERROR_CODES)[keyof typeof VAULT_ERROR_CODES];

const VAULT_ERROR_CODE_VALUES = new Set<string>(Object.values(VAULT_ERROR_CODES));

export function isVaultErrorCode(code: string): code is VaultErrorCode {
  return VAULT_ERROR_CODE_VALUES.has(code);
}
