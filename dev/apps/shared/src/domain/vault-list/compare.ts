import type { VaultDisplayStatus } from "../vault";
import type { VaultListItem } from "./types";

export const STATE_RANK: Record<VaultDisplayStatus, number> = {
  open: 0,
  opening: 1,
  closing: 2,
  closed: 3,
  recovery: 4,
};

export function compareDisplayName(a: string, b: string): number {
  const aFirst = (a[0] ?? "").toLowerCase();
  const bFirst = (b[0] ?? "").toLowerCase();
  const byFirst = aFirst.localeCompare(bFirst);
  if (byFirst !== 0) return byFirst;
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

/** Future: max(last_store_write_at, last_close_ok_at) from persistence.json */
export function lastAccessedMs(vault: VaultListItem): number {
  const parsed = Date.parse(vault.lastAccessedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}
