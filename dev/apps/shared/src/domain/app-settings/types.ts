import type { VaultListSortDirection, VaultListSortMode, VaultListViewMode } from "../vault-list";

export type LocaleId = "en" | "pt-BR" | "es";
export type UiTheme = "dark" | "neutral" | "light";
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

/** How the app locates the vault-root: `default_root` (distribution default) or `custom_root` (absolute path via `.upriv-root`). */
export type VaultRootMode = "default_root" | "custom_root";

export const APP_SETTINGS_SECTIONS = [
  "appearance",
  "logging",
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
     * Wire/UI only — derived from app-home `.upriv-root` (`status=active` → `"custom_root"`).
     * Not persisted in `settings.toml`.
     */
    vault_root_mode: VaultRootMode;
    /**
     * Wire/UI only — absolute path from `.upriv-root` when `vault_root_mode` is
     * `"custom_root"`; empty string in `"default_root"` mode.
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

/** True when saveable System Settings prefs match (`ui` + `logging`; ignores wire `app`). */
export function appSettingsEqual(a: AppSettingsConfig, b: AppSettingsConfig): boolean {
  return (
    a.ui.locale === b.ui.locale &&
    a.ui.theme === b.ui.theme &&
    a.ui.vault_list_sort === b.ui.vault_list_sort &&
    a.ui.vault_list_sort_direction === b.ui.vault_list_sort_direction &&
    a.ui.vault_list_view === b.ui.vault_list_view &&
    a.ui.always_show_hidden_vaults === b.ui.always_show_hidden_vaults &&
    a.ui.file_manager_dock_expanded === b.ui.file_manager_dock_expanded &&
    a.logging.enabled === b.logging.enabled &&
    a.logging.level === b.logging.level &&
    a.logging.entries_per_file === b.logging.entries_per_file &&
    a.logging.keep_last_entries === b.logging.keep_last_entries
  );
}
