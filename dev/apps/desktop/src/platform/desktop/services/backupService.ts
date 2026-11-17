import type { BackupService } from "@upriv/shared";
import {
  rpcBackupDelete,
  rpcBackupExport,
  rpcBackupFolderForget,
  rpcBackupList,
  rpcBackupPromote,
  rpcBackupRename,
  rpcBackupSave,
} from "@/lib/rpc";

/** Desktop → daemon `backup_*`. */
export const desktopBackupService: BackupService = {
  listBackups: (vaultId) => rpcBackupList(vaultId),
  deleteBackups: (vaultId, keys) => rpcBackupDelete(vaultId, keys),
  promoteToSave: (vaultId, key) => rpcBackupPromote(vaultId, key),
  renameBackup: (vaultId, key, name) => rpcBackupRename(vaultId, key, name),
  forgetFolder: (vaultId, folder) => rpcBackupFolderForget(vaultId, folder),
  saveNow: (vaultId, job) => rpcBackupSave(vaultId, job),
  exportTo: (vaultId, keys, destDir, job) => rpcBackupExport(vaultId, keys, destDir, job),
};
