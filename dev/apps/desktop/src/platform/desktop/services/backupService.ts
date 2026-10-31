import { createLiveBackupService } from "@upriv/shared";
import {
  rpcBackupDelete,
  rpcBackupExport,
  rpcBackupList,
  rpcBackupPromote,
  rpcBackupSave,
} from "@/lib/rpc";

/** Desktop → daemon `backup_*`. */
export const desktopBackupService = createLiveBackupService({
  listBackups: (vaultId) => rpcBackupList(vaultId),
  deleteBackups: (vaultId, stamps) => rpcBackupDelete(vaultId, stamps),
  promoteToSave: (vaultId, stamp) => rpcBackupPromote(vaultId, stamp),
  saveNow: (vaultId, job) => rpcBackupSave(vaultId, job),
  exportTo: (vaultId, keys, destDir, job) => rpcBackupExport(vaultId, keys, destDir, job),
});
