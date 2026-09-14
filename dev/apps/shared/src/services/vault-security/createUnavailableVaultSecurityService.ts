import { RpcError } from "../../domain/core-rpc/errors";
import { VAULT_ERROR_CODES } from "../../domain/vault/errors/codes";
import type { VaultSecurityService } from "./VaultSecurityService";

/**
 * Live desktop/native adapter until landmine P0 is fixed: v1 chunk AAD still
 * binds KDF salt/`m`/`t`/`p`, so a real rewrap that rotates salt would break
 * files. Must not use `createMockVaultSecurityService` against a real `contents/`
 * (that mock reports success without rewriting the store).
 */
export function createUnavailableVaultSecurityService(): VaultSecurityService {
  const fail = (): never => {
    throw new RpcError(
      VAULT_ERROR_CODES.REWRAP_UNAVAILABLE,
      "vault password / KDF change is not available until chunk AAD no longer binds salt",
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
