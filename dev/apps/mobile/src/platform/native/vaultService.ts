import { createLiveVaultService, type CreateVaultInput } from "@upriv/shared";
import {
  rpcVaultConfigGet,
  rpcVaultConfigSave,
  rpcVaultCreate,
  rpcVaultList,
  rpcVaultRename,
} from "@/lib/rpc";
import { assertSafVaultPathRpcAvailable, safVaultPathRpcUnavailable } from "./safVaultRpcGuard";

/** Native → `upriv-ffi` vault list / create / config get+save / rename. */
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
});
