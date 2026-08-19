import { createMockVaultGroupService } from "@upriv/shared";
import { knownMockVaultIds, resetMockVaultIds } from "../data/vaults";
import { MOCK_VAULT_GROUPS } from "../data/vaultGroups";

const mockGroups = createMockVaultGroupService({
  getKnownVaultIds: () => knownMockVaultIds(),
  initialGroups: MOCK_VAULT_GROUPS,
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
