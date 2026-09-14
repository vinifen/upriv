import type { KdfUnlockPreset } from "../../domain/vault-settings";

export interface ChangeVaultPasswordInput {
  currentPassword: string;
  newPassword: string;
}

export interface ChangeVaultKdfInput {
  currentPassword: string;
  nextPreset: KdfUnlockPreset;
}

/**
 * Password-gated vault operations. Both verify the password and rewrap the
 * master key inside `upriv-core` — never in the UI. A wrong password must
 * reject with `RpcError(VAULT_ERROR_CODES.WRONG_PASSWORD)` so callers can map
 * it through `errorDisplayI18nKey`.
 *
 * Live change-password / KDF change is **blocked** until SECURITY-CRYPTO
 * landmine P0 (v1 chunk AAD still binds salt). Use
 * `createUnavailableVaultSecurityService` in desktop/native factories — never
 * the mock that reports success without rewriting `contents/`.
 */
export interface VaultSecurityService {
  /** Rewraps `vault.header` + `contents/` under a new password. */
  changePassword(vaultId: string, input: ChangeVaultPasswordInput): Promise<void>;
  /** Rewraps under new Argon2id cost; the vault must be closed. */
  changeKdfPreset(vaultId: string, input: ChangeVaultKdfInput): Promise<void>;
}
