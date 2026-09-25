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
import { assertSafVaultPathRpcAvailable, safVaultPathRpcUnavailable } from "./safVaultRpcGuard";

/** Native → `upriv-ffi` vault list / create / import / config / rename / delete / export. */
export const nativeVaultService = createLiveVaultService({
  async listVaults() {
    if (safVaultPathRpcUnavailable()) return [];
    return rpcVaultList();
  },
  createVault(input: CreateVaultInput) {
    assertSafVaultPathRpcAvailable();
    return rpcVaultCreate(input);
  },
  async getSettings(vaultId) {
    assertSafVaultPathRpcAvailable();
    return rpcVaultConfigGet(vaultId);
  },
  async saveSettings(vaultId, config) {
    assertSafVaultPathRpcAvailable();
    await rpcVaultConfigSave(vaultId, config);
  },
  async rename(vaultId, displayName) {
    assertSafVaultPathRpcAvailable();
    return rpcVaultRename(vaultId, displayName);
  },
  async deleteVault(vaultId) {
    assertSafVaultPathRpcAvailable();
    await rpcVaultDelete(vaultId);
  },
  async exportVault(vaultId, request) {
    assertSafVaultPathRpcAvailable();
    return rpcVaultExport(vaultId, request);
  },
  async exportVaultToPath(vaultId, request, destPath) {
    assertSafVaultPathRpcAvailable();
    return rpcVaultExportToPath(vaultId, request, destPath);
  },
  async exportCapabilities() {
    assertSafVaultPathRpcAvailable();
    return rpcVaultExportCapabilities();
  },
  async probeExportPassword(vaultId, password) {
    assertSafVaultPathRpcAvailable();
    return rpcVaultExportProbe(vaultId, password);
  },
  importZip: (input) => {
    assertSafVaultPathRpcAvailable();
    return rpcVaultImportZip(input);
  },
  import7z: (input) => {
    assertSafVaultPathRpcAvailable();
    return rpcVaultImport7z(input);
  },
  recoverDirtyClose: async (vaultId) => {
    assertSafVaultPathRpcAvailable();
    await rpcVaultRecoverAck(vaultId);
  },
});
