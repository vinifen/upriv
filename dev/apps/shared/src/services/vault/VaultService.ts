import type { KdfUnlockPreset } from "../../domain/vault-settings/kdf";
import type { VaultExportRequest, VaultListItem } from "../../domain/vault-list";
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

  /**
   * Argon2id unlock preset from `contents/vault.header` (not `config.toml`).
   * `undefined` only while the header is still being read or if the probe fails.
   */
  getUnlockPreset(vaultId: string): Promise<KdfUnlockPreset | undefined>;

  /** Mock / post-rewrap: update the in-memory header preset after `changeKdfPreset`. */
  setUnlockPreset(vaultId: string, preset: KdfUnlockPreset): Promise<void>;

  /**
   * Export bytes for `{display_name}.zip` or `{display_name}.7z`.
   * Zip = envelope of `contents/` (no zip password). `.7z` = logical stream (never `.enc` blobs).
   */
  getExportBytes(vault: VaultRow, request: VaultExportRequest): Promise<Uint8Array>;
}
