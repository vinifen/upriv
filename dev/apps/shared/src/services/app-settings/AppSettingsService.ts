import type { AppSettingsConfig } from "../../domain/app-settings";
import type { AppListChanges, ListsSaved } from "../../domain/folder-lists";

/** Result of `AppSettingsService.load()` — includes disk awareness from the daemon. */
export interface AppSettingsLoadResult {
  settings: AppSettingsConfig;
  /** True when `.upriv/settings.toml` was read from disk (not bootstrap defaults). */
  onDisk: boolean;
  /** Data folder used when loading; null when there is none yet. */
  rootPath: string | null;
}

/** What a save did. */
export interface AppSettingsSaved extends ListsSaved {
  /** False only before this process ever had a data folder: the preferences stay in memory. */
  wrote: boolean;
}

export interface AppSettingsService {
  load(): Promise<AppSettingsLoadResult>;
  /**
   * Save `config`. Its lists are not read: `lists` carries what changed in
   * them, applied by core to the file as it is now.
   */
  save(config: AppSettingsConfig, lists?: AppListChanges): Promise<AppSettingsSaved>;
}
