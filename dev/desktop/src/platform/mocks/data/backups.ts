import { backupCreatedAtFromFilename, type VaultBackupEntry } from "@upriv/shared";

function entry(filename: string, sizeBytes: number, saved = false): VaultBackupEntry {
  return {
    filename,
    createdAt: backupCreatedAtFromFilename(filename) ?? "1970-01-01T00:00:00Z",
    sizeBytes,
    saved,
  };
}

/** Demo backups — mirrors `prod-example/.upriv/vaults/<id>/backups/` (+ `saves/`). */
export const MOCK_BACKUPS_BY_VAULT: Record<string, VaultBackupEntry[]> = {
  "my-encrypted-notes": [
    entry("20260401T100000-my-encrypted-notes.7z", 47_800_000, true),
    entry("20260515T090000-my-encrypted-notes.7z", 48_000_000),
    entry("20260528T120000-my-encrypted-notes.7z", 48_200_000),
  ],
  "vault-example-2": [
    entry("20260501T080000-vault-example-2.7z", 310_500_000, true),
    entry("20260528T140000-vault-example-2.7z", 312_400_000),
    entry("20260528T120000-vault-example-2.7z", 311_900_000),
  ],
  "finance-2025": [
    entry("20260520T090000-finance-2025.7z", 89_100_000),
    entry("20260510T090000-finance-2025.7z", 88_700_000),
  ],
  "dev-secrets": [
    entry("20260515T120000-dev-secrets.7z", 12_400_000, true),
    entry("20260601T180000-dev-secrets.7z", 12_800_000),
  ],
};

export function getMockBackupsForVault(vaultId: string): VaultBackupEntry[] {
  const list = MOCK_BACKUPS_BY_VAULT[vaultId] ?? [];
  return [...list].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/** Placeholder bytes until Tauri reads real `.7z` files from disk. */
export function getMockBackupBytes(entry: VaultBackupEntry): Uint8Array {
  const header = `[Upriv mock backup]\n${entry.filename}\n${entry.saved ? "saved\n" : ""}`;
  const payload = "0".repeat(
    Math.min(256, Math.max(32, Math.floor((entry.sizeBytes ?? 1024) / 1_000_000))),
  );
  return new TextEncoder().encode(header + payload);
}
