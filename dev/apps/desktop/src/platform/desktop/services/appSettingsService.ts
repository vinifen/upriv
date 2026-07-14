import type { AppSettingsConfig, AppSettingsService } from "@upriv/shared";
import { createDefaultAppSettings, normalizeAppSettings } from "@upriv/shared";
import { rpcAppSettingsGet, rpcAppSettingsSave } from "@/lib/rpc";

/**
 * Desktop → daemon `app_settings_get` / `app_settings_save`.
 * Persists `.upriv/settings.toml` (`[ui]` / `[logging]` / other `[app]` keys).
 * Vault-root mode+path are derived from / written to `.upriv-root` only (not TOML).
 * Before a vault-root exists, save is a no-op on disk (`wrote: false`) — UI keeps in-memory state.
 */
export const desktopAppSettingsService: AppSettingsService = {
  async load() {
    const result = await rpcAppSettingsGet();
    return normalizeAppSettings(result.settings);
  },

  async save(config) {
    await rpcAppSettingsSave(normalizeAppSettings(config));
  },

  getDefaultRootPathSuggestion() {
    return createDefaultAppSettings().app.upriv_root_path || "";
  },
};

export type { AppSettingsConfig };
