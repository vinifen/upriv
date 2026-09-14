//! Wire / in-memory app settings (matches TS `AppSettingsConfig`).

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::paths::VaultRootMode;

use super::toml::{
    default_entries, default_keep, default_locale, default_log_level, default_sort,
    default_sort_dir, default_theme, default_view,
};

fn default_true() -> bool {
    true
}

fn default_false() -> bool {
    false
}

/// In-memory app settings matching the TS `AppSettingsConfig` wire shape (snake_case JSON).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AppSettings {
    pub ui: UiSettings,
    pub logging: LoggingSettings,
    pub app: AppSectionSettings,
    /// Default mount parent (`[workspace]` in settings.toml). Empty path = unset.
    #[serde(default)]
    pub workspace: WorkspaceSettings,
}

/// App `[workspace]` — mount parent for open vaults.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct WorkspaceSettings {
    /// Absolute path, or empty when unset.
    #[serde(default)]
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UiSettings {
    pub locale: String,
    pub theme: String,
    pub vault_list_sort: String,
    pub vault_list_sort_direction: String,
    pub vault_list_view: String,
    /// Vault list search query. Control expands only while focused.
    #[serde(default)]
    pub vault_list_search: String,
    /// UI: show the new-vault button. Default true.
    #[serde(default = "default_true", alias = "vault_list_show_create")]
    pub vault_list_show_create_button: bool,
    /// UI: show the list search button. Default true.
    #[serde(default = "default_true", alias = "vault_list_show_search")]
    pub vault_list_show_search_button: bool,
    /// UI: show the sort button. Default true.
    #[serde(default = "default_true", alias = "vault_list_show_sort")]
    pub vault_list_show_sort_button: bool,
    /// UI: show the view button. Default true.
    #[serde(default = "default_true", alias = "vault_list_show_view")]
    pub vault_list_show_view_button: bool,
    /// UI: show the header overflow (⋮) menu. Default true.
    #[serde(default = "default_true")]
    pub vault_list_show_header_more_button: bool,
    /// UI: show the vault row overflow (⋯) menu. Default true.
    #[serde(default = "default_true")]
    pub vault_list_show_vault_more_button: bool,
    /// UI: show the vault row settings (gear) menu. Default true.
    #[serde(default = "default_true")]
    pub vault_list_show_vault_settings_button: bool,
    /// UI: show the group header settings (gear) menu. Default true.
    #[serde(default = "default_true")]
    pub vault_list_show_group_settings_button: bool,
    #[serde(default, alias = "vault_list_always_show_hidden")]
    pub always_show_hidden_vaults: bool,
    /// UI: show vertical drag handles on the vault list (drag up/down). Default true.
    #[serde(
        default = "default_true",
        alias = "show_drag_vault_list",
        alias = "allow_drag_vault_list"
    )]
    pub vault_list_show_drag: bool,
    /// Dropping a vault onto a group assigns it. Default true; missing TOML/JSON → true.
    #[serde(default = "default_true", alias = "allow_drag_vault_into_group")]
    pub vault_list_allow_drag_into_group: bool,
    pub file_manager_dock_expanded: bool,
    /// Close unlock/lock password dialog on Confirm (progress on the row). Default false.
    #[serde(default = "default_false")]
    pub lifecycle_close_modal_on_submit: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LoggingSettings {
    pub enabled: bool,
    pub level: String,
    pub entries_per_file: u32,
    pub keep_last_entries: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AppSectionSettings {
    /// Derived from `.upriv-root` (`status=active` → [`VaultRootMode::CustomRoot`]). Not written to TOML.
    pub vault_root_mode: VaultRootMode,
    /// Derived from `.upriv-root` when custom; empty when default_root. Not written to TOML.
    #[serde(default)]
    pub upriv_root_path: String,
    /// `[app].last_opened_vault` — always written (empty = none).
    #[serde(default)]
    pub last_opened_vault: String,
}

#[derive(Debug, Clone)]
pub struct LoadedAppSettings {
    pub settings: AppSettings,
    /// Vault-root used when loading from disk (`None` = defaults, no root yet).
    pub root_path: Option<PathBuf>,
    pub on_disk: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            ui: UiSettings {
                locale: default_locale(),
                theme: default_theme(),
                vault_list_sort: default_sort(),
                vault_list_sort_direction: default_sort_dir(),
                vault_list_view: default_view(),
                vault_list_search: String::new(),
                vault_list_show_create_button: true,
                vault_list_show_search_button: true,
                vault_list_show_sort_button: true,
                vault_list_show_view_button: true,
                vault_list_show_header_more_button: true,
                vault_list_show_vault_more_button: true,
                vault_list_show_vault_settings_button: true,
                vault_list_show_group_settings_button: true,
                always_show_hidden_vaults: false,
                vault_list_show_drag: true,
                vault_list_allow_drag_into_group: true,
                file_manager_dock_expanded: false,
                lifecycle_close_modal_on_submit: false,
            },
            logging: LoggingSettings {
                enabled: true,
                level: default_log_level(),
                entries_per_file: default_entries(),
                keep_last_entries: default_keep(),
            },
            app: AppSectionSettings {
                vault_root_mode: VaultRootMode::DefaultRoot,
                upriv_root_path: String::new(),
                last_opened_vault: String::new(),
            },
            workspace: WorkspaceSettings::default(),
        }
    }
}
