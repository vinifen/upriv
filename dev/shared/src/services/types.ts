import type { AppSettingsService } from "./app-settings/AppSettingsService";
import type { BackupService } from "./backup/BackupService";
import type { CreateVaultService } from "./vault-create/CreateVaultService";
import type { VaultFileSystemService } from "./filesystem/VaultFileSystemService";
import type { VaultLifecycleService } from "./lifecycle/VaultLifecycleService";
import type { LogService } from "./logs/LogService";
import type { VaultService } from "./vault/VaultService";

/** Application service layer — platform selects mock vs native implementations. */
export interface AppServices {
  vault: VaultService;
  appSettings: AppSettingsService;
  backups: BackupService;
  logs: LogService;
  filesystem: VaultFileSystemService;
  lifecycle: VaultLifecycleService;
  createVault: CreateVaultService;
}
