//! Serde mapping for `.upriv/settings.toml` (marker + app prefs).

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::{Result, UprivError};
use crate::paths::VAULT_ROOT_SETTINGS_REL;

use super::types::AppSettings;

#[derive(Debug, Deserialize, Serialize)]
pub(super) struct SettingsToml {
    pub(super) package: PackageToml,
    #[serde(default)]
    pub(super) ui: UiToml,
    #[serde(default)]
    pub(super) logging: LoggingToml,
    #[serde(default)]
    pub(super) app: AppToml,
}

#[derive(Debug, Deserialize, Serialize)]
pub(super) struct PackageToml {
    #[serde(default = "default_package_version")]
    pub(super) version: i64,
    #[serde(default = "default_label")]
    pub(super) label: String,
    #[serde(default = "default_vaults_dir")]
    pub(super) vaults_dir: String,
    #[serde(default = "default_state_file")]
    pub(super) state_file: String,
    #[serde(default = "default_logs_dir")]
    pub(super) logs_dir: String,
    #[serde(default = "default_app_dir")]
    pub(super) app_dir: String,
    #[serde(default = "default_workspace_dir")]
    pub(super) workspace_dir: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) default_vault: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) last_opened_vault: Option<String>,
}

pub(crate) fn default_package_version() -> i64 {
    1
}
pub(crate) fn default_label() -> String {
    "Upriv".into()
}
pub(crate) fn default_vaults_dir() -> String {
    ".upriv/vaults".into()
}
pub(crate) fn default_state_file() -> String {
    ".upriv/state.json".into()
}
pub(crate) fn default_logs_dir() -> String {
    ".upriv/logs".into()
}
pub(crate) fn default_app_dir() -> String {
    ".upriv/app".into()
}
pub(crate) fn default_workspace_dir() -> String {
    "workspace".into()
}

#[derive(Debug, Default, Deserialize, Serialize)]
pub(super) struct UiToml {
    #[serde(default = "default_locale")]
    pub(super) locale: String,
    #[serde(default = "default_theme")]
    pub(super) theme: String,
    #[serde(default = "default_sort")]
    pub(super) vault_list_sort: String,
    #[serde(default = "default_sort_dir")]
    pub(super) vault_list_sort_direction: String,
    #[serde(default = "default_view")]
    pub(super) vault_list_view: String,
    #[serde(default)]
    pub(super) always_show_hidden_vaults: bool,
    #[serde(default)]
    pub(super) file_manager_dock_expanded: bool,
}

pub(crate) fn default_locale() -> String {
    "en".into()
}
pub(crate) fn default_theme() -> String {
    "dark".into()
}
pub(crate) fn default_sort() -> String {
    "order".into()
}
pub(crate) fn default_sort_dir() -> String {
    "asc".into()
}
pub(crate) fn default_view() -> String {
    "default".into()
}

#[derive(Debug, Deserialize, Serialize)]
pub(super) struct LoggingToml {
    #[serde(default = "default_true")]
    pub(super) enabled: bool,
    #[serde(default = "default_log_level")]
    pub(super) level: String,
    #[serde(default = "default_entries")]
    pub(super) entries_per_file: u32,
    #[serde(default = "default_keep")]
    pub(super) keep_last_entries: u32,
}

impl Default for LoggingToml {
    fn default() -> Self {
        Self {
            enabled: true,
            level: default_log_level(),
            entries_per_file: default_entries(),
            keep_last_entries: default_keep(),
        }
    }
}

fn default_true() -> bool {
    true
}
pub(crate) fn default_log_level() -> String {
    "info".into()
}
pub(crate) fn default_entries() -> u32 {
    1000
}
pub(crate) fn default_keep() -> u32 {
    10_000
}

#[derive(Debug, Default, Deserialize, Serialize)]
pub(super) struct AppToml {
    /// Other `[app]` keys (e.g. `last_opened_vault`). Unknown historical keys
    /// in old TOML are ignored by serde — vault-root mode is `.upriv-root` only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) last_opened_vault: Option<String>,
}

pub(super) fn parse_settings_toml(raw: &str, path: &Path) -> Result<SettingsToml> {
    toml::from_str(raw).map_err(|error| UprivError::VaultRootIncomplete {
        path: path.to_path_buf(),
        detail: format!("invalid settings.toml: {error}"),
    })
}

/// Write `[ui]` / `[logging]` (and preserve `[package]` / `[app].last_opened_vault`).
pub(super) fn write_settings_toml_only(root: &Path, settings: &AppSettings) -> Result<()> {
    let path = root.join(VAULT_ROOT_SETTINGS_REL);
    let existing = if path.is_file() {
        std::fs::read_to_string(&path).ok()
    } else {
        None
    };
    let mut package = PackageToml {
        version: default_package_version(),
        label: default_label(),
        vaults_dir: default_vaults_dir(),
        state_file: default_state_file(),
        logs_dir: default_logs_dir(),
        app_dir: default_app_dir(),
        workspace_dir: default_workspace_dir(),
        default_vault: None,
        last_opened_vault: None,
    };
    let mut last_opened_vault = None;
    if let Some(raw) = existing.as_deref() {
        if let Ok(prev) = toml::from_str::<SettingsToml>(raw) {
            package = prev.package;
            last_opened_vault = prev.app.last_opened_vault;
        }
    }

    let file = SettingsToml {
        package,
        ui: UiToml {
            locale: settings.ui.locale.clone(),
            theme: settings.ui.theme.clone(),
            vault_list_sort: settings.ui.vault_list_sort.clone(),
            vault_list_sort_direction: settings.ui.vault_list_sort_direction.clone(),
            vault_list_view: settings.ui.vault_list_view.clone(),
            always_show_hidden_vaults: settings.ui.always_show_hidden_vaults,
            file_manager_dock_expanded: settings.ui.file_manager_dock_expanded,
        },
        logging: LoggingToml {
            enabled: settings.logging.enabled,
            level: settings.logging.level.clone(),
            entries_per_file: settings.logging.entries_per_file,
            keep_last_entries: settings.logging.keep_last_entries,
        },
        app: AppToml { last_opened_vault },
    };

    let body = toml::to_string_pretty(&file).map_err(|error| {
        UprivError::Io(std::io::Error::other(format!(
            "serialize settings.toml: {error}"
        )))
    })?;
    let header = "# Upriv marker + app settings (vault-root directory)\n\n";
    let footer = "\
# Vault-root mode (`default_root` vs `custom_root`) is NOT configured in this file.
# It lives in the app-home `.upriv-root` alias:
#   missing or status=inactive → default_root mode
#   status=active + path → custom_root
";
    let contents = format!("{header}{body}\n{footer}");
    crate::paths::write_bytes_atomic(&path, contents.as_bytes())
}
