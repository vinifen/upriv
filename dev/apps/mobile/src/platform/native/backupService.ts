import { createLiveBackupService } from "@upriv/shared";
import {
  rpcBackupDelete,
  rpcBackupExportStampsToPath,
  rpcBackupExportToPath,
  rpcBackupGet,
  rpcBackupList,
  rpcBackupPromote,
} from "@/lib/rpc";
import { assertSafVaultPathRpcAvailable } from "./safVaultRpcGuard";

/** Native → `upriv-ffi` `backup_*` (skipped on SAF trees). */
export const nativeBackupService = createLiveBackupService({
  async listBackups(vaultId) {
    assertSafVaultPathRpcAvailable();
    return rpcBackupList(vaultId);
  },
  async deleteBackups(vaultId, stamps) {
    assertSafVaultPathRpcAvailable();
    return rpcBackupDelete(vaultId, stamps);
  },
  async promoteToSave(vaultId, stamp) {
    assertSafVaultPathRpcAvailable();
    return rpcBackupPromote(vaultId, stamp);
  },
  async getBackupBytes(vaultId, stamp) {
    assertSafVaultPathRpcAvailable();
    return rpcBackupGet(vaultId, stamp);
  },
  async exportToPath(vaultId, stamp, destPath) {
    assertSafVaultPathRpcAvailable();
    return rpcBackupExportToPath(vaultId, stamp, destPath);
  },
  async exportSnapshotsToPath(vaultId, stamps, destPath) {
    assertSafVaultPathRpcAvailable();
    return rpcBackupExportStampsToPath(vaultId, stamps, destPath);
  },
});
