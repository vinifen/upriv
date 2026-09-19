import type { VaultListItem } from "@upriv/shared";

/** Demo vaults — same shape as desktop browser mocks. Mutated by create flows in mocks. */
export const MOCK_VAULTS: VaultListItem[] = [
  {
    id: "my-encrypted-notes",
    displayName: "My Encrypted Notes",
    session: "open",
    storageMode: "encrypted_dir",
    order: 1,
    lastAccessedWhen: "2m ago",
    lastAccessedAt: "2026-06-02T11:58:00Z",
    note: "Daily scratch pad — sync after laptop backup.",
  },
  {
    id: "vault-example-2",
    displayName: "Vault ExaMple 2",
    session: null,
    storageMode: "encrypted_dir",
    order: 2,
    lastAccessedWhen: "2 days ago",
    lastAccessedAt: "2026-05-31T10:00:00Z",
    note: "Mock demo: unlock with gatefail, then lock to see the header test error.",
  },
  {
    id: "cold-storage",
    displayName: "Cold Storage",
    session: null,
    storageMode: "encrypted_dir",
    order: 3,
    lastAccessedWhen: "14 days ago",
    lastAccessedAt: "2026-05-19T08:00:00Z",
    note: "",
  },
  {
    id: "personal-photos",
    displayName: "Personal Photos",
    session: null,
    storageMode: "encrypted_dir",
    order: 4,
    lastAccessedWhen: "2 days ago",
    lastAccessedAt: "2026-05-31T14:30:00Z",
    note: "RAW exports only; JPEG previews live elsewhere.",
  },
  {
    id: "work-documents",
    displayName: "Work Documents",
    session: "open",
    storageMode: "encrypted_dir",
    order: 5,
    lastAccessedWhen: "1h ago",
    lastAccessedAt: "2026-06-02T11:00:00Z",
    note: "",
  },
];

/** Wizard-created vaults live in React state, not `MOCK_VAULTS`. */
const extraMockVaultIds = new Set<string>();
/** Seed vaults whose folder id was remapped by mock `rename`. */
const suppressedSeedVaultIds = new Set<string>();
const remappedSeedVaults: VaultListItem[] = [];

export function registerMockVaultId(id: string): void {
  const trimmed = id.trim();
  if (trimmed) extraMockVaultIds.add(trimmed);
}

export function unregisterMockVaultId(id: string): void {
  extraMockVaultIds.delete(id.trim());
}

export function suppressMockSeedVaultId(id: string): void {
  const trimmed = id.trim();
  if (trimmed) suppressedSeedVaultIds.add(trimmed);
}

export function removeRemappedMockSeedVault(id: string): void {
  const idx = remappedSeedVaults.findIndex((row) => row.id === id.trim());
  if (idx >= 0) remappedSeedVaults.splice(idx, 1);
}

export function registerRemappedMockSeedVault(vault: VaultListItem): void {
  removeRemappedMockSeedVault(vault.id);
  remappedSeedVaults.push(structuredClone(vault));
  registerMockVaultId(vault.id);
}

export function listMockVaultSeedRows(): VaultListItem[] {
  return [
    ...MOCK_VAULTS.filter((vault) => !suppressedSeedVaultIds.has(vault.id)),
    ...remappedSeedVaults,
  ].map((vault) => structuredClone(vault));
}

export function knownMockVaultIds(): Set<string> {
  return new Set([
    ...MOCK_VAULTS.filter((vault) => !suppressedSeedVaultIds.has(vault.id)).map(
      (vault) => vault.id,
    ),
    ...remappedSeedVaults.map((vault) => vault.id),
    ...extraMockVaultIds,
  ]);
}

export function resetMockVaultIds(): void {
  extraMockVaultIds.clear();
  suppressedSeedVaultIds.clear();
  remappedSeedVaults.length = 0;
}
