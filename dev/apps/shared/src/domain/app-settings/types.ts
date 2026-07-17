import type { VaultListSortDirection, VaultListSortMode, VaultListViewMode } from "../vault-list";

export type LocaleId = "en" | "pt-BR" | "es";
export type UiTheme = "dark" | "neutral" | "light";
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

/** How the app locates the vault-root: beside the app, or a custom absolute path. */
export type VaultRootMode = "nearby" | "custom";

export const APP_SETTINGS_SECTIONS = [
  "appearance",
  "logging",
  "behavior",
  "hidden_vaults",
  "download_vaults",
] as const;

export type AppSettingsSectionId = (typeof APP_SETTINGS_SECTIONS)[number];

export interface AppSettingsConfig {
  ui: {
    locale: LocaleId;
    theme: UiTheme;
    vault_list_sort: VaultListSortMode;
    vault_list_sort_direction: VaultListSortDirection;
    vault_list_view: VaultListViewMode;
    always_show_hidden_vaults: boolean;
    /** Desktop file-manager dock UI — mobile clients may ignore. */
    file_manager_dock_expanded: boolean;
  };
  logging: {
    enabled: boolean;
    level: LogLevel;
    entries_per_file: number;
    keep_last_entries: number;
  };
  app: {
    /**
     * Wire/UI only — derived from app-home `.upriv-root` (`status=active` → `"custom"`).
     * Not persisted in `settings.toml`.
     */
    vault_root_mode: VaultRootMode;
    /**
     * Wire/UI only — from `.upriv-root` when custom; empty when nearby.
     * Not persisted in `settings.toml`.
     */
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
