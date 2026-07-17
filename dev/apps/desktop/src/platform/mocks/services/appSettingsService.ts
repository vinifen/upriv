import type { AppSettingsLoadResult, AppSettingsService } from "@upriv/shared";
import { DEFAULT_APP_SETTINGS, MOCK_UPRIV_ROOT_PATH } from "@/platform/mocks/data/appSettings";

let runtimeSettings = structuredClone(DEFAULT_APP_SETTINGS);
let settingsOnDisk = false;

/** Prototype app settings — in-memory for browser. Desktop uses daemon RPC. */
export const mockAppSettingsService: AppSettingsService = {
  async load(): Promise<AppSettingsLoadResult> {
    return {
      settings: structuredClone(runtimeSettings),
      onDisk: settingsOnDisk,
      rootPath: settingsOnDisk ? MOCK_UPRIV_ROOT_PATH : null,
    };
  },

  async save(config) {
    runtimeSettings = structuredClone(config);
    settingsOnDisk = true;
    return true;
  },

  getDefaultRootPathSuggestion() {
    return MOCK_UPRIV_ROOT_PATH;
  },
};
