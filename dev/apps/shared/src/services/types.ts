import type { AppSettingsService } from "./app-settings/AppSettingsService";
import type { BackupService } from "./backup/BackupService";
import type { CreateVaultService } from "./vault-create/CreateVaultService";
import type { VaultFileSystemService } from "./filesystem/VaultFileSystemService";
import type { VaultLifecycleService } from "./lifecycle/VaultLifecycleService";
import type { LogService } from "./logs/LogService";
import type { VaultService } from "./vault/VaultService";
import type { VaultRootService } from "./vault-root/VaultRootService";

/** Application service layer — platform selects mock vs native implementations. */
export interface AppServices {
  vault: VaultService;
  /**
   * Vault-root discovery/setup. Mutating calls belong in settings / gate flows
   * (see `VaultRootService` JSDoc).
   */
  vaultRoot: VaultRootService;
  appSettings: AppSettingsService;
  backups: BackupService;
  logs: LogService;
  filesystem: VaultFileSystemService;
  lifecycle: VaultLifecycleService;
  createVault: CreateVaultService;
}
