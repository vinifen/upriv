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
  /** Portable `.7z` export could not keep logical bytes in RAM. */
  INSUFFICIENT_RAM_EXPORT: "insufficient_ram_export",
  VAULT_STORE_INVALID: "vault_store_invalid",
  /** Change-password / KDF rewrap is not implemented. */
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
  PATH_NOT_FOUND: "vault_path_not_found",
  PATH_EXISTS: "vault_path_exists",
  FILE_TOO_LARGE: "vault_file_too_large",
  VAULT_LOCKED: "vault_locked",
  MOUNT_FAILED: "vault_mount_failed",
  /** Dropped/picked `.zip` / `.7z` path is missing, relative, or unreadable. */
  IMPORT_ARCHIVE_NOT_FOUND: "import_archive_not_found",
  /** File-manager OS path is relative, missing, a symlink, or inside `store/`. */
  IMPORT_SOURCE_UNREADABLE: "import_source_unreadable",
  /** Export of this vault refused while it is open or closing. */
  VAULT_MUST_BE_CLOSED: "vault_must_be_closed",
} as const;

export type VaultErrorCode = (typeof VAULT_ERROR_CODES)[keyof typeof VAULT_ERROR_CODES];

const VAULT_ERROR_CODE_VALUES = new Set<string>(Object.values(VAULT_ERROR_CODES));

export function isVaultErrorCode(code: string): code is VaultErrorCode {
  return VAULT_ERROR_CODE_VALUES.has(code);
}
