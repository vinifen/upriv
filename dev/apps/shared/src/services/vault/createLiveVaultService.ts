import { RpcError } from "../../domain/core-rpc/errors";
import type { VaultSettingsConfig } from "../../domain/vault-settings";
import type { CreateVaultInput, VaultRenameResult, VaultService } from "./VaultService";
import type { VaultExportRequest, VaultListItem } from "../../domain/vault-list";
import type { VaultRow } from "../../domain/vault";
import type { VaultPathWriteResult } from "../backup/createLiveBackupService";

function notImplemented(what: string): never {
  throw new RpcError("not_implemented", `${what} is not implemented`);
}

export interface LiveVaultRpc {
  listVaults: () => Promise<VaultListItem[]>;
  createVault: (input: CreateVaultInput) => Promise<VaultListItem>;
  getSettings: (vaultId: string) => Promise<VaultSettingsConfig | undefined>;
  /** Persist full `config.toml` via `vault_config_save` (enforces edit-policy). */
  saveSettings?: (vaultId: string, config: VaultSettingsConfig) => Promise<void>;
  /** Deep rename via `vault_rename` (display name + optional folder migration). */
  rename?: (vaultId: string, displayName: string) => Promise<VaultRenameResult>;
  deleteVault?: (vaultId: string) => Promise<void>;
  exportVault?: (vaultId: string, request: VaultExportRequest) => Promise<Uint8Array>;
  exportVaultToPath?: (
    vaultId: string,
    request: VaultExportRequest,
    destPath: string,
  ) => Promise<VaultPathWriteResult>;
  exportCapabilities?: () => Promise<{ sevenZip: boolean }>;
  probeExportPassword?: (vaultId: string, password: string) => Promise<boolean>;
  importZip?: (input: CreateVaultInput) => Promise<VaultListItem>;
  import7z?: (input: CreateVaultInput) => Promise<VaultListItem>;
  recoverDirtyClose?: (vaultId: string) => Promise<void>;
}

/** Shared live adapter — desktop daemon and native FFI pass their `rpc*` fns. */
export function createLiveVaultService(rpc: LiveVaultRpc): VaultService {
  const canPersist = typeof rpc.saveSettings === "function";
  const canDelete = typeof rpc.deleteVault === "function";
  const canExport = typeof rpc.exportVault === "function";
  return {
    canPersistSettings: canPersist,
    canDeleteVault: canDelete,
    canExportVault: canExport,

    listVaults: () => rpc.listVaults(),
    async createVault(input) {
      if (input.importPackage?.kind === "store_zip") {
        if (!rpc.importZip) notImplemented("Vault zip import");
        return rpc.importZip(input);
      }
      if (input.importPackage?.kind === "seven_zip") {
        if (!rpc.import7z) notImplemented("Vault 7z import");
        return rpc.import7z(input);
      }
      return rpc.createVault(input);
    },
    getSettings: (vaultId) => rpc.getSettings(vaultId),

    async registerSettings(vaultId, config) {
      if (!rpc.saveSettings) {
        notImplemented("Vault settings save");
      }
      await rpc.saveSettings(vaultId, config);
    },

    async rename(vaultId, displayName) {
      if (!rpc.rename) {
        notImplemented("Vault rename");
      }
      return rpc.rename(vaultId, displayName);
    },

    async unregisterSettings(vaultId) {
      if (!rpc.deleteVault) {
        notImplemented("Vault delete");
      }
      await rpc.deleteVault(vaultId);
    },

    async recoverDirtyClose(vaultId) {
      if (!rpc.recoverDirtyClose) {
        notImplemented("Vault recovery");
      }
      await rpc.recoverDirtyClose(vaultId);
    },

    async getUnlockPreset() {
      return undefined;
    },

    async setUnlockPreset() {
      notImplemented("Vault unlock preset change");
    },

    async getExportBytes(vault: VaultRow, request: VaultExportRequest) {
      if (!rpc.exportVault) {
        notImplemented("Vault export");
      }
      return rpc.exportVault(vault.id, request);
    },

    async exportToPath(vault: VaultRow, request: VaultExportRequest, destPath: string) {
      if (!rpc.exportVaultToPath) {
        notImplemented("Vault export");
      }
      return rpc.exportVaultToPath(vault.id, request, destPath);
    },

    async exportCapabilities() {
      if (!rpc.exportCapabilities) {
        return { sevenZip: false };
      }
      return rpc.exportCapabilities();
    },

    async probeExportPassword(vaultId, password) {
      if (!rpc.probeExportPassword) {
        notImplemented("Vault export password check");
      }
      return rpc.probeExportPassword(vaultId, password);
    },
  };
}
