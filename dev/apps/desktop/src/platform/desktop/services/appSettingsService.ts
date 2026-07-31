import type {
  AppSettingsConfig,
  AppSettingsLoadResult,
  AppSettingsSaveOptions,
  AppSettingsService,
} from "@upriv/shared";
import { normalizeAppSettings } from "@upriv/shared";
import { rpcAppSettingsGet, rpcAppSettingsSave } from "@/lib/rpc";

/**
 * Desktop → daemon `app_settings_get` / `app_settings_save`.
 * Persists `.upriv/settings.toml` (`[ui]` / `[logging]` / other `[app]` keys).
 * Vault-root mode+path are derived from / written to `.upriv-root` only (not TOML).
 * Before a vault-root exists, the UI keeps prefs in memory (`onDisk: false`) and
 * does not call save expecting a write. Mid-session missing/corrupt `.upriv` →
 * RPC error (`vault_root_not_found` / `incomplete`), not soft `wrote: false`.
 * Soft `wrote: false` remains only for empty custom_root path bootstrap.
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
};

export type { AppSettingsConfig };
