import type { VaultSecurityService } from "@upriv/shared";
import { rpcVaultChangeKdf, rpcVaultChangePassword, rpcVaultRebuild } from "@/lib/rpc";

/** Native → `vault_change_password` / `vault_change_kdf` / `vault_rebuild`. */
export const nativeVaultSecurityService: VaultSecurityService = {
  changePassword(vaultId, input) {
    return rpcVaultChangePassword(vaultId, input.currentPassword, input.newPassword, input.job);
  },

  changeKdfPreset(vaultId, input) {
    return rpcVaultChangeKdf(vaultId, input.currentPassword, input.nextPreset, input.job);
  },

  rebuildIndex(vaultId, input) {
    return rpcVaultRebuild(vaultId, input.password, input.job);
  },
};
