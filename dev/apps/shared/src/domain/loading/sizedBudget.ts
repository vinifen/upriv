import { LOADING_BUDGET_MS } from "./budget";

/**
 * Slowest steady speed a sized budget allows for: a phone's storage-access
 * folder or a USB hard drive once its cache is full.
 */
export const SLOW_DISK_BYTES_PER_SECOND = 4 * 1024 * 1024;

/**
 * Longest any sized budget grows, however large the work. Also the call
 * timeout of every sized RPC: the visible budget ends the wait first, and core
 * is never cut off while a larger budget still allows it to run.
 */
export const SIZED_BUDGET_CEILING_MS = 12 * 60 * 60 * 1000;

/** How a budget grows with the bytes its work moves. */
interface SizedWork {
  /** The budget before the size is known, and its least. Covers Argon2id and small vaults. */
  floorMs: number;
  /** How many times the work reads or writes its bytes. */
  passes: number;
}

/**
 * Work whose time follows the size of the vault, folder, or backups it moves.
 * Every other blocking wait keeps its fixed `LOADING_BUDGET_MS` entry.
 */
export const SIZED_WORK = {
  /** Close: the closing pass, the seal, and the backup zip of `store/` (read, write, check). */
  vaultClose: { floorMs: LOADING_BUDGET_MS.vaultPipeline, passes: 3 },
  /** Back up now: the same zip of the closed `store/`. */
  vaultBackupSave: { floorMs: LOADING_BUDGET_MS.vaultBackupSave, passes: 3 },
  /** Password or unlock-RAM change: a backup zip of `store/` first, then the header and index. */
  vaultRewrap: { floorMs: LOADING_BUDGET_MS.vaultRewrap, passes: 3 },
  /** Vault export: read the vault and write the file. A `.7z` also compresses it. */
  vaultExport: { floorMs: LOADING_BUDGET_MS.vaultExport, passes: 4 },
  /** Backup export: copy the chosen zips, bundled when there are several. */
  backupExport: { floorMs: LOADING_BUDGET_MS.backupExport, passes: 2 },
  /** Export data folder: zip the whole `.upriv`. */
  dataFolderExport: { floorMs: LOADING_BUDGET_MS.dataFolderExport, passes: 2 },
  /** Remove a leftover plain-text folder: overwrite each file, then delete it. */
  plainLeftoverRemove: { floorMs: LOADING_BUDGET_MS.plainLeftoverRemove, passes: 2 },
} as const satisfies Record<string, SizedWork>;

export type SizedWorkKind = keyof typeof SIZED_WORK;

/**
 * Budget for `work` that moves `bytes`: its floor plus the time every pass
 * takes on a slow disk, never past `SIZED_BUDGET_CEILING_MS`. An unknown or
 * zero size is the floor, so the budget only grows once core has measured the
 * work.
 */
export function sizedBudgetMs(work: SizedWorkKind, bytes: number | null | undefined): number {
  const { floorMs, passes } = SIZED_WORK[work];
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return floorMs;
  const transferMs = Math.ceil(((bytes * passes) / SLOW_DISK_BYTES_PER_SECOND) * 1000);
  return Math.min(SIZED_BUDGET_CEILING_MS, floorMs + transferMs);
}
