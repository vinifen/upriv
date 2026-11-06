/** What a vault takes on disk (`vault_disk_usage`), in bytes of regular files. */
export interface VaultDiskUsage {
  /** In `store/`. */
  storeBytes: number;
  /** Set aside in `held/`: data no file of the vault names. */
  heldBytes: number;
}

function isByteCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** A `vault_disk_usage` answer; null when it is not one. */
export function parseVaultDiskUsage(raw: unknown): VaultDiskUsage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { storeBytes, heldBytes } = raw as Record<string, unknown>;
  if (!isByteCount(storeBytes) || !isByteCount(heldBytes)) return null;
  return { storeBytes, heldBytes };
}
