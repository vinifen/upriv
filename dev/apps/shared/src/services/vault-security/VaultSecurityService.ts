import type {
  KeyCopies,
  PasswordChangeFinishResult,
  PasswordChangeResult,
  UnlockRamChangeResult,
  VaultKeyStatus,
} from "../../domain/vault/keyChanges";
import type { VaultRebuildResult } from "../../domain/vault/rebuild";
import type { StorageChangeResult } from "../../domain/vault/storageChange";
import type { KdfUnlockPreset, VaultStorage } from "../../domain/vault-settings";

export interface ChangeVaultPasswordInput {
  currentPassword: string;
  newPassword: string;
  /** **Back up first**: a save of the vault as it is, when there is room for it. */
  backUpFirst: boolean;
  /** The job the change runs as (`newJobId`), so the person can stop it. */
  job: string;
}

export interface FinishPasswordChangeInput {
  password: string;
  /** The job Finish runs as (`newJobId`), so the person can stop it. */
  job: string;
}

export interface ChangeVaultKdfInput {
  currentPassword: string;
  nextPreset: KdfUnlockPreset;
  /** The job the change runs as (`newJobId`), so the person can stop it. */
  job: string;
}

export interface ChangeVaultStorageInput {
  password: string;
  storage: VaultStorage;
  /** The job the change runs as (`newJobId`), so the person can stop it. */
  job: string;
}

export interface RebuildVaultInput {
  password: string;
  /** The job the rebuild runs as (`newJobId`), so the person can stop it. */
  job: string;
}

/**
 * Password-gated vault operations, all inside `upriv-core` — never in the UI.
 * A wrong password must reject with `RpcError(VAULT_ERROR_CODES.WRONG_PASSWORD)`
 * so callers can map it through `errorDisplayI18nKey`.
 *
 * The changes and Finish need the vault closed. Each is a job: a stop before
 * its last step rejects with `job_cancelled` and leaves the vault as it was;
 * in that step `job_cancel` refuses (`job_not_stoppable`). A stop
 * during the pass that follows is not a cancel: the answer says the key copies
 * wait (`keyCopies: "waiting"`). Expo Go uses the mock, which does not touch
 * a real `store/`.
 */
export interface VaultSecurityService {
  /**
   * A new key, and every file rewritten with it (`vault_change_password`).
   * With `backUpFirst`, a save of the vault as it is comes first, when there
   * is room for it.
   */
  changePassword(vaultId: string, input: ChangeVaultPasswordInput): Promise<PasswordChangeResult>;
  /**
   * Rewrite the files an unfinished password change left on earlier keys
   * (`vault_password_change_finish`).
   */
  finishPasswordChange(
    vaultId: string,
    input: FinishPasswordChangeInput,
  ): Promise<PasswordChangeFinishResult>;
  /** A new Argon2id cost and salt for the same password and keys (`vault_change_kdf`). */
  changeKdfPreset(vaultId: string, input: ChangeVaultKdfInput): Promise<UnlockRamChangeResult>;
  /**
   * The vault's storage value sealed in its index with the password, then
   * copied to `config.toml` (`vault_change_storage`). No file is converted.
   * The value the copy already holds is refused before the password
   * (`storage_unchanged`).
   */
  changeStorage(vaultId: string, input: ChangeVaultStorageInput): Promise<StorageChangeResult>;
  /**
   * The job after each open (`vault_key_copies_update`): every file's key copy
   * made the header's, when one is behind. Answers `done` at once when nothing
   * is due.
   */
  updateKeyCopies(vaultId: string, job: string): Promise<KeyCopies>;
  /**
   * Where an open vault's keys stand (`vault_key_status`), read from its
   * session in RAM; null while it has no open session.
   */
  keyStatus(vaultId: string): Promise<VaultKeyStatus | null>;
  /**
   * Rebuild a closed vault from its files (`vault_rebuild`): the header from
   * their key copies, the list of files from their records and the backups. A
   * vault whose header and index open is refused (`vault_index_readable`).
   */
  rebuildIndex(vaultId: string, input: RebuildVaultInput): Promise<VaultRebuildResult>;
}
