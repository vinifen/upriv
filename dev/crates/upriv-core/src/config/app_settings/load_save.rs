//! Discover vault-root + load/save app settings (alias sync included).

use std::path::{Path, PathBuf};

use crate::error::{Result, UprivError};
use crate::paths::{
    app_home_dir, deactivate_vault_root_alias_everywhere, discover_vault_root_upward,
    env_default_root_anchor, read_vault_root_alias, setup_default_root_anchor,
    write_vault_root_alias_for_root, VaultRoot, VaultRootMode, VAULT_ROOT_SETTINGS_REL,
};

use super::toml::{parse_settings_toml, write_settings_toml_only};
use super::types::{
    AppSectionSettings, AppSettings, LoadedAppSettings, LoggingSettings, UiSettings,
};

/// Bootstrap: active alias root, else default_root (exact anchor when `UPRIV_DEFAULT_ROOT_ANCHOR` set).
///
/// When `.upriv-root` is **active**, a failed open is returned as an error (no default_root
/// fallback) so settings load/save cannot silently use a different root while the UI
/// still shows custom_root mode.
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

    if env_default_root_anchor().is_some() {
        return crate::paths::open_default_root_candidate(&home);
    }

    if let Some(found) = discover_vault_root_upward(&home) {
        return crate::paths::open_default_root_candidate(&found);
    }
    if let Ok(cwd) = std::env::current_dir() {
        if !crate::paths::fs_env::same_dir(&cwd, &home) {
            if let Some(found) = discover_vault_root_upward(&cwd) {
                return crate::paths::open_default_root_candidate(&found);
            }
        }
    }
    Ok(None)
}

/// Load settings from the bootstrap root, or defaults when no root exists yet.
/// Always merge vault-root mode from `.upriv-root` (even when no readable root yet).
///
/// Active alias that fails to open → defaults + alias-derived wire fields (`on_disk: false`)
/// so the UI can still show custom_root mode / Gate alias-invalid without falling back to default_root TOML.
///
/// I/O other than absence (`NotFound`) is propagated (e.g. `PermissionDenied`) — do not
/// treat unreadable settings as “needs setup”.
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
        Err(UprivError::VaultRootAliasInvalid(_) | UprivError::VaultRootIncomplete { .. }) => {
            let mut settings = AppSettings::default();
            apply_alias_to_app_settings(&mut settings);
            Ok(LoadedAppSettings {
                settings,
                root_path: None,
                on_disk: false,
            })
        }
        Err(UprivError::Io(ref error)) if error.kind() == std::io::ErrorKind::NotFound => {
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

/// Apply `.upriv-root` → wire `vault_root_mode` / `upriv_root_path`.
fn apply_alias_to_app_settings(settings: &mut AppSettings) {
    settings.app.vault_root_mode = VaultRootMode::DefaultRoot;
    settings.app.upriv_root_path.clear();
    let Ok(home) = app_home_dir() else {
        return;
    };
    let Ok(Some(alias)) = read_vault_root_alias(&home) else {
        return;
    };
    if alias.active {
        settings.app.vault_root_mode = VaultRootMode::CustomRoot;
        match alias.path.to_str() {
            Some(s) if !s.contains('\n') && !s.contains('\r') => {
                settings.app.upriv_root_path = s.to_string();
            }
            _ => {
                // Keep custom_root mode but leave path empty — UI must re-pick (non-UTF-8 / newline).
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
    let parsed = parse_settings_toml(&raw, &path)?;

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
            vault_root_mode: VaultRootMode::DefaultRoot,
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

/// Write settings.toml at `root` and sync `.upriv-root` from wire `app` fields.
pub fn save_app_settings(root: &Path, settings: &AppSettings) -> Result<()> {
    save_app_settings_with_alias_sync(root, settings, true)
}

/// Write settings.toml at `root`. When `sync_alias` is true, also align `.upriv-root`
/// from wire `app` fields. Pass `false` when the caller already mutated the alias
/// via setup/deactivate (single writer).
///
/// Alias is synced **before** TOML when `sync_alias` is true (alias is on-disk source of
/// truth for mode/path). If alias write fails, settings.toml is left unchanged.
pub fn save_app_settings_with_alias_sync(
    root: &Path,
    settings: &AppSettings,
    sync_alias: bool,
) -> Result<()> {
    if sync_alias {
        sync_alias_with_app_settings(settings)?;
    }
    write_settings_toml_only(root, settings)?;
    Ok(())
}

/// Align `.upriv-root` with settings: default_root → deactivate; custom → write active alias.
pub fn sync_alias_with_app_settings(settings: &AppSettings) -> Result<()> {
    if settings.app.vault_root_mode == VaultRootMode::DefaultRoot {
        deactivate_vault_root_alias_everywhere()?;
        return Ok(());
    }
    let path = settings.app.upriv_root_path.trim();
    if path.is_empty() {
        return Err(UprivError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "custom vault-root mode requires a non-empty upriv_root_path",
        )));
    }
    let home = app_home_dir()?;
    let root = VaultRoot::discover(path)?;
    write_vault_root_alias_for_root(&home, &root)?;
    Ok(())
}

/// Save when a writable vault-root exists for the **desired** mode; else `Ok(false)`.
///
/// Target is chosen from the payload (not from the current active alias):
/// - custom → `upriv_root_path` (must already be a valid root)
/// - default_root → default_root anchor only (where `setup_default_root` creates); never the old custom root
///
/// `sync_alias` defaults to true via [`save_app_settings_session`]; pass false when
/// vault-root setup already wrote/deactivated the alias.
pub fn save_app_settings_session(settings: &AppSettings) -> Result<bool> {
    save_app_settings_session_with_alias_sync(settings, true)
}

/// Like [`save_app_settings_session`], with explicit alias-sync control.
pub fn save_app_settings_session_with_alias_sync(
    settings: &AppSettings,
    sync_alias: bool,
) -> Result<bool> {
    let target = if settings.app.vault_root_mode == VaultRootMode::CustomRoot {
        let path = settings.app.upriv_root_path.trim();
        if path.is_empty() {
            return Ok(false);
        }
        PathBuf::from(path)
    } else {
        let anchor = setup_default_root_anchor()?;
        match crate::paths::open_default_root_candidate(&anchor)? {
            Some(root) => root.root().to_path_buf(),
            None => return Ok(false),
        }
    };

    match crate::paths::open_default_root_candidate(&target)? {
        Some(_) => {}
        None => return Ok(false),
    }
    save_app_settings_with_alias_sync(&target, settings, sync_alias)?;
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
        std::env::set_var("UPRIV_DEFAULT_ROOT_ANCHOR", home.path());

        let dir = tempfile::tempdir().unwrap();
        initialize_vault_root(dir.path()).unwrap();
        let mut settings = AppSettings::default();
        settings.ui.locale = "pt-BR".into();
        settings.app.vault_root_mode = VaultRootMode::DefaultRoot;
        save_app_settings(dir.path(), &settings).unwrap();

        let raw = std::fs::read_to_string(dir.path().join(".upriv/settings.toml")).unwrap();
        assert!(
            !raw.contains("vault_root_mode") && !raw.contains("upriv_root_path"),
            "mode/path must not be persisted in settings.toml"
        );
        assert!(raw.contains(".upriv-root"));

        let loaded = load_app_settings_at(dir.path()).unwrap();
        assert_eq!(loaded.settings.ui.locale, "pt-BR");
        assert_eq!(
            loaded.settings.app.vault_root_mode,
            VaultRootMode::DefaultRoot
        );
        assert!(loaded.on_disk);

        std::env::remove_var("UPRIV_DEFAULT_ROOT_ANCHOR");
    }

    #[test]
    fn save_custom_writes_active_alias() {
        let _guard = ENV_LOCK.lock().unwrap();
        let home = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        initialize_vault_root(root.path()).unwrap();
        std::env::remove_var("APPIMAGE");
        std::env::set_var("UPRIV_DEFAULT_ROOT_ANCHOR", home.path());

        let mut settings = AppSettings::default();
        settings.app.vault_root_mode = VaultRootMode::CustomRoot;
        settings.app.upriv_root_path = root.path().to_string_lossy().into_owned();
        save_app_settings(root.path(), &settings).unwrap();

        let alias = read_vault_root_alias(home.path()).unwrap().unwrap();
        assert!(alias.active);
        assert_eq!(alias.path, root.path().canonicalize().unwrap());

        let raw = std::fs::read_to_string(root.path().join(".upriv/settings.toml")).unwrap();
        assert!(!raw.contains("vault_root_mode") && !raw.contains("upriv_root_path"));

        settings.app.vault_root_mode = VaultRootMode::DefaultRoot;
        settings.app.upriv_root_path.clear();
        save_app_settings(root.path(), &settings).unwrap();
        let alias = read_vault_root_alias(home.path()).unwrap().unwrap();
        assert!(!alias.active);

        std::env::remove_var("UPRIV_DEFAULT_ROOT_ANCHOR");
    }

    #[test]
    fn load_derives_mode_from_alias_not_toml() {
        let _guard = ENV_LOCK.lock().unwrap();
        let home = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        initialize_vault_root(root.path()).unwrap();
        write_vault_root_alias(home.path(), root.path()).unwrap();
        std::env::remove_var("APPIMAGE");
        std::env::set_var("UPRIV_DEFAULT_ROOT_ANCHOR", home.path());

        // Unknown `[app]` keys must not override `.upriv-root` (alias wins).
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
obsolete_vault_root_flag = true
"#,
        )
        .unwrap();

        let loaded = load_app_settings_at(root.path()).unwrap();
        assert_eq!(
            loaded.settings.app.vault_root_mode,
            VaultRootMode::CustomRoot
        );
        assert_eq!(
            loaded.settings.app.upriv_root_path,
            root.path().canonicalize().unwrap().to_string_lossy()
        );

        std::env::remove_var("UPRIV_DEFAULT_ROOT_ANCHOR");
    }

    #[test]
    fn active_broken_alias_does_not_fall_back_to_default_root() {
        let _guard = ENV_LOCK.lock().unwrap();
        let home = tempfile::tempdir().unwrap();
        let default_root = tempfile::tempdir().unwrap();
        let missing = home.path().join("gone-custom");
        initialize_vault_root(default_root.path()).unwrap();
        let alias_path = home.path().join(".upriv-root");
        std::fs::write(
            &alias_path,
            format!("status=active\n{}\n", missing.display()),
        )
        .unwrap();
        std::env::remove_var("APPIMAGE");
        // App home = `home` (alias lives here); default_root is a different folder.
        std::env::set_var("UPRIV_DEFAULT_ROOT_ANCHOR", home.path());
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
        assert_eq!(
            loaded.settings.app.vault_root_mode,
            VaultRootMode::CustomRoot
        );
        assert!(loaded.settings.app.upriv_root_path.contains("gone-custom"));

        std::env::remove_var("UPRIV_DEFAULT_ROOT_ANCHOR");
        let _ = default_root;
    }

    #[test]
    fn save_session_default_root_writes_default_root_not_old_custom() {
        let _guard = ENV_LOCK.lock().unwrap();
        let home = tempfile::tempdir().unwrap();
        let custom = tempfile::tempdir().unwrap();
        initialize_vault_root(home.path()).unwrap();
        initialize_vault_root(custom.path()).unwrap();
        write_vault_root_alias(home.path(), custom.path()).unwrap();
        std::env::remove_var("APPIMAGE");
        std::env::set_var("UPRIV_DEFAULT_ROOT_ANCHOR", home.path());

        std::fs::write(
            custom.path().join(".upriv/settings.toml"),
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
        settings.app.vault_root_mode = VaultRootMode::DefaultRoot;
        settings.app.upriv_root_path.clear();
        assert!(save_app_settings_session(&settings).unwrap());

        let default_root_raw =
            std::fs::read_to_string(home.path().join(".upriv/settings.toml")).unwrap();
        assert!(default_root_raw.contains("pt-BR"));
        let custom_raw =
            std::fs::read_to_string(custom.path().join(".upriv/settings.toml")).unwrap();
        assert!(!custom_raw.contains("pt-BR"));

        std::env::remove_var("UPRIV_DEFAULT_ROOT_ANCHOR");
    }
}
