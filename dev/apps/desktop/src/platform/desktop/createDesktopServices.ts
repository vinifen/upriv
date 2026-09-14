import { createUnavailableVaultSecurityService, type AppServices } from "@upriv/shared";
import { mockServices } from "@/platform/mocks";
import { desktopAppSettingsService } from "./services/appSettingsService";
import { desktopLogService } from "./services/logService";
import { desktopVaultGroupService } from "./services/vaultGroupService";
import { desktopVaultLifecycleService } from "./services/vaultLifecycleService";
import { desktopVaultRootService } from "./services/vaultRootService";
import { desktopVaultService } from "./services/vaultService";

/**
 * Desktop adapters → upriv-daemon.
 * Vault list / create / open / close / groups are live. File manager, export,
 * backups, and import stay mock until those RPCs land. Change-password / KDF
 * rewrap is unavailable until SECURITY-CRYPTO landmine P0.
 */
export function createDesktopServices(): AppServices {
  return {
    ...mockServices,
    vaultRoot: desktopVaultRootService,
    appSettings: desktopAppSettingsService,
    logs: desktopLogService,
    vault: desktopVaultService,
    lifecycle: desktopVaultLifecycleService,
    vaultGroups: desktopVaultGroupService,
    vaultSecurity: createUnavailableVaultSecurityService(),
  };
}
