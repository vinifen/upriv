import { RpcError } from "../../domain/core-rpc/errors";
import type { VaultSettingsConfig } from "../../domain/vault-settings";
import type { CreateVaultInput, VaultService } from "./VaultService";
import type { VaultListItem } from "../../domain/vault-list";

function notImplemented(what: string): never {
  throw new RpcError("not_implemented", `${what} is not implemented`);
}

export interface LiveVaultRpc {
  listVaults: () => Promise<VaultListItem[]>;
  createVault: (input: CreateVaultInput) => Promise<VaultListItem>;
  getSettings: (vaultId: string) => Promise<VaultSettingsConfig | undefined>;
  /** Persist full `config.toml` via `vault_config_save` (enforces edit-policy). */
  saveSettings?: (vaultId: string, config: VaultSettingsConfig) => Promise<void>;
}

/** Shared live adapter — desktop daemon and native FFI pass their `rpc*` fns. */
export function createLiveVaultService(rpc: LiveVaultRpc): VaultService {
  const canPersist = typeof rpc.saveSettings === "function";
  return {
    canPersistSettings: canPersist,
    canDeleteVault: false,
    canExportVault: false,

    listVaults: () => rpc.listVaults(),
    createVault: (input) => rpc.createVault(input),
    getSettings: (vaultId) => rpc.getSettings(vaultId),

    async registerSettings(vaultId, config) {
      if (!rpc.saveSettings) {
        notImplemented("Vault settings save");
      }
      await rpc.saveSettings(vaultId, config);
    },

    async unregisterSettings() {
      notImplemented("Vault delete");
    },

    async getUnlockPreset() {
      return undefined;
    },

    async setUnlockPreset() {
      notImplemented("Vault unlock preset change");
    },

    async getExportBytes() {
      notImplemented("Vault export");
    },
  };
}
