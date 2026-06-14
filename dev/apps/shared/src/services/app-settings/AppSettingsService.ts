import type { AppSettingsConfig } from "../../domain/app-settings";

export interface AppSettingsService {
  load(): Promise<AppSettingsConfig>;
  save(config: AppSettingsConfig): Promise<void>;
}
