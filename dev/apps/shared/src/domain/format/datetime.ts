import { isoDateFormat } from "./intl";

/** Format ISO-8601 timestamp for list/detail UI (locale-aware). */
export function formatIsoDate(iso: string, locale: string): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return iso;
  return isoDateFormat(locale).format(new Date(parsed));
}
