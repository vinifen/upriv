import { formatIsoDate } from "../format/datetime";

export function formatBackupDate(iso: string, locale: string): string {
  return formatIsoDate(iso, locale);
}

/** On-disk snapshot: `YYYYMMDDHHmmss-<vaultId>.zip`. */
export function backupSnapshotFileName(stamp: string, vaultId: string): string {
  return `${stamp}-${vaultId.trim()}.zip`;
}

/** Name of the snapshot file. This name selects the zip; the stamp alone does not. */
export function backupEntryFileName(
  entry: { stamp: string; fileName?: string },
  vaultId: string,
): string {
  const named = entry.fileName?.trim();
  if (named && !named.includes("/") && !named.includes("\\")) return named;
  return backupSnapshotFileName(entry.stamp, vaultId);
}

/**
 * Locator for one zip. A pin lives under `saves/` and can share its file name
 * with the copy in `backups/`.
 */
export function backupEntryKey(
  entry: { stamp: string; fileName?: string; saved?: boolean },
  vaultId: string,
): string {
  const name = backupEntryFileName(entry, vaultId);
  return entry.saved ? `saves/${name}` : name;
}

/**
 * Name inside a downloaded bundle of several snapshots. A pin that shares its
 * file name with the copy in `backups/` is `saves-<file name>` so the two zips
 * stay distinct. Core uses the same rule.
 */
export function backupBundleEntryName(
  entry: { stamp: string; fileName?: string; saved?: boolean },
  vaultId: string,
  entries: readonly { stamp: string; fileName?: string; saved?: boolean }[],
): string {
  const name = backupEntryFileName(entry, vaultId);
  if (!entry.saved) return name;
  const clashes = entries.some(
    (other) => !other.saved && backupEntryFileName(other, vaultId) === name,
  );
  return clashes ? `saves-${name}` : name;
}
