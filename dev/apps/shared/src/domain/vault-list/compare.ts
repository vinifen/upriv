import { baseCollator, deviceCollator } from "../format/intl";
import type { VaultDisplayStatus } from "../vault";
import type { VaultListItem } from "./types";

export const STATE_RANK: Record<VaultDisplayStatus, number> = {
  open: 0,
  opening: 1,
  creating: 1,
  queued: 1,
  exporting: 1,
  backing_up: 1,
  changing_password: 1,
  changing_kdf: 1,
  closing: 2,
  closed: 3,
  recovery: 4,
};

export function compareDisplayName(a: string, b: string): number {
  const aFirst = (a[0] ?? "").toLowerCase();
  const bFirst = (b[0] ?? "").toLowerCase();
  const byFirst = deviceCollator().compare(aFirst, bFirst);
  if (byFirst !== 0) return byFirst;
  return baseCollator().compare(a, b);
}

/** `lastAccessedAt` in ms, or 0 when it is missing or unreadable. */
export function lastAccessedMs(vault: VaultListItem): number {
  const parsed = Date.parse(vault.lastAccessedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}
