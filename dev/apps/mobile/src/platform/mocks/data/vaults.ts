import type { VaultListItem } from "@upriv/shared";

/** Demo vaults — same shape as desktop browser mocks. Mutated by create flows in mocks. */
export const MOCK_VAULTS: VaultListItem[] = [
  {
    id: "my-encrypted-notes",
    displayName: "My Encrypted Notes",
    persistence: "closed",
    session: "open",
    storageMode: "encrypted_dir",
    order: 1,
    canSeal: true,
    lastAccessedWhen: "2m ago",
    lastAccessedAt: "2026-06-02T11:58:00Z",
    note: "Daily scratch pad — sync after laptop backup.",
  },
  {
    id: "vault-example-2",
    displayName: "Vault ExaMple 2",
    persistence: "sealed",
    session: null,
    storageMode: "encrypted_dir",
    order: 2,
    canSeal: false,
    lastAccessedWhen: "2 days ago",
    lastAccessedAt: "2026-05-31T10:00:00Z",
    note: "",
  },
  {
    id: "cold-storage",
    displayName: "Cold Storage",
    persistence: "closed",
    session: null,
    storageMode: "encrypted_dir",
    order: 3,
    canSeal: true,
    lastAccessedWhen: "14 days ago",
    lastAccessedAt: "2026-05-19T08:00:00Z",
    note: "",
  },
  {
    id: "personal-photos",
    displayName: "Personal Photos",
    persistence: "sealed",
    session: null,
    storageMode: "encrypted_dir",
    order: 4,
    canSeal: false,
    lastAccessedWhen: "2 days ago",
    lastAccessedAt: "2026-05-31T14:30:00Z",
    note: "RAW exports only; JPEG previews live elsewhere.",
  },
  {
    id: "work-documents",
    displayName: "Work Documents",
    persistence: "closed",
    session: "open",
    storageMode: "encrypted_dir",
    order: 5,
    canSeal: true,
    lastAccessedWhen: "1h ago",
    lastAccessedAt: "2026-06-02T11:00:00Z",
    note: "",
  },
];

/** Wizard-created vaults live in React state, not `MOCK_VAULTS`. */
const extraMockVaultIds = new Set<string>();

export function registerMockVaultId(id: string): void {
  const trimmed = id.trim();
  if (trimmed) extraMockVaultIds.add(trimmed);
}

export function unregisterMockVaultId(id: string): void {
  extraMockVaultIds.delete(id.trim());
}

export function knownMockVaultIds(): Set<string> {
  return new Set([...MOCK_VAULTS.map((vault) => vault.id), ...extraMockVaultIds]);
}

export function resetMockVaultIds(): void {
  extraMockVaultIds.clear();
}
