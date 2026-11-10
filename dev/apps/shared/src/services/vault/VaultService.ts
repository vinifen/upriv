import type { KdfUnlockPreset } from "../../domain/vault-settings/kdf";
import type { VaultExportRequest, VaultExportResult, VaultListItem } from "../../domain/vault-list";
import type { VaultSettingsConfig } from "../../domain/vault-settings";
import type { VaultDeleteOutcome, VaultRow } from "../../domain/vault";
import type { VaultWelcomeFiles } from "../../domain/vault-create/welcomeReadme";
import type { VaultDiskUsage } from "../../domain/vault-info";

export type VaultImportPackageKind = "store_zip" | "seven_zip" | "files_zip" | "os_tree";

/**
 * Store zip, logical `.7z`, or a zip of ordinary files.
 * Prefer `archivePath` so large files skip NDJSON.
 */
export interface VaultImportPackage {
  kind: VaultImportPackageKind;
  archivePath?: string;
  contentB64?: string;
  archivePassword?: string;
  /** A `.7z` or `.zip` of files: keep the file manager layout it carries. */
  keepWorkspace?: boolean;
}

export interface CreateVaultInput {
  password: string;
  unlockPreset?: KdfUnlockPreset;
  settings: VaultSettingsConfig;
  importPackage?: VaultImportPackage;
  /**
   * Welcome `README.md` + layout (`buildVaultWelcomeFiles`). Scratch and
   * ordinary-file imports; core skips it when the root already has a README
   * or the import keeps a layout.
   * A store `.zip` / backup import never sends it.
   */
  welcome?: VaultWelcomeFiles;
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

  /**
   * Scratch create: writes `config.toml` + seeded `store/` (password is not stored).
   * `input.importPackage` routes to an import instead. `input.welcome` adds
   * `README.md` and the layout that opens it. Runs as the job `job`: a stop
   * removes the new vault and rejects with `job_cancelled`.
   */
  createVault(input: CreateVaultInput, job: string): Promise<VaultListItem>;

  /** Load `vaults/<id>/config.toml` equivalent. */
  getSettings(vaultId: string): Promise<VaultSettingsConfig | undefined>;

  /**
   * On-disk size of regular files in `store/` and `held/`. Metadata only.
   * `null` when the live adapter does not measure it.
   */
  diskUsage(vaultId: string): Promise<VaultDiskUsage | null>;

  /** Persist settings (`vault_config_save` — enforces edit-policy on quiet targets). */
  registerSettings(vaultId: string, config: VaultSettingsConfig): Promise<void>;

  /**
   * Deep rename via `vault_rename` — updates display name; migrates folder/`[vault].id`
   * when the slug changes. Vault must be closed.
   */
  rename(vaultId: string, displayName: string): Promise<VaultRenameResult>;

  /**
   * Remove the vault folder (wipe) via `vault_delete`. With `outsideBackups`,
   * what it wrote to its folder outside the data folder goes too.
   */
  unregisterSettings(vaultId: string, outsideBackups?: boolean): Promise<VaultDeleteOutcome>;

  /**
   * Write `{display_name}-upriv.zip`, `{display_name}-sevenzip.7z`, or
   * `{display_name}-plain-text.zip` into the folder `destDir` in core, as the
   * job `job`. `-upriv.zip` = envelope of `store/` (no zip password). `.7z` =
   * logical stream (never `.enc` blobs). `-plain-text.zip` = the readable
   * files, not encrypted. When that name is already in the folder the
   * file gets the next free number (`{display_name}-upriv-2.zip`, see
   * `vaultExportToast`); nothing is replaced.
   * Every file goes in; the result names the ones kept with zeros where their
   * data was missing or damaged. Rejects with `job_cancelled` after
   * `JobService.cancel`.
   */
  exportToFolder(
    vault: VaultRow,
    request: VaultExportRequest,
    destDir: string,
    job: string,
  ): Promise<VaultExportResult>;

  /** Whether portable `.7z` export can run in RAM (always on when core is linked). Zip of `store/` is always available. */
  exportCapabilities(): Promise<{ sevenZip: boolean }>;

  /**
   * Clear what a crash left from a job: delete the vaults an import never
   * finished and remove the unfinished export files. Core logs the outcome.
   */
  sweepUnfinished(): Promise<void>;
}
