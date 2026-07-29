import type { VaultRow } from "..";

/**
 * Cross-domain test helper (`*.shared.ts`): used by this module and/or other domains' tests.
 * Never put helpers that are only used inside this module here — use `fixtures.ts` instead.
 */
export function vaultRowFixture(overrides: Partial<VaultRow> = {}): VaultRow {
  return {
    id: "demo",
    displayName: "Demo",
    persistence: "closed",
    session: null,
    storageMode: "encrypted_dir",
    canSeal: true,
    ...overrides,
  };
}
