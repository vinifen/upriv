/** Prototype / browser mocks. Desktop overrides `vaultRoot` + `appSettings` (+ empty vault list).
 *  Temporary: the whole `platform/mocks` layer will be removed as daemon adapters land —
 *  keep mocks minimal; do not add edge-case scaffolding.
 *  Never use `localStorage` (or other browser storage) for product or mock vault-root state —
 *  in-memory mocks only; real persistence is disk via the daemon.
 *  TODO: rename `mock*` / `getMock*` / `MOCK_*` symbols to neutral names as remaining adapters land. */
import type { AppServices } from "@upriv/shared";
import { mockAppSettingsService } from "./services/appSettingsService";
import { mockBackupService } from "./services/backupService";
import { mockCreateVaultService } from "./services/createVaultService";
import { mockLogService } from "./services/logService";
import { mockVaultFileSystemService } from "./services/vaultFileSystemService";
import { mockVaultLifecycleService } from "./services/vaultLifecycleService";
import { mockVaultRootService } from "./services/vaultRootService";
import { mockVaultService } from "./services/vaultService";

/** All mock services — swap for desktop adapters in `createServices()`. */
export const mockServices: AppServices = {
  vault: mockVaultService,
  vaultRoot: mockVaultRootService,
  appSettings: mockAppSettingsService,
  backups: mockBackupService,
  logs: mockLogService,
  filesystem: mockVaultFileSystemService,
  lifecycle: mockVaultLifecycleService,
  createVault: mockCreateVaultService,
};
