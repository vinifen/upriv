import type { AppSettingsLoadResult, AppSettingsService } from "@upriv/shared";
import {
  getMockAppSettings,
  MOCK_UPRIV_ROOT_PATH,
  replaceMockAppSettings,
} from "@/platform/mocks/data/appSettings";

let settingsOnDisk = false;

/** Prototype app settings — in-memory for browser. Desktop uses daemon RPC. */
export const mockAppSettingsService: AppSettingsService = {
  async load(): Promise<AppSettingsLoadResult> {
    return {
      settings: getMockAppSettings(),
      onDisk: settingsOnDisk,
      rootPath: settingsOnDisk ? MOCK_UPRIV_ROOT_PATH : null,
    };
  },

  async save(config) {
    replaceMockAppSettings(config);
    settingsOnDisk = true;
    return true;
  },
};
