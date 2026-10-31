import { LOADING_BUDGET_MS, createLiveBackupService } from "@upriv/shared";
import {
  rpcBackupDelete,
  rpcBackupExport,
  rpcBackupList,
  rpcBackupPromote,
  rpcBackupSave,
} from "@/lib/rpc";
import { nativeSafExportMount } from "./safExportMount";

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
  async saveNow(vaultId, job) {
    return rpcBackupSave(vaultId, job);
  },
  // A picked folder is mounted for the export, so Rust writes the file straight into it.
  async exportTo(vaultId, keys, destDir, job) {
    return nativeSafExportMount.withExportFolder(
      destDir,
      job,
      LOADING_BUDGET_MS.backupExport,
      (dir) => rpcBackupExport(vaultId, keys, dir, job),
    );
  },
});
