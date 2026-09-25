import { createLiveVaultService, type CreateVaultInput } from "@upriv/shared";
import {
  rpcVaultConfigGet,
  rpcVaultConfigSave,
  rpcVaultCreate,
  rpcVaultDelete,
  rpcVaultExport,
  rpcVaultExportCapabilities,
  rpcVaultExportProbe,
  rpcVaultExportToPath,
  rpcVaultImport7z,
  rpcVaultImportZip,
  rpcVaultList,
  rpcVaultRecoverAck,
  rpcVaultRename,
} from "@/lib/rpc";

/** Desktop → daemon vault list / create / import / config / rename / delete / export. */
export const desktopVaultService = createLiveVaultService({
  listVaults: () => rpcVaultList(),
  createVault: (input: CreateVaultInput) => rpcVaultCreate(input),
  getSettings: (vaultId) => rpcVaultConfigGet(vaultId),
  saveSettings: (vaultId, config) => rpcVaultConfigSave(vaultId, config),
  rename: (vaultId, displayName) => rpcVaultRename(vaultId, displayName),
  deleteVault: (vaultId) => rpcVaultDelete(vaultId),
  exportVault: (vaultId, request) => rpcVaultExport(vaultId, request),
  exportVaultToPath: (vaultId, request, destPath) =>
    rpcVaultExportToPath(vaultId, request, destPath),
  exportCapabilities: () => rpcVaultExportCapabilities(),
  probeExportPassword: (vaultId, password) => rpcVaultExportProbe(vaultId, password),
  importZip: (input) => rpcVaultImportZip(input),
  import7z: (input) => rpcVaultImport7z(input),
  recoverDirtyClose: (vaultId) => rpcVaultRecoverAck(vaultId),
});
