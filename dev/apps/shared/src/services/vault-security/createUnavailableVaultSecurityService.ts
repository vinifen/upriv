import { RpcError } from "../../domain/core-rpc/errors";
import { VAULT_ERROR_CODES } from "../../domain/vault/errors/codes";
import type { VaultSecurityService } from "./VaultSecurityService";

/**
 * Live desktop/native adapter. Change-password is not implemented. Must not
 * use `createMockVaultSecurityService` against a real `store/` (that mock
 * reports success without rewriting the store).
 */
export function createUnavailableVaultSecurityService(): VaultSecurityService {
  const fail = (): never => {
    throw new RpcError(
      VAULT_ERROR_CODES.REWRAP_UNAVAILABLE,
      "vault password / KDF change is not implemented",
    );
  };
  return {
    async changePassword() {
      fail();
    },
    async changeKdfPreset() {
      fail();
    },
  };
}
