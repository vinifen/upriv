import type { AppSettingsService } from "./app-settings/AppSettingsService";
import type { BackupService } from "./backup/BackupService";
import type { CreateVaultService } from "./vault-create/CreateVaultService";
import type { DataFolderService } from "./data-folder/DataFolderService";
import type { JobService } from "./jobs/JobService";
import type { VaultFileSystemService } from "./filesystem/VaultFileSystemService";
import type { VaultLifecycleService } from "./lifecycle/VaultLifecycleService";
import type { LogService } from "./logs/LogService";
import type { VaultService } from "./vault/VaultService";
import type { VaultGroupService } from "./vault-groups/VaultGroupService";
import type { VaultRootService } from "./vault-root/VaultRootService";
import type { VaultSecurityService } from "./vault-security/VaultSecurityService";

/** Application service layer — platform selects mock vs native implementations. */
export interface AppServices {
  vault: VaultService;
  vaultGroups: VaultGroupService;
  /**
   * Vault-root discovery/setup. Mutating calls belong in settings / gate flows
   * (see `VaultRootService` JSDoc).
   */
  vaultRoot: VaultRootService;
  appSettings: AppSettingsService;
  backups: BackupService;
  /**
   * Export data folder. Desktop and the Android native build. On a phone the
   * zip lands in a second folder the user picks, mounted beside the data
   * folder for that one export. Mocks leave it out.
   */
  dataFolder?: DataFolderService;
  /** Progress and stop of vault exports, Back up now, and the data-folder export. */
  jobs: JobService;
  logs: LogService;
  filesystem: VaultFileSystemService;
  lifecycle: VaultLifecycleService;
  createVault: CreateVaultService;
  /** Password / KDF rewrap — the only place a password is ever verified. */
  vaultSecurity: VaultSecurityService;
}
