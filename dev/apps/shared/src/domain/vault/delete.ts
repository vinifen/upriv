/** What a delete did with the backups a vault keeps outside the data folder. */
export type OutsideBackupsOutcome = "none" | "kept" | "removed" | "failed";

export interface VaultDeleteOutcome {
  outside: OutsideBackupsOutcome;
  /** The folder those backups are in. Null when the vault keeps none outside. */
  folder: string | null;
}

/** `vault_delete`. */
export function parseVaultDeleteOutcome(raw: unknown): VaultDeleteOutcome {
  const record = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const outside = record.outside;
  const folders = Array.isArray(record.folders) ? record.folders : [];
  return {
    outside: outside === "kept" || outside === "removed" || outside === "failed" ? outside : "none",
    folder: typeof folders[0] === "string" ? folders[0] : null,
  };
}
