//! Where a vault's backups go on this device, and whether a folder can take
//! one now.
//!
//! A folder can be a drive that is unplugged, full, read-only, or a network
//! share that stopped answering. Each check has its own limit
//! ([`crate::folder_probe`]), so one stuck drive never holds up the rest.

#[allow(unused_imports)]
use crate::host_fs::HostFsQuery;
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::config::{load_app_settings_at, load_vault_config};
use crate::device::{this_device, DeviceSystem};
use crate::folder_list::backup::{
    self, AppBackupFolders, BackupPlace, VaultBackupChoice, DATA_FOLDER_BACKUPS_DIR,
};
use crate::folder_list::{path_issue, DeviceGroups, ListKind};
use crate::folder_probe::{probe_writable, room_for, within_limit, FolderState};
use crate::paths::VaultRoot;

use super::persistence::load_vault_persistence;

/// `backups/` of a vault folder in the data folder.
pub(super) const BACKUPS_DIR: &str = DATA_FOLDER_BACKUPS_DIR;

/// The lists that decide where a vault's backups go. A file that cannot be
/// read means the data folder, the one place that always exists.
pub(super) struct BackupLists {
    pub app: AppBackupFolders,
    pub vault: DeviceGroups<VaultBackupChoice>,
}

pub(super) fn backup_lists(root: &VaultRoot, vault_dir: &Path) -> BackupLists {
    BackupLists {
        app: load_app_settings_at(root.root())
            .map(|loaded| loaded.settings.backups)
            .unwrap_or_default(),
        vault: load_vault_config(vault_dir)
            .map(|config| config.backup.devices)
            .unwrap_or_default(),
    }
}

/// The id that names this vault's folder in a row: the vault id at its first
/// backup outside the data folder, which a rename leaves as it was.
pub(super) fn folder_id(vault_dir: &Path, vault_id: &str) -> String {
    load_vault_persistence(vault_dir)
        .ok()
        .flatten()
        .and_then(|saved| saved.backup_folder_id)
        .unwrap_or_else(|| vault_id.to_string())
}

/// A choice of the backup chain, resolved for one vault: the folder that
/// holds its zips.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct BackupTarget {
    pub place: BackupPlace,
    pub dir: PathBuf,
}

impl BackupTarget {
    pub(super) fn of(place: BackupPlace, vault_dir: &Path, folder_id: &str) -> Self {
        let dir = place.dir(vault_dir, folder_id);
        Self { place, dir }
    }

    pub(super) fn is_data_folder(&self) -> bool {
        self.place == BackupPlace::DataFolder
    }
}

/// The folder this device's selection names, and the chain behind it.
pub(super) struct Targets {
    pub lists: BackupLists,
    pub selected: BackupTarget,
    pub chain: Vec<BackupTarget>,
}

pub(super) fn targets(root: &VaultRoot, vault_id: &str, vault_dir: &Path) -> Targets {
    let lists = backup_lists(root, vault_dir);
    let id = folder_id(vault_dir, vault_id);
    let device = this_device();
    let selected = BackupTarget::of(
        backup::selected_place(&lists.app, &lists.vault, device),
        vault_dir,
        &id,
    );
    let chain = backup::chain(&lists.app, &lists.vault, device)
        .into_iter()
        .map(|place| BackupTarget::of(place, vault_dir, &id))
        .collect();
    Targets {
        lists,
        selected,
        chain,
    }
}

/// True when this device wrote to `dir` before and the person has not
/// selected it again since: its vault folder missing there means the drive
/// is away, and none is made in its place.
fn wrote_here(vault_dir: &Path, dir: &Path) -> bool {
    let key = this_device().record_key();
    let dir = dir.to_string_lossy();
    load_vault_persistence(vault_dir)
        .ok()
        .flatten()
        .is_some_and(|saved| {
            saved
                .backup_folders
                .iter()
                .any(|folder| folder.dir == dir && folder.device == key && !folder.reuse)
        })
}

/// Whether `target` can take a zip of `needed` bytes now, within `limit`. The
/// folder of a row is never made; the vault's folder in it is made by the
/// write.
pub(super) fn check_target(
    vault_dir: &Path,
    target: &BackupTarget,
    needed: Option<u64>,
    limit: Duration,
) -> FolderState {
    if target
        .place
        .row_path()
        .is_some_and(|path| path_issue(DeviceSystem::current(), ListKind::Backup, path).is_some())
    {
        return FolderState::Refused;
    }
    let dir = target.dir.clone();
    let base = target
        .place
        .row_folder()
        .unwrap_or_else(|| vault_dir.to_path_buf());
    let away_if_missing = !target.is_data_folder() && wrote_here(vault_dir, &dir);
    let key = base.clone();
    within_limit(&key, "backup_target", limit, move || {
        if !base.host_is_dir() {
            return FolderState::Missing;
        }
        let into = if dir.host_is_dir() {
            &dir
        } else if away_if_missing {
            return FolderState::Missing;
        } else {
            &base
        };
        let state = probe_writable(into);
        match needed {
            Some(bytes) if state.is_ok() => room_for(into, bytes),
            _ => state,
        }
    })
    .unwrap_or(FolderState::NotResponding)
}

/// Whether the zips in `dir` can be read now: a listing of a folder that is
/// not in use, within `limit`.
pub(super) fn check_readable(dir: &Path, limit: Duration) -> FolderState {
    let target = dir.to_path_buf();
    within_limit(
        dir,
        "backup_readable",
        limit,
        move || match crate::host_fs::entry_kind(&target) {
            Ok(crate::host_fs::EntryKind::Dir) => FolderState::Ok,
            Ok(_) => FolderState::Missing,
            Err(error) => FolderState::of_io(&error),
        },
    )
    .unwrap_or(FolderState::NotResponding)
}

/// Size of the next zip of this vault.
pub(super) fn zip_bytes_of(vault_dir: &Path) -> Option<u64> {
    super::zip_io::store_zip_bytes(&vault_dir.join(crate::paths::STORE_DIR_NAME)).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::folder_list::Row;
    use crate::folder_probe::FOLDER_STATUS_CHECK_LIMIT;

    fn row_target(row: &Path, vault_dir: &Path) -> BackupTarget {
        BackupTarget::of(
            BackupPlace::AppRow(Row {
                number: 1,
                name: String::new(),
                path: row.display().to_string(),
            }),
            vault_dir,
            "notes",
        )
    }

    #[test]
    fn a_writable_row_is_ok_and_keeps_no_probe_file() {
        let tmp = tempfile::tempdir().unwrap();
        let vault_dir = tmp.path().join("vault");
        let target = row_target(tmp.path(), &vault_dir);
        assert_eq!(
            check_target(&vault_dir, &target, None, FOLDER_STATUS_CHECK_LIMIT),
            FolderState::Ok
        );
        assert_eq!(crate::host_fs::read_dir(tmp.path()).unwrap().count(), 0);
        assert!(!target.dir.host_exists());
    }

    #[test]
    fn a_row_that_is_gone_is_missing_and_never_made() {
        let tmp = tempfile::tempdir().unwrap();
        let gone = tmp.path().join("unplugged");
        let target = row_target(&gone, tmp.path());
        assert_eq!(
            check_target(tmp.path(), &target, None, FOLDER_STATUS_CHECK_LIMIT),
            FolderState::Missing
        );
        assert!(!gone.host_exists());
    }

    #[test]
    fn a_zip_larger_than_the_free_space_has_no_room() {
        let tmp = tempfile::tempdir().unwrap();
        let target = row_target(tmp.path(), tmp.path());
        assert_eq!(
            check_target(
                tmp.path(),
                &target,
                Some(u64::MAX),
                FOLDER_STATUS_CHECK_LIMIT
            ),
            FolderState::NoRoom
        );
    }

    #[test]
    fn a_row_the_rules_refuse_is_refused() {
        let tmp = tempfile::tempdir().unwrap();
        let inside = tmp.path().join("upriv-unlocked").join("Notes");
        let target = row_target(&inside, tmp.path());
        assert_eq!(
            check_target(tmp.path(), &target, None, FOLDER_STATUS_CHECK_LIMIT),
            FolderState::Refused
        );
    }
}
