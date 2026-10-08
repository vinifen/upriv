import { createLiveBackupService } from "@upriv/shared";
import {
  rpcBackupDelete,
  rpcBackupExportStampsToPath,
  rpcBackupExportToPath,
  rpcBackupGet,
  rpcBackupList,
  rpcBackupPromote,
} from "@/lib/rpc";

/** Native → `upriv-ffi` `backup_*` (skipped on SAF trees). */
export const nativeBackupService = createLiveBackupService({
  async listBackups(vaultId) {
    return rpcBackupList(vaultId);
  },
  async deleteBackups(vaultId, stamps) {
    return rpcBackupDelete(vaultId, stamps);
  },
  async promoteToSave(vaultId, stamp) {
    return rpcBackupPromote(vaultId, stamp);
  },
  async getBackupBytes(vaultId, stamp) {
    return rpcBackupGet(vaultId, stamp);
  },
  async exportToPath(vaultId, stamp, destPath) {
    return rpcBackupExportToPath(vaultId, stamp, destPath);
  },
  async exportSnapshotsToPath(vaultId, stamps, destPath) {
    return rpcBackupExportStampsToPath(vaultId, stamps, destPath);
  },
});
