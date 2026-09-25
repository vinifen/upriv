import { createUnavailableVaultSecurityService, type AppServices } from "@upriv/shared";
import { desktopAppSettingsService } from "./services/appSettingsService";
import { desktopBackupService } from "./services/backupService";
import { desktopCreateVaultService } from "./services/createVaultService";
import { desktopLogService } from "./services/logService";
import { desktopVaultFileSystemService } from "./services/vaultFileSystemService";
import { desktopVaultGroupService } from "./services/vaultGroupService";
import { desktopVaultLifecycleService } from "./services/vaultLifecycleService";
import { desktopVaultRootService } from "./services/vaultRootService";
import { desktopVaultService } from "./services/vaultService";

/**
 * Desktop adapters → upriv-daemon.
 * Change-password / KDF rewrap is not implemented.
 */
export function createDesktopServices(): AppServices {
  return {
    vaultRoot: desktopVaultRootService,
    appSettings: desktopAppSettingsService,
    logs: desktopLogService,
    vault: desktopVaultService,
    lifecycle: desktopVaultLifecycleService,
    vaultGroups: desktopVaultGroupService,
    filesystem: desktopVaultFileSystemService,
    backups: desktopBackupService,
    createVault: desktopCreateVaultService,
    vaultSecurity: createUnavailableVaultSecurityService(),
  };
}
