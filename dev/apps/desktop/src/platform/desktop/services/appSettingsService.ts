import type {
  AppSettingsConfig,
  AppSettingsLoadResult,
  AppSettingsSaveOptions,
  AppSettingsService,
} from "@upriv/shared";
import { createDefaultAppSettings, normalizeAppSettings } from "@upriv/shared";
import { rpcAppSettingsGet, rpcAppSettingsSave } from "@/lib/rpc";

/**
 * Desktop → daemon `app_settings_get` / `app_settings_save`.
 * Persists `.upriv/settings.toml` (`[ui]` / `[logging]` / other `[app]` keys).
 * Vault-root mode+path are derived from / written to `.upriv-root` only (not TOML).
 * Before a vault-root exists, save is a no-op on disk (`wrote: false`) — UI keeps in-memory state.
 */
export const desktopAppSettingsService: AppSettingsService = {
  async load(): Promise<AppSettingsLoadResult> {
    const result = await rpcAppSettingsGet();
    return {
      settings: normalizeAppSettings(result.settings),
      onDisk: result.onDisk,
      rootPath: result.rootPath,
    };
  },

  async save(config, options?: AppSettingsSaveOptions) {
    const { wrote } = await rpcAppSettingsSave(normalizeAppSettings(config), {
      syncAlias: options?.syncAlias,
    });
    return wrote;
  },

  getDefaultRootPathSuggestion() {
    return createDefaultAppSettings().app.upriv_root_path || "";
  },
};

export type { AppSettingsConfig };
