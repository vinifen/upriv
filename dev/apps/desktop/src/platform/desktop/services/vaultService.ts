import { createLiveVaultService, type CreateVaultInput } from "@upriv/shared";
import {
  rpcVaultConfigGet,
  rpcVaultConfigSave,
  rpcVaultCreate,
  rpcVaultDelete,
  rpcVaultExportCapabilities,
  rpcVaultExportToFolder,
  rpcVaultUnfinishedSweep,
  rpcVaultImport7z,
  rpcVaultImportFilesZip,
  rpcVaultImportOsPath,
  rpcVaultImportZip,
  rpcVaultList,
  rpcVaultRename,
  rpcVaultDiskUsage,
} from "@/lib/rpc";

/** Desktop → daemon vault list / create / import / config / rename / delete / export. */
export const desktopVaultService = createLiveVaultService({
  listVaults: () => rpcVaultList(),
  createVault: (input: CreateVaultInput, job) => rpcVaultCreate(input, job),
  getSettings: (vaultId) => rpcVaultConfigGet(vaultId),
  diskUsage: (vaultId) => rpcVaultDiskUsage(vaultId),
  saveSettings: (vaultId, config) => rpcVaultConfigSave(vaultId, config),
  rename: (vaultId, displayName) => rpcVaultRename(vaultId, displayName),
  deleteVault: (vaultId, outsideBackups) => rpcVaultDelete(vaultId, outsideBackups),
  exportVaultToFolder: (vaultId, request, destDir, job) =>
    rpcVaultExportToFolder(vaultId, request, destDir, job),
  exportCapabilities: () => rpcVaultExportCapabilities(),
  sweepUnfinished: async () => {
    await rpcVaultUnfinishedSweep();
  },
  importZip: (input, job) => rpcVaultImportZip(input, job),
  import7z: (input, job) => rpcVaultImport7z(input, job),
  importFilesZip: (input, job) => rpcVaultImportFilesZip(input, job),
  importOsPath: (input, job) => rpcVaultImportOsPath(input, job),
});
