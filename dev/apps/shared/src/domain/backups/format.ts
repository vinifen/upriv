import { formatIsoDate } from "../format/datetime";

export function formatBackupDate(iso: string, locale: string): string {
  return formatIsoDate(iso, locale);
}

/** Longest name of a backup, in characters (core `BACKUP_NAME_MAX_CHARS`). */
export const BACKUP_NAME_MAX_CHARS = 80;

/**
 * A backup name as typed, trimmed and capped. Core turns characters a system
 * refuses into `_`; an empty name takes the name away.
 */
export function normalizeBackupName(name: string): string {
  return Array.from(name.trim()).slice(0, BACKUP_NAME_MAX_CHARS).join("");
}

/** The file part of a backup key (`<folder>/[saves/]<file>`). */
function keyFileName(key: string): string {
  return key.slice(key.lastIndexOf("/") + 1);
}

/**
 * The file an export of the backups `keys` writes into its folder: one keeps
 * its own name, several go into `upriv-backups-<id>.zip`. While that name is
 * taken core adds the next free `number` (`{name}-2.zip`, `export_backups`).
 */
export function backupExportFilename(keys: readonly string[], vaultId: string, number = 1): string {
  const stem =
    keys.length === 1
      ? keyFileName(keys[0]).replace(/\.zip$/, "")
      : `upriv-backups-${vaultId.trim()}`;
  return number > 1 ? `${stem}-${number}.zip` : `${stem}.zip`;
}

/**
 * The row that shows an export of `keys`: one backup grows its own row.
 * `null` for several, which show above the list, under the toolbar.
 */
export function backupExportRowKey(keys: readonly string[]): string | null {
  return keys.length === 1 ? keys[0] : null;
}
