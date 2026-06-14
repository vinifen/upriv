/** Prototype data, in-memory stores, and mock service implementations — delete when Tauri is wired. */
export { DEFAULT_APP_SETTINGS, MOCK_UPRIV_ROOT_PATH } from "./data/appSettings";
export { MOCK_VAULTS } from "./data/vaults";
export { getMockLogFile, getMockLogFiles } from "./data/logs";
export {
  getMockBackupBytes,
  getMockBackupsForVault,
  MOCK_BACKUPS_BY_VAULT,
} from "./data/backups";
export { getMockVaultArchiveBytes } from "./data/vaultArchive";
export {
  getMockVaultSettings,
  registerMockVaultSettings,
  unregisterMockVaultSettings,
} from "./stores/vaultSettings";
export { getMockFileContent, getMockVaultFileTree } from "./stores/fileTree";
export {
  createVaultFile,
  createVaultFolder,
  deleteVaultPath,
  ensureVaultFolder,
  getVaultFileContent,
  getVaultFileTree,
  getVaultTreeRevision,
  importVaultFile,
  isVaultFileEditable,
  isVaultFileImage,
  isVaultFileViewable,
  moveVaultPath,
  renameVaultPath,
  resetVaultFileSession,
  setVaultFileContent,
  vaultFileLanguageFromPath,
} from "./stores/fileSystem";
export { mockAppSettingsService } from "./services/appSettingsService";
export { mockBackupService } from "./services/backupService";
export { mockCreateVaultService } from "./services/createVaultService";
export { mockLogService } from "./services/logService";
export { mockVaultService } from "./services/vaultService";
export { mockVaultFileSystemService } from "./services/vaultFileSystemService";
export { mockVaultLifecycleService } from "./services/vaultLifecycleService";

import type { AppServices } from "@upriv/shared";
import { mockAppSettingsService } from "./services/appSettingsService";
import { mockBackupService } from "./services/backupService";
import { mockCreateVaultService } from "./services/createVaultService";
import { mockLogService } from "./services/logService";
import { mockVaultFileSystemService } from "./services/vaultFileSystemService";
import { mockVaultLifecycleService } from "./services/vaultLifecycleService";
import { mockVaultService } from "./services/vaultService";

/** All mock services — swap for Tauri implementations in `createServices()`. */
export const mockServices: AppServices = {
  vault: mockVaultService,
  appSettings: mockAppSettingsService,
  backups: mockBackupService,
  logs: mockLogService,
  filesystem: mockVaultFileSystemService,
  lifecycle: mockVaultLifecycleService,
  createVault: mockCreateVaultService,
};
