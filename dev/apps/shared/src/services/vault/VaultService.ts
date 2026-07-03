import type { VaultListItem } from "../../domain/vault-list";
import type { VaultSettingsConfig } from "../../domain/vault-settings";
import type { VaultRow } from "../../domain/vault";

/** Vault list and per-vault config access (mock or Tauri). */
export interface VaultService {
  /** All vault rows for the list screen. */
  listVaults(): Promise<VaultListItem[]>;

  /** Load `vaults/<id>/config.toml` equivalent. */
  getSettings(vaultId: string): Promise<VaultSettingsConfig | undefined>;

  /** Persist settings after save (mock registry or Tauri `config_save`). */
  registerSettings(vaultId: string, config: VaultSettingsConfig): Promise<void>;

  /** Remove settings on vault delete. */
  unregisterSettings(vaultId: string): Promise<void>;

  /** Persist a new display order (`[vault] order` per config) after drag-and-drop. */
  reorderVaults(orderedIds: readonly string[]): Promise<void>;

  /** Export bytes for `{display_name}.7z` (mock or Tauri read). */
  getArchiveExportBytes(vault: VaultRow): Promise<Uint8Array>;
}
