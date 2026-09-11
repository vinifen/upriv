import { createMockVaultGroupService } from "@upriv/shared/testing";
import { knownMockVaultIds, resetMockVaultIds } from "../data/vaults";
import { MOCK_VAULT_GROUPS } from "../data/vaultGroups";
import { getMockVaultSettings, registerMockVaultSettings } from "../stores/vaultSettings";

let onGroupHiddenLog: (() => void) | undefined;

export function setMockVaultGroupHiddenLogger(fn: (() => void) | undefined) {
  onGroupHiddenLog = fn;
}

function setMockVaultsHidden(vaultIds: readonly string[], hidden: boolean) {
  for (const id of vaultIds) {
    const settings = getMockVaultSettings(id);
    if (settings.vault.hidden === hidden) continue;
    registerMockVaultSettings({
      ...settings,
      vault: { ...settings.vault, hidden },
    });
  }
}

const mockGroups = createMockVaultGroupService({
  getKnownVaultIds: () => knownMockVaultIds(),
  initialGroups: MOCK_VAULT_GROUPS,
  hideVaults: (ids) => setMockVaultsHidden(ids, true),
  unhideVaults: (ids) => setMockVaultsHidden(ids, false),
  onGroupHidden: () => onGroupHiddenLog?.(),
});

/** In-memory vault groups for browser / until CORE RPC adapters land. */
export const mockVaultGroupService = mockGroups.service;

/** Test/dev helper to simulate a corrupt groups file. */
export function setMockVaultGroupsInvalid(next: boolean) {
  mockGroups.setInvalid(next);
}

export function resetMockVaultGroups() {
  mockGroups.reset(MOCK_VAULT_GROUPS);
  resetMockVaultIds();
}
