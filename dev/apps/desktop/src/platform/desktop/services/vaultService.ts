import { createLiveVaultService, type CreateVaultInput } from "@upriv/shared";
import { rpcVaultConfigGet, rpcVaultConfigSave, rpcVaultCreate, rpcVaultList } from "@/lib/rpc";

/** Desktop → daemon `vault_list` / `vault_create` / `vault_config_get` / `vault_config_save`. */
export const desktopVaultService = createLiveVaultService({
  listVaults: () => rpcVaultList(),
  createVault: (input: CreateVaultInput) => rpcVaultCreate(input),
  getSettings: (vaultId) => rpcVaultConfigGet(vaultId),
  saveSettings: (vaultId, config) => rpcVaultConfigSave(vaultId, config),
});
