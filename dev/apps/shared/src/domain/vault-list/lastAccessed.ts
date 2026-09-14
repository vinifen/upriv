import { formatIsoDate } from "../format/datetime";

/** Localized last-access copy from an ISO stamp, or "—" when missing. */
export function formatLastAccessedWhen(iso: string | undefined, locale: string): string {
  const trimmed = iso?.trim() ?? "";
  if (!trimmed) return "—";
  return formatIsoDate(trimmed, locale);
}

/** Prefer `lastAccessedAt` (locale-formatted). Fall back to a mock relative label. */
export function vaultLastAccessedLabel(
  vault: { lastAccessedAt?: string; lastAccessedWhen?: string },
  locale: string,
): string {
  const iso = vault.lastAccessedAt?.trim() ?? "";
  if (iso) return formatIsoDate(iso, locale);
  const when = vault.lastAccessedWhen?.trim() ?? "";
  return when || "—";
}

/** Touch last-accessed fields after unlock/open. List UI formats `lastAccessedAt`. */
export function touchVaultLastAccessed(when: string): {
  lastAccessedAt: string;
  lastAccessedWhen: string;
} {
  return {
    lastAccessedAt: new Date().toISOString(),
    lastAccessedWhen: when,
  };
}
