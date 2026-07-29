import { createEmptyCreateVaultDraft } from "..";
import type { CreateVaultDraft } from "..";

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
