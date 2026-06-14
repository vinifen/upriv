/** Format ISO-8601 timestamp for list/detail UI (locale-aware). */
export function formatIsoDate(iso: string, locale: string): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return iso;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(parsed));
}
