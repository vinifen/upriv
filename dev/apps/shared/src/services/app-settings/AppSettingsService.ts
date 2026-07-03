import type { AppSettingsConfig } from "../../domain/app-settings";

export interface AppSettingsService {
  load(): Promise<AppSettingsConfig>;
  save(config: AppSettingsConfig): Promise<void>;
  /** Suggested path when native folder picker is unavailable (browser dev). */
  getDefaultRootPathSuggestion(): string;
  /** Native folder picker (Tauri); `null` if cancelled or unavailable. */
  pickVaultRootFolder(): Promise<string | null>;
}
