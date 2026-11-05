/**
 * Phrase typed to delete backups: the vault's current display name, then a
 * space and the count when two or more are chosen (`Notes`, `Notes 2`).
 * Backup file names may carry an older id; the phrase always uses the live name.
 */
export function backupDeleteConfirmPhrase(displayName: string, count: number): string {
  const name = displayName.trim();
  return count === 1 ? name : `${name} ${count}`;
}

export function matchesBackupDeleteConfirmation(
  input: string,
  displayName: string,
  count: number,
): boolean {
  if (count <= 0) return false;
  return input.trim() === backupDeleteConfirmPhrase(displayName, count);
}
