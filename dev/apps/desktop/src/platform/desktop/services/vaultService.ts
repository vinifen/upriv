import { createLiveVaultService, type CreateVaultInput } from "@upriv/shared";
import {
  rpcVaultConfigGet,
  rpcVaultConfigSave,
  rpcVaultCreate,
  rpcVaultDelete,
  rpcVaultExportCapabilities,
  rpcVaultExportProbe,
  rpcVaultExportToPath,
  rpcVaultImport7z,
  rpcVaultImportFilesZip,
  rpcVaultImportOsPath,
  rpcVaultImportZip,
  rpcVaultList,
  rpcVaultRename,
  rpcVaultStoreSize,
} from "@/lib/rpc";

/** Desktop → daemon vault list / create / import / config / rename / delete / export. */
export const desktopVaultService = createLiveVaultService({
  listVaults: () => rpcVaultList(),
  createVault: (input: CreateVaultInput) => rpcVaultCreate(input),
  getSettings: (vaultId) => rpcVaultConfigGet(vaultId),
  storeOnDiskBytes: (vaultId) => rpcVaultStoreSize(vaultId),
  saveSettings: (vaultId, config) => rpcVaultConfigSave(vaultId, config),
  rename: (vaultId, displayName) => rpcVaultRename(vaultId, displayName),
  deleteVault: (vaultId) => rpcVaultDelete(vaultId),
  exportVaultToPath: (vaultId, request, destPath, job) =>
    rpcVaultExportToPath(vaultId, request, destPath, job),
  exportCapabilities: () => rpcVaultExportCapabilities(),
  probeExportPassword: (vaultId, password) => rpcVaultExportProbe(vaultId, password),
  importZip: (input) => rpcVaultImportZip(input),
  import7z: (input) => rpcVaultImport7z(input),
  importFilesZip: (input) => rpcVaultImportFilesZip(input),
  importOsPath: (input) => rpcVaultImportOsPath(input),
});
