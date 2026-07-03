import type { VaultListItem, VaultService } from "@upriv/shared";
import { getMockVaultArchiveBytes } from "@/platform/mocks/data/vaultArchive";
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

/** Prototype vault service — delegates to in-memory mocks until desktop wiring. */
export const mockVaultService: VaultService = {
  async listVaults() {
    return structuredClone(MOCK_VAULTS).map(enrichPasswordHint);
  },

  async getSettings(vaultId) {
    return getMockVaultSettings(vaultId);
  },

  async registerSettings(_vaultId, config) {
    registerMockVaultSettings(config);
  },

  async unregisterSettings(vaultId) {
    unregisterMockVaultSettings(vaultId);
  },

  async getArchiveExportBytes(vault) {
    return getMockVaultArchiveBytes(vault);
  },
};
