//! Serde mapping for `.upriv/settings.toml` (marker + app prefs).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{Result, UprivError};
use crate::paths::{validate_workspace_global_path, VaultRootMode, VAULT_ROOT_SETTINGS_REL};

use super::types::{
    AppSectionSettings, AppSettings, LoggingSettings, UiSettings, WorkspaceSettings,
};

#[derive(Debug, Deserialize, Serialize)]
pub(super) struct SettingsToml {
    pub(super) package: PackageToml,
    #[serde(default)]
    pub(super) ui: UiToml,
    #[serde(default)]
    pub(super) logging: LoggingToml,
    #[serde(default)]
    pub(super) app: AppToml,
    #[serde(default)]
    pub(super) workspace: WorkspaceToml,
}

#[derive(Debug, Default, Deserialize, Serialize)]
pub(super) struct WorkspaceToml {
    #[serde(default)]
    pub(super) path: String,
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

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(default)]
pub(super) struct UiToml {
    pub(super) locale: String,
    pub(super) theme: String,
    pub(super) show_header_more_button: bool,
    pub(super) file_manager_dock_expanded: bool,
    pub(super) always_show_hidden_vaults: bool,
    pub(super) vault_list_sort: String,
    pub(super) vault_list_sort_direction: String,
    pub(super) vault_list_view: String,
    pub(super) vault_list_search: String,
    pub(super) vault_list_show_drag: bool,
    pub(super) vault_list_allow_drag_into_group: bool,
    pub(super) vault_list_show_create_button: bool,
    pub(super) vault_list_show_search_button: bool,
    pub(super) vault_list_show_sort_button: bool,
    pub(super) vault_list_show_view_button: bool,
    pub(super) vault_list_show_vault_more_button: bool,
    pub(super) vault_list_show_vault_settings_button: bool,
    pub(super) vault_list_show_group_settings_button: bool,
    /// Close unlock/lock password dialog on Confirm. Default false.
    pub(super) lifecycle_close_modal_on_submit: bool,
}

impl Default for UiToml {
    fn default() -> Self {
        Self {
            locale: default_locale(),
            theme: default_theme(),
            show_header_more_button: true,
            file_manager_dock_expanded: false,
            always_show_hidden_vaults: false,
            vault_list_sort: default_sort(),
            vault_list_sort_direction: default_sort_dir(),
            vault_list_view: default_view(),
            vault_list_search: String::new(),
            vault_list_show_drag: true,
            vault_list_allow_drag_into_group: true,
            vault_list_show_create_button: true,
            vault_list_show_search_button: true,
            vault_list_show_sort_button: true,
            vault_list_show_view_button: true,
            vault_list_show_vault_more_button: true,
            vault_list_show_vault_settings_button: true,
            vault_list_show_group_settings_button: true,
            lifecycle_close_modal_on_submit: false,
        }
    }
}

fn ui_toml_from_settings(ui: &UiSettings) -> UiToml {
    UiToml {
        locale: ui.locale.clone(),
        theme: ui.theme.clone(),
        show_header_more_button: ui.vault_list_show_header_more_button,
        file_manager_dock_expanded: ui.file_manager_dock_expanded,
        always_show_hidden_vaults: ui.always_show_hidden_vaults,
        vault_list_sort: ui.vault_list_sort.clone(),
        vault_list_sort_direction: ui.vault_list_sort_direction.clone(),
        vault_list_view: ui.vault_list_view.clone(),
        vault_list_search: ui.vault_list_search.clone(),
        vault_list_show_drag: ui.vault_list_show_drag,
        vault_list_allow_drag_into_group: ui.vault_list_allow_drag_into_group,
        vault_list_show_create_button: ui.vault_list_show_create_button,
        vault_list_show_search_button: ui.vault_list_show_search_button,
        vault_list_show_sort_button: ui.vault_list_show_sort_button,
        vault_list_show_view_button: ui.vault_list_show_view_button,
        vault_list_show_vault_more_button: ui.vault_list_show_vault_more_button,
        vault_list_show_vault_settings_button: ui.vault_list_show_vault_settings_button,
        vault_list_show_group_settings_button: ui.vault_list_show_group_settings_button,
        lifecycle_close_modal_on_submit: ui.lifecycle_close_modal_on_submit,
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

pub(super) fn ui_settings_from_toml(ui: &UiToml) -> UiSettings {
    UiSettings {
        locale: ui.locale.clone(),
        theme: ui.theme.clone(),
        vault_list_sort: ui.vault_list_sort.clone(),
        vault_list_sort_direction: ui.vault_list_sort_direction.clone(),
        vault_list_view: ui.vault_list_view.clone(),
        vault_list_search: ui.vault_list_search.clone(),
        vault_list_show_create_button: ui.vault_list_show_create_button,
        vault_list_show_search_button: ui.vault_list_show_search_button,
        vault_list_show_sort_button: ui.vault_list_show_sort_button,
        vault_list_show_view_button: ui.vault_list_show_view_button,
        vault_list_show_header_more_button: ui.show_header_more_button,
        vault_list_show_vault_more_button: ui.vault_list_show_vault_more_button,
        vault_list_show_vault_settings_button: ui.vault_list_show_vault_settings_button,
        vault_list_show_group_settings_button: ui.vault_list_show_group_settings_button,
        always_show_hidden_vaults: ui.always_show_hidden_vaults,
        vault_list_show_drag: ui.vault_list_show_drag,
        vault_list_allow_drag_into_group: ui.vault_list_allow_drag_into_group,
        file_manager_dock_expanded: ui.file_manager_dock_expanded,
        lifecycle_close_modal_on_submit: ui.lifecycle_close_modal_on_submit,
    }
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
    /// Last vault id opened in the UI (empty = none). Always written so the
    /// key stays visible in `settings.toml`; vault-root mode lives in `.upriv-root`.
    #[serde(default)]
    pub(super) last_opened_vault: String,
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
        ui: ui_settings_from_toml(&parsed.ui),
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
            last_opened_vault: parsed.app.last_opened_vault.trim().to_string(),
        },
        workspace: WorkspaceSettings {
            path: parsed.workspace.path.trim().to_string(),
        },
    })
}

/// Pure [`AppSettings`] → `settings.toml` serialization with `[package]`
/// preservation. `[app].last_opened_vault` is taken from the wire value
/// (trimmed); empty clears the pointer — do not fall back to `previous`.
///
/// Symmetric with [`parse_settings_toml_str`] — no disk access. Vault-root
/// mode/path fields are **not** written (same rule as [`write_settings_toml_only`]).
///
/// The Android SAF flow pairs this with the DocumentFile write in the Expo
/// module: Rust owns TOML semantics, Kotlin only moves bytes through SAF.
/// Callers must pass the real `last_opened_vault` from normalized settings
/// (empty only when intentionally clearing).
pub fn serialize_settings_toml_str(
    settings: &AppSettings,
    previous: Option<&str>,
) -> Result<String> {
    let vault_root = if settings.app.vault_root_mode == VaultRootMode::CustomRoot
        && !settings.app.upriv_root_path.trim().is_empty()
    {
        Some(Path::new(settings.app.upriv_root_path.trim()))
    } else {
        None
    };
    // Reserved check: custom_root FS root when set, plus always
    // `path_is_under_reserved_upriv_tree` inside validate (default_root / SAF).
    validate_workspace_global_path(&settings.workspace.path, vault_root)?;

    let package = package_from_previous(previous);
    let last_opened_vault = settings.app.last_opened_vault.trim().to_string();
    let file = SettingsToml {
        package,
        ui: ui_toml_from_settings(&settings.ui),
        logging: LoggingToml {
            enabled: settings.logging.enabled,
            level: crate::logging::LogLevel::parse_filter(&settings.logging.level)
                .filter_str()
                .to_string(),
            entries_per_file: settings.logging.entries_per_file,
            keep_last_entries: settings.logging.keep_last_entries,
        },
        app: AppToml { last_opened_vault },
        workspace: WorkspaceToml {
            path: settings.workspace.path.trim().to_string(),
        },
    };
    let body = toml::to_string_pretty(&file).map_err(|error| {
        UprivError::Io(std::io::Error::other(format!(
            "serialize settings.toml: {error}"
        )))
    })?;
    let body = inject_package_section_comments(&body);
    let body = inject_app_section_comments(&body);
    let body = inject_workspace_section_comments(&body);
    let header = "# Upriv marker + app settings (vault-root directory)\n\n";
    Ok(format!("{header}{body}"))
}

const APP_SECTION_COMMENTS: &str = "\
# Vault-root mode (`default_root` | `custom_root`): app-home `.upriv-root`, not here.
# Missing/inactive → default_root; active + path → custom_root.";

const WORKSPACE_SECTION_COMMENTS: &str = "\
# Absolute path for the default mount parent (open vaults). Empty = unset — no folder created.";

/// Append vault-root alias pointer under `[app]` (after `last_opened_vault`).
fn inject_app_section_comments(body: &str) -> String {
    let Some(app_idx) = body.find("[app]") else {
        return body.to_string();
    };
    let after_header = app_idx + "[app]".len();
    let has_newline = body.as_bytes().get(after_header) == Some(&b'\n');
    let content_start = after_header + usize::from(has_newline);
    let app_tail = &body[content_start..];

    if let Some(rel) = app_tail.find("last_opened_vault =") {
        let line_end = app_tail[rel..]
            .find('\n')
            .map(|i| rel + i)
            .unwrap_or(app_tail.len());
        let insert_at = content_start + line_end;
        return format!(
            "{}\n{APP_SECTION_COMMENTS}{}",
            &body[..insert_at],
            &body[insert_at..]
        );
    }

    format!(
        "{}{APP_SECTION_COMMENTS}\n{}",
        &body[..content_start],
        &body[content_start..]
    )
}

/// Insert mount-parent comment under `[workspace]` (before `path =`).
fn inject_workspace_section_comments(body: &str) -> String {
    let Some(ws_idx) = body.find("[workspace]") else {
        return body.to_string();
    };
    let after_header = ws_idx + "[workspace]".len();
    let has_newline = body.as_bytes().get(after_header) == Some(&b'\n');
    let content_start = after_header + usize::from(has_newline);
    if body[content_start..].starts_with(WORKSPACE_SECTION_COMMENTS) {
        return body.to_string();
    }
    format!(
        "{}{WORKSPACE_SECTION_COMMENTS}\n{}",
        &body[..content_start],
        &body[content_start..]
    )
}

const PACKAGE_SECTION_COMMENTS: &str = "\
# List groups (optional): .upriv/vault_groups.toml — missing file = no groups.";

/// Append vault-groups pointer after `[package]` (before `[ui]`).
/// Keeps a blank line after the comment (same shape as `DEFAULT_SETTINGS_TOML`).
fn inject_package_section_comments(body: &str) -> String {
    if let Some(idx) = body.find("\n[ui]") {
        let (package, rest) = body.split_at(idx);
        // `rest` is `\n[ui]…`; extra `\n` after the comment restores the blank line
        // that `package.trim_end()` removed between `[package]` and `[ui]`.
        format!("{}\n{PACKAGE_SECTION_COMMENTS}\n{rest}", package.trim_end())
    } else {
        format!("{body}\n{PACKAGE_SECTION_COMMENTS}\n")
    }
}

/// Extract `[package]` from a previous TOML string.
/// Falls back to fresh defaults when `previous` is missing or unparseable.
fn package_from_previous(previous: Option<&str>) -> PackageToml {
    let mut package = PackageToml {
        version: default_package_version(),
        label: default_label(),
        vaults_dir: default_vaults_dir(),
        state_file: default_state_file(),
        logs_dir: default_logs_dir(),
        app_dir: default_app_dir(),
    };
    if let Some(raw) = previous {
        if let Ok(prev) = toml::from_str::<SettingsToml>(raw) {
            package = prev.package;
        }
    }
    package
}

/// Write `[ui]` / `[logging]` (preserve `[package]`; `last_opened_vault` from settings).
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

[ui]
locale = "pt-BR"
theme = "dark"
file_manager_dock_expanded = true
vault_list_sort = "order"
vault_list_sort_direction = "asc"
vault_list_view = "default"

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
        assert_eq!(settings.ui.vault_list_search, "");
        // Missing keys use serde defaults (toolbar + drag flags default true).
        assert!(settings.ui.vault_list_show_create_button);
        assert!(settings.ui.vault_list_show_search_button);
        assert!(settings.ui.vault_list_show_sort_button);
        assert!(settings.ui.vault_list_show_view_button);
        assert!(settings.ui.vault_list_show_header_more_button);
        assert!(settings.ui.vault_list_show_vault_more_button);
        assert!(settings.ui.vault_list_show_vault_settings_button);
        assert!(settings.ui.vault_list_show_group_settings_button);
        assert!(settings.ui.vault_list_show_drag);
        assert!(settings.ui.vault_list_allow_drag_into_group);
        assert_eq!(settings.logging.level, "warn");
        assert_eq!(settings.logging.entries_per_file, 500);
        // Vault-root mode/path never come from TOML.
        assert_eq!(settings.app.vault_root_mode, VaultRootMode::DefaultRoot);
        assert!(settings.app.upriv_root_path.is_empty());
    }

    #[test]
    fn parse_ignores_legacy_show_keys_without_button_suffix() {
        let raw = r#"
[package]
version = 1
label = "Upriv"
vaults_dir = ".upriv/vaults"
state_file = ".upriv/state.json"
logs_dir = ".upriv/logs"
app_dir = ".upriv/app"

[ui]
vault_list_show_create = false
vault_list_show_search = false
vault_list_show_sort = false
vault_list_show_view = false
allow_drag_vault_list = false
"#;
        let settings = parse_settings_toml_str(raw).unwrap();
        assert!(settings.ui.vault_list_show_create_button);
        assert!(settings.ui.vault_list_show_search_button);
        assert!(settings.ui.vault_list_show_sort_button);
        assert!(settings.ui.vault_list_show_view_button);
        assert!(settings.ui.vault_list_show_drag);
    }

    #[test]
    fn parse_reads_flat_vault_settings_button_keys() {
        let raw = r#"
[package]
version = 1
label = "Upriv"
vaults_dir = ".upriv/vaults"
state_file = ".upriv/state.json"
logs_dir = ".upriv/logs"
app_dir = ".upriv/app"

[ui]
vault_list_show_vault_settings_button = false
"#;
        let settings = parse_settings_toml_str(raw).unwrap();
        assert!(!settings.ui.vault_list_show_vault_settings_button);
        assert!(settings.ui.vault_list_show_group_settings_button);
    }

    #[test]
    fn parse_ignores_legacy_combined_vault_group_settings_key() {
        let raw = r#"
[package]
version = 1
label = "Upriv"
vaults_dir = ".upriv/vaults"
state_file = ".upriv/state.json"
logs_dir = ".upriv/logs"
app_dir = ".upriv/app"

[ui]
vault_list_show_vault_group_settings_button = false
"#;
        let settings = parse_settings_toml_str(raw).unwrap();
        assert!(settings.ui.vault_list_show_vault_settings_button);
        assert!(settings.ui.vault_list_show_group_settings_button);
    }

    #[test]
    fn serialize_nonempty_last_opened_wins_over_previous() {
        let previous = r#"
[package]
version = 1
label = "Upriv"
vaults_dir = ".upriv/vaults"
state_file = ".upriv/state.json"
logs_dir = ".upriv/logs"
app_dir = ".upriv/app"

[ui]
locale = "en"

[logging]
enabled = true

[app]
last_opened_vault = "notes"
"#;
        let mut settings = AppSettings::default();
        settings.ui.locale = "es".into();
        settings.app.last_opened_vault = "from-wire".into();
        // Explicit custom_root should NOT be written to TOML — alias is the source of truth.
        settings.app.vault_root_mode = VaultRootMode::CustomRoot;
        settings.app.upriv_root_path = "content://ignored".into();
        let out = serialize_settings_toml_str(&settings, Some(previous)).unwrap();
        assert!(out.contains("locale = \"es\""));
        assert!(out.contains("last_opened_vault = \"from-wire\""));
        assert!(!out.contains("last_opened_vault = \"notes\""));
        let opened_idx = out
            .find("last_opened_vault = \"from-wire\"")
            .expect("last_opened");
        let mode_idx = out.find("Vault-root mode").expect("vault-root comment");
        assert!(
            opened_idx < mode_idx,
            "vault-root comment must follow last_opened_vault: {out}"
        );
        assert!(
            out.contains("Absolute path for the default mount parent"),
            "workspace comment missing: {out}"
        );
        assert!(
            !out.contains("vault_root_mode") && !out.contains("upriv_root_path"),
            "mode/path must not be persisted: {out}"
        );
    }

    #[test]
    fn serialize_empty_last_opened_clears_previous() {
        let previous = r#"
[package]
version = 1
label = "Upriv"
vaults_dir = ".upriv/vaults"
state_file = ".upriv/state.json"
logs_dir = ".upriv/logs"
app_dir = ".upriv/app"

[app]
last_opened_vault = "notes"
"#;
        let settings = AppSettings::default();
        assert!(settings.app.last_opened_vault.is_empty());
        let out = serialize_settings_toml_str(&settings, Some(previous)).unwrap();
        assert!(out.contains("last_opened_vault = \"\""));
        assert!(!out.contains("last_opened_vault = \"notes\""));
    }

    #[test]
    fn serialize_preserves_package_fields_when_last_opened_cleared() {
        let previous = r#"
[package]
version = 1
label = "Upriv"
vaults_dir = ".upriv/vaults"
state_file = ".upriv/state.json"
logs_dir = ".upriv/logs"
app_dir = ".upriv/app"

[app]
last_opened_vault = "notes"
"#;
        let out = serialize_settings_toml_str(&AppSettings::default(), Some(previous)).unwrap();
        assert!(out.contains("vaults_dir = \".upriv/vaults\""));
        assert!(out.contains("state_file = \".upriv/state.json\""));
        assert!(out.contains("logs_dir = \".upriv/logs\""));
        assert!(out.contains("app_dir = \".upriv/app\""));
        assert!(out.contains("label = \"Upriv\""));
        assert!(out.contains("last_opened_vault = \"\""));
    }

    #[test]
    fn serialize_without_previous_uses_defaults() {
        let out = serialize_settings_toml_str(&AppSettings::default(), None).unwrap();
        assert!(out.contains("[package]"));
        assert!(out.contains("vaults_dir = \".upriv/vaults\""));
        assert!(out.contains("locale = \"en\""));
        assert!(!out.contains("[ui.vault_list]"));
        assert!(out.contains("vault_list_search = \"\""));
        assert!(out.contains("always_show_hidden_vaults = false"));
        assert!(out.contains("vault_list_show_drag = true"));
        assert!(out.contains("vault_list_allow_drag_into_group = true"));
        assert!(out.contains("vault_list_show_create_button = true"));
        assert!(out.contains("vault_list_show_search_button = true"));
        assert!(out.contains("vault_list_show_sort_button = true"));
        assert!(out.contains("vault_list_show_view_button = true"));
        assert!(out.contains("show_header_more_button = true"));
        assert!(out.contains("vault_list_show_vault_more_button = true"));
        let ui_section = out
            .split("\n[ui]")
            .nth(1)
            .unwrap_or("")
            .split("\n[logging]")
            .next()
            .unwrap_or("");
        assert!(
            ui_section.contains("show_header_more_button")
                && ui_section.contains("vault_list_sort"),
            "vault-list prefs must live under flat [ui]: {out}"
        );
        assert!(out.contains("vault_list_show_vault_settings_button = true"));
        assert!(out.contains("vault_list_show_group_settings_button = true"));
        assert!(!out.contains("vault_list_show_vault_group_settings_button"));
        assert!(out.contains("vault_list_sort = \"order\""));
        assert!(out.contains("vault_groups.toml"));
        let ui_idx = out.find("\n[ui]").expect("[ui] section");
        let groups_idx = out.find("vault_groups.toml").expect("groups comment");
        assert!(
            groups_idx < ui_idx,
            "vault_groups comment must sit under [package], before [ui]: {out}"
        );
        assert!(
            out.contains(
                "# List groups (optional): .upriv/vault_groups.toml — missing file = no groups.\n\n[ui]"
            ),
            "blank line required after vault_groups comment (matches DEFAULT_SETTINGS_TOML): {out}"
        );
        assert!(out.contains("last_opened_vault = \"\""));
    }

    #[test]
    fn serialize_rejects_relative_workspace_path() {
        let mut settings = AppSettings::default();
        settings.workspace.path = "workspace".into();
        let err = serialize_settings_toml_str(&settings, None).unwrap_err();
        assert!(matches!(err, UprivError::WorkspacePathInvalid { .. }));
    }

    #[test]
    fn serialize_rejects_reserved_workspace_under_custom_root() {
        let mut settings = AppSettings::default();
        settings.app.vault_root_mode = VaultRootMode::CustomRoot;
        settings.app.upriv_root_path = "/data/root".into();
        settings.workspace.path = "/data/root/.upriv/vaults".into();
        let err = serialize_settings_toml_str(&settings, None).unwrap_err();
        assert!(matches!(err, UprivError::WorkspacePathReserved(_)));
    }

    #[test]
    fn serialize_rejects_reserved_workspace_under_default_root() {
        let mut settings = AppSettings::default();
        assert_eq!(settings.app.vault_root_mode, VaultRootMode::DefaultRoot);
        settings.workspace.path = "/tmp/foo/.upriv/vaults/x".into();
        let err = serialize_settings_toml_str(&settings, None).unwrap_err();
        assert!(matches!(err, UprivError::WorkspacePathReserved(_)));
    }

    #[test]
    fn parse_ignores_nested_vault_list_table() {
        let raw = r#"
[package]
version = 1
label = "Upriv"
vaults_dir = ".upriv/vaults"
state_file = ".upriv/state.json"
logs_dir = ".upriv/logs"
app_dir = ".upriv/app"

[ui]
locale = "en"
theme = "dark"

[ui.vault_list]
vault_list_sort = "name"
vault_list_sort_direction = "desc"
vault_list_view = "compact"
vault_list_search = "notes"
always_show_hidden_vaults = true
vault_list_show_drag = false
vault_list_allow_drag_into_group = false
vault_list_show_create_button = false
vault_list_show_search_button = false
vault_list_show_sort_button = false
vault_list_show_view_button = false
vault_list_show_vault_more_button = false
vault_list_show_vault_settings_button = false
vault_list_show_group_settings_button = false
"#;
        let settings = parse_settings_toml_str(raw).unwrap();
        assert_eq!(settings.ui.vault_list_sort, "order");
        assert_eq!(settings.ui.vault_list_sort_direction, "asc");
        assert_eq!(settings.ui.vault_list_view, "default");
        assert_eq!(settings.ui.vault_list_search, "");
        assert!(!settings.ui.always_show_hidden_vaults);
        assert!(settings.ui.vault_list_show_drag);
        assert!(settings.ui.vault_list_allow_drag_into_group);
        assert!(settings.ui.vault_list_show_create_button);
        assert!(settings.ui.vault_list_show_vault_settings_button);
    }

    #[test]
    fn parse_accepts_header_more_under_ui_table() {
        let raw = r#"
[package]
version = 1
label = "Upriv"
vaults_dir = ".upriv/vaults"
state_file = ".upriv/state.json"
logs_dir = ".upriv/logs"
app_dir = ".upriv/app"

[ui]
show_header_more_button = false
"#;
        let settings = parse_settings_toml_str(raw).unwrap();
        assert!(!settings.ui.vault_list_show_header_more_button);
    }

    #[test]
    fn parse_ignores_header_more_in_nested_legacy_table() {
        let raw = r#"
[package]
version = 1
label = "Upriv"
vaults_dir = ".upriv/vaults"
state_file = ".upriv/state.json"
logs_dir = ".upriv/logs"
app_dir = ".upriv/app"

[ui.vault_list]
show_header_more_button = false
"#;
        let settings = parse_settings_toml_str(raw).unwrap();
        assert!(settings.ui.vault_list_show_header_more_button);
    }

    #[test]
    fn parse_rejects_broken_toml() {
        let err = parse_settings_toml_str("[package\nversion = 1\n").unwrap_err();
        assert!(matches!(err, UprivError::VaultRootIncomplete { .. }));
    }

    #[test]
    fn kotlin_saf_template_matches_core_defaults() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(
            "../../apps/mobile/modules/upriv-core/android/src/main/java/expo/modules/uprivcore/SafVaultRoot.kt",
        );
        let src = std::fs::read_to_string(&path)
            .unwrap_or_else(|err| panic!("read {}: {err}", path.display()));
        let marker = "DEFAULT_SETTINGS_TOML_TEMPLATE = \"\"\"";
        let start = src
            .find(marker)
            .unwrap_or_else(|| panic!("missing {marker} in {}", path.display()));
        let after = &src[start + marker.len()..];
        let end = after
            .find("\"\"\"")
            .expect("unclosed DEFAULT_SETTINGS_TOML_TEMPLATE");
        let template = after[..end].replace("__LOCALE__", "en");
        let from_kotlin = parse_settings_toml_str(&template).expect("kotlin template parses");
        let from_core = parse_settings_toml_str(
            &serialize_settings_toml_str(&AppSettings::default(), None).unwrap(),
        )
        .expect("core serialize parses");
        assert_eq!(from_kotlin.ui, from_core.ui);
        assert_eq!(from_kotlin.logging, from_core.logging);
        assert_eq!(from_kotlin.workspace, from_core.workspace);
    }
}
