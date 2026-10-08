/**
 * Phrase typed to delete backups: the vault's current display name, a space,
 * and the count (`Notes 2`). Backup file names may carry an older id; the
 * phrase always uses the live name.
 */
export function backupDeleteConfirmPhrase(displayName: string, count: number): string {
  return `${displayName.trim()} ${count}`;
}

export function matchesBackupDeleteConfirmation(
  input: string,
  displayName: string,
  count: number,
): boolean {
  if (count <= 0) return false;
  return input.trim() === backupDeleteConfirmPhrase(displayName, count);
}
