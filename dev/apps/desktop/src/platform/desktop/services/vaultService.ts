import { createLiveVaultService, type CreateVaultInput } from "@upriv/shared";
import {
  rpcVaultConfigGet,
  rpcVaultConfigSave,
  rpcVaultCreate,
  rpcVaultList,
  rpcVaultRename,
} from "@/lib/rpc";

/** Desktop → daemon `vault_list` / `vault_create` / `vault_config_*` / `vault_rename`. */
export const desktopVaultService = createLiveVaultService({
  listVaults: () => rpcVaultList(),
  createVault: (input: CreateVaultInput) => rpcVaultCreate(input),
  getSettings: (vaultId) => rpcVaultConfigGet(vaultId),
  saveSettings: (vaultId, config) => rpcVaultConfigSave(vaultId, config),
  rename: (vaultId, displayName) => rpcVaultRename(vaultId, displayName),
});
