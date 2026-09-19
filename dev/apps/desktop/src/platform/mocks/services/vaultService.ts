import {
  clearMockVaultUnlockPreset,
  getMockVaultUnlockPreset,
  mockVaultExportBytes,
  remapVaultWorkspaceSnapshot,
  setMockVaultUnlockPreset,
} from "@upriv/shared/testing";
import {
  DEFAULT_KDF_UNLOCK_PRESET,
  displayNameToVaultId,
  normalizeStoredName,
  type CreateVaultInput,
  type VaultListItem,
  type VaultRenameResult,
  type VaultService,
} from "@upriv/shared";
import {
  listMockVaultSeedRows,
  registerMockVaultId,
  registerRemappedMockSeedVault,
  removeRemappedMockSeedVault,
  suppressMockSeedVaultId,
  unregisterMockVaultId,
} from "@/platform/mocks/data/vaults";
import { getMockAppSettings, replaceMockAppSettings } from "@/platform/mocks/data/appSettings";
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

async function mockRename(vaultId: string, displayName: string): Promise<VaultRenameResult> {
  const trimmed = normalizeStoredName(displayName);
  const listed = await mockVaultService.listVaults();
  const existing = listed.map((row) => row.id).filter((id) => id !== vaultId);
  const newId = displayNameToVaultId(trimmed, existing);
  const idChanged = newId !== vaultId;
  const settings = getMockVaultSettings(vaultId);
  const nextSettings = {
    ...settings,
    vault: { ...settings.vault, id: newId, display_name: trimmed },
  };

  if (idChanged) {
    remapVaultWorkspaceSnapshot(vaultId, newId);
    const app = getMockAppSettings();
    if (app.app.last_opened_vault.trim() === vaultId) {
      replaceMockAppSettings({
        ...app,
        app: { ...app.app, last_opened_vault: newId },
      });
    }
    const preset = getMockVaultUnlockPreset(vaultId);
    unregisterMockVaultSettings(vaultId);
    clearMockVaultUnlockPreset(vaultId);
    unregisterMockVaultId(vaultId);

    const createdIdx = extraCreatedVaults.findIndex((row) => row.id === vaultId);
    if (createdIdx >= 0) {
      extraCreatedVaults[createdIdx] = {
        ...extraCreatedVaults[createdIdx],
        id: newId,
        displayName: trimmed,
      };
      registerMockVaultId(newId);
    } else {
      const seed = listMockVaultSeedRows().find((row) => row.id === vaultId);
      removeRemappedMockSeedVault(vaultId);
      suppressMockSeedVaultId(vaultId);
      registerRemappedMockSeedVault({
        ...(seed ?? {
          id: vaultId,
          displayName: trimmed,
          session: null,
          storageMode: settings.storage.mode,
          order: settings.vault.order,
          lastAccessedWhen: "—",
          lastAccessedAt: new Date().toISOString(),
          note: settings.vault.note,
          hidden: settings.vault.hidden,
        }),
        id: newId,
        displayName: trimmed,
      });
    }
    if (preset) setMockVaultUnlockPreset(newId, preset);
  } else {
    const createdIdx = extraCreatedVaults.findIndex((row) => row.id === vaultId);
    if (createdIdx >= 0) {
      extraCreatedVaults[createdIdx] = {
        ...extraCreatedVaults[createdIdx],
        displayName: trimmed,
      };
    }
  }

  registerMockVaultSettings(nextSettings);
  return {
    id: newId,
    previousId: vaultId,
    displayName: trimmed,
    idChanged,
  };
}

/** In-memory vault service for Vite browser / tests. Electron uses the daemon adapter. */
export const mockVaultService: VaultService = {
  canPersistSettings: true,
  canDeleteVault: true,
  canExportVault: true,

  async listVaults() {
    return [...listMockVaultSeedRows(), ...structuredClone(extraCreatedVaults)].map(
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

  rename: mockRename,

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
