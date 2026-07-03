import type { VaultListItem } from "../../domain/vault-list";
import type { VaultSettingsConfig } from "../../domain/vault-settings";
import type { VaultRow } from "../../domain/vault";

/** Vault list and per-vault config access (mock or desktop RPC). */
export interface VaultService {
  /** All vault rows for the list screen. */
  listVaults(): Promise<VaultListItem[]>;

  /** Load `vaults/<id>/config.toml` equivalent. */
  getSettings(vaultId: string): Promise<VaultSettingsConfig | undefined>;

  /** Persist settings after save (mock registry or `vault_config_save` RPC). */
  registerSettings(vaultId: string, config: VaultSettingsConfig): Promise<void>;

  /** Remove settings on vault delete. */
  unregisterSettings(vaultId: string): Promise<void>;

  /** Export bytes for `{display_name}.7z` (mock or desktop read). */
  getArchiveExportBytes(vault: VaultRow): Promise<Uint8Array>;
}
