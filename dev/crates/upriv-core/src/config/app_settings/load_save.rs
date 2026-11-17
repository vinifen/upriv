//! Load and save `settings.toml` of the data folder this device uses.

use std::path::Path;
use std::sync::{Mutex, MutexGuard};

use crate::error::{Result, UprivError};
use crate::paths::{VaultRoot, VAULT_ROOT_SETTINGS_REL};

use super::toml::{parse_settings_toml, ui_settings_from_toml, write_settings_toml_only};
use super::types::{AppSectionSettings, AppSettings, LoadedAppSettings, LoggingSettings};
use crate::config::list_saves::{
    apply_app_lists, carry_device_removals, release_unlocked_rows, reuse_selected_backup_folders,
    selects_here, AppListChanges, ListsSaved,
};

/// Serializes load-modify-save of settings.toml (UniFFI may dispatch RPCs concurrently).
static SETTINGS_WRITE_LOCK: Mutex<()> = Mutex::new(());

fn lock_settings_write() -> MutexGuard<'static, ()> {
    SETTINGS_WRITE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// The data folder this device uses: the explicit one, or its choice in the
/// data folder list. `None` while that choice holds no data folder that
/// answers (the first run, a selected choice that does not answer).
pub fn discover_bootstrap_root() -> Result<Option<VaultRoot>> {
    crate::paths::chosen_data_folder()
}

/// Load settings from the data folder in use, or defaults when there is none
/// yet. An incomplete or missing data folder reads as defaults too (`on_disk:
/// false`): the Gate decides what to show. I/O other than absence
/// (`NotFound`) is propagated (e.g. `PermissionDenied`): unreadable settings
/// are not “needs setup”.
pub fn load_app_settings() -> Result<LoadedAppSettings> {
    match discover_bootstrap_root() {
        Ok(Some(root)) => load_app_settings_at(root.root()),
        Ok(None) | Err(UprivError::VaultRootIncomplete { .. }) => Ok(defaults()),
        Err(UprivError::Io(ref error)) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(defaults())
        }
        Err(error) => Err(error),
    }
}

fn defaults() -> LoadedAppSettings {
    LoadedAppSettings {
        settings: AppSettings::default(),
        root_path: None,
        on_disk: false,
    }
}

/// Load `.upriv/settings.toml` at `root`.
pub fn load_app_settings_at(root: &Path) -> Result<LoadedAppSettings> {
    // Same marker rules as discover / inspect (reject incomplete before serde defaults).
    crate::paths::validate_existing_vault_root(root)?;
    let path = root.join(VAULT_ROOT_SETTINGS_REL);
    let raw = crate::host_fs::read_to_string(&path).map_err(UprivError::from)?;
    let parsed = parse_settings_toml(&raw, &path)?;
    let settings = AppSettings {
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
            last_opened_vault: parsed.app.last_opened_vault.trim().to_string(),
        },
        unlocked_folders: parsed.unlocked_folders,
        backups: parsed.backups,
    };
    Ok(LoadedAppSettings {
        settings,
        root_path: Some(root.to_path_buf()),
        on_disk: true,
    })
}

/// Change `settings.toml` at `root` from a fresh read, under the settings
/// write lock. For core's own writes: a pointer, a switch.
pub(crate) fn update_app_settings(
    root: &Path,
    change: impl FnOnce(&mut AppSettings),
) -> Result<()> {
    let _guard = lock_settings_write();
    let mut settings = load_app_settings_at(root)?.settings;
    change(&mut settings);
    write_settings_toml_only(root, &settings)
}

/// Write settings.toml at `root` from `settings`, with `lists` applied to the
/// lists as the file holds them now. The settings lock is let go before any
/// vault's file is written, so a vault that saves a switch meanwhile never
/// waits on this save.
pub fn save_app_settings_at(
    root: &Path,
    settings: &AppSettings,
    lists: &AppListChanges,
) -> Result<ListsSaved> {
    let vault_root = VaultRoot::new(root);
    let leaving = {
        let _guard = lock_settings_write();
        let saved = load_app_settings_at(root)?.settings;
        let mut after = settings.clone();
        let leaving = apply_app_lists(&vault_root, &saved, &mut after, lists)?;
        write_settings_toml_only(root, &after)?;
        leaving
    };
    if selects_here(&lists.backups) {
        let ids = crate::config::known_vault_ids(&vault_root).unwrap_or_default();
        reuse_selected_backup_folders(&vault_root, &ids);
    }
    Ok(ListsSaved {
        unchanged_vaults: carry_device_removals(&vault_root, lists),
        kept_folders: release_unlocked_rows(&vault_root, &leaving),
    })
}

/// Save to the data folder in use.
///
/// - `Ok(Some(_))` — wrote `settings.toml`
/// - `Ok(None)` — **only** before this process ever had a data folder (the
///   first run): the preferences stay in memory until Setup makes one
/// - `Err(VaultRootNotFound)` — the data folder was ready this process and is
///   gone (case B)
/// - `Err(VaultRootIncomplete)` — its `.upriv` is corrupt (case A)
pub fn save_app_settings_session(
    settings: &AppSettings,
    lists: &AppListChanges,
) -> Result<Option<ListsSaved>> {
    match discover_bootstrap_root()? {
        Some(root) => save_app_settings_at(root.root(), settings, lists).map(Some),
        None if crate::logging::vault_root_was_ready() => Err(crate::paths::data_folder_lost()),
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::{initialize_vault_root, ENV_LOCK};

    fn save_app_settings(root: &Path, settings: &AppSettings) -> Result<ListsSaved> {
        save_app_settings_at(root, settings, &AppListChanges::default())
    }

    #[test]
    fn roundtrip_settings_toml() {
        let dir = tempfile::tempdir().unwrap();
        initialize_vault_root(dir.path()).unwrap();
        let mut settings = AppSettings::default();
        settings.ui.locale = "pt-BR".into();
        save_app_settings(dir.path(), &settings).unwrap();

        let loaded = load_app_settings_at(dir.path()).unwrap();
        assert_eq!(loaded.settings.ui.locale, "pt-BR");
        assert!(loaded.on_disk);
    }

    #[test]
    fn load_and_save_normalize_logging_level_preset() {
        let dir = tempfile::tempdir().unwrap();
        initialize_vault_root(dir.path()).unwrap();
        let settings_path = dir.path().join(".upriv/settings.toml");
        let mut raw = crate::host_fs::read_to_string(&settings_path).unwrap();
        raw = raw.replace("level = \"info\"", "level = \"ERROR\"");
        if !raw.contains("level = \"ERROR\"") {
            // Fresh default may use different formatting — force a logging section.
            raw.push_str("\n[logging]\nenabled = true\nlevel = \"ERROR\"\nentries_per_file = 1000\nkeep_last_entries = 10000\n");
        }
        crate::host_fs::write(&settings_path, raw).unwrap();

        let loaded = load_app_settings_at(dir.path()).unwrap();
        assert_eq!(loaded.settings.logging.level, "error");

        save_app_settings(dir.path(), &loaded.settings).unwrap();
        let persisted = crate::host_fs::read_to_string(&settings_path).unwrap();
        assert!(
            persisted.contains("level = \"error\""),
            "persisted={persisted}"
        );
    }

    #[test]
    fn a_session_save_writes_the_data_folder_in_use_and_never_makes_one() {
        let _guard = ENV_LOCK.lock().unwrap();
        let _env = crate::paths::EnvGuard::capture(&[
            "APPIMAGE",
            "UPRIV_DEFAULT_ROOT_ANCHOR",
            "UPRIV_VAULT_ROOT",
        ]);
        let home = tempfile::tempdir().unwrap();
        std::env::remove_var("APPIMAGE");
        std::env::remove_var("UPRIV_VAULT_ROOT");
        std::env::set_var("UPRIV_DEFAULT_ROOT_ANCHOR", home.path());

        // The first run keeps its preferences in memory: nothing is made.
        crate::logging::reset_vault_root_ready();
        assert!(
            save_app_settings_session(&AppSettings::default(), &AppListChanges::default())
                .unwrap()
                .is_none()
        );
        assert!(!home.path().join(".upriv").exists());

        initialize_vault_root(home.path()).unwrap();
        let mut settings = AppSettings::default();
        settings.ui.locale = "es".into();
        assert!(
            save_app_settings_session(&settings, &AppListChanges::default())
                .unwrap()
                .is_some()
        );
        let raw = crate::host_fs::read_to_string(home.path().join(".upriv/settings.toml")).unwrap();
        assert!(raw.contains("locale = \"es\""));
    }

    #[test]
    fn a_session_save_after_the_data_folder_is_gone_fails_loud() {
        let _guard = ENV_LOCK.lock().unwrap();
        let _env = crate::paths::EnvGuard::capture(&[
            "APPIMAGE",
            "UPRIV_DEFAULT_ROOT_ANCHOR",
            "UPRIV_VAULT_ROOT",
        ]);
        let home = tempfile::tempdir().unwrap();
        std::env::remove_var("APPIMAGE");
        std::env::remove_var("UPRIV_VAULT_ROOT");
        std::env::set_var("UPRIV_DEFAULT_ROOT_ANCHOR", home.path());
        initialize_vault_root(home.path()).unwrap();
        crate::logging::log_vault_root_ready("default", &home.path().display().to_string());

        crate::host_fs::remove_dir_all(home.path().join(".upriv")).unwrap();
        let err = save_app_settings_session(&AppSettings::default(), &AppListChanges::default())
            .unwrap_err();
        crate::logging::reset_vault_root_ready();
        assert!(matches!(err, UprivError::VaultRootNotFound(_)), "{err:?}");
    }

    #[test]
    fn an_incomplete_data_folder_is_not_saved_over() {
        let _guard = ENV_LOCK.lock().unwrap();
        let _env = crate::paths::EnvGuard::capture(&[
            "APPIMAGE",
            "UPRIV_DEFAULT_ROOT_ANCHOR",
            "UPRIV_VAULT_ROOT",
        ]);
        let home = tempfile::tempdir().unwrap();
        std::env::remove_var("APPIMAGE");
        std::env::remove_var("UPRIV_VAULT_ROOT");
        std::env::set_var("UPRIV_DEFAULT_ROOT_ANCHOR", home.path());
        crate::host_fs::create_dir_all(home.path().join(".upriv")).unwrap();
        let err = save_app_settings_session(&AppSettings::default(), &AppListChanges::default())
            .unwrap_err();
        assert!(
            matches!(err, UprivError::VaultRootIncomplete { .. }),
            "{err:?}"
        );
    }

    #[test]
    fn a_save_applies_list_changes_to_the_file_as_it_is_now() {
        let (_tmp, root) = crate::test_support::vault_root_with(&[]);
        let device = crate::device::this_device();
        let Some(id) = device.id.clone() else {
            return;
        };
        let drive = tempfile::tempdir().unwrap();
        let mut lists = AppListChanges::default();
        lists.unlocked_folders.groups.insert(
            id.clone(),
            crate::folder_list::GroupChange {
                remove: false,
                rows: Some(vec![crate::folder_list::Row {
                    number: 1,
                    name: "SSD".into(),
                    path: drive.path().display().to_string(),
                }]),
                next_number: None,
                selected: Some(crate::folder_list::Selection::Row(1)),
            },
        );
        // The settings the window holds carry no list: the file's lists are kept.
        let settings = load_app_settings_at(root.root()).unwrap().settings;
        save_app_settings_at(root.root(), &settings, &lists).unwrap();
        update_app_settings(root.root(), |settings| settings.ui.locale = "es".into()).unwrap();

        let saved = load_app_settings_at(root.root()).unwrap().settings;
        assert_eq!(saved.ui.locale, "es");
        let group = saved.unlocked_folders.devices.here(device).unwrap();
        assert_eq!(group.rows[0].name, "SSD");
        assert_eq!(group.selected, crate::folder_list::Selection::Row(1));

        // A save that changes no list keeps the rows.
        save_app_settings_at(root.root(), &settings, &AppListChanges::default()).unwrap();
        let saved = load_app_settings_at(root.root()).unwrap().settings;
        assert_eq!(saved.unlocked_folders.devices.rows_here(device).len(), 1);
    }

    #[test]
    fn a_row_inside_upriv_is_refused_on_save() {
        let (_tmp, root) = crate::test_support::vault_root_with(&[]);
        let device = crate::device::this_device();
        let Some(id) = device.id.clone() else {
            return;
        };
        let mut lists = AppListChanges::default();
        lists.backups.groups.insert(
            id,
            crate::folder_list::GroupChange {
                remove: false,
                rows: Some(vec![crate::folder_list::Row {
                    number: 1,
                    name: String::new(),
                    path: root.root().join(".upriv/mine").display().to_string(),
                }]),
                next_number: None,
                selected: None,
            },
        );
        let settings = load_app_settings_at(root.root()).unwrap().settings;
        assert!(matches!(
            save_app_settings_at(root.root(), &settings, &lists),
            Err(UprivError::FolderPathRefused { .. })
        ));
    }
}
