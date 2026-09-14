import {
  clearMockVaultUnlockPreset,
  getMockVaultUnlockPreset,
  setMockVaultUnlockPreset,
} from "@upriv/shared/testing";
import {
  DEFAULT_KDF_UNLOCK_PRESET,
  type CreateVaultInput,
  type VaultListItem,
  type VaultService,
} from "@upriv/shared";
import { mockVaultExportBytes } from "@upriv/shared/testing";
import {
  MOCK_VAULTS,
  registerMockVaultId,
  unregisterMockVaultId,
} from "@/platform/mocks/data/vaults";
import {
  getMockVaultSettings,
  registerMockVaultSettings,
  unregisterMockVaultSettings,
} from "@/platform/mocks/stores/vaultSettings";

function enrichPasswordHint(vault: VaultListItem): VaultListItem {
  const fromRow = vault.passwordHint?.trim();
  if (fromRow) return vault;
  const fromConfig = getMockVaultSettings(vault.id).vault.password_hint?.trim();
  return fromConfig ? { ...vault, passwordHint: fromConfig } : vault;
}

function listVaultWithPersistedOrder(vault: VaultListItem): VaultListItem {
  const settings = getMockVaultSettings(vault.id);
  return enrichPasswordHint({
    ...vault,
    order: settings.vault.order,
    hidden: settings.vault.hidden,
    unlockPreset: getMockVaultUnlockPreset(vault.id),
  });
}

const extraCreatedVaults: VaultListItem[] = [];

/** In-memory vault service for Vite browser / tests. Electron uses the daemon adapter. */
export const mockVaultService: VaultService = {
  canPersistSettings: true,
  canDeleteVault: true,
  canExportVault: true,

  async listVaults() {
    return [...structuredClone(MOCK_VAULTS), ...structuredClone(extraCreatedVaults)].map(
      listVaultWithPersistedOrder,
    );
  },

  async createVault(input: CreateVaultInput) {
    const id = input.settings.vault.id.trim();
    const settings = { ...input.settings, vault: { ...input.settings.vault, id } };
    registerMockVaultSettings(settings);
    const unlockPreset = input.unlockPreset ?? DEFAULT_KDF_UNLOCK_PRESET;
    setMockVaultUnlockPreset(id, unlockPreset);
    const item: VaultListItem = {
      id,
      displayName: settings.vault.display_name,
      session: null,
      storageMode: settings.storage.mode,
      order: settings.vault.order,
      lastAccessedWhen: "—",
      lastAccessedAt: new Date().toISOString(),
      note: settings.vault.note,
      passwordHint: settings.vault.password_hint || undefined,
      hidden: settings.vault.hidden,
      unlockPreset,
    };
    const existing = extraCreatedVaults.findIndex((row) => row.id === item.id);
    if (existing >= 0) extraCreatedVaults.splice(existing, 1);
    extraCreatedVaults.push(item);
    registerMockVaultId(item.id);
    return item;
  },

  async getSettings(vaultId) {
    return getMockVaultSettings(vaultId);
  },

  async registerSettings(_vaultId, config) {
    registerMockVaultSettings(config);
  },

  async unregisterSettings(vaultId) {
    unregisterMockVaultSettings(vaultId);
    clearMockVaultUnlockPreset(vaultId);
    const index = extraCreatedVaults.findIndex((row) => row.id === vaultId);
    if (index >= 0) extraCreatedVaults.splice(index, 1);
    unregisterMockVaultId(vaultId);
  },

  async getUnlockPreset(vaultId) {
    return getMockVaultUnlockPreset(vaultId);
  },

  async setUnlockPreset(vaultId, preset) {
    setMockVaultUnlockPreset(vaultId, preset);
  },

  async getExportBytes(vault, request) {
    return mockVaultExportBytes(vault, request);
  },
};
