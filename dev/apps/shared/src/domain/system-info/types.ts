import type { AppSettingsConfig, VaultRootMode } from "../app-settings";
import type { AppDistribution, VaultRootResolveResult } from "../vault-root";

export interface SystemInfoSnapshot {
  app: {
    version: string;
    distribution: AppDistribution | null;
    versionOffline: boolean;
  };
  root: VaultRootResolveResult;
  rootMode: VaultRootMode;
  inventory: {
    vaultsTotal: number;
    vaultsOpen: number;
    groupsTotal: number;
  };
  ui: AppSettingsConfig["ui"];
  logging: AppSettingsConfig["logging"];
  workspace: AppSettingsConfig["workspace"];
  /** `[app].last_opened_vault` from settings.toml (may be empty). */
  lastOpenedVault: string;
  paths: {
    logsDir: string;
    appHome: string;
  };
}
