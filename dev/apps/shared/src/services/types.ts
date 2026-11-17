import type { AppSettingsService } from "./app-settings/AppSettingsService";
import type { BackupService } from "./backup/BackupService";
import type { CreateVaultService } from "./vault-create/CreateVaultService";
import type { DataFolderService } from "./data-folder/DataFolderService";
import type { DeviceService } from "./device/DeviceService";
import type { ExportFolderGrants } from "./export-folders/ExportFolderGrants";
import type { FolderListService } from "./folder-lists/FolderListService";
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
  /** This device as core knows it. */
  device: DeviceService;
  vault: VaultService;
  vaultGroups: VaultGroupService;
  /**
   * The data folder and its list. `apply` belongs to Setup, the Gate's
   * screens, and the Data folder window (see `VaultRootService`).
   */
  vaultRoot: VaultRootService;
  /** The status of the unlocked folder and backup rows, and a vault's unlocked folder here. */
  folderLists: FolderListService;
  appSettings: AppSettingsService;
  backups: BackupService;
  /**
   * Export data folder. Desktop and the Android native build. On a phone the
   * zip lands in a second folder the user picks, mounted beside the data
   * folder for that one export. Mocks leave it out.
   */
  dataFolder?: DataFolderService;
  /**
   * Grants behind folders picked for an export. Only the Android native build:
   * a desktop folder is a path, and the mocks pick no real folder.
   */
  exportFolderGrants?: ExportFolderGrants;
  /** Progress and stop of vault exports, Back up now, and the data-folder export. */
  jobs: JobService;
  logs: LogService;
  filesystem: VaultFileSystemService;
  lifecycle: VaultLifecycleService;
  createVault: CreateVaultService;
  /** Password / KDF rewrap — the only place a password is ever verified. */
  vaultSecurity: VaultSecurityService;
}
