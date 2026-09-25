import { RpcError } from "../../domain/core-rpc/errors";
import { delayMs } from "../../domain/timing/delay";
import { VAULT_ERROR_CODES } from "../../domain/vault/errors/codes";
import type { VaultSecurityService } from "./VaultSecurityService";

/**
 * Prototype UI only. Live desktop/native must use
 * `createUnavailableVaultSecurityService`. This mock reports success without
 * rewriting `store/` — never wire it against a real vault.
 */
const MOCK_WRONG_PASSWORD = "wrong";
const MOCK_CHANGE_PASSWORD_MS = 700;
const MOCK_CHANGE_KDF_MS = 900;

function rejectWrongPassword(password: string): void {
  if (password.trim() === MOCK_WRONG_PASSWORD) {
    throw new RpcError(VAULT_ERROR_CODES.WRONG_PASSWORD, "mock: wrong vault password");
  }
}

export function createMockVaultSecurityService(): VaultSecurityService {
  return {
    async changePassword(_vaultId, input) {
      await delayMs(MOCK_CHANGE_PASSWORD_MS);
      rejectWrongPassword(input.currentPassword);
    },
    async changeKdfPreset(_vaultId, input) {
      await delayMs(MOCK_CHANGE_KDF_MS);
      rejectWrongPassword(input.currentPassword);
    },
  };
}
