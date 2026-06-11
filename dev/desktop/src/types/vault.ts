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
export type VaultDisplayStatus = "open" | "closed" | "sealed" | "recovery" | "closing" | "opening";

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

/**
 * Resolve the badge/row style status from backend fields.
 *
 * Invariant: `plain` vaults never persist `persistence: "closed"` — not-open is always
 * `sealed` (PRD RF-53). A malformed DTO with `plain` + `closed` still renders as sealed.
 */
export function resolveVaultDisplayStatus(row: VaultRow): VaultDisplayStatus {
  if (row.session === "recovery") return "recovery";
  if (row.session === "closing") return "closing";
  if (row.session === "open") return "open";
  if (row.storageMode === "plain") return "sealed";
  return row.persistence === "sealed" ? "sealed" : "closed";
}

/** Dev-only guard for mock seed rows that violate the plain-storage invariant. */
export function assertPlainVaultInvariant(row: VaultRow): void {
  if (!import.meta.env.DEV) return;
  if (row.storageMode === "plain" && row.persistence === "closed" && row.session !== "open") {
    console.warn(
      `[upriv] plain vault "${row.id}" has persistence "closed" while not open — UI shows sealed.`,
    );
  }
}

/** List row status including in-flight open pipeline (runtime only). */
export function resolveVaultListStatus(
  row: VaultRow,
  pipelineOpeningVaultId: string | null,
): VaultDisplayStatus {
  if (pipelineOpeningVaultId === row.id) return "opening";
  return resolveVaultDisplayStatus(row);
}
