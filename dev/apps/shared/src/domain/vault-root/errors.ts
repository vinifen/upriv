import { RpcError, isRpcError } from "../core-rpc/errors";

/**
 * Vault-root discovery / setup wire codes from upriv-core / daemon.
 * Keep in sync with `upriv-daemon` `map_core_err` and locales.
 *
 * `io_error` is **transport** (disk full, permission on a valid root) — not Gate A/B.
 * Keep the constant for i18n / Gate lockout; do not treat it as integrity.
 */
export const VAULT_ROOT_ERROR_CODES = {
  NOT_FOUND: "vault_root_not_found",
  INCOMPLETE: "vault_root_incomplete",
  ALIAS_INVALID: "vault_root_alias_invalid",
  IO_ERROR: "io_error",
} as const;

export type VaultRootErrorCode =
  (typeof VAULT_ROOT_ERROR_CODES)[keyof typeof VAULT_ROOT_ERROR_CODES];

/** Mid-session A/B: missing / incomplete / alias — Gate must re-resolve. */
export type VaultRootIntegrityCode =
  | typeof VAULT_ROOT_ERROR_CODES.NOT_FOUND
  | typeof VAULT_ROOT_ERROR_CODES.INCOMPLETE
  | typeof VAULT_ROOT_ERROR_CODES.ALIAS_INVALID;

const VAULT_ROOT_INTEGRITY_CODES = new Set<string>([
  VAULT_ROOT_ERROR_CODES.NOT_FOUND,
  VAULT_ROOT_ERROR_CODES.INCOMPLETE,
  VAULT_ROOT_ERROR_CODES.ALIAS_INVALID,
]);

export function isVaultRootErrorCode(code: string): code is VaultRootIntegrityCode {
  return VAULT_ROOT_INTEGRITY_CODES.has(code);
}

/** Android SAF: lost persistable grant — treat like a dead custom alias (first-run Setup). */
const SAF_VAULT_ROOT_GONE_CODES = new Set(["saf_unauthorized", "saf_invalid_tree"]);

/**
 * Android SAF I/O that still needs Gate to re-resolve, but keep RAM prefs
 * (not first-run Setup). Write/create failures are not “folder gone”.
 */
const SAF_VAULT_ROOT_EPOCH_ONLY_CODES = new Set(["saf_write_failed", "saf_create_failed"]);

/**
 * Mid-session A/B (missing / incomplete / alias): Gate must re-resolve.
 * Transport `io_error` and case C (`vault_not_found`) do **not** bump epoch.
 * SAF lost-grant / write-create failures also bump so the Gate does not keep a dead tree.
 */
export function shouldBumpVaultRootEpoch(error: unknown): boolean {
  if (!isRpcError(error)) return false;
  if (isVaultRootErrorCode(error.code)) return true;
  return (
    SAF_VAULT_ROOT_GONE_CODES.has(error.code) || SAF_VAULT_ROOT_EPOCH_ONLY_CODES.has(error.code)
  );
}

/**
 * `.upriv` is gone (missing marker, or custom alias target no longer a vault-root).
 * Drop RAM prefs and show first-run Setup — not Repair, not alias Recovery.
 * Incomplete leftover is **not** gone (Repair). Lost SAF grant matches alias-invalid.
 */
export function isVaultRootGoneError(error: unknown): boolean {
  if (!isRpcError(error)) return false;
  return (
    error.code === VAULT_ROOT_ERROR_CODES.NOT_FOUND ||
    error.code === VAULT_ROOT_ERROR_CODES.ALIAS_INVALID ||
    SAF_VAULT_ROOT_GONE_CODES.has(error.code)
  );
}

/** Wire error for mid-session missing `.upriv` (toast `modal.vault_root_setup.lost`). */
export function vaultRootGoneRpcError(): RpcError {
  return new RpcError(VAULT_ROOT_ERROR_CODES.NOT_FOUND, "vault-root gone");
}
