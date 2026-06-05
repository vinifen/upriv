/** Persisted vault state on disk (never `open` — runtime only). */
export type VaultPersistence = "closed" | "sealed";

/** Runtime session state while the app is running. */
export type VaultSession = "open" | "closing" | "recovery";

/** Storage mode from `config.toml` → `[storage] mode`. */
export type StorageMode = "encrypted_dir" | "plain";

/**
 * Unified display status for list rows (PRD §1.7, SDD §8.2).
 * Derived from session + persistence + recovery detection.
 */
export type VaultDisplayStatus = "open" | "closed" | "sealed" | "recovery";

/** Row DTO returned by `vault_list` (SDD §8.2.6). */
export interface VaultRow {
  id: string;
  displayName: string;
  persistence: VaultPersistence;
  session: VaultSession | null;
  storageMode: StorageMode;
  order?: number;
  passwordHint?: string;
  canSeal: boolean;
  /** `[vault] hidden` — omitted from list unless show-hidden is active. */
  hidden?: boolean;
}

/** Resolve the badge/row style status from backend fields. */
export function resolveVaultDisplayStatus(row: VaultRow): VaultDisplayStatus {
  if (row.session === "recovery") return "recovery";
  if (row.session === "open") return "open";
  return row.persistence === "sealed" ? "sealed" : "closed";
}
