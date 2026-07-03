/** Prototype data, in-memory stores, and mock service implementations — delete when desktop RPC is wired.
 *  TODO: rename `mock*` / `getMock*` / `MOCK_*` symbols to neutral names as real adapters replace this folder. */
import type { AppServices } from "@upriv/shared";
import { mockAppSettingsService } from "./services/appSettingsService";
import { mockBackupService } from "./services/backupService";
import { mockCreateVaultService } from "./services/createVaultService";
import { mockLogService } from "./services/logService";
import { mockVaultFileSystemService } from "./services/vaultFileSystemService";
import { mockVaultLifecycleService } from "./services/vaultLifecycleService";
import { mockVaultService } from "./services/vaultService";

/** All mock services — swap for desktop adapters in `createServices()`. */
export const mockServices: AppServices = {
  vault: mockVaultService,
  appSettings: mockAppSettingsService,
  backups: mockBackupService,
  logs: mockLogService,
  filesystem: mockVaultFileSystemService,
  lifecycle: mockVaultLifecycleService,
  createVault: mockCreateVaultService,
};
