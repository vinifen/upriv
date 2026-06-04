import type { VaultRow } from "@/types";

/** Vault row enriched for list UI (mock / future `vault_list` DTO). */
export interface VaultListItem extends VaultRow {
  lastAccessedWhen: string;
  /** Optional annotation stored in config (`[vault] note`); empty string when unset. */
  note: string;
}
