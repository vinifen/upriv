//! The status of one row of a folder list, for its settings window: whether
//! the folder answers and takes a write, then what it holds. Each row is
//! checked on its own, within its own limit, so one stuck drive never holds
//! up another row.

#[allow(unused_imports)]
use crate::host_fs::HostFsQuery;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::config::{known_vault_ids, load_app_settings_at, load_vault_config};
use crate::device::{this_device, DeviceSystem};
use crate::folder_list::backup::BackupPlace;
use crate::folder_list::unlocked::UnlockedPlace;
use crate::folder_list::{path_issue, row_folder, ListKind, Row, SHARED_BACKUPS_CONTAINER};
use crate::folder_probe::{
    holds_unlocked_mount, probe_writable, within_limit, FolderState, FOLDER_STATUS_CHECK_LIMIT,
};
use crate::paths::VaultRoot;

use super::backup_folder::{folder_id, zip_bytes_of};

/// Which list a row belongs to, for its status.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StatusList {
    Unlocked,
    Backup,
}

/// What a row's folder holds, once it answers.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderDetails {
    /// Free bytes, when the system says.
    pub free_bytes: Option<u64>,
    /// Unlocked folders: the vaults open there now.
    pub open_vaults: Vec<String>,
    /// Unlocked folders: plain-text folders this device left there.
    pub plain_left: u32,
    /// Unlocked folders: an encrypted vault's unlocked folder cannot live on
    /// this file system (exFAT or FAT on Windows).
    pub no_encrypted_folder: bool,
    /// Backups: how many zips it holds, and their size.
    pub zips: u32,
    pub zip_bytes: u64,
    /// Backups of a vault: the size of its next zip.
    pub next_zip_bytes: Option<u64>,
}

/// A row's status: its state, and its details once it answers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderStatus {
    pub state: FolderState,
    pub details: Option<FolderDetails>,
}

/// `folder_status`: the status of `path` as a row of `list` on this device.
/// `vault_id` names the vault of a vault's list.
pub fn folder_status(
    root: &VaultRoot,
    list: StatusList,
    path: &str,
    vault_id: Option<&str>,
) -> FolderStatus {
    let kind = match list {
        StatusList::Unlocked => ListKind::Unlocked,
        StatusList::Backup => ListKind::Backup,
    };
    if path_issue(DeviceSystem::current(), kind, path).is_some() {
        return FolderStatus {
            state: FolderState::Refused,
            details: None,
        };
    }
    let base = row_folder(path);
    let probe = base.clone();
    let state = within_limit(&base, "row_status", FOLDER_STATUS_CHECK_LIMIT, move || {
        probe_writable(&probe)
    })
    .unwrap_or(FolderState::NotResponding);
    if !state.is_ok() {
        return FolderStatus {
            state,
            details: None,
        };
    }
    let row = Row {
        number: 0,
        name: String::new(),
        path: path.to_string(),
    };
    let details = match list {
        StatusList::Unlocked => unlocked_details(root, &row),
        StatusList::Backup => backup_details(root, &row, vault_id),
    };
    FolderStatus { state, details }
}

fn unlocked_details(root: &VaultRoot, row: &Row) -> Option<FolderDetails> {
    let container = UnlockedPlace::AppRow(row.clone()).container(root.root());
    let base = row_folder(&row.path);
    let open_vaults = super::unlocked_folder::open_vault_names_under(root, &container);
    let plain_left = super::plain::records_left_under(root, &container);
    within_limit(
        &base.clone(),
        "row_details",
        FOLDER_STATUS_CHECK_LIMIT,
        move || FolderDetails {
            free_bytes: crate::host_fs::free_bytes(&base),
            open_vaults,
            plain_left,
            no_encrypted_folder: !holds_unlocked_mount(&base),
            ..FolderDetails::default()
        },
    )
}

fn backup_details(root: &VaultRoot, row: &Row, vault_id: Option<&str>) -> Option<FolderDetails> {
    let base = row_folder(&row.path);
    let (dirs, next_zip_bytes) = match vault_id {
        Some(id) => {
            let vault_dir = root.vault_dir(id).ok()?;
            let place = BackupPlace::VaultRow(row.clone());
            let dir = place.dir(&vault_dir, &folder_id(&vault_dir, id));
            (vec![dir], zip_bytes_of(&vault_dir))
        }
        None => (vec![shared_container(&base)], None),
    };
    let per_vault = vault_id.is_none();
    within_limit(
        &base.clone(),
        "row_details",
        FOLDER_STATUS_CHECK_LIMIT,
        move || {
            let (zips, zip_bytes) = dirs
                .iter()
                .map(|dir| count_zips(dir, per_vault))
                .fold((0, 0), |(count, bytes), (more, size)| {
                    (count + more, bytes + size)
                });
            FolderDetails {
                free_bytes: crate::host_fs::free_bytes(&base),
                zips,
                zip_bytes,
                next_zip_bytes,
                ..FolderDetails::default()
            }
        },
    )
}

/// `upriv-backups` in an app row, or the row when it already is one.
fn shared_container(base: &Path) -> PathBuf {
    if crate::folder_list::names_folder(base, SHARED_BACKUPS_CONTAINER) {
        base.to_path_buf()
    } else {
        base.join(SHARED_BACKUPS_CONTAINER)
    }
}

/// The zips in `dir` and its `saves/`, and in each vault's folder below it
/// for the shared container of an app row. Counted by name and size, never
/// opened.
pub(super) fn count_zips(dir: &Path, per_vault: bool) -> (u32, u64) {
    let mut found = (0u32, 0u64);
    let mut add = |folder: &Path| {
        for at in [folder.to_path_buf(), folder.join("saves")] {
            let Ok(entries) = crate::host_fs::read_dir(&at) else {
                continue;
            };
            for entry in entries.flatten() {
                let is_zip = entry
                    .file_name()
                    .to_str()
                    .is_some_and(|name| name.ends_with(".zip"));
                if !is_zip || !entry.file_type().is_ok_and(|kind| kind.host_is_file()) {
                    continue;
                }
                found.0 += 1;
                found.1 += entry
                    .known_len()
                    .or_else(|| entry.metadata().ok().map(|meta| meta.len()))
                    .unwrap_or(0);
            }
        }
    };
    if per_vault {
        if let Ok(entries) = crate::host_fs::read_dir(dir) {
            for entry in entries.flatten() {
                if entry.file_type().is_ok_and(|kind| kind.host_is_dir()) {
                    add(&entry.path());
                }
            }
        }
    } else {
        add(dir);
    }
    found
}

/// `device_trees`: the storage-access trees this device's rows name, in
/// every list, for a phone to mount. Each once.
pub fn device_trees(root: &VaultRoot) -> Vec<String> {
    let device = this_device();
    let mut trees = BTreeSet::new();
    let mut take = |rows: &[Row]| {
        for row in rows {
            if crate::paths::is_content_uri(row.path.trim()) {
                trees.insert(row.path.trim().to_string());
            }
        }
    };
    if let Ok(loaded) = load_app_settings_at(root.root()) {
        take(loaded.settings.unlocked_folders.devices.rows_here(device));
        take(loaded.settings.backups.devices.rows_here(device));
    }
    for id in known_vault_ids(root).unwrap_or_default() {
        let Ok(config) = root.vault_dir(&id).and_then(load_vault_config) else {
            continue;
        };
        take(config.unlocked_folder.devices.rows_here(device));
        take(config.backup.devices.rows_here(device));
    }
    trees.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{vault_root_with, VaultSpec};

    #[test]
    fn a_folder_that_answers_shows_what_it_holds() {
        let (tmp, root) = vault_root_with(&[]);
        let drive = tmp.path().join("drive");
        let notes = drive.join(SHARED_BACKUPS_CONTAINER).join("notes");
        std::fs::create_dir_all(notes.join("saves")).unwrap();
        std::fs::write(notes.join("20260101000000-notes.zip"), b"12345").unwrap();
        std::fs::write(notes.join("saves").join("20260101000001-notes.zip"), b"123").unwrap();
        let status = folder_status(
            &root,
            StatusList::Backup,
            &drive.display().to_string(),
            None,
        );
        assert_eq!(status.state, FolderState::Ok);
        let details = status.details.unwrap();
        assert_eq!((details.zips, details.zip_bytes), (2, 8));
        assert!(details.free_bytes.is_some());
    }

    #[test]
    fn a_folder_that_is_gone_has_no_details() {
        let (tmp, root) = vault_root_with(&[]);
        let gone = tmp.path().join("gone").display().to_string();
        let status = folder_status(&root, StatusList::Unlocked, &gone, None);
        assert_eq!(status.state, FolderState::Missing);
        assert!(status.details.is_none());
    }

    #[test]
    fn a_path_the_rules_refuse_is_never_looked_at() {
        let (_tmp, root) = vault_root_with(&[]);
        let status = folder_status(&root, StatusList::Backup, "relative", None);
        assert_eq!(status.state, FolderState::Refused);
    }

    #[test]
    fn the_trees_are_those_this_devices_rows_name() {
        let (_tmp, root) = vault_root_with(&[VaultSpec::encrypted("notes", "Notes", 1)]);
        let vault_dir = root.vault_dir("notes").unwrap();
        let mut config = load_vault_config(&vault_dir).unwrap();
        let tree = std::path::Path::new(
            "content://com.android.externalstorage.documents/tree/primary%3ADocuments",
        );
        crate::test_support::backup_rows(&mut config, &[tree]);
        crate::test_support::unlocked_rows(&mut config, &[tree, std::path::Path::new("/mnt/a")]);
        crate::config::save_vault_config(&vault_dir, &config).unwrap();
        assert_eq!(device_trees(&root), vec![tree.display().to_string()]);
    }
}
