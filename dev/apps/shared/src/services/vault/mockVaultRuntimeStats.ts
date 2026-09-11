import type { StorageMode } from "../../domain/vault";
import type { VaultRuntimeStats } from "../../domain/vault-info";

const openStats = new Map<string, { openCount: number; lastOpenedAt: string | null }>();

function seedFromId(vaultId: string): number {
  let hash = 0;
  for (const char of vaultId) {
    hash = (hash * 31 + char.charCodeAt(0)) | 0;
  }
  return Math.abs(hash);
}

/** Mock lifecycle helper — increment after a successful open pipeline. */
export function recordMockVaultOpened(vaultId: string): void {
  const seed = seedFromId(vaultId);
  const prev = openStats.get(vaultId);
  openStats.set(vaultId, {
    openCount: (prev?.openCount ?? seed % 12) + 1,
    lastOpenedAt: new Date().toISOString(),
  });
}

export function getMockVaultRuntimeStats(
  vaultId: string,
  options: { isOpen: boolean; storageMode: StorageMode },
): VaultRuntimeStats {
  const seed = seedFromId(vaultId);
  const stored = openStats.get(vaultId);
  const openCount = stored?.openCount ?? 1 + (seed % 12);
  const lastOpenedAt = stored?.lastOpenedAt ?? null;
  const contentsBytes = 12_000_000 + (seed % 900) * 1_000_000;
  const sessionRamBytes = options.isOpen
    ? options.storageMode === "upriv_plain"
      ? 8_000_000 + (seed % 16) * 512_000
      : 32_000_000 + (seed % 64) * 1_048_576
    : null;

  return {
    openCount,
    lastOpenedAt,
    sessionRamBytes,
    contentsBytes,
    logicalFileCount: 3 + (seed % 120),
  };
}

/** Test / dev reset. */
export function resetMockVaultRuntimeStats(): void {
  openStats.clear();
}
