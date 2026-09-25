import { createLiveBackupService } from "@upriv/shared";
import {
  rpcBackupDelete,
  rpcBackupExportStampsToPath,
  rpcBackupExportToPath,
  rpcBackupGet,
  rpcBackupList,
  rpcBackupPromote,
} from "@/lib/rpc";

/** Desktop → daemon `backup_*`. */
export const desktopBackupService = createLiveBackupService({
  listBackups: (vaultId) => rpcBackupList(vaultId),
  deleteBackups: (vaultId, stamps) => rpcBackupDelete(vaultId, stamps),
  promoteToSave: (vaultId, stamp) => rpcBackupPromote(vaultId, stamp),
  getBackupBytes: (vaultId, stamp) => rpcBackupGet(vaultId, stamp),
  exportToPath: (vaultId, stamp, destPath) => rpcBackupExportToPath(vaultId, stamp, destPath),
  exportSnapshotsToPath: (vaultId, stamps, destPath) =>
    rpcBackupExportStampsToPath(vaultId, stamps, destPath),
});
