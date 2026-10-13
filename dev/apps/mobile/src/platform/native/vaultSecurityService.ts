import type { VaultSecurityService } from "@upriv/shared";
import { rpcVaultChangeKdf, rpcVaultChangePassword } from "@/lib/rpc";

/** Native → `vault_change_password` / `vault_change_kdf`. */
export const nativeVaultSecurityService: VaultSecurityService = {
  changePassword(vaultId, input) {
    return rpcVaultChangePassword(vaultId, input.currentPassword, input.newPassword);
  },

  changeKdfPreset(vaultId, input) {
    return rpcVaultChangeKdf(vaultId, input.currentPassword, input.nextPreset);
  },
};
