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
  /** Corrupt `.upriv/vault_groups.toml` (list soft-fails with `invalid: true`; mutations may Err). */
  GROUPS_INVALID: "vault_groups_invalid",
  GROUP_NOT_FOUND: "vault_group_not_found",
  PLAIN_DESTINATION_INVALID: "plain_destination_invalid",
  PLAIN_LEFTOVER: "plain_leftover",
  /**
   * Another device still has a plain-text folder of this vault on record
   * (`details.device`, `details.system`, `details.path`): the vault cannot be deleted yet.
   */
  PLAIN_ELSEWHERE: "vault_plain_elsewhere",
  /** This device has no ID for this run: a plain-text vault does not open. */
  DEVICE_UNKNOWN: "device_unknown",
  PLAIN_NAMES_UNSUPPORTED: "plain_names_unsupported",
  PLAIN_SPACE_SHORT: "plain_space_short",
  PLAIN_FOLDER_UNWRITABLE: "plain_folder_unwritable",
  /** Config save refused while session open / mid-close (edit-policy quiet targets). */
  CONFIG_BUSY: "vault_config_busy",
  PATH_NOT_FOUND: "vault_path_not_found",
  PATH_EXISTS: "vault_path_exists",
  FILE_TOO_LARGE: "vault_file_too_large",
  /**
   * Part of a file's data is missing or damaged (`details.problem`). The file
   * stays in the vault, marked in the explorer; the rest of the vault works.
   */
  FILE_UNREADABLE: "vault_file_unreadable",
  /** No set-aside file of that name can be put back: it was put back or deleted already. */
  HELD_NOT_FOUND: "vault_held_not_found",
  /**
   * The password opened the header, but neither index file opens: the tree
   * is lost and the files are not. The unlock window offers the rebuild.
   */
  INDEX_UNREADABLE: "vault_index_unreadable",
  /** A rebuild was asked for a vault whose index opens. */
  INDEX_READABLE: "vault_index_readable",
  /** The copy a rebuild pins first does not fit (`details.needed`, `details.available`). */
  REBUILD_SPACE_SHORT: "vault_rebuild_space_short",
  VAULT_LOCKED: "vault_locked",
  MOUNT_FAILED: "vault_mount_failed",
  /** Windows directory mount needs NTFS or ReFS. exFAT and FAT cannot hold it. */
  MOUNT_FILESYSTEM: "vault_mount_filesystem",
  /** Dropped/picked `.zip` / `.7z` path is missing, relative, or unreadable. */
  IMPORT_ARCHIVE_NOT_FOUND: "import_archive_not_found",
  /** File-manager OS path is relative, missing, a symlink, or inside `store/`. */
  IMPORT_SOURCE_UNREADABLE: "import_source_unreadable",
  /** Export or rewrap of this vault refused while it is open or closing. */
  VAULT_MUST_BE_CLOSED: "vault_must_be_closed",
  /** Open refused while export, password change, or unlock-RAM change holds the vault. */
  VAULT_BUSY: "vault_busy",
  /** Safety zip failed, so the password change, unlock-RAM change, or rebuild changed nothing. */
  VAULT_BACKUP_FAILED: "vault_backup_failed",
  /** New password matches the current one. Not a broken vault header. */
  REWRAP_PASSWORD_UNCHANGED: "rewrap_password_unchanged",
  /** Unlock RAM preset matches the header. Not a broken vault header. */
  REWRAP_KDF_UNCHANGED: "rewrap_kdf_unchanged",
  /** A vault export or the data-folder export chose a folder inside a `.upriv`. */
  EXPORT_DESTINATION_RESERVED: "export_destination_reserved",
  /** Delete or pin of a backup a backup export is reading. */
  BACKUP_EXPORTING: "backup_exporting",
  /** A folder list change core cannot apply as it is (a row number or a selection it does not know). */
  FOLDER_LIST_INVALID: "folder_list_invalid",
  /** A row path this device's system cannot hold, or an empty one (`details.path`). */
  FOLDER_PATH_INVALID: "folder_path_invalid",
  /** A row path inside a `.upriv` (`details.path`). */
  FOLDER_PATH_RESERVED: "folder_path_reserved",
  /** A row path already in the group, or a fixed choice's folder (`details.path`). */
  FOLDER_PATH_DUPLICATE: "folder_path_duplicate",
  /** A row inside a folder Upriv makes for another list (`details.path`). */
  FOLDER_OVERLAP: "folder_overlap",
  /** An unlocked folder row a vault is open in cannot be deleted (`details.path`). */
  FOLDER_IN_USE: "folder_in_use",
  /**
   * A plain-text folder on record cannot be reached here (`details.device`,
   * `details.system`, `details.path`).
   */
  PLAIN_FOLDER_UNREACHABLE: "plain_folder_unreachable",
  /** A plain-text open with nothing selected on this device. */
  UNLOCKED_FOLDER_UNSET: "unlocked_folder_unset",
  /** No choice of the unlocked folder chain can take this vault (`details.path`). */
  UNLOCKED_FOLDER_UNAVAILABLE: "unlocked_folder_unavailable",
  /** FUSE or WinFsp is not installed. */
  MOUNT_DRIVER_MISSING: "vault_mount_driver_missing",
  /** No backup folder of the chain, the data folder included, can take the zip (`details.reason`). */
  BACKUP_UNAVAILABLE: "backup_unavailable",
  /** A backup name that is too long or holds only characters a system refuses. */
  BACKUP_NAME_INVALID: "backup_name_invalid",
} as const;

export type VaultErrorCode = (typeof VAULT_ERROR_CODES)[keyof typeof VAULT_ERROR_CODES];

const VAULT_ERROR_CODE_VALUES = new Set<string>(Object.values(VAULT_ERROR_CODES));

export function isVaultErrorCode(code: string): code is VaultErrorCode {
  return VAULT_ERROR_CODE_VALUES.has(code);
}
