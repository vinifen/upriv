//! Saving the folder lists of `settings.toml` and a vault's `config.toml`.
//!
//! A save carries what changed, per list and device group, never whole
//! lists: core reads the file again under its lock and applies only those
//! parts, so a switch core made meanwhile in another part stays. When the
//! person's change and a switch touched the same part, the person's change
//! wins.
//!
//! A rename or a removal of another device's group in an app list applies to
//! that device's group of the same feature in every vault too. Each file is
//! written on its own, atomically: one that fails keeps its previous
//! content, which is valid on its own, and the save names it.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::device::{this_device, DeviceId, ThisDevice};
use crate::error::{Result, UprivError};
use crate::folder_list::backup::{AppBackupChoice, BackupSelections, VaultBackupChoice};
use crate::folder_list::unlocked::{
    app_fixed_folders, AppUnlockedChoice, UnlockedPlace, UnlockedSelections, VaultUnlockedChoice,
};
use crate::folder_list::{apply_changes, DeviceGroups, FixedChoice, ListChanges, Row};
use crate::paths::VaultRoot;

use super::app_settings::AppSettings;
use super::vault_config::VaultConfig;

/// What an app settings save changes in the app's lists.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppListChanges {
    #[serde(default)]
    pub unlocked_folders: ListChanges<AppUnlockedChoice>,
    #[serde(default)]
    pub backups: ListChanges<AppBackupChoice>,
}

/// What a vault settings save changes in the vault's lists.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VaultListChanges {
    #[serde(default)]
    pub unlocked_folder: ListChanges<VaultUnlockedChoice>,
    #[serde(default)]
    pub backup: ListChanges<VaultBackupChoice>,
}

/// What a save did beyond its own file.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListsSaved {
    /// Vaults whose `config.toml` kept its previous content: a device group
    /// renamed or removed in System settings did not change there.
    pub unchanged_vaults: Vec<String>,
    /// `upriv-unlocked` folders of deleted rows that stayed, because they hold
    /// files or could not be reached. The row is gone either way.
    pub kept_folders: Vec<String>,
}

/// The rows of this device's group that a change deletes or points elsewhere.
fn rows_leaving<F: FixedChoice>(
    groups: &DeviceGroups<F>,
    changes: &ListChanges<F>,
    device: &ThisDevice,
) -> Vec<Row> {
    let Some(id) = device.id.as_ref() else {
        return Vec::new();
    };
    let Some(after) = changes
        .groups
        .get(id)
        .and_then(|change| change.rows.as_ref())
    else {
        return Vec::new();
    };
    groups
        .rows_here(device)
        .iter()
        .filter(|before| {
            !after
                .iter()
                .any(|row| row.number == before.number && row.path.trim() == before.path)
        })
        .cloned()
        .collect()
}

/// Apply the app's list changes to `settings`, whose lists are taken from
/// `saved` (the file as it is now). Returns the unlocked rows this device
/// lost, for [`release_unlocked_rows`].
pub(crate) fn apply_app_lists(
    root: &VaultRoot,
    saved: &AppSettings,
    settings: &mut AppSettings,
    changes: &AppListChanges,
) -> Result<Vec<UnlockedPlace>> {
    let device = this_device();
    settings.unlocked_folders.devices = saved.unlocked_folders.devices.clone();
    settings.backups.devices = saved.backups.devices.clone();
    if changes.unlocked_folders.touches_here(device)
        && !crate::session::open_session_ids().is_empty()
    {
        return Err(UprivError::VaultConfigBusy {
            target: "unlocked_folders".into(),
        });
    }
    let leaving: Vec<UnlockedPlace> = rows_leaving(
        &saved.unlocked_folders.devices,
        &changes.unlocked_folders,
        device,
    )
    .into_iter()
    .map(UnlockedPlace::AppRow)
    .collect();
    crate::vault::refuse_folders_in_use(root, &leaving)?;
    apply_changes(
        &mut settings.unlocked_folders.devices,
        &changes.unlocked_folders,
        device,
        &app_fixed_folders(root.root()),
    )?;
    apply_changes(&mut settings.backups.devices, &changes.backups, device, &[])?;
    Ok(leaving)
}

/// Apply a vault's list changes to `after`, whose lists are taken from
/// `before` (the file as it is now). Returns the unlocked rows this device
/// lost.
pub(crate) fn apply_vault_lists(
    root: &VaultRoot,
    before: &VaultConfig,
    after: &mut VaultConfig,
    changes: &VaultListChanges,
) -> Result<Vec<UnlockedPlace>> {
    let device = this_device();
    after.unlocked_folder.devices = before.unlocked_folder.devices.clone();
    after.backup.devices = before.backup.devices.clone();
    let leaving: Vec<UnlockedPlace> = rows_leaving(
        &before.unlocked_folder.devices,
        &changes.unlocked_folder,
        device,
    )
    .into_iter()
    .map(UnlockedPlace::VaultRow)
    .collect();
    crate::vault::refuse_folders_in_use(root, &leaving)?;
    apply_changes(
        &mut after.unlocked_folder.devices,
        &changes.unlocked_folder,
        device,
        &[],
    )?;
    apply_changes(&mut after.backup.devices, &changes.backup, device, &[])?;
    Ok(leaving)
}

/// The other devices whose groups a save removes, carried to every vault.
fn removed_devices<F: FixedChoice>(changes: &ListChanges<F>, device: &ThisDevice) -> Vec<DeviceId> {
    changes
        .groups
        .iter()
        .filter(|(id, change)| device.id.as_ref() != Some(*id) && change.remove)
        .map(|(id, _)| id.clone())
        .collect()
}

/// True when `groups` changed.
fn remove_groups<F: FixedChoice>(groups: &mut DeviceGroups<F>, removed: &[DeviceId]) -> bool {
    let mut changed = false;
    for device in removed {
        changed |= groups.0.remove(device).is_some();
    }
    changed
}

/// Carry the app lists' removals of other devices' groups to every vault.
/// Returns the vaults whose files kept their previous content.
pub(crate) fn carry_device_removals(root: &VaultRoot, changes: &AppListChanges) -> Vec<String> {
    let device = this_device();
    let unlocked = removed_devices(&changes.unlocked_folders, device);
    let backups = removed_devices(&changes.backups, device);
    if unlocked.is_empty() && backups.is_empty() {
        return Vec::new();
    }
    let Ok(ids) = super::known_vault_ids(root) else {
        return Vec::new();
    };
    let mut unchanged = Vec::new();
    for id in ids {
        let Ok(vault_dir) = root.vault_dir(&id) else {
            continue;
        };
        let carried = crate::session::with_vault_dir_lock(&vault_dir, || {
            let mut config = super::load_vault_config(&vault_dir)?;
            let lists_changed = remove_groups(&mut config.unlocked_folder.devices, &unlocked)
                | remove_groups(&mut config.backup.devices, &backups);
            if lists_changed {
                super::save_vault_config(&vault_dir, &config)?;
            }
            if !backups.is_empty() {
                crate::vault::forget_backup_devices(&vault_dir, &id, &backups)?;
            }
            Ok(())
        });
        if carried.is_err() {
            unchanged.push(id);
        }
    }
    unchanged
}

/// Update a vault's `config.toml` from a fresh read. The caller holds the
/// vault's directory lock.
pub(crate) fn update_vault_config_locked(
    vault_dir: &Path,
    change: impl FnOnce(&mut VaultConfig),
) -> Result<()> {
    let mut config = super::load_vault_config(vault_dir)?;
    change(&mut config);
    super::save_vault_config(vault_dir, &config)
}

/// Save the selections an unlocked folder switch makes: the vault's in its
/// `config.toml` (the caller holds that vault's directory lock), the app's
/// in `settings.toml`. False when a file kept its previous content: the
/// switch then holds for this run only.
pub(crate) fn save_unlocked_switch(
    root: &VaultRoot,
    vault_dir: &Path,
    taking: UnlockedSelections,
) -> bool {
    let device = this_device();
    let mut saved = true;
    if let Some(to) = taking.vault {
        saved &= update_vault_config_locked(vault_dir, |config| {
            config.unlocked_folder.devices.select_here(device, to);
        })
        .is_ok();
    }
    if let Some(to) = taking.app {
        saved &= super::app_settings::update_app_settings(root.root(), |settings| {
            settings.unlocked_folders.devices.select_here(device, to);
        })
        .is_ok();
    }
    saved
}

/// Save the selections a backup folder switch makes. The caller holds the
/// vault's directory lock.
pub(crate) fn save_backup_switch(
    root: &VaultRoot,
    vault_dir: &Path,
    taking: BackupSelections,
) -> bool {
    let device = this_device();
    let mut saved = true;
    if let Some(to) = taking.vault {
        saved &= update_vault_config_locked(vault_dir, |config| {
            config.backup.devices.select_here(device, to);
        })
        .is_ok();
    }
    if let Some(to) = taking.app {
        saved &= super::app_settings::update_app_settings(root.root(), |settings| {
            settings.backups.devices.select_here(device, to);
        })
        .is_ok();
    }
    saved
}

/// After a save that selects a backup folder on this device: each vault it
/// leads to makes its folder there again when it is missing.
pub(crate) fn reuse_selected_backup_folders<'a>(
    root: &VaultRoot,
    vault_ids: impl IntoIterator<Item = &'a String>,
) {
    for vault_id in vault_ids {
        if crate::vault::reuse_selected_backup_folder(root, vault_id).is_err() {
            crate::logging::log_event(
                crate::logging::LogLevel::Warn,
                "backup_folder_reuse_unrecorded",
                &[("id", vault_id.as_str())],
            );
        }
    }
}

/// True when `changes` set this device's selection.
pub(crate) fn selects_here<F: FixedChoice>(changes: &ListChanges<F>) -> bool {
    let device = this_device();
    device
        .id
        .as_ref()
        .and_then(|id| changes.groups.get(id))
        .is_some_and(|change| change.selected.is_some())
}

/// The `upriv-unlocked` folders the deleted rows used: each goes when it
/// holds nothing but its folder ID file and no row of this device still
/// names it. Returns the ones that stayed.
pub(crate) fn release_unlocked_rows(root: &VaultRoot, leaving: &[UnlockedPlace]) -> Vec<String> {
    let still_named = crate::vault::unlocked_containers_named(root);
    let mut kept = Vec::new();
    for place in leaving {
        let container: PathBuf = place.container(root.root());
        if still_named.contains(&container) {
            continue;
        }
        if !crate::vault::release_unlocked_container(root, &container) {
            kept.push(container.display().to_string());
        }
    }
    kept
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::folder_list::model::tests::device;
    use crate::folder_list::{DeviceGroup, GroupChange};

    #[test]
    fn a_removal_of_another_device_is_carried() {
        let here = device(b"desk");
        let other = device(b"laptop");
        let remove = GroupChange {
            remove: true,
            rows: None,
            next_number: None,
            selected: None,
        };
        let mut changes = ListChanges::<AppUnlockedChoice>::default();
        changes
            .groups
            .insert(other.id.clone().unwrap(), remove.clone());
        changes.groups.insert(here.id.clone().unwrap(), remove);
        // This device's group goes only row by row.
        let removed = removed_devices(&changes, &here);
        assert_eq!(removed, vec![other.id.clone().unwrap()]);

        let mut groups = DeviceGroups::<VaultUnlockedChoice>::default();
        groups.0.insert(
            other.id.clone().unwrap(),
            DeviceGroup {
                rows: vec![Row {
                    number: 1,
                    name: String::new(),
                    path: "/a".into(),
                }],
                ..DeviceGroup::for_device(&other)
            },
        );
        assert!(remove_groups(&mut groups, &removed));
        assert!(groups.0.is_empty());
        assert!(!remove_groups(&mut groups, &removed));
    }

    #[test]
    fn the_rows_leaving_are_the_deleted_and_the_moved_ones() {
        let here = device(b"desk");
        let row = |number: u32, path: &str| Row {
            number,
            name: String::new(),
            path: path.into(),
        };
        let mut groups = DeviceGroups::<AppUnlockedChoice>::default();
        groups.0.insert(
            here.id.clone().unwrap(),
            DeviceGroup {
                rows: vec![row(1, "/a"), row(2, "/b"), row(3, "/c")],
                next_number: 4,
                ..DeviceGroup::for_device(&here)
            },
        );
        let mut changes = ListChanges::default();
        changes.groups.insert(
            here.id.clone().unwrap(),
            GroupChange {
                remove: false,
                rows: Some(vec![row(1, "/a"), row(3, "/elsewhere")]),
                next_number: None,
                selected: None,
            },
        );
        let leaving = rows_leaving(&groups, &changes, &here);
        assert_eq!(leaving, vec![row(2, "/b"), row(3, "/c")]);
    }
}
