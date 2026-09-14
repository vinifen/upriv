import { createLiveVaultService, type CreateVaultInput } from "@upriv/shared";
import { rpcVaultConfigGet, rpcVaultConfigSave, rpcVaultCreate, rpcVaultList } from "@/lib/rpc";
import { assertSafVaultPathRpcAvailable, safVaultPathRpcUnavailable } from "./safVaultRpcGuard";

/** Native → `upriv-ffi` vault list / create / config get+save. */
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
});
