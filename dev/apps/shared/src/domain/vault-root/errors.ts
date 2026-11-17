import { RpcError, isRpcError } from "../core-rpc/errors";

/**
 * Data folder wire codes from upriv-core. Keep in sync with `upriv-rpc`
 * `map_core_err` and locales.
 *
 * `io_error` is **transport** (disk full, permission on a valid root) — not Gate A/B.
 */
export const VAULT_ROOT_ERROR_CODES = {
  NOT_FOUND: "vault_root_not_found",
  INCOMPLETE: "vault_root_incomplete",
  /** The data folder list in the app home cannot be read as one. */
  LIST_INVALID: "data_folder_list_invalid",
  /** The folder the list selects cannot hold a data folder now (`details.reason`). */
  UNAVAILABLE: "data_folder_unavailable",
  /** A vault is busy: the data folder in use cannot change (not Gate A/B). */
  BUSY: "vault_root_busy",
  /** A phone's data folder answered that its drive is away, mid-operation. */
  UNREACHABLE: "vault_root_unreachable",
  IO_ERROR: "io_error",
} as const;

export type VaultRootErrorCode =
  (typeof VAULT_ROOT_ERROR_CODES)[keyof typeof VAULT_ROOT_ERROR_CODES];

/** Mid-session integrity: the Gate must resolve again. */
export type VaultRootIntegrityCode =
  | typeof VAULT_ROOT_ERROR_CODES.NOT_FOUND
  | typeof VAULT_ROOT_ERROR_CODES.INCOMPLETE
  | typeof VAULT_ROOT_ERROR_CODES.LIST_INVALID;

const VAULT_ROOT_INTEGRITY_CODES = new Set<string>([
  VAULT_ROOT_ERROR_CODES.NOT_FOUND,
  VAULT_ROOT_ERROR_CODES.INCOMPLETE,
  VAULT_ROOT_ERROR_CODES.LIST_INVALID,
]);

export function isVaultRootErrorCode(code: string): code is VaultRootIntegrityCode {
  return VAULT_ROOT_INTEGRITY_CODES.has(code);
}

/** A phone lost the grant of its data folder's tree. */
const SAF_VAULT_ROOT_GONE_CODES = new Set(["saf_unauthorized", "saf_invalid_tree"]);

/**
 * Mid-session A/B (missing / incomplete / an unreadable list): the Gate
 * must resolve again. Transport `io_error` and case C (`vault_not_found`) do
 * **not** bump the epoch. A lost phone grant and an unreachable data folder
 * bump it too.
 */
export function shouldBumpVaultRootEpoch(error: unknown): boolean {
  if (!isRpcError(error)) return false;
  if (isVaultRootErrorCode(error.code)) return true;
  if (error.code === VAULT_ROOT_ERROR_CODES.UNREACHABLE) return true;
  return SAF_VAULT_ROOT_GONE_CODES.has(error.code);
}

/**
 * The data folder in use is gone (case B): the in-memory preferences reset,
 * and the Gate resolves again. The selection stays, so the Gate shows the
 * list while a search looks for a data folder that answers. An incomplete
 * leftover is **not** gone (Repair).
 */
export function isVaultRootGoneError(error: unknown): boolean {
  if (!isRpcError(error)) return false;
  return (
    error.code === VAULT_ROOT_ERROR_CODES.NOT_FOUND || SAF_VAULT_ROOT_GONE_CODES.has(error.code)
  );
}

/** Wire error for mid-session missing `.upriv` (toast `modal.vault_root_setup.lost`). */
export function vaultRootGoneRpcError(): RpcError {
  return new RpcError(VAULT_ROOT_ERROR_CODES.NOT_FOUND, "data folder gone");
}
