import type { AppServices } from "@upriv/shared";
import { createTauriAppSettingsService } from "./appSettingsService";
import { createTauriBackupService } from "./backupService";
import { createTauriCreateVaultService } from "./createVaultService";
import { createTauriLogService } from "./logService";
import { createTauriVaultFileSystemService } from "./vaultFileSystemService";
import { createTauriVaultLifecycleService } from "./vaultLifecycleService";
import { createTauriVaultService } from "./vaultService";

/** Tauri adapters for vault list, settings persistence, create, lifecycle, and workspace FS. */
export function createTauriServices(mockServices: AppServices): AppServices {
  return {
    ...mockServices,
    appSettings: createTauriAppSettingsService(),
    backups: createTauriBackupService(),
    logs: createTauriLogService(),
    createVault: createTauriCreateVaultService(),
    vault: createTauriVaultService(),
    lifecycle: createTauriVaultLifecycleService(),
    filesystem: createTauriVaultFileSystemService(),
  };
}
