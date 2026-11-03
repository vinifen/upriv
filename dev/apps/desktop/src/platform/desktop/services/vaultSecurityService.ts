import type { VaultSecurityService } from "@upriv/shared";
import { rpcVaultChangeKdf, rpcVaultChangePassword } from "@/lib/rpc";

/** Desktop → daemon `vault_change_password` / `vault_change_kdf`. */
export const desktopVaultSecurityService: VaultSecurityService = {
  changePassword(vaultId, input) {
    return rpcVaultChangePassword(vaultId, input.currentPassword, input.newPassword, input.job);
  },

  changeKdfPreset(vaultId, input) {
    return rpcVaultChangeKdf(vaultId, input.currentPassword, input.nextPreset, input.job);
  },
};
