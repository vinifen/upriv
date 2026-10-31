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
 * The file an export of the backups `keys` (`backupEntryKey`) writes into its
 * folder: one keeps its own name, several go into `upriv-backups-<id>.zip`.
 * While that name is taken core adds the next free `number` (`{name} 2.zip`,
 * `export_backups`).
 */
export function backupExportFilename(keys: readonly string[], vaultId: string, number = 1): string {
  const stem =
    keys.length === 1
      ? keys[0].slice(keys[0].lastIndexOf("/") + 1).replace(/\.zip$/, "")
      : `upriv-backups-${vaultId.trim()}`;
  return number > 1 ? `${stem} ${number}.zip` : `${stem}.zip`;
}

/**
 * The row that shows an export of `keys`: one backup grows its own row.
 * `null` for several, which show above the list, under the toolbar.
 */
export function backupExportRowKey(keys: readonly string[]): string | null {
  return keys.length === 1 ? keys[0] : null;
}
