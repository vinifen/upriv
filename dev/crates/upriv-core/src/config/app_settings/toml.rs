//! Serde mapping for `.upriv/settings.toml` (marker + app prefs).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{Result, UprivError};
use crate::paths::{VaultRootMode, VAULT_ROOT_SETTINGS_REL};

use super::types::{AppSectionSettings, AppSettings, LoggingSettings, UiSettings};

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

#[derive(Debug, Deserialize, Serialize)]
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
    #[serde(default = "default_true")]
    pub(super) allow_drag_vault_into_group: bool,
    #[serde(default)]
    pub(super) file_manager_dock_expanded: bool,
}

impl Default for UiToml {
    fn default() -> Self {
        Self {
            locale: default_locale(),
            theme: default_theme(),
            vault_list_sort: default_sort(),
            vault_list_sort_direction: default_sort_dir(),
            vault_list_view: default_view(),
            always_show_hidden_vaults: false,
            allow_drag_vault_into_group: true,
            file_manager_dock_expanded: false,
        }
    }
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

/// Pure `settings.toml` → [`AppSettings`] parse — no disk access, no alias merge.
///
/// Mobile SAF path uses this so that `settings.toml` bytes read via the
/// Android DocumentFile bridge can be turned into the same wire shape as the
/// on-disk `load_app_settings_at()` path, without giving Rust core a SAF
/// `content://` root. Callers that also know the current vault-root mode/path
/// (from a SAF alias file managed outside Rust) can overwrite the resulting
/// `AppSettings::app` fields afterwards.
///
/// The `app` section always comes back with defaults
/// (`vault_root_mode = default_root`, `upriv_root_path = ""`) — vault-root
/// mode/path is never stored in TOML.
pub fn parse_settings_toml_str(raw: &str) -> Result<AppSettings> {
    let parsed = parse_settings_toml(raw, &PathBuf::from("settings.toml"))?;
    Ok(AppSettings {
        ui: UiSettings {
            locale: parsed.ui.locale,
            theme: parsed.ui.theme,
            vault_list_sort: parsed.ui.vault_list_sort,
            vault_list_sort_direction: parsed.ui.vault_list_sort_direction,
            vault_list_view: parsed.ui.vault_list_view,
            always_show_hidden_vaults: parsed.ui.always_show_hidden_vaults,
            allow_drag_vault_into_group: parsed.ui.allow_drag_vault_into_group,
            file_manager_dock_expanded: parsed.ui.file_manager_dock_expanded,
        },
        logging: LoggingSettings {
            enabled: parsed.logging.enabled,
            level: crate::logging::LogLevel::parse_filter(&parsed.logging.level)
                .filter_str()
                .to_string(),
            entries_per_file: parsed.logging.entries_per_file,
            keep_last_entries: parsed.logging.keep_last_entries,
        },
        app: AppSectionSettings {
            vault_root_mode: VaultRootMode::DefaultRoot,
            upriv_root_path: String::new(),
        },
    })
}

/// Pure [`AppSettings`] → `settings.toml` serialization with `[package]`
/// / `[app].last_opened_vault` preservation from `previous` (when provided).
///
/// Symmetric with [`parse_settings_toml_str`] — no disk access. Vault-root
/// mode/path fields are **not** written (same rule as [`write_settings_toml_only`]).
///
/// The Android SAF flow pairs this with the DocumentFile write in the Expo
/// module: Rust owns TOML semantics, Kotlin only moves bytes through SAF.
pub fn serialize_settings_toml_str(
    settings: &AppSettings,
    previous: Option<&str>,
) -> Result<String> {
    let (package, last_opened_vault) = package_from_previous(previous);
    let file = SettingsToml {
        package,
        ui: UiToml {
            locale: settings.ui.locale.clone(),
            theme: settings.ui.theme.clone(),
            vault_list_sort: settings.ui.vault_list_sort.clone(),
            vault_list_sort_direction: settings.ui.vault_list_sort_direction.clone(),
            vault_list_view: settings.ui.vault_list_view.clone(),
            always_show_hidden_vaults: settings.ui.always_show_hidden_vaults,
            allow_drag_vault_into_group: settings.ui.allow_drag_vault_into_group,
            file_manager_dock_expanded: settings.ui.file_manager_dock_expanded,
        },
        logging: LoggingToml {
            enabled: settings.logging.enabled,
            level: crate::logging::LogLevel::parse_filter(&settings.logging.level)
                .filter_str()
                .to_string(),
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
    Ok(format!("{header}{body}\n{footer}"))
}

/// Extract `[package]` + `[app].last_opened_vault` from a previous TOML string.
/// Falls back to fresh defaults when `previous` is missing or unparseable.
fn package_from_previous(previous: Option<&str>) -> (PackageToml, Option<String>) {
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
    if let Some(raw) = previous {
        if let Ok(prev) = toml::from_str::<SettingsToml>(raw) {
            package = prev.package;
            last_opened_vault = prev.app.last_opened_vault;
        }
    }
    (package, last_opened_vault)
}

/// Write `[ui]` / `[logging]` (and preserve `[package]` / `[app].last_opened_vault`).
pub(super) fn write_settings_toml_only(root: &Path, settings: &AppSettings) -> Result<()> {
    let path = root.join(VAULT_ROOT_SETTINGS_REL);
    let existing = if path.is_file() {
        std::fs::read_to_string(&path).ok()
    } else {
        None
    };
    let contents = serialize_settings_toml_str(settings, existing.as_deref())?;
    // Mid-session: if `.upriv` was deleted, fail — never recreate it via create_dir_all.
    // First-time init already created `.upriv/` before this write (settings may not exist yet).
    let upriv = root.join(".upriv");
    if !upriv.is_dir() {
        return Err(UprivError::VaultRootNotFound(path.clone()));
    }
    crate::paths::write_bytes_atomic_existing_parent(&path, contents.as_bytes())
}

#[cfg(test)]
mod pure_toml_tests {
    use super::*;

    #[test]
    fn parse_roundtrip_preserves_ui_and_logging() {
        let raw = r#"
[package]
version = 1
label = "Upriv"
vaults_dir = ".upriv/vaults"
state_file = ".upriv/state.json"
logs_dir = ".upriv/logs"
app_dir = ".upriv/app"
workspace_dir = "workspace"

[ui]
locale = "pt-BR"
theme = "dark"
vault_list_sort = "order"
vault_list_sort_direction = "asc"
vault_list_view = "default"
always_show_hidden_vaults = false
file_manager_dock_expanded = true

[logging]
enabled = true
level = "warn"
entries_per_file = 500
keep_last_entries = 20000

[app]
last_opened_vault = "kept"
"#;
        let settings = parse_settings_toml_str(raw).unwrap();
        assert_eq!(settings.ui.locale, "pt-BR");
        assert!(settings.ui.file_manager_dock_expanded);
        assert!(settings.ui.allow_drag_vault_into_group);
        assert_eq!(settings.logging.level, "warn");
        assert_eq!(settings.logging.entries_per_file, 500);
        // Vault-root mode/path never come from TOML.
        assert_eq!(settings.app.vault_root_mode, VaultRootMode::DefaultRoot);
        assert!(settings.app.upriv_root_path.is_empty());
    }

    #[test]
    fn serialize_preserves_package_and_last_opened_vault() {
        let previous = r#"
[package]
version = 1
label = "Upriv"
vaults_dir = ".upriv/vaults"
state_file = ".upriv/state.json"
logs_dir = ".upriv/logs"
app_dir = ".upriv/app"
workspace_dir = "workspace"
default_vault = "notes"

[ui]
locale = "en"

[logging]
enabled = true

[app]
last_opened_vault = "notes"
"#;
        let mut settings = AppSettings::default();
        settings.ui.locale = "es".into();
        // Explicit custom_root should NOT be written to TOML — alias is the source of truth.
        settings.app.vault_root_mode = VaultRootMode::CustomRoot;
        settings.app.upriv_root_path = "content://ignored".into();
        let out = serialize_settings_toml_str(&settings, Some(previous)).unwrap();
        assert!(out.contains("locale = \"es\""));
        assert!(out.contains("default_vault = \"notes\""));
        assert!(out.contains("last_opened_vault = \"notes\""));
        assert!(
            !out.contains("vault_root_mode") && !out.contains("upriv_root_path"),
            "mode/path must not be persisted: {out}"
        );
    }

    #[test]
    fn serialize_without_previous_uses_defaults() {
        let out = serialize_settings_toml_str(&AppSettings::default(), None).unwrap();
        assert!(out.contains("[package]"));
        assert!(out.contains("vaults_dir = \".upriv/vaults\""));
        assert!(out.contains("locale = \"en\""));
        assert!(!out.contains("last_opened_vault"));
    }

    #[test]
    fn parse_rejects_broken_toml() {
        let err = parse_settings_toml_str("[package\nversion = 1\n").unwrap_err();
        assert!(matches!(err, UprivError::VaultRootIncomplete { .. }));
    }
}
