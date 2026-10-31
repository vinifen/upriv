import { buildCreateVaultResult, createEmptyCreateVaultDraft } from "..";
import type { CreateVaultDraft } from "..";
import type { VaultSettingsConfig } from "../../vault-settings";

export function createVaultDraftFixture(
  existingOrders: readonly number[] = [],
  overrides: Partial<CreateVaultDraft> = {},
): CreateVaultDraft {
  return {
    ...createEmptyCreateVaultDraft(existingOrders),
    source: "scratch",
    displayName: "My Vault",
    password: "secret-pass",
    passwordConfirm: "secret-pass",
    ...overrides,
  };
}

/** The settings a default draft would save. */
export function vaultSettingsFixture(): VaultSettingsConfig {
  return buildCreateVaultResult(createVaultDraftFixture(), []).settings;
}
