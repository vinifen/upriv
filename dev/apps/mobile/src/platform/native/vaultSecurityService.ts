import type { VaultSecurityService } from "@upriv/shared";
import {
  rpcVaultChangeKdf,
  rpcVaultChangePassword,
  rpcVaultChangeStorage,
  rpcVaultKeyCopiesUpdate,
  rpcVaultKeyStatus,
  rpcVaultPasswordChangeFinish,
  rpcVaultRebuild,
} from "@/lib/rpc";

/**
 * Native → `vault_change_password`, `vault_password_change_finish`,
 * `vault_change_kdf`, `vault_change_storage`, `vault_key_copies_update`,
 * `vault_key_status`, and `vault_rebuild`.
 */
export const nativeVaultSecurityService: VaultSecurityService = {
  changePassword(vaultId, input) {
    return rpcVaultChangePassword(vaultId, input);
  },

  finishPasswordChange(vaultId, input) {
    return rpcVaultPasswordChangeFinish(vaultId, input.password, input.job);
  },

  changeKdfPreset(vaultId, input) {
    return rpcVaultChangeKdf(vaultId, input.currentPassword, input.nextPreset, input.job);
  },

  changeStorage(vaultId, input) {
    return rpcVaultChangeStorage(vaultId, input.password, input.storage, input.job);
  },

  updateKeyCopies(vaultId, job) {
    return rpcVaultKeyCopiesUpdate(vaultId, job);
  },

  keyStatus(vaultId) {
    return rpcVaultKeyStatus(vaultId);
  },

  rebuildIndex(vaultId, input) {
    return rpcVaultRebuild(vaultId, input.password, input.job);
  },
};
