import { formatIsoDate } from "../format/datetime";

/** Parse `20260528T120000` stamp prefix into ISO-8601. */
export function backupCreatedAtFromStamp(stamp: string): string | null {
  const match = stamp.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
}

export function formatBackupDate(iso: string, locale: string): string {
  return formatIsoDate(iso, locale);
}
