import type { VaultRow } from "../vault";
import type { KdfUnlockPreset } from "../vault-settings/kdf";

/** Vault row enriched for list UI (`vault_list` DTO + locale formatting). */
export interface VaultListItem extends VaultRow {
  /** Localized last-access label (from `lastAccessedAt`, or a mock relative string). */
  lastAccessedWhen: string;
  /**
   * ISO-8601 sort key from `vaults/<id>/persistence.json` (`last_close_ok_at`).
   */
  lastAccessedAt: string;
  /** Optional annotation stored in config (`[vault] note`); empty string when unset. */
  note: string;
  /** From `contents/vault.header` when readable without the password. */
  unlockPreset?: KdfUnlockPreset;
}
