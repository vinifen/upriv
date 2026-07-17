import type { AppSettingsConfig } from "../../domain/app-settings";

/** Result of `AppSettingsService.load()` — includes disk awareness from the daemon. */
export interface AppSettingsLoadResult {
  settings: AppSettingsConfig;
  /** True when `.upriv/settings.toml` was read from disk (not bootstrap defaults). */
  onDisk: boolean;
  /** Vault-root used when loading; null when no root yet. */
  rootPath: string | null;
}

export interface AppSettingsSaveOptions {
  /**
   * When false, daemon writes TOML only (skip `.upriv-root` sync).
   * Pass false after `setupNearby` / `setupAtPath` / deactivate already applied the alias.
   * Default true for back-compat.
   */
  syncAlias?: boolean;
}

export interface AppSettingsService {
  load(): Promise<AppSettingsLoadResult>;
  save(config: AppSettingsConfig, options?: AppSettingsSaveOptions): Promise<boolean>;
  /** Suggested path when native folder picker is unavailable (browser dev). */
  getDefaultRootPathSuggestion(): string;
}
