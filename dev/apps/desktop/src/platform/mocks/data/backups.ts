import { backupCreatedAtFromStamp, type VaultBackupEntry } from "@upriv/shared";

function entry(stamp: string, sizeBytes: number, saved = false): VaultBackupEntry {
  return {
    stamp,
    createdAt: backupCreatedAtFromStamp(stamp) ?? "1970-01-01T00:00:00Z",
    sizeBytes,
    saved,
  };
}

/** Demo backups — stamp folders under `vaults/<id>/backups/` (`saves/` when pinned). */
export const MOCK_BACKUPS_BY_VAULT: Record<string, VaultBackupEntry[]> = {
  "my-encrypted-notes": [
    entry("20260401T100000", 47_800_000, true),
    entry("20260515T090000", 48_000_000),
    entry("20260528T120000", 48_200_000),
  ],
  "vault-example-2": [
    entry("20260501T080000", 310_500_000, true),
    entry("20260528T140000", 312_400_000),
    entry("20260528T120000", 311_900_000),
  ],
  "finance-2025": [entry("20260520T090000", 89_100_000), entry("20260510T090000", 88_700_000)],
  "dev-secrets": [entry("20260515T120000", 12_400_000, true), entry("20260601T180000", 12_800_000)],
};

export function getMockBackupsForVault(vaultId: string): VaultBackupEntry[] {
  const list = MOCK_BACKUPS_BY_VAULT[vaultId] ?? [];
  return [...list].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/** Placeholder bytes until desktop copies a frozen `contents/` tree. */
export function getMockBackupBytes(entry: VaultBackupEntry): Uint8Array {
  const header = `[Upriv mock backup]\n${entry.stamp}\n${entry.saved ? "saved\n" : ""}`;
  const payload = "0".repeat(
    Math.min(256, Math.max(32, Math.floor((entry.sizeBytes ?? 1024) / 1_000_000))),
  );
  return new TextEncoder().encode(header + payload);
}
