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

/**
 * Password-gated vault operations. Both verify the password and rewrap the
 * master key inside `upriv-core` — never in the UI. A wrong password must
 * reject with `RpcError(VAULT_ERROR_CODES.WRONG_PASSWORD)` so callers can map
 * it through `errorDisplayI18nKey`.
 *
 * The vault must be closed. File blobs stay; the header and the name index
 * are resealed. A stop before that reseal leaves the vault as it was and
 * rejects with `job_cancelled`; during it, `job_cancel` refuses
 * (`job_not_stoppable`). Expo Go uses the mock, which does not touch a real
 * `store/`.
 */
export interface VaultSecurityService {
  /** Writes a backup zip of `store/`, then rewraps `vault.header` under a new password. */
  changePassword(vaultId: string, input: ChangeVaultPasswordInput): Promise<void>;
  /** Rewraps under new Argon2id cost; the vault must be closed. */
  changeKdfPreset(vaultId: string, input: ChangeVaultKdfInput): Promise<void>;
}
