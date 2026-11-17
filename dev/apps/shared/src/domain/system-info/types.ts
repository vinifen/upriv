import type { AppSettingsConfig } from "../app-settings";
import type { DeviceInfo } from "../device";
import type { DataFolderListView, AppDistribution, VaultRootResolveResult } from "../vault-root";

export interface SystemInfoSnapshot {
  app: {
    version: string;
    distribution: AppDistribution | null;
    versionOffline: boolean;
  };
  /** This device as core knows it. */
  device: DeviceInfo;
  root: VaultRootResolveResult;
  /** The data folder list: this device's group names the folder in use. */
  dataFolders: DataFolderListView;
  inventory: {
    vaultsTotal: number;
    vaultsOpen: number;
    groupsTotal: number;
  };
  ui: AppSettingsConfig["ui"];
  logging: AppSettingsConfig["logging"];
  unlockedFolders: AppSettingsConfig["unlocked_folders"];
  backups: AppSettingsConfig["backups"];
  /** `[app].last_opened_vault` from settings.toml (may be empty). */
  lastOpenedVault: string;
  paths: {
    logsDir: string;
    /** Where the system file manager opens `logsDir` (`vaultRootUprivOpenPath`). */
    logsOpenPath: string;
    appHome: string;
  };
}
