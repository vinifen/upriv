//! Load / save `.upriv/settings.toml` (`[ui]`, `[logging]`, `[app]`).
//!
//! Vault-root **mode and path are not stored in TOML**. They live in the app-home
//! `.upriv-root` alias (`status=active|inactive` + path). The wire/`AppSettings`
//! fields `auto_detect_vault_root` and `upriv_root_path` are derived on load and
//! drive alias updates on save.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{Result, UprivError};
use crate::paths::{
    app_home_dir, deactivate_vault_root_alias_everywhere, discover_vault_root_near,
    env_nearby_anchor, read_vault_root_alias, setup_nearby_anchor, write_vault_root_alias,
    VaultRoot, VAULT_ROOT_SETTINGS_REL,
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
    /// Derived from `.upriv-root` (`status=active` → false). Not written to TOML.
    pub auto_detect_vault_root: bool,
    /// Derived from `.upriv-root` when fixed; empty when auto. Not written to TOML.
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

#[derive(Debug, Deserialize, Serialize)]
struct SettingsToml {
    package: PackageToml,
    #[serde(default)]
    ui: UiToml,
    #[serde(default)]
    logging: LoggingToml,
    #[serde(default)]
    app: AppToml,
}

#[derive(Debug, Deserialize, Serialize)]
struct PackageToml {
    #[serde(default = "default_package_version")]
    version: i64,
    #[serde(default = "default_label")]
    label: String,
    #[serde(default = "default_vaults_dir")]
    vaults_dir: String,
    #[serde(default = "default_state_file")]
    state_file: String,
    #[serde(default = "default_logs_dir")]
    logs_dir: String,
    #[serde(default = "default_app_dir")]
    app_dir: String,
    #[serde(default = "default_workspace_dir")]
    workspace_dir: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    default_vault: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    last_opened_vault: Option<String>,
}

fn default_package_version() -> i64 {
    1
}
fn default_label() -> String {
    "Upriv".into()
}
fn default_vaults_dir() -> String {
    ".upriv/vaults".into()
}
fn default_state_file() -> String {
    ".upriv/state.json".into()
}
fn default_logs_dir() -> String {
    ".upriv/logs".into()
}
fn default_app_dir() -> String {
    ".upriv/app".into()
}
fn default_workspace_dir() -> String {
    "workspace".into()
}

#[derive(Debug, Default, Deserialize, Serialize)]
struct UiToml {
    #[serde(default = "default_locale")]
    locale: String,
    #[serde(default = "default_theme")]
    theme: String,
    #[serde(default = "default_sort")]
    vault_list_sort: String,
    #[serde(default = "default_sort_dir")]
    vault_list_sort_direction: String,
    #[serde(default = "default_view")]
    vault_list_view: String,
    #[serde(default)]
    always_show_hidden_vaults: bool,
    #[serde(default)]
    file_manager_dock_expanded: bool,
}

fn default_locale() -> String {
    "en".into()
}
fn default_theme() -> String {
    "dark".into()
}
fn default_sort() -> String {
    "order".into()
}
fn default_sort_dir() -> String {
    "asc".into()
}
fn default_view() -> String {
    "default".into()
}

#[derive(Debug, Deserialize, Serialize)]
struct LoggingToml {
    #[serde(default = "default_true")]
    enabled: bool,
    #[serde(default = "default_log_level")]
    level: String,
    #[serde(default = "default_entries")]
    entries_per_file: u32,
    #[serde(default = "default_keep")]
    keep_last_entries: u32,
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
fn default_log_level() -> String {
    "info".into()
}
fn default_entries() -> u32 {
    1000
}
fn default_keep() -> u32 {
    10_000
}

#[derive(Debug, Default, Deserialize, Serialize)]
struct AppToml {
    /// Other `[app]` keys (e.g. `last_opened_vault`). Legacy `auto_detect_vault_root`
    /// in old files is ignored by serde (unknown field) — mode is `.upriv-root` only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    last_opened_vault: Option<String>,
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
                auto_detect_vault_root: true,
                upriv_root_path: String::new(),
            },
        }
    }
}

/// Bootstrap: active alias root, else nearby (exact anchor when `UPRIV_NEARBY_ANCHOR` set).
///
/// When `.upriv-root` is **active**, a failed open is returned as an error (no nearby
/// fallback) so settings load/save cannot silently use a different root while the UI
/// still shows fixed mode.
pub fn discover_bootstrap_root() -> Result<Option<VaultRoot>> {
    let home = app_home_dir()?;
    if let Some(alias) = read_vault_root_alias(&home)? {
        if alias.active {
            return match VaultRoot::discover(&alias.path) {
                Ok(root) => Ok(Some(root)),
                Err(error @ UprivError::VaultRootIncomplete { .. }) => Err(error),
                Err(error @ UprivError::Io(_)) => Err(error),
                Err(_) => Err(UprivError::VaultRootAliasInvalid(alias.path)),
            };
        }
    }

    if env_nearby_anchor().is_some() {
        return Ok(VaultRoot::discover(&home).ok());
    }

    if let Some(found) = discover_vault_root_near(&home) {
        return Ok(VaultRoot::discover(&found).ok());
    }
    if let Ok(cwd) = std::env::current_dir() {
        if cwd != home {
            if let Some(found) = discover_vault_root_near(&cwd) {
                return Ok(VaultRoot::discover(&found).ok());
            }
        }
    }
    Ok(None)
}

/// Load settings from the bootstrap root, or defaults when no root exists yet.
/// Always merge vault-root mode from `.upriv-root` (even when no readable root yet).
///
/// Active alias that fails to open → defaults + alias-derived wire fields (`on_disk: false`)
/// so the UI can still show fixed mode / Gate alias-invalid without falling back to nearby TOML.
pub fn load_app_settings() -> Result<LoadedAppSettings> {
    match discover_bootstrap_root() {
        Ok(Some(root)) => load_app_settings_at(root.root()),
        Ok(None) => {
            let mut settings = AppSettings::default();
            apply_alias_to_app_settings(&mut settings);
            Ok(LoadedAppSettings {
                settings,
                root_path: None,
                on_disk: false,
            })
        }
        Err(
            UprivError::VaultRootAliasInvalid(_)
            | UprivError::VaultRootIncomplete { .. }
            | UprivError::Io(_),
        ) => {
            let mut settings = AppSettings::default();
            apply_alias_to_app_settings(&mut settings);
            Ok(LoadedAppSettings {
                settings,
                root_path: None,
                on_disk: false,
            })
        }
        Err(error) => Err(error),
    }
}

/// Apply `.upriv-root` → wire `auto_detect_vault_root` / `upriv_root_path`.
fn apply_alias_to_app_settings(settings: &mut AppSettings) {
    settings.app.auto_detect_vault_root = true;
    settings.app.upriv_root_path.clear();
    let Ok(home) = app_home_dir() else {
        return;
    };
    let Ok(Some(alias)) = read_vault_root_alias(&home) else {
        return;
    };
    if alias.active {
        settings.app.auto_detect_vault_root = false;
        match alias.path.to_str() {
            Some(s) if !s.contains('\n') && !s.contains('\r') => {
                settings.app.upriv_root_path = s.to_string();
            }
            _ => {
                // Keep fixed mode but leave path empty — UI must re-pick (non-UTF-8 / newline).
                settings.app.upriv_root_path.clear();
            }
        }
    }
}

/// Load `.upriv/settings.toml` at `root` and derive vault-root mode from `.upriv-root`.
pub fn load_app_settings_at(root: &Path) -> Result<LoadedAppSettings> {
    // Same marker rules as discover / inspect (reject incomplete before serde defaults).
    crate::paths::validate_existing_vault_root(root)?;
    let path = root.join(VAULT_ROOT_SETTINGS_REL);
    let raw = std::fs::read_to_string(&path).map_err(UprivError::from)?;
    let parsed: SettingsToml =
        toml::from_str(&raw).map_err(|error| UprivError::VaultRootIncomplete {
            path: path.clone(),
            detail: format!("invalid settings.toml: {error}"),
        })?;

    let mut settings = AppSettings {
        ui: UiSettings {
            locale: parsed.ui.locale,
            theme: parsed.ui.theme,
            vault_list_sort: parsed.ui.vault_list_sort,
            vault_list_sort_direction: parsed.ui.vault_list_sort_direction,
            vault_list_view: parsed.ui.vault_list_view,
            always_show_hidden_vaults: parsed.ui.always_show_hidden_vaults,
            file_manager_dock_expanded: parsed.ui.file_manager_dock_expanded,
        },
        logging: LoggingSettings {
            enabled: parsed.logging.enabled,
            level: parsed.logging.level,
            entries_per_file: parsed.logging.entries_per_file,
            keep_last_entries: parsed.logging.keep_last_entries,
        },
        app: AppSectionSettings {
            auto_detect_vault_root: true,
            upriv_root_path: String::new(),
        },
    };

    apply_alias_to_app_settings(&mut settings);

    Ok(LoadedAppSettings {
        settings,
        root_path: Some(root.to_path_buf()),
        on_disk: true,
    })
}

/// After first-run setup, set `[ui].locale` on the new root without changing other fields.
/// Does not sync `.upriv-root` (caller already wrote/deactivated the alias).
pub fn apply_setup_ui_locale(root: &Path, locale: Option<&str>) -> Result<()> {
    let Some(locale) = locale.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(());
    };
    let mut loaded = load_app_settings_at(root)?;
    if loaded.settings.ui.locale == locale {
        return Ok(());
    }
    loaded.settings.ui.locale = locale.to_string();
    // Write TOML only — skip alias sync (setup RPCs already set alias state).
    write_settings_toml_only(root, &loaded.settings)
}

fn write_settings_toml_only(root: &Path, settings: &AppSettings) -> Result<()> {
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
# Vault-root mode (auto vs fixed) is NOT configured in this file.
# It lives in the app-home `.upriv-root` alias:
#   missing or status=inactive → auto-detect nearby
#   status=active + path → fixed vault-root
";
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let contents = format!("{header}{body}\n{footer}");
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp = path.with_extension(format!("toml.tmp.{}.{}", std::process::id(), nonce));
    {
        use std::io::Write;
        let mut file = std::fs::File::create(&tmp)?;
        file.write_all(contents.as_bytes())?;
        file.sync_all()?;
    }
    std::fs::rename(&tmp, &path)?;
    Ok(())
}

/// Write settings.toml at `root` and sync `.upriv-root` from wire `app` fields.
pub fn save_app_settings(root: &Path, settings: &AppSettings) -> Result<()> {
    write_settings_toml_only(root, settings)?;
    sync_alias_with_app_settings(settings)?;
    Ok(())
}

/// Align `.upriv-root` with settings: auto → deactivate; fixed → write active alias.
pub fn sync_alias_with_app_settings(settings: &AppSettings) -> Result<()> {
    if settings.app.auto_detect_vault_root {
        deactivate_vault_root_alias_everywhere()?;
        return Ok(());
    }
    let path = settings.app.upriv_root_path.trim();
    if path.is_empty() {
        return Err(UprivError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "fixed vault-root mode requires a non-empty upriv_root_path",
        )));
    }
    let home = app_home_dir()?;
    write_vault_root_alias(&home, path)?;
    Ok(())
}

/// Save when a writable vault-root exists for the **desired** mode; else `Ok(false)`.
///
/// Target is chosen from the payload (not from the current active alias):
/// - fixed → `upriv_root_path` (must already be a valid root)
/// - auto → nearby anchor only (where `setup_nearby` creates); never the old fixed root
pub fn save_app_settings_session(settings: &AppSettings) -> Result<bool> {
    let target = if !settings.app.auto_detect_vault_root {
        let path = settings.app.upriv_root_path.trim();
        if path.is_empty() {
            return Ok(false);
        }
        PathBuf::from(path)
    } else {
        let anchor = setup_nearby_anchor()?;
        match VaultRoot::discover(&anchor) {
            Ok(root) => root.root().to_path_buf(),
            Err(_) => return Ok(false),
        }
    };

    if VaultRoot::discover(&target).is_err() {
        return Ok(false);
    }
    save_app_settings(&target, settings)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::{initialize_vault_root, write_vault_root_alias, ENV_LOCK};

    #[test]
    fn roundtrip_settings_toml() {
        let _guard = ENV_LOCK.lock().unwrap();
        let home = tempfile::tempdir().unwrap();
        std::env::remove_var("APPIMAGE");
        std::env::set_var("UPRIV_NEARBY_ANCHOR", home.path());

        let dir = tempfile::tempdir().unwrap();
        initialize_vault_root(dir.path()).unwrap();
        let mut settings = AppSettings::default();
        settings.ui.locale = "pt-BR".into();
        settings.app.auto_detect_vault_root = true;
        save_app_settings(dir.path(), &settings).unwrap();

        let raw = std::fs::read_to_string(dir.path().join(".upriv/settings.toml")).unwrap();
        assert!(
            !raw.contains("auto_detect_vault_root"),
            "mode must not be persisted in settings.toml"
        );
        assert!(raw.contains(".upriv-root"));

        let loaded = load_app_settings_at(dir.path()).unwrap();
        assert_eq!(loaded.settings.ui.locale, "pt-BR");
        assert!(loaded.settings.app.auto_detect_vault_root);
        assert!(loaded.on_disk);

        std::env::remove_var("UPRIV_NEARBY_ANCHOR");
    }

    #[test]
    fn save_fixed_writes_active_alias() {
        let _guard = ENV_LOCK.lock().unwrap();
        let home = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        initialize_vault_root(root.path()).unwrap();
        std::env::remove_var("APPIMAGE");
        std::env::set_var("UPRIV_NEARBY_ANCHOR", home.path());

        let mut settings = AppSettings::default();
        settings.app.auto_detect_vault_root = false;
        settings.app.upriv_root_path = root.path().to_string_lossy().into_owned();
        save_app_settings(root.path(), &settings).unwrap();

        let alias = read_vault_root_alias(home.path()).unwrap().unwrap();
        assert!(alias.active);
        assert_eq!(alias.path, root.path().canonicalize().unwrap());

        let raw = std::fs::read_to_string(root.path().join(".upriv/settings.toml")).unwrap();
        assert!(!raw.contains("auto_detect_vault_root"));

        settings.app.auto_detect_vault_root = true;
        settings.app.upriv_root_path.clear();
        save_app_settings(root.path(), &settings).unwrap();
        let alias = read_vault_root_alias(home.path()).unwrap().unwrap();
        assert!(!alias.active);

        std::env::remove_var("UPRIV_NEARBY_ANCHOR");
    }

    #[test]
    fn load_derives_mode_from_alias_not_toml() {
        let _guard = ENV_LOCK.lock().unwrap();
        let home = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        initialize_vault_root(root.path()).unwrap();
        write_vault_root_alias(home.path(), root.path()).unwrap();
        std::env::remove_var("APPIMAGE");
        std::env::set_var("UPRIV_NEARBY_ANCHOR", home.path());

        // Legacy TOML may still claim auto=true while alias is active — alias wins.
        let settings_path = root.path().join(".upriv/settings.toml");
        std::fs::write(
            &settings_path,
            r#"
[package]
version = 1
vaults_dir = ".upriv/vaults"

[ui]
locale = "en"

[logging]
enabled = true

[app]
auto_detect_vault_root = true
"#,
        )
        .unwrap();

        let loaded = load_app_settings_at(root.path()).unwrap();
        assert!(!loaded.settings.app.auto_detect_vault_root);
        assert_eq!(
            loaded.settings.app.upriv_root_path,
            root.path().canonicalize().unwrap().to_string_lossy()
        );

        std::env::remove_var("UPRIV_NEARBY_ANCHOR");
    }

    #[test]
    fn active_broken_alias_does_not_fall_back_to_nearby() {
        let _guard = ENV_LOCK.lock().unwrap();
        let home = tempfile::tempdir().unwrap();
        let nearby = tempfile::tempdir().unwrap();
        let missing = home.path().join("gone-fixed");
        initialize_vault_root(nearby.path()).unwrap();
        let alias_path = home.path().join(".upriv-root");
        std::fs::write(
            &alias_path,
            format!("status=active\npath={}\n", missing.display()),
        )
        .unwrap();
        std::env::remove_var("APPIMAGE");
        // App home = `home` (alias lives here); nearby root is a different folder.
        std::env::set_var("UPRIV_NEARBY_ANCHOR", home.path());
        initialize_vault_root(home.path()).unwrap();

        let err = discover_bootstrap_root().unwrap_err();
        assert!(
            matches!(
                err,
                UprivError::VaultRootAliasInvalid(_)
                    | UprivError::Io(_)
                    | UprivError::VaultRootIncomplete { .. }
            ),
            "expected alias open failure, got {err:?}"
        );

        let loaded = load_app_settings().unwrap();
        assert!(!loaded.on_disk);
        assert!(!loaded.settings.app.auto_detect_vault_root);
        assert!(loaded.settings.app.upriv_root_path.contains("gone-fixed"));

        std::env::remove_var("UPRIV_NEARBY_ANCHOR");
        let _ = nearby;
    }

    #[test]
    fn save_session_auto_writes_nearby_not_old_fixed() {
        let _guard = ENV_LOCK.lock().unwrap();
        let home = tempfile::tempdir().unwrap();
        let fixed = tempfile::tempdir().unwrap();
        initialize_vault_root(home.path()).unwrap();
        initialize_vault_root(fixed.path()).unwrap();
        write_vault_root_alias(home.path(), fixed.path()).unwrap();
        std::env::remove_var("APPIMAGE");
        std::env::set_var("UPRIV_NEARBY_ANCHOR", home.path());

        std::fs::write(
            fixed.path().join(".upriv/settings.toml"),
            r#"
[package]
version = 1
vaults_dir = ".upriv/vaults"
[ui]
locale = "en"
[logging]
enabled = true
"#,
        )
        .unwrap();

        let mut settings = AppSettings::default();
        settings.ui.locale = "pt-BR".into();
        settings.app.auto_detect_vault_root = true;
        settings.app.upriv_root_path.clear();
        assert!(save_app_settings_session(&settings).unwrap());

        let nearby_raw = std::fs::read_to_string(home.path().join(".upriv/settings.toml")).unwrap();
        assert!(nearby_raw.contains("pt-BR"));
        let fixed_raw = std::fs::read_to_string(fixed.path().join(".upriv/settings.toml")).unwrap();
        assert!(!fixed_raw.contains("pt-BR"));

        std::env::remove_var("UPRIV_NEARBY_ANCHOR");
    }
}
