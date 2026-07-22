//! Wire / in-memory app settings (matches TS `AppSettingsConfig`).

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::paths::VaultRootMode;

use super::toml::{
    default_entries, default_keep, default_locale, default_log_level, default_sort,
    default_sort_dir, default_theme, default_view,
};

/// In-memory app settings matching the TS `AppSettingsConfig` wire shape (snake_case JSON).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AppSettings {
    pub ui: UiSettings,
    pub logging: LoggingSettings,
    pub app: AppSectionSettings,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UiSettings {
    pub locale: String,
    pub theme: String,
    pub vault_list_sort: String,
    pub vault_list_sort_direction: String,
    pub vault_list_view: String,
    pub always_show_hidden_vaults: bool,
    pub file_manager_dock_expanded: bool,
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
                always_show_hidden_vaults: false,
                file_manager_dock_expanded: false,
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
            },
        }
    }
}
