import type { AppSettingsService } from "@upriv/shared";
import { DEFAULT_APP_SETTINGS, MOCK_UPRIV_ROOT_PATH } from "@/platform/mocks/data/appSettings";

let runtimeSettings = structuredClone(DEFAULT_APP_SETTINGS);

/** Prototype app settings — in-memory until `app_settings_get` / `app_settings_save` RPC. */
export const mockAppSettingsService: AppSettingsService = {
  async load() {
    return structuredClone(runtimeSettings);
  },

  async save(config) {
    runtimeSettings = structuredClone(config);
  },

  getDefaultRootPathSuggestion() {
    return MOCK_UPRIV_ROOT_PATH;
  },
};
