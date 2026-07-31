/** Lines per rotated log file (`[logging] entries_per_file` in settings.toml). */
export const LOG_ENTRIES_PER_FILE = 1000;

/** Default retention — 10k lines (~10 files at 1000 lines each). */
export const LOG_KEEP_LAST_DEFAULT = 10_000;

/** `0` = no retention limit (`keep_last_entries` omitted or zero in TOML). */
export const LOG_KEEP_LAST_UNLIMITED = 0;

/** Cadenced choices from 5k to 1M (not every 1k step).
 * Minimum is 2× `LOG_ENTRIES_PER_FILE` so “keep N lines” always means at least
 * one full archived file plus headroom for the growing `current-*`. */
export const LOG_KEEP_LAST_ENTRY_OPTIONS = [
  5_000, 10_000, 25_000, 50_000, 100_000, 500_000, 1_000_000,
] as const satisfies readonly number[];

/**
 * Product UI presets (maps to `[logging].level`) — same four severities as log lines.
 * Quietest → loudest: `error` | `warn` | `info` | `debug`.
 */
export const LOG_LEVEL_PRESETS = ["error", "warn", "info", "debug"] as const;

export type LogLevelPreset = (typeof LOG_LEVEL_PRESETS)[number];

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

/** Normalize `[logging].level` to a UI preset (`error` | `warn` | `info` | `debug`). */
export function normalizeLogLevel(level: string | undefined): LogLevelPreset {
  const value = (level ?? "info").trim().toLowerCase();
  if (value === "error") return "error";
  if (value === "warn" || value === "warning") return "warn";
  if (value === "debug") return "debug";
  if (value === "info") return "info";
  return "info";
}
