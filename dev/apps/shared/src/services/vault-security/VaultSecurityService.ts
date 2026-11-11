import type { VaultRebuildResult } from "../../domain/vault/rebuild";
import type { KdfUnlockPreset } from "../../domain/vault-settings";

export interface ChangeVaultPasswordInput {
  currentPassword: string;
  newPassword: string;
  /** The job the change runs as (`newJobId`), so the person can stop it. */
  job: string;
}

export interface ChangeVaultKdfInput {
  currentPassword: string;
  nextPreset: KdfUnlockPreset;
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
 * The vault must be closed. Each writes a copy of `store/` first and leaves
 * file blobs as they are. A stop before the header or index is written leaves
 * the vault as it was and rejects with `job_cancelled`; during that write,
 * `job_cancel` refuses (`job_not_stoppable`). Expo Go uses the mock, which
 * does not touch a real `store/`.
 */
export interface VaultSecurityService {
  /** Writes a backup zip of `store/`, then rewraps `vault.header` under a new password. */
  changePassword(vaultId: string, input: ChangeVaultPasswordInput): Promise<void>;
  /** Rewraps under new Argon2id cost; the vault must be closed. */
  changeKdfPreset(vaultId: string, input: ChangeVaultKdfInput): Promise<void>;
  /**
   * Pins a copy of `store/` in Backups, then seals a new index built from the
   * records the vault's blobs carry. Only for a vault whose index is lost
   * (`vault_index_unreadable`); one whose index opens is refused
   * (`vault_index_readable`).
   */
  rebuildIndex(vaultId: string, input: RebuildVaultInput): Promise<VaultRebuildResult>;
}
