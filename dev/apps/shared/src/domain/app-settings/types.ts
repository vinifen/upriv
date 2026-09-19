import type { VaultListSortDirection, VaultListSortMode, VaultListViewMode } from "../vault-list";

export type LocaleId = "en" | "pt-BR" | "es";
export type UiTheme = "dark" | "neutral" | "light";
export const DEFAULT_UI_THEME: UiTheme = "dark";
/** Same four values as `LOG_LEVEL_PRESETS` / Rust `LogLevel` filter. */
export type LogLevel = "error" | "warn" | "info" | "debug";

/** How the app locates the vault-root: `default_root` (distribution default) or `custom_root` (absolute path via `.upriv-root`). */
export type VaultRootMode = "default_root" | "custom_root";

export const APP_SETTINGS_SECTIONS = [
  "language",
  "general",
  "workspace",
  "vault_list",
  "groups",
  "logging",
  "hidden_vaults",
] as const;

export type AppSettingsSectionId = (typeof APP_SETTINGS_SECTIONS)[number];

export interface AppSettingsConfig {
  ui: {
    locale: LocaleId;
    theme: UiTheme;
    vault_list_sort: VaultListSortMode;
    vault_list_sort_direction: VaultListSortDirection;
    vault_list_view: VaultListViewMode;
    /** Vault list search query. Control expands only while focused. */
    vault_list_search: string;
    /** UI: show the new-vault button. Default true. */
    vault_list_show_create_button: boolean;
    /** UI: show the list search button. Default true. A saved query still filters if hidden. */
    vault_list_show_search_button: boolean;
    /** UI: show the sort button. Default true. Current sort stays in effect if hidden. */
    vault_list_show_sort_button: boolean;
    /** UI: show the view button. Default true. Current view stays in effect if hidden. */
    vault_list_show_view_button: boolean;
    /** UI: show the header overflow (⋮) menu. Default true. */
    vault_list_show_header_more_button: boolean;
    /** UI: show the vault row overflow (⋯) menu. Default true. */
    vault_list_show_vault_more_button: boolean;
    /** UI: show the vault row settings (gear) menu. Default true. */
    vault_list_show_vault_settings_button: boolean;
    /** UI: show the group header settings (gear) menu. Default true. */
    vault_list_show_group_settings_button: boolean;
    always_show_hidden_vaults: boolean;
    /**
     * UI: show vertical drag handles on the vault list (drag up/down).
     * Independent of sort mode; turn off to hide those handles.
     */
    vault_list_show_drag: boolean;
    /**
     * When true, dropping a vault onto a group assigns it, and dropping a grouped
     * vault onto the list (or an ungrouped vault) removes it from the group.
     * In-group reorder is independent.
     */
    vault_list_allow_drag_into_group: boolean;
    /**
     * Minimized file-manager dock expanded (chip tower vs count button).
     * Toggled from the dock itself — not a System settings checkbox.
     */
    file_manager_dock_expanded: boolean;
    /**
     * Explorer/editor split width (canonical integer % of the FM pane, 15–65).
     * App-wide — shared by every vault. Adjusted by dragging the FM resize grip.
     */
    file_manager_tree_split_percent: number;
    /**
     * When true, unlock/lock password dialog closes as soon as Confirm queues the
     * pipeline (progress on the row). Default false — keep the dialog open so a
     * wrong password can be fixed in place.
     */
    lifecycle_close_modal_on_submit: boolean;
    /**
     * When true, after a vault successfully opens, open the in-app file manager
     * automatically — only if no other modal is open at that moment. Default false.
     */
    lifecycle_open_file_manager_on_open: boolean;
    /**
     * When true, deleting a file/folder in the file manager asks for confirmation.
     * Default true. The delete dialog can turn this off via “don’t ask again”.
     */
    file_manager_confirm_delete: boolean;
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
    /**
     * `[app].last_opened_vault` in `settings.toml` — last vault id opened in the UI.
     * Empty string when unset; always written on serialize.
     */
    last_opened_vault: string;
  };
  /**
   * Default mount parent for open vaults (`[workspace]` in `settings.toml`).
   * Empty `path` = unset — do not create a mount folder until the user chooses.
   */
  workspace: {
    /** Absolute filesystem path, or `""` when unset. */
    path: string;
  };
}

export type AppSettingsPatch = {
  ui?: Partial<AppSettingsConfig["ui"]>;
  logging?: Partial<AppSettingsConfig["logging"]>;
  app?: Partial<AppSettingsConfig["app"]>;
  workspace?: Partial<AppSettingsConfig["workspace"]>;
};

/** True when saveable System Settings prefs match (`ui` + `logging` + `workspace`; ignores wire `app`). */
export function appSettingsEqual(a: AppSettingsConfig, b: AppSettingsConfig): boolean {
  return (
    a.ui.locale === b.ui.locale &&
    a.ui.theme === b.ui.theme &&
    a.ui.vault_list_sort === b.ui.vault_list_sort &&
    a.ui.vault_list_sort_direction === b.ui.vault_list_sort_direction &&
    a.ui.vault_list_view === b.ui.vault_list_view &&
    a.ui.vault_list_search === b.ui.vault_list_search &&
    a.ui.vault_list_show_create_button === b.ui.vault_list_show_create_button &&
    a.ui.vault_list_show_search_button === b.ui.vault_list_show_search_button &&
    a.ui.vault_list_show_sort_button === b.ui.vault_list_show_sort_button &&
    a.ui.vault_list_show_view_button === b.ui.vault_list_show_view_button &&
    a.ui.vault_list_show_header_more_button === b.ui.vault_list_show_header_more_button &&
    a.ui.vault_list_show_vault_more_button === b.ui.vault_list_show_vault_more_button &&
    a.ui.vault_list_show_vault_settings_button === b.ui.vault_list_show_vault_settings_button &&
    a.ui.vault_list_show_group_settings_button === b.ui.vault_list_show_group_settings_button &&
    a.ui.always_show_hidden_vaults === b.ui.always_show_hidden_vaults &&
    a.ui.vault_list_show_drag === b.ui.vault_list_show_drag &&
    a.ui.vault_list_allow_drag_into_group === b.ui.vault_list_allow_drag_into_group &&
    a.ui.file_manager_dock_expanded === b.ui.file_manager_dock_expanded &&
    a.ui.file_manager_tree_split_percent === b.ui.file_manager_tree_split_percent &&
    a.ui.lifecycle_close_modal_on_submit === b.ui.lifecycle_close_modal_on_submit &&
    a.ui.lifecycle_open_file_manager_on_open === b.ui.lifecycle_open_file_manager_on_open &&
    a.ui.file_manager_confirm_delete === b.ui.file_manager_confirm_delete &&
    a.logging.enabled === b.logging.enabled &&
    a.logging.level === b.logging.level &&
    a.logging.entries_per_file === b.logging.entries_per_file &&
    a.logging.keep_last_entries === b.logging.keep_last_entries &&
    a.workspace.path.trim() === b.workspace.path.trim()
  );
}
