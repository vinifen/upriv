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
import { nativeExportTrees } from "./exportTrees";

/** Native → `upriv-ffi` `backup_*`. */
export const nativeBackupService: BackupService = {
  listBackups: (vaultId) => rpcBackupList(vaultId),
  deleteBackups: (vaultId, keys) => rpcBackupDelete(vaultId, keys),
  promoteToSave: (vaultId, key) => rpcBackupPromote(vaultId, key),
  renameBackup: (vaultId, key, name) => rpcBackupRename(vaultId, key, name),
  forgetFolder: (vaultId, folder) => rpcBackupFolderForget(vaultId, folder),
  saveNow: (vaultId, job) => rpcBackupSave(vaultId, job),
  // A picked folder is reached at its tree's root, so Rust writes the file straight into it.
  exportTo: (vaultId, keys, destDir, job) =>
    nativeExportTrees.withExportFolder(destDir, job, (dir) =>
      rpcBackupExport(vaultId, keys, dir, job),
    ),
};
