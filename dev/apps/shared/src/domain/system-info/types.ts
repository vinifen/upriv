import type { AppSettingsConfig } from "../app-settings";
import type { DeviceInfo, OsNames } from "../device";
import type { DataFolderListView, AppDistribution, VaultRootResolveResult } from "../vault-root";

/**
 * What System Info shows. The settings and the list are known at once; each
 * part read from core is `null` until it lands, and its rows show loading.
 */
export interface SystemInfoSnapshot {
  app: {
    version: string;
    distribution: AppDistribution | null;
    versionOffline: boolean;
  } | null;
  /** This device as core knows it. */
  device: DeviceInfo | null;
  /** The OS names devices are named by, this device's own among them (`useOsNames`). */
  osNames: OsNames;
  root: VaultRootResolveResult | null;
  /** The data folder list: this device's group names the folder in use. */
  dataFolders: DataFolderListView | null;
  /**
   * The bytes of every file in the data folder's `.upriv`: `"measuring"`
   * while core walks it, `null` when the measure failed.
   */
  dataFolderBytes: number | null | "measuring";
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
}
