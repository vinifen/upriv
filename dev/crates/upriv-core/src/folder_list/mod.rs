//! Saved lists of folders, kept per device: the unlocked folders, the backup
//! folders, and the data folder. Each list keeps one group per device under
//! its feature's table; on the current device one choice is selected, and the
//! order of the list is its priority when the selection fails.

pub mod backup;
pub mod chain;
pub mod data_folder;
pub mod model;
pub mod path_rules;
pub mod unlocked;

use std::path::PathBuf;

pub use chain::{fail_over, ChoiceName, Failover, Level, ListName, Switch, Try};
pub use model::{
    apply_changes, DeviceGroup, DeviceGroups, FixedChoice, GroupChange, ListChanges, Row,
    Selection, ROW_NAME_MAX_CHARS,
};
pub use path_rules::{
    is_within, path_issue, same_path, ListKind, PathIssue, SHARED_BACKUPS_CONTAINER,
    UNLOCKED_CONTAINER,
};

/// The folder a row names on this device: its path, or on a phone the root
/// of the storage-access tree its path names, served while that tree is
/// mounted.
pub fn row_folder(path: &str) -> PathBuf {
    let path = path.trim();
    if crate::paths::is_content_uri(path) {
        crate::host_fs::tree_root(path)
    } else {
        PathBuf::from(path)
    }
}

/// Whether a folder's name is `name`, the way the current system compares
/// names: Windows and macOS ignore case.
pub(crate) fn names_folder(folder: &std::path::Path, name: &str) -> bool {
    let Some(last) = folder.file_name().and_then(|last| last.to_str()) else {
        return false;
    };
    if cfg!(any(windows, target_os = "macos", target_os = "ios")) {
        last.eq_ignore_ascii_case(name)
    } else {
        last == name
    }
}
