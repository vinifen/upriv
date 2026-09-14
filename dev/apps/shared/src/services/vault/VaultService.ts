import type { KdfUnlockPreset } from "../../domain/vault-settings/kdf";
import type { VaultExportRequest, VaultListItem } from "../../domain/vault-list";
import type { VaultSettingsConfig } from "../../domain/vault-settings";
import type { VaultRow } from "../../domain/vault";

export interface CreateVaultInput {
  password: string;
  unlockPreset?: KdfUnlockPreset;
  settings: VaultSettingsConfig;
}

/** Vault list and per-vault config access (native or desktop RPC, or in-memory mock). */
export interface VaultService {
  /** Live when `vault_config_save` is wired (desktop/native). */
  readonly canPersistSettings: boolean;
  /** Live adapters stay false until `vault_delete` lands. */
  readonly canDeleteVault: boolean;
  /** Live adapters stay false until export zip/`.7z` RPC lands. */
  readonly canExportVault: boolean;

  /** All vault rows for the list screen. */
  listVaults(): Promise<VaultListItem[]>;

  /** Scratch create: writes `config.toml` + seeded `contents/` (password is not stored). */
  createVault(input: CreateVaultInput): Promise<VaultListItem>;

  /** Load `vaults/<id>/config.toml` equivalent. */
  getSettings(vaultId: string): Promise<VaultSettingsConfig | undefined>;

  /** Persist settings (`vault_config_save` — enforces edit-policy on quiet targets). */
  registerSettings(vaultId: string, config: VaultSettingsConfig): Promise<void>;

  /** Remove settings on vault delete. */
  unregisterSettings(vaultId: string): Promise<void>;

  /**
   * Argon2id unlock preset from `contents/vault.header` (not `config.toml`).
   * Prefer `VaultListItem.unlockPreset` — live adapters do not relist for this field.
   * `undefined` when the header is missing or the probe is unavailable.
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
