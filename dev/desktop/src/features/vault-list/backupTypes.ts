/** Row in backups modal — mirrors future `backup_list` DTO. */
export interface VaultBackupEntry {
  /** Filename under `backup/<vault_id>/` or `backup/<vault_id>/saves/`. */
  filename: string;
  /** ISO-8601 from filename or filesystem mtime. */
  createdAt: string;
  /** Uncompressed archive size in bytes (optional in UI). */
  sizeBytes?: number;
  /**
   * Pinned save — skipped by `keep_last` rotation; stored under `saves/` on disk.
   * User promotes a standard backup via `backup_promote_save`.
   */
  saved?: boolean;
}
