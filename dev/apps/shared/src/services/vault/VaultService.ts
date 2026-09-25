import type { KdfUnlockPreset } from "../../domain/vault-settings/kdf";
import type { VaultExportRequest, VaultListItem } from "../../domain/vault-list";
import type { VaultSettingsConfig } from "../../domain/vault-settings";
import type { VaultRow } from "../../domain/vault";
import type { VaultPathWriteResult } from "../backup/createLiveBackupService";

export type VaultImportPackageKind = "store_zip" | "seven_zip";

/** Zip of `store/` or logical `.7z`. Prefer `archivePath` so large files skip NDJSON. */
export interface VaultImportPackage {
  kind: VaultImportPackageKind;
  archivePath?: string;
  contentB64?: string;
  archivePassword?: string;
}

export interface CreateVaultInput {
  password: string;
  unlockPreset?: KdfUnlockPreset;
  settings: VaultSettingsConfig;
  importPackage?: VaultImportPackage;
}

/** Result of `vault_rename` (display name + optional folder id migration). */
export interface VaultRenameResult {
  id: string;
  previousId: string;
  displayName: string;
  idChanged: boolean;
}

/** Vault list and per-vault config access (native or desktop RPC, or in-memory mock). */
export interface VaultService {
  /** Live when `vault_config_save` is wired (desktop/native). */
  readonly canPersistSettings: boolean;
  /** Live when `vault_delete` is wired. */
  readonly canDeleteVault: boolean;
  /** Live when `vault_export` is wired. */
  readonly canExportVault: boolean;

  /** All vault rows for the list screen. */
  listVaults(): Promise<VaultListItem[]>;

  /** Scratch create: writes `config.toml` + seeded `store/` (password is not stored). */
  createVault(input: CreateVaultInput): Promise<VaultListItem>;

  /** Load `vaults/<id>/config.toml` equivalent. */
  getSettings(vaultId: string): Promise<VaultSettingsConfig | undefined>;

  /** Persist settings (`vault_config_save` — enforces edit-policy on quiet targets). */
  registerSettings(vaultId: string, config: VaultSettingsConfig): Promise<void>;

  /**
   * Deep rename via `vault_rename` — updates display name; migrates folder/`[vault].id`
   * when the slug changes. Vault must be closed.
   */
  rename(vaultId: string, displayName: string): Promise<VaultRenameResult>;

  /** Remove the vault folder (wipe) via `vault_delete`. */
  unregisterSettings(vaultId: string): Promise<void>;

  /** Clear dirty-close recovery (`vault_recover_ack`). */
  recoverDirtyClose(vaultId: string): Promise<void>;

  /**
   * Argon2id unlock preset from `store/header/vault.header` (not `config.toml`).
   * Prefer `VaultListItem.unlockPreset` — live adapters do not relist for this field.
   * `undefined` when the header is missing or the probe is unavailable.
   */
  getUnlockPreset(vaultId: string): Promise<KdfUnlockPreset | undefined>;

  /** Mock / post-rewrap: update the in-memory header preset after `changeKdfPreset`. */
  setUnlockPreset(vaultId: string, preset: KdfUnlockPreset): Promise<void>;

  /**
   * Export bytes for `{display_name}.zip` or `{display_name}.7z`.
   * Zip = envelope of `store/` (no zip password). `.7z` = logical stream (never `.enc` blobs).
   * Prefer `exportToPath` so large archives skip the NDJSON cap.
   */
  getExportBytes(vault: VaultRow, request: VaultExportRequest): Promise<Uint8Array>;

  /** Write the export archive to `destPath` in core (no base64 in NDJSON). */
  exportToPath(
    vault: VaultRow,
    request: VaultExportRequest,
    destPath: string,
  ): Promise<VaultPathWriteResult>;

  /** Whether portable `.7z` export can run in RAM (always on when core is linked). Zip of `store/` is always available. */
  exportCapabilities(): Promise<{ sevenZip: boolean }>;

  /**
   * Argon2id check that `password` unlocks this closed vault.
   * Resolves `false` for a wrong password. Does not pack an export.
   */
  probeExportPassword(vaultId: string, password: string): Promise<boolean>;
}
