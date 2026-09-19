import type { VaultListItem } from "@upriv/shared";

/** Demo vaults — UI dev only. */
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
    lastAccessedWhen: "12m ago",
    lastAccessedAt: "2026-06-02T11:48:00Z",
    note: "",
  },
  {
    id: "old-archive",
    displayName: "Old Archive",
    session: null,
    storageMode: "encrypted_dir",
    order: 6,
    hidden: true,
    lastAccessedWhen: "Jan 2023",
    lastAccessedAt: "2023-01-15T12:00:00Z",
    note: "",
  },
  {
    id: "finance-2025",
    displayName: "Finance 2025",
    session: null,
    storageMode: "encrypted_dir",
    order: 7,
    hidden: true,
    lastAccessedWhen: "5 days ago",
    lastAccessedAt: "2026-05-28T16:00:00Z",
    note: "Tax receipts + bank CSV exports.",
  },
  {
    id: "medical-records",
    displayName: "Medical Records",
    session: null,
    storageMode: "encrypted_dir",
    order: 8,
    lastAccessedWhen: "3 weeks ago",
    lastAccessedAt: "2026-05-12T11:00:00Z",
    note: "",
  },
  {
    id: "dev-secrets",
    displayName: "Dev Secrets",
    session: "open",
    storageMode: "encrypted_dir",
    order: 9,
    lastAccessedWhen: "18m ago",
    lastAccessedAt: "2026-06-02T11:42:00Z",
    note: "",
  },
  {
    id: "travel-planner",
    displayName: "Travel Planner",
    session: "open",
    storageMode: "encrypted_dir",
    order: 10,
    lastAccessedWhen: "35m ago",
    lastAccessedAt: "2026-06-02T11:25:00Z",
    note: "",
  },
  {
    id: "daily-journal",
    displayName: "Daily Journal",
    session: "recovery",
    storageMode: "encrypted_dir",
    order: 11,
    lastAccessedWhen: "4h ago",
    lastAccessedAt: "2026-06-02T08:00:00Z",
    note: "Recovery pending — last good entry 2026-05-28.",
  },
  {
    id: "plain-folder-demo",
    displayName: "Plain Folder Demo",
    session: null,
    storageMode: "upriv_plain",
    order: 12,
    lastAccessedWhen: "1 week ago",
    lastAccessedAt: "2026-05-26T09:00:00Z",
    note: "Plaintext workspace while open; wipe on close.",
  },
  {
    id: "encrypted-dir-demo",
    displayName: "Encrypted Dir Demo",
    session: null,
    storageMode: "encrypted_dir",
    order: 13,
    lastAccessedWhen: "3 days ago",
    lastAccessedAt: "2026-05-30T09:00:00Z",
    note: "Encrypted contents/ at rest; decrypt in RAM while open.",
  },
  {
    id: "upriv-plain-demo",
    displayName: "Upriv Plain Demo",
    session: null,
    storageMode: "upriv_plain",
    order: 17,
    lastAccessedWhen: "5 days ago",
    lastAccessedAt: "2026-05-28T09:00:00Z",
    note: "Ciphertext in contents/ when closed; plaintext workspace/ while open.",
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
    ...MOCK_VAULTS.filter((vault) => !suppressedSeedVaultIds.has(vault.id)).map((vault) => vault.id),
    ...remappedSeedVaults.map((vault) => vault.id),
    ...extraMockVaultIds,
  ]);
}

export function resetMockVaultIds(): void {
  extraMockVaultIds.clear();
  suppressedSeedVaultIds.clear();
  remappedSeedVaults.length = 0;
}
