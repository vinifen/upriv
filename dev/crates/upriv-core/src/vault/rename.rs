//! Deep vault rename: display name + folder/`[vault].id` migration (vault closed).

use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use crate::config::vault_config::normalize_and_validate_display_name;
use crate::config::{
    known_vault_ids, load_app_settings_at, load_vault_config_raw, remap_grouped_vault_id,
    save_app_settings, save_vault_config, VaultConfig,
};
use crate::error::{Result, UprivError};
use crate::logging::{log_event, LogLevel};
use crate::paths::{display_name_to_vault_id, resolve_vault_mount_point, VaultRoot};
use crate::session::{
    is_vault_closing_at, is_vault_open_at, is_vault_preparing_at, with_vault_dir_lock,
    with_vault_dir_locks, with_vault_registry_lock,
};

use super::persistence::{load_vault_persistence, save_vault_persistence, VaultPersistence};

/// Result of [`rename_vault`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VaultRenameResult {
    pub previous_id: String,
    pub id: String,
    pub display_name: String,
    pub id_changed: bool,
}

#[cfg(test)]
thread_local! {
    static RENAME_FAIL_AT: std::cell::Cell<Option<&'static str>> = const { std::cell::Cell::new(None) };
}

#[cfg(test)]
pub(crate) fn set_rename_fail_at(step: Option<&'static str>) {
    RENAME_FAIL_AT.with(|cell| cell.set(step));
}

fn maybe_fail(step: &'static str) -> Result<()> {
    #[cfg(not(test))]
    {
        let _ = step;
        Ok(())
    }
    #[cfg(test)]
    {
        let hit = RENAME_FAIL_AT.with(|cell| {
            if cell.get() == Some(step) {
                cell.set(None);
                true
            } else {
                false
            }
        });
        if hit {
            return Err(UprivError::VaultStoreInvalid {
                path: PathBuf::from("rename"),
                detail: format!("injected failure at {step}"),
            });
        }
        Ok(())
    }
}

fn refuse_if_busy(vault_dir: &Path) -> Result<()> {
    // Rename does no Argon2 — refuse this vault's open / mid-close / preparing
    // (open or create seed). Process-wide `is_unlock_in_flight` must not block
    // a closed-vault migration of a *different* vault.
    if is_vault_open_at(vault_dir)
        || is_vault_closing_at(vault_dir)
        || is_vault_preparing_at(vault_dir)
    {
        return Err(UprivError::VaultConfigBusy {
            target: "vault.display_name".into(),
        });
    }
    Ok(())
}

fn log_vault_renamed(previous_id: &str, id: &str, from: &str, to: &str) {
    if previous_id == id && from == to {
        return;
    }
    log_event(
        LogLevel::Info,
        "vault_renamed",
        &[
            ("previous_id", previous_id),
            ("id", id),
            ("from", from),
            ("to", to),
        ],
    );
}

fn allocate_id(root: &VaultRoot, old_id: &str, display_name: &str) -> Result<String> {
    let known = known_vault_ids(root)?;
    let mut existing: Vec<String> = known
        .into_iter()
        .filter(|id| id.as_str() != old_id)
        .collect();
    existing.sort();
    Ok(display_name_to_vault_id(display_name, &existing))
}

fn patch_last_opened(root: &VaultRoot, old_id: &str, new_id: &str) -> Result<bool> {
    let loaded = match load_app_settings_at(root.root()) {
        Ok(loaded) => loaded,
        Err(UprivError::VaultRootNotFound(_)) | Err(UprivError::VaultRootIncomplete { .. }) => {
            return Ok(false);
        }
        Err(error) => return Err(error),
    };
    if loaded.settings.app.last_opened_vault.trim() != old_id {
        return Ok(false);
    }
    let mut settings = loaded.settings;
    settings.app.last_opened_vault = new_id.to_string();
    save_app_settings(root.root(), &settings)?;
    Ok(true)
}

/// Rename leftover `{parent}/{display_name}` when the vault is closed and dest is free.
fn migrate_closed_mount_leaf(
    root: &VaultRoot,
    config: &VaultConfig,
    old_display: &str,
    new_display: &str,
    previous_id: &str,
    next_id: &str,
) -> Result<Option<(PathBuf, PathBuf)>> {
    if old_display == new_display {
        return Ok(None);
    }
    let loaded = match load_app_settings_at(root.root()) {
        Ok(loaded) => loaded,
        Err(UprivError::VaultRootNotFound(_)) | Err(UprivError::VaultRootIncomplete { .. }) => {
            return Ok(None);
        }
        Err(error) => return Err(error),
    };
    let Some(old_mount) = resolve_vault_mount_point(
        &loaded.settings.workspace.path,
        &config.mount.workspace_path,
        old_display,
    ) else {
        return Ok(None);
    };
    let Some(new_mount) = resolve_vault_mount_point(
        &loaded.settings.workspace.path,
        &config.mount.workspace_path,
        new_display,
    ) else {
        return Ok(None);
    };
    if !old_mount.is_dir() {
        return Ok(None);
    }
    if new_mount.exists() {
        log_event(
            LogLevel::Warn,
            "vault_rename_mount_skipped",
            &[
                ("previous_id", previous_id),
                ("id", next_id),
                ("reason", "dest_exists"),
            ],
        );
        return Ok(None);
    }
    std::fs::rename(&old_mount, &new_mount)?;
    Ok(Some((old_mount, new_mount)))
}

fn rollback_error(old_dir: &Path, parts: Vec<String>) -> UprivError {
    UprivError::VaultStoreInvalid {
        path: old_dir.to_path_buf(),
        detail: format!("rename rollback failed: {}", parts.join("; ")),
    }
}

struct RenameRollback<'a> {
    root: &'a VaultRoot,
    old_id: &'a str,
    new_id: &'a str,
    old_dir: &'a Path,
    new_dir: &'a Path,
    prior_config: &'a VaultConfig,
    prior_persistence: &'a Option<VaultPersistence>,
    groups_remapped: bool,
    last_opened_patched: bool,
    mount_moved: &'a Option<(PathBuf, PathBuf)>,
}

/// Restore prior identity files after a failed migration. Errors are visible, not swallowed.
fn rollback_migration(ctx: RenameRollback<'_>) -> Result<()> {
    let RenameRollback {
        root,
        old_id,
        new_id,
        old_dir,
        new_dir,
        prior_config,
        prior_persistence,
        groups_remapped,
        last_opened_patched,
        mount_moved,
    } = ctx;
    let mut errors: Vec<String> = Vec::new();
    if last_opened_patched {
        if let Err(error) = patch_last_opened(root, new_id, old_id) {
            errors.push(format!("last_opened: {error}"));
        }
    }
    if groups_remapped {
        if let Err(error) = remap_grouped_vault_id(root, new_id, old_id) {
            errors.push(format!("groups: {error}"));
        }
    }
    if let Some((old_mount, new_mount)) = mount_moved {
        if new_mount.exists() && !old_mount.exists() {
            if let Err(error) = std::fs::rename(new_mount, old_mount) {
                errors.push(format!("mount: {error}"));
            }
        }
    }
    if new_dir.is_dir() {
        if let Err(error) = save_vault_config(new_dir, prior_config) {
            errors.push(format!("config: {error}"));
        }
        if let Some(persistence) = prior_persistence {
            if let Err(error) = save_vault_persistence(new_dir, persistence) {
                errors.push(format!("persistence: {error}"));
            }
        }
        if let Err(error) = std::fs::rename(new_dir, old_dir) {
            errors.push(format!("folder: {error}"));
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(rollback_error(old_dir, errors))
    }
}

fn combine_migrate_and_rollback(
    old_dir: &Path,
    migrate: UprivError,
    rollback: UprivError,
) -> UprivError {
    UprivError::VaultStoreInvalid {
        path: old_dir.to_path_buf(),
        detail: format!("rename failed ({migrate}); {rollback}"),
    }
}

/// Rename a closed vault's display name; migrate folder/`id` when the slug changes.
pub fn rename_vault(
    root: &VaultRoot,
    old_id: &str,
    display_name: &str,
) -> Result<VaultRenameResult> {
    let old_id = old_id.trim();
    let display_name = normalize_and_validate_display_name(display_name)?;

    let old_dir = root.vault_dir(old_id)?;
    if !old_dir.is_dir() {
        return Err(UprivError::VaultNotFound(old_dir));
    }

    with_vault_registry_lock(|| {
        refuse_if_busy(&old_dir)?;
        let new_id = allocate_id(root, old_id, &display_name)?;
        if new_id == old_id {
            return rename_display_name_only(root, &old_dir, old_id, &display_name, new_id);
        }

        let new_dir = root.vault_dir(&new_id)?;
        if new_dir.exists() {
            return Err(UprivError::VaultAlreadyExists(new_dir));
        }

        with_vault_dir_locks(&old_dir, &new_dir, || {
            refuse_if_busy(&old_dir)?;
            let prior_config = load_vault_config_raw(&old_dir)?;
            if prior_config.vault.id.trim() != old_id {
                return Err(UprivError::VaultConfigInvalid {
                    path: crate::config::vault_config_path(&old_dir),
                    detail: format!(
                        "[vault].id ({}) must match directory name ({old_id})",
                        prior_config.vault.id
                    ),
                });
            }
            let prior_persistence = load_vault_persistence(&old_dir)?;
            let prior_display = prior_config.vault.display_name.clone();

            let mut next_config = prior_config.clone();
            next_config.vault.id = new_id.clone();
            next_config.vault.display_name = display_name.clone();

            match std::fs::rename(&old_dir, &new_dir) {
                Ok(()) => {}
                Err(error) if error.kind() == ErrorKind::AlreadyExists => {
                    return Err(UprivError::VaultAlreadyExists(new_dir.clone()));
                }
                Err(error) => return Err(error.into()),
            }

            let mut groups_remapped = false;
            let mut last_opened_patched = false;
            let mut mount_moved = None;
            let migrated: Result<()> = (|| {
                save_vault_config(&new_dir, &next_config)?;
                if let Some(mut persistence) = prior_persistence.clone() {
                    persistence.vault_id = new_id.clone();
                    persistence.display_name = display_name.clone();
                    save_vault_persistence(&new_dir, &persistence)?;
                } else if let Some(mut persistence) = load_vault_persistence(&new_dir)? {
                    persistence.vault_id = new_id.clone();
                    persistence.display_name = display_name.clone();
                    save_vault_persistence(&new_dir, &persistence)?;
                }
                remap_grouped_vault_id(root, old_id, &new_id)?;
                groups_remapped = true;
                maybe_fail("after_groups")?;
                last_opened_patched = patch_last_opened(root, old_id, &new_id)?;
                mount_moved = migrate_closed_mount_leaf(
                    root,
                    &next_config,
                    &prior_display,
                    &display_name,
                    old_id,
                    &new_id,
                )?;
                Ok(())
            })();

            if let Err(error) = migrated {
                return match rollback_migration(RenameRollback {
                    root,
                    old_id,
                    new_id: &new_id,
                    old_dir: &old_dir,
                    new_dir: &new_dir,
                    prior_config: &prior_config,
                    prior_persistence: &prior_persistence,
                    groups_remapped,
                    last_opened_patched,
                    mount_moved: &mount_moved,
                }) {
                    Ok(()) => Err(error),
                    Err(rollback) => Err(combine_migrate_and_rollback(&old_dir, error, rollback)),
                };
            }
            log_vault_renamed(old_id, &new_id, &prior_display, &display_name);
            Ok(())
        })?;

        Ok(VaultRenameResult {
            previous_id: old_id.to_string(),
            id: new_id,
            display_name: display_name.clone(),
            id_changed: true,
        })
    })
}

fn rename_display_name_only(
    root: &VaultRoot,
    old_dir: &PathBuf,
    old_id: &str,
    display_name: &str,
    new_id: String,
) -> Result<VaultRenameResult> {
    with_vault_dir_lock(old_dir, || {
        refuse_if_busy(old_dir)?;
        let mut config = load_vault_config_raw(old_dir)?;
        if config.vault.id.trim() != old_id {
            return Err(UprivError::VaultConfigInvalid {
                path: crate::config::vault_config_path(old_dir),
                detail: format!(
                    "[vault].id ({}) must match directory name ({old_id})",
                    config.vault.id
                ),
            });
        }
        if config.vault.display_name == display_name {
            return Ok(VaultRenameResult {
                previous_id: old_id.to_string(),
                id: new_id.clone(),
                display_name: display_name.to_string(),
                id_changed: false,
            });
        }
        let prior_config = config.clone();
        let prior_persistence = load_vault_persistence(old_dir)?;
        let prior_display = config.vault.display_name.clone();
        config.vault.display_name = display_name.to_string();
        save_vault_config(old_dir, &config)?;
        if let Some(mut persistence) = load_vault_persistence(old_dir)? {
            persistence.display_name = display_name.to_string();
            save_vault_persistence(old_dir, &persistence)?;
        }
        if let Err(error) =
            migrate_closed_mount_leaf(root, &config, &prior_display, display_name, old_id, old_id)
        {
            let mut errors: Vec<String> = Vec::new();
            if let Err(restore) = save_vault_config(old_dir, &prior_config) {
                errors.push(format!("config: {restore}"));
            }
            if let Some(persistence) = prior_persistence {
                if let Err(restore) = save_vault_persistence(old_dir, &persistence) {
                    errors.push(format!("persistence: {restore}"));
                }
            }
            if errors.is_empty() {
                return Err(error);
            }
            return Err(combine_migrate_and_rollback(
                old_dir,
                error,
                rollback_error(old_dir, errors),
            ));
        }
        log_vault_renamed(old_id, old_id, &prior_display, display_name);
        Ok(VaultRenameResult {
            previous_id: old_id.to_string(),
            id: new_id,
            display_name: display_name.to_string(),
            id_changed: false,
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{create_vault_group_with_sort, load_vault_groups, save_app_settings};
    use crate::contents::KdfUnlockPreset;
    use crate::session::PreparingGuard;
    use crate::test_support::{vault_root_with, VaultSpec};
    use crate::vault::{close_vault, create_vault, open_vault};

    fn sample_config(id: &str, name: &str) -> crate::config::VaultConfig {
        toml::from_str(&format!(
            r#"
[vault]
id = "{id}"
display_name = "{name}"
order = 1
[storage]
mode = "encrypted_dir"
"#
        ))
        .expect("config")
    }

    #[test]
    fn rename_updates_display_name_when_slug_unchanged() {
        let (_tmp, root) = vault_root_with(&[VaultSpec::encrypted("notes", "Notes", 1)]);
        let result = rename_vault(&root, "notes", "NOTES").expect("rename");
        assert!(!result.id_changed);
        assert_eq!(result.id, "notes");
        assert_eq!(result.display_name, "NOTES");
        let cfg = load_vault_config_raw(root.vault_dir("notes").unwrap()).unwrap();
        assert_eq!(cfg.vault.display_name, "NOTES");
        assert_eq!(cfg.vault.id, "notes");
    }

    #[test]
    fn rename_slug_matches_typescript_for_non_nfd_letters() {
        let (_tmp, root) = vault_root_with(&[VaultSpec::encrypted("notes", "Notes", 1)]);
        let result = rename_vault(&root, "notes", "Øresund").expect("rename");
        assert_eq!(result.id, "resund");
        assert!(root.vault_dir("resund").unwrap().is_dir());
        assert!(!root.vault_dir("oresund").unwrap().exists());

        let again = rename_vault(&root, "resund", "Øresund").expect("same title");
        assert!(!again.id_changed);
        assert_eq!(again.id, "resund");
    }

    #[test]
    fn rename_migrates_folder_and_groups() {
        let (_tmp, root) = vault_root_with(&[
            VaultSpec::encrypted("notes", "Notes", 1),
            VaultSpec::encrypted("other", "Other", 2),
        ]);
        create_vault_group_with_sort(
            &root,
            "work",
            "Work",
            &["notes".into(), "other".into()],
            None,
            None,
            false,
        )
        .expect("group");

        let result = rename_vault(&root, "notes", "Work Docs").expect("rename");
        assert!(result.id_changed);
        assert_eq!(result.previous_id, "notes");
        assert_eq!(result.id, "work-docs");
        assert!(!root.vault_dir("notes").unwrap().exists());
        assert!(root.vault_dir("work-docs").unwrap().is_dir());
        let cfg = load_vault_config_raw(root.vault_dir("work-docs").unwrap()).unwrap();
        assert_eq!(cfg.vault.id, "work-docs");
        assert_eq!(cfg.vault.display_name, "Work Docs");

        let known = known_vault_ids(&root).unwrap();
        let groups = load_vault_groups(&root, &known).unwrap();
        let work = groups.groups.iter().find(|g| g.id == "work").unwrap();
        assert_eq!(work.grouped_vaults, vec!["work-docs", "other"]);
    }

    #[test]
    fn rename_collapses_internal_whitespace() {
        let (_tmp, root) = vault_root_with(&[VaultSpec::encrypted("notes", "Notes", 1)]);
        let result = rename_vault(&root, "notes", "Work    Docs").expect("rename");
        assert_eq!(result.display_name, "Work Docs");
        assert_eq!(result.id, "work-docs");
        let cfg = load_vault_config_raw(root.vault_dir("work-docs").unwrap()).unwrap();
        assert_eq!(cfg.vault.display_name, "Work Docs");
    }

    #[test]
    fn rename_collision_gets_suffix() {
        let (_tmp, root) = vault_root_with(&[
            VaultSpec::encrypted("notes", "Notes", 1),
            VaultSpec::encrypted("work-docs", "Work Docs", 2),
        ]);
        let result = rename_vault(&root, "notes", "Work Docs").expect("rename");
        assert_eq!(result.id, "work-docs-2");
    }

    #[test]
    fn rename_refuses_when_open() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .expect("create");
        open_vault(&root, "notes", b"pass-word-ok").expect("open");
        let err = rename_vault(&root, "notes", "Renamed").unwrap_err();
        assert!(matches!(err, UprivError::VaultConfigBusy { .. }));
        close_vault(&root, "notes", None).expect("close");
    }

    #[test]
    fn rename_refuses_when_preparing() {
        let (_tmp, root) = vault_root_with(&[VaultSpec::encrypted("notes", "Notes", 1)]);
        let dir = root.vault_dir("notes").unwrap();
        let _preparing = PreparingGuard::enter(&dir).expect("preparing");
        let err = rename_vault(&root, "notes", "Renamed").unwrap_err();
        assert!(matches!(err, UprivError::VaultConfigBusy { .. }));
    }

    #[test]
    fn rename_display_name_only_refuses_when_open_inside_lock() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .expect("create");
        open_vault(&root, "notes", b"pass-word-ok").expect("open");
        // Same slug path ("Notes" → "NOTES") must also refuse while open.
        let err = rename_vault(&root, "notes", "NOTES").unwrap_err();
        assert!(matches!(err, UprivError::VaultConfigBusy { .. }));
        close_vault(&root, "notes", None).expect("close");
    }

    #[test]
    fn rename_refuses_windows_reserved_display_name() {
        let (_tmp, root) = vault_root_with(&[VaultSpec::encrypted("notes", "Notes", 1)]);
        let err = rename_vault(&root, "notes", "CON").unwrap_err();
        assert!(matches!(err, UprivError::VaultConfigInvalid { .. }));
        assert!(root.vault_dir("notes").unwrap().is_dir());
    }

    #[test]
    fn injected_failure_after_groups_rolls_back_through_rename_vault() {
        let (_tmp, root) = vault_root_with(&[
            VaultSpec::encrypted("notes", "Notes", 1),
            VaultSpec::encrypted("other", "Other", 2),
        ]);
        create_vault_group_with_sort(
            &root,
            "work",
            "Work",
            &["notes".into(), "other".into()],
            None,
            None,
            false,
        )
        .expect("group");

        set_rename_fail_at(Some("after_groups"));
        let err = rename_vault(&root, "notes", "Work Docs").unwrap_err();
        assert!(matches!(err, UprivError::VaultStoreInvalid { .. }));
        assert!(root.vault_dir("notes").unwrap().is_dir());
        assert!(!root.vault_dir("work-docs").unwrap().exists());
        let cfg = load_vault_config_raw(root.vault_dir("notes").unwrap()).unwrap();
        assert_eq!(cfg.vault.id, "notes");
        assert_eq!(cfg.vault.display_name, "Notes");
        let known = known_vault_ids(&root).unwrap();
        let groups = load_vault_groups(&root, &known).unwrap();
        let work = groups.groups.iter().find(|g| g.id == "work").unwrap();
        assert_eq!(work.grouped_vaults, vec!["notes", "other"]);
    }

    #[test]
    fn rename_moves_leftover_closed_mount_leaf() {
        let (tmp, root) = vault_root_with(&[VaultSpec::encrypted("notes", "Notes", 1)]);
        let workspace = tmp.path().join("workspace");
        std::fs::create_dir_all(workspace.join("Notes")).unwrap();
        let mut loaded = load_app_settings_at(root.root()).expect("settings");
        loaded.settings.workspace.path = workspace.to_string_lossy().into();
        save_app_settings(root.root(), &loaded.settings).expect("save workspace");

        rename_vault(&root, "notes", "Work Docs").expect("rename");
        assert!(!workspace.join("Notes").exists());
        assert!(workspace.join("Work Docs").is_dir());
    }

    #[test]
    fn rollback_restores_config_id_match_after_groups_failure_simulation() {
        let (_tmp, root) = vault_root_with(&[VaultSpec::encrypted("notes", "Notes", 1)]);
        let old_dir = root.vault_dir("notes").unwrap();
        let new_dir = root.vault_dir("work-docs").unwrap();
        let prior = load_vault_config_raw(&old_dir).unwrap();
        std::fs::rename(&old_dir, &new_dir).unwrap();
        let mut broken = prior.clone();
        broken.vault.id = "work-docs".into();
        broken.vault.display_name = "Work Docs".into();
        save_vault_config(&new_dir, &broken).unwrap();

        rollback_migration(RenameRollback {
            root: &root,
            old_id: "notes",
            new_id: "work-docs",
            old_dir: &old_dir,
            new_dir: &new_dir,
            prior_config: &prior,
            prior_persistence: &None,
            groups_remapped: false,
            last_opened_patched: false,
            mount_moved: &None,
        })
        .expect("rollback");

        assert!(old_dir.is_dir());
        assert!(!new_dir.exists());
        let restored = load_vault_config_raw(&old_dir).unwrap();
        assert_eq!(restored.vault.id, "notes");
        assert_eq!(restored.vault.display_name, "Notes");
    }
}
