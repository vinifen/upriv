import {
  clearMockVaultUnlockPreset,
  getMockVaultUnlockPreset,
  setMockVaultUnlockPreset,
} from "@upriv/shared/testing";
import type { VaultListItem, VaultService } from "@upriv/shared";
import { mockVaultExportBytes } from "@upriv/shared/testing";
import { MOCK_VAULTS } from "@/platform/mocks/data/vaults";
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
  });
}

/** Prototype vault service — delegates to in-memory mocks until desktop wiring. */
export const mockVaultService: VaultService = {
  async listVaults() {
    return structuredClone(MOCK_VAULTS).map(listVaultWithPersistedOrder);
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
