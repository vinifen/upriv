/** Lines per rotated log file (`[logging] entries_per_file` in settings.toml). */
export const LOG_ENTRIES_PER_FILE = 1000;

/** Default retention — 10k lines (~10 files at 1000 lines each). */
export const LOG_KEEP_LAST_DEFAULT = 10_000;

/** `0` = no retention limit (`keep_last_entries` omitted or zero in TOML). */
export const LOG_KEEP_LAST_UNLIMITED = 0;

/** Cadenced choices from 1k to 100k (not every 1k step). */
export const LOG_KEEP_LAST_ENTRY_OPTIONS = [
  1_000, 5_000, 10_000, 25_000, 50_000, 100_000, 500_000, 1_000_000,
] as const satisfies readonly number[];

export function logFileCountForKeepLast(keepLastEntries: number): number {
  if (keepLastEntries <= 0) return 0;
  return Math.ceil(keepLastEntries / LOG_ENTRIES_PER_FILE);
}

export function normalizeLogKeepLastEntries(keepLastEntries: number | undefined): number {
  if (keepLastEntries === LOG_KEEP_LAST_UNLIMITED) return LOG_KEEP_LAST_UNLIMITED;
  if (keepLastEntries === undefined) return LOG_KEEP_LAST_DEFAULT;
  if ((LOG_KEEP_LAST_ENTRY_OPTIONS as readonly number[]).includes(keepLastEntries)) {
    return keepLastEntries;
  }
  return LOG_KEEP_LAST_DEFAULT;
}
