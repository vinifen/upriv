import {
  LOG_ENTRIES_PER_FILE,
  LOG_KEEP_LAST_DEFAULT,
  type AppSettingsConfig,
  type LocaleId,
  type LogLevel,
  type UiTheme,
  type VaultListSortDirection,
  type VaultListSortMode,
  type VaultListViewMode,
} from "@upriv/shared";

/** Raw `.upriv/settings.toml` shape from `app_settings_get`. */
export interface RawAppSettings {
  ui?: {
    locale?: string;
    theme?: string;
    vault_list_sort?: string | null;
    vault_list_sort_direction?: string | null;
    vault_list_view?: string | null;
    always_show_hidden_vaults?: boolean;
    file_manager_dock_expanded?: boolean;
  };
  logging?: {
    enabled?: boolean;
    level?: string;
    entries_per_file?: number;
    keep_last_entries?: number | null;
  };
  app?: {
    auto_detect_vault_root?: boolean;
    last_opened_vault?: string | null;
  };
}

export function mapRawAppSettings(
  raw: RawAppSettings,
  localVaultRootPath: string,
): AppSettingsConfig {
  return {
    ui: {
      locale: (raw.ui?.locale ?? "en") as LocaleId,
      theme: (raw.ui?.theme ?? "dark") as UiTheme,
      vault_list_sort: (raw.ui?.vault_list_sort ?? "order") as VaultListSortMode,
      vault_list_sort_direction: (raw.ui?.vault_list_sort_direction ??
        "asc") as VaultListSortDirection,
      vault_list_view: (raw.ui?.vault_list_view ?? "default") as VaultListViewMode,
      always_show_hidden_vaults: raw.ui?.always_show_hidden_vaults ?? false,
      file_manager_dock_expanded: raw.ui?.file_manager_dock_expanded ?? false,
    },
    logging: {
      enabled: raw.logging?.enabled ?? true,
      level: (raw.logging?.level ?? "info") as LogLevel,
      entries_per_file: raw.logging?.entries_per_file ?? LOG_ENTRIES_PER_FILE,
      keep_last_entries: raw.logging?.keep_last_entries ?? LOG_KEEP_LAST_DEFAULT,
    },
    app: {
      auto_detect_vault_root: raw.app?.auto_detect_vault_root ?? true,
      upriv_root_path: localVaultRootPath,
    },
  };
}

/** Strip app-local vault path — persisted via `app_vault_root_path_set`. */
export function unmapAppSettings(config: AppSettingsConfig): RawAppSettings {
  return {
    ui: {
      locale: config.ui.locale,
      theme: config.ui.theme,
      vault_list_sort: config.ui.vault_list_sort,
      vault_list_sort_direction: config.ui.vault_list_sort_direction,
      vault_list_view: config.ui.vault_list_view,
      always_show_hidden_vaults: config.ui.always_show_hidden_vaults,
      file_manager_dock_expanded: config.ui.file_manager_dock_expanded,
    },
    logging: {
      enabled: config.logging.enabled,
      level: config.logging.level,
      entries_per_file: config.logging.entries_per_file,
      keep_last_entries: config.logging.keep_last_entries,
    },
    app: {
      auto_detect_vault_root: config.app.auto_detect_vault_root,
    },
  };
}
