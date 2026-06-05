import type { LocaleId } from "@/i18n";
import type { VaultListSortDirection, VaultListSortMode } from "@/features/vault-list/vaultListSort";
import type { VaultListViewMode } from "@/features/vault-list/vaultListView";

export type UiTheme = "dark" | "light";
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

export const APP_SETTINGS_SECTIONS = ["appearance", "logging", "behavior", "hidden_vaults"] as const;

export type AppSettingsSectionId = (typeof APP_SETTINGS_SECTIONS)[number];

export interface AppSettingsConfig {
  ui: {
    locale: LocaleId;
    theme: UiTheme;
    /** Persisted when the user changes sort in the list toolbar (not edited in system settings). */
    vault_list_sort: VaultListSortMode;
    vault_list_sort_direction: VaultListSortDirection;
    /** Persisted when the user changes view in the list toolbar (not edited in system settings). */
    vault_list_view: VaultListViewMode;
    /** TOML: `[ui] always_show_hidden_vaults` */
    always_show_hidden_vaults: boolean;
    /** TOML: `[ui] file_manager_dock_expanded` */
    file_manager_dock_expanded: boolean;
  };
  logging: {
    enabled: boolean;
    level: LogLevel;
    entries_per_file: number;
  };
  app: {
    /** TOML: `[app] auto_detect_vault_root` */
    auto_detect_vault_root: boolean;
    /** Folder that contains `.upriv/` (Upriv root) — not a single vault. */
    upriv_root_path: string;
  };
}

export type AppSettingsPatch = {
  ui?: Partial<AppSettingsConfig["ui"]>;
  logging?: Partial<AppSettingsConfig["logging"]>;
  app?: Partial<AppSettingsConfig["app"]>;
};

export function appSettingsEqual(a: AppSettingsConfig, b: AppSettingsConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Auto-detect and a fixed path are mutually exclusive. */
export function normalizeAppSettings(config: AppSettingsConfig): AppSettingsConfig {
  if (!config.app.auto_detect_vault_root) return config;
  if (!config.app.upriv_root_path) return config;
  return {
    ...config,
    app: { ...config.app, upriv_root_path: "" },
  };
}
