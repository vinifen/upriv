import { formatIsoDate } from "../format/datetime";

/** Parse backup filename timestamp into ISO-8601. */
export function backupCreatedAtFromFilename(filename: string): string | null {
  const compact = filename.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/);
  if (compact) {
    const [, y, mo, d, h, mi, s] = compact;
    return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
  }

  const numeric = filename.match(/^(\d{10,})/);
  if (numeric) {
    const secs = Number.parseInt(numeric[1]!.slice(0, 10), 10);
    if (Number.isFinite(secs)) {
      return new Date(secs * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
    }
  }

  return null;
}

export function formatBackupDate(iso: string, locale: string): string {
  return formatIsoDate(iso, locale);
}
