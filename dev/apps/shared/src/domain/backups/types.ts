/** Row in backups modal — mirrors future `backup_list` DTO. */
export interface VaultBackupEntry {
  /** Stamp folder under `vaults/<id>/backups/` (or `backups/saves/` when pinned). */
  stamp: string;
  /** ISO-8601 from the stamp prefix or filesystem mtime. */
  createdAt: string;
  /** Size of the frozen `contents/` tree in bytes (optional in UI). */
  sizeBytes?: number;
  /**
   * Pinned save — skipped by `keep_last` rotation; stored under `saves/` on disk.
   * User promotes a standard backup via `backup_promote_save`.
   */
  saved?: boolean;
}
