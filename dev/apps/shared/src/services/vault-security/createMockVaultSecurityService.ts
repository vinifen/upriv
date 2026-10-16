import { RpcError } from "../../domain/core-rpc/errors";
import { delayMs } from "../../domain/timing/delay";
import { VAULT_ERROR_CODES } from "../../domain/vault/errors/codes";
import { setMockVaultUnlockPreset } from "../vault/mockVaultHeaderKdf";
import type { VaultSecurityService } from "./VaultSecurityService";

/**
 * Expo Go only. Reports success without rewriting `store/`. Live desktop and
 * native factories call `vault_change_password` / `vault_change_kdf`.
 */
const MOCK_WRONG_PASSWORD = "wrong";
const MOCK_CHANGE_PASSWORD_MS = 700;
const MOCK_CHANGE_KDF_MS = 900;

function rejectWrongPassword(password: string): void {
  if (password.trim() === MOCK_WRONG_PASSWORD) {
    throw new RpcError(VAULT_ERROR_CODES.WRONG_PASSWORD, "mock: wrong vault password");
  }
}

export interface MockVaultSecurityHooks {
  /** Expo Go stamps `password_changed_at` on the in-memory config. */
  onPasswordChanged?: (vaultId: string) => void;
}

export function createMockVaultSecurityService(
  hooks?: MockVaultSecurityHooks,
): VaultSecurityService {
  return {
    async changePassword(vaultId, input) {
      await delayMs(MOCK_CHANGE_PASSWORD_MS);
      rejectWrongPassword(input.currentPassword);
      hooks?.onPasswordChanged?.(vaultId);
    },
    async changeKdfPreset(vaultId, input) {
      await delayMs(MOCK_CHANGE_KDF_MS);
      rejectWrongPassword(input.currentPassword);
      setMockVaultUnlockPreset(vaultId, input.nextPreset);
    },
  };
}
