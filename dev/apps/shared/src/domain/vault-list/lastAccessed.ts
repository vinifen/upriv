/** Touch last-accessed fields after unlock/open (mock until platform returns relative labels). */
export function touchVaultLastAccessed(when: string): {
  lastAccessedAt: string;
  lastAccessedWhen: string;
} {
  return {
    lastAccessedAt: new Date().toISOString(),
    lastAccessedWhen: when,
  };
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Parse a last-accessed value into epoch milliseconds.
 *
 * Accepts canonical ISO-8601 as well as the legacy `"<unixSeconds>Z"` form
 * written by older core builds (e.g. `"1782741491Z"`). Returns `null` when the
 * value is empty or not understood.
 */
export function parseLastAccessedMs(raw: string | undefined | null): number | null {
  const value = raw?.trim();
  if (!value) return null;
  const legacy = /^(\d+)Z$/.exec(value);
  if (legacy) {
    const secs = Number(legacy[1]);
    return Number.isFinite(secs) ? secs * SECOND : null;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/** Normalize any accepted last-accessed value to canonical ISO-8601 (or `""`). */
export function normalizeLastAccessedIso(raw: string | undefined | null): string {
  const ms = parseLastAccessedMs(raw);
  return ms === null ? "" : new Date(ms).toISOString();
}

/**
 * Human-readable last-accessed label, locale-aware.
 *
 * Relative ("just now", "2 hours ago", "3 days ago") for the last week, then a
 * localized absolute date for older timestamps. Returns `""` for unknown input.
 */
export function formatLastAccessed(
  raw: string | undefined | null,
  locale: string,
  nowMs: number = Date.now(),
): string {
  const ms = parseLastAccessedMs(raw);
  if (ms === null) return "";

  const diff = nowMs - ms;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  if (diff < MINUTE) return rtf.format(0, "second");
  if (diff < HOUR) return rtf.format(-Math.floor(diff / MINUTE), "minute");
  if (diff < DAY) return rtf.format(-Math.floor(diff / HOUR), "hour");
  if (diff < 7 * DAY) return rtf.format(-Math.floor(diff / DAY), "day");

  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(ms));
}
