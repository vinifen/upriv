import type { AppSettingsLoadResult, AppSettingsService } from "@upriv/shared";
import { normalizeAppSettings } from "@upriv/shared";
import { rpcAppSettingsGet, rpcAppSettingsSave } from "@/lib/rpc";

/**
 * Desktop → daemon `app_settings_get` / `app_settings_save`: `.upriv/settings.toml`
 * of the data folder in use. Before a data folder exists the UI keeps prefs in
 * memory (`onDisk: false`) and a save writes nothing (`wrote: false`). Mid-session
 * a missing or corrupt `.upriv` is an RPC error (`vault_root_not_found` /
 * `incomplete`), never a soft `wrote: false`.
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

  save: (config, lists) => rpcAppSettingsSave(normalizeAppSettings(config), lists),
};
