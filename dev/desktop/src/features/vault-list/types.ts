import type { VaultRow } from "@/types";

/** Vault row enriched for list UI (mock / future `vault_list` DTO). */
export interface VaultListItem extends VaultRow {
  /** Human-readable last access (UI only until backend formats). */
  lastAccessedWhen: string;
  /**
   * ISO-8601 for sort — future: max(`last_store_write_at`, `last_close_ok_at`) from
   * `vaults/<id>/persistence.json` after validation.
   */
  lastAccessedAt: string;
  /** Optional annotation stored in config (`[vault] note`); empty string when unset. */
  note: string;
}
