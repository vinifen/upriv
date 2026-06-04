/** Row in backups modal — mirrors future `backup_list` DTO. */
export interface VaultBackupEntry {
  /** Filename under `backup/<vault_id>/` (e.g. `20260528T120000-my-encrypted-notes.7z`). */
  filename: string;
  /** ISO-8601 from filename or filesystem mtime. */
  createdAt: string;
  /** Uncompressed archive size in bytes (optional in UI). */
  sizeBytes?: number;
}
