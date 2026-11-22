//! Where an open plaintext vault writes its files, and whether that place may
//! hold them.
//!
//! The folder is the vault's unlocked folder on this device:
//! `{row}/upriv-unlocked/{vault name}` for a row of its chain, or
//! `{data folder}/upriv-unlocked/{vault name}` beside the data folder. The
//! settings name it; nothing sealed in the vault confirms it, so the unlock
//! window shows it before the password ([`plain_destination`]).

use std::ffi::OsString;
use std::path::{Component, Path, PathBuf};

use super::marker;
use super::volume;
use crate::config::{load_app_settings_at, VaultConfig};
use crate::device::this_device;
use crate::error::{PlainDestinationReason, Result, UprivError};
use crate::folder_list::unlocked::{self, AppUnlockedFolders, UnlockedPlace};
use crate::folder_list::{fail_over, Failover, Try};
use crate::folder_probe::{FolderState, FOLDER_SWITCH_CHECK_LIMIT};
#[allow(unused_imports)]
use crate::host_fs::HostFsQuery;
use crate::paths::{is_inside_upriv_of, path_is_under_reserved_upriv_tree, VaultRoot};
use crate::vault::unlocked_destination::UnlockedDestination;
use crate::vault::unlocked_folder::check_place;

/// A vault's folder in one place of its chain.
#[derive(Debug, Clone)]
pub(super) struct Destination {
    pub place: UnlockedPlace,
    pub folder: PathBuf,
}

impl Destination {
    pub(super) fn new(root: &VaultRoot, place: UnlockedPlace, display_name: &str) -> Self {
        let folder = place.vault_folder(root.root(), display_name);
        Self { place, folder }
    }

    pub(super) fn in_data_folder(&self) -> bool {
        self.place.in_data_folder()
    }

    /// The `upriv-unlocked` folder that holds this vault's folder.
    pub(super) fn container(&self, root: &VaultRoot) -> PathBuf {
        self.place.container(root.root())
    }
}

/// The lists that decide a vault's place on this device.
pub(super) struct Places {
    pub app: AppUnlockedFolders,
    pub selected: UnlockedPlace,
    pub chain: Vec<UnlockedPlace>,
}

/// The selected place and the chain. [`UprivError::UnlockedFolderUnset`]
/// when nothing is selected on this device.
pub(super) fn places(root: &VaultRoot, config: &VaultConfig) -> Result<Places> {
    let app = load_app_settings_at(root.root())?.settings.unlocked_folders;
    let device = this_device();
    let selected = unlocked::selected_place(&app, &config.unlocked_folder, device)
        .ok_or(UprivError::UnlockedFolderUnset)?;
    let chain = unlocked::chain(&app, &config.unlocked_folder, device);
    Ok(Places {
        app,
        selected,
        chain,
    })
}

/// The plain-text half of [`crate::vault::unlocked_destination`]: the
/// folder the open would fill, checked the way the open checks it before
/// the password, with nothing made. The walk down the chain stops at the
/// first place that answers and whose vault folder is free; a leftover or an
/// occupied folder is the open's error.
pub(crate) fn plain_destination(
    root: &VaultRoot,
    vault_id: &str,
    config: &VaultConfig,
) -> Result<UnlockedDestination> {
    super::require_known_device()?;
    let places = match places(root, config) {
        Ok(places) => places,
        Err(UprivError::UnlockedFolderUnset) => return Ok(UnlockedDestination::Unset),
        Err(error) => return Err(error),
    };
    let display_name = config.vault.display_name.as_str();
    let outcome = fail_over(&places.selected, &places.chain, |place| {
        try_place(root, vault_id, place, display_name, false)
    });
    let device = this_device();
    let (dest, switches) = match outcome {
        Failover::Kept(dest) => (dest, Vec::new()),
        Failover::Switched {
            link,
            value,
            reason,
        } => {
            let taking =
                unlocked::selections_taking(&places.app, &config.unlocked_folder, device, link);
            let switches = unlocked::switches(
                &places.app,
                &config.unlocked_folder,
                device,
                vault_id,
                taking,
                reason,
            );
            (value, switches)
        }
        Failover::Stopped(error) => return Err(error),
        Failover::Unavailable(reason) => {
            return Ok(UnlockedDestination::Unavailable {
                path: places.selected.container(root.root()).display().to_string(),
                reason,
            })
        }
    };
    Ok(UnlockedDestination::Folder {
        path: dest.folder.display().to_string(),
        class: Some(volume::inspect(&dest.folder).class),
        switches,
    })
}

/// Whether `place` can take the vault's folder before anything is written:
/// its folder answers and takes a write, the vault's folder is not around
/// the data folder, and it is missing or empty. A failure of the folder
/// itself moves the walk on; a leftover or an occupied folder stops it.
/// With `make`, `upriv-unlocked` is made with its folder ID file.
pub(super) fn try_place(
    root: &VaultRoot,
    vault_id: &str,
    place: &UnlockedPlace,
    display_name: &str,
    make: bool,
) -> Try<Destination, UprivError> {
    let state = check_place(root, place, FOLDER_SWITCH_CHECK_LIMIT, make);
    if !state.is_ok() {
        return Try::Fails(state);
    }
    let dest = Destination::new(root, place.clone(), display_name);
    if let Err(error) = check(root, &dest) {
        return Try::Stop(error);
    }
    match inspect_leaf(&dest.folder, vault_id) {
        Ok(_) => Try::Works(dest),
        Err(UprivError::Io(error)) => Try::Fails(FolderState::of_io(&error)),
        Err(error) => Try::Stop(error),
    }
}

fn refused(path: &Path, reason: PlainDestinationReason) -> UprivError {
    UprivError::PlainDestinationInvalid {
        path: path.to_path_buf(),
        reason,
    }
}

/// Refuse a place other apps could not use, or one inside `.upriv` or
/// around the data folder.
pub(super) fn check(root: &VaultRoot, dest: &Destination) -> Result<()> {
    let folder = &dest.folder;
    if cfg!(target_os = "android") && !crate::host_fs::is_bridge_path(folder) {
        return Err(refused(folder, PlainDestinationReason::PrivateStorage));
    }
    if path_is_under_reserved_upriv_tree(folder)
        || is_inside_upriv_of(folder, root.root())
        || nested_under(&place_parts(root.root()), &place_parts(folder))
    {
        return Err(refused(folder, PlainDestinationReason::Reserved));
    }
    Ok(())
}

/// What is at the folder path before open writes anything.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Leaf {
    /// Open makes the folder, and close removes it.
    Missing,
    /// An empty folder the user made. Open and close never remove it or
    /// change its permissions.
    Empty,
}

/// The folder may be missing or empty. A folder with this vault's marker is a
/// crash leftover; one with another vault's marker belongs to that vault.
pub(super) fn inspect_leaf(folder: &Path, vault_id: &str) -> Result<Leaf> {
    let not_a_folder = || refused(folder, PlainDestinationReason::NotAFolder);
    let occupied = || refused(folder, PlainDestinationReason::Occupied);
    match crate::host_fs::entry_kind(folder) {
        Ok(crate::host_fs::EntryKind::Dir) => {}
        Ok(_) => return Err(not_a_folder()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Leaf::Missing),
        Err(error) => return Err(error.into()),
    }
    if !owned_by_current_user(folder) {
        return Err(not_a_folder());
    }
    match marker::read(folder).map_err(|_| occupied())? {
        None => {}
        Some(found) if found.vault_id == vault_id => return Err(UprivError::PlainLeftover),
        Some(_) => return Err(occupied()),
    }
    if !super::disk::holds_only(folder, &[])? {
        return Err(occupied());
    }
    Ok(Leaf::Empty)
}

#[cfg(unix)]
fn owned_by_current_user(folder: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    if crate::host_fs::is_bridge_path(folder) {
        return true;
    }
    std::fs::symlink_metadata(folder).is_ok_and(|meta| meta.uid() == unsafe { libc::geteuid() })
}

#[cfg(not(unix))]
fn owned_by_current_user(_folder: &Path) -> bool {
    true
}

/// Components of `path` for comparing places: links in the part that exists
/// are resolved, and case is folded where the system ignores it.
fn place_parts(path: &Path) -> Vec<OsString> {
    let resolved = resolve_existing(path);
    resolved
        .components()
        .filter_map(|component| match component {
            Component::Prefix(prefix) => Some(fold(prefix.as_os_str())),
            Component::RootDir => Some(OsString::from("/")),
            Component::Normal(name) => Some(fold(name)),
            Component::CurDir | Component::ParentDir => None,
        })
        .collect()
}

fn fold(part: &std::ffi::OsStr) -> OsString {
    if cfg!(any(windows, target_os = "macos")) {
        OsString::from(part.to_string_lossy().to_lowercase())
    } else {
        part.to_os_string()
    }
}

/// `path` with its longest existing prefix replaced by the real path.
fn resolve_existing(path: &Path) -> PathBuf {
    if crate::host_fs::is_bridge_path(path) {
        return path.to_path_buf();
    }
    let mut existing = path.to_path_buf();
    let mut rest: Vec<OsString> = Vec::new();
    loop {
        if let Ok(real) = std::fs::canonicalize(&existing) {
            return rest.iter().rev().fold(real, |acc, part| acc.join(part));
        }
        match (
            existing.file_name().map(|name| name.to_os_string()),
            existing.parent(),
        ) {
            (Some(name), Some(parent)) => {
                rest.push(name);
                existing = parent.to_path_buf();
            }
            _ => return path.to_path_buf(),
        }
    }
}

/// True when `inner` is `outer` or inside it.
fn nested_under(inner: &[OsString], outer: &[OsString]) -> bool {
    !outer.is_empty() && inner.starts_with(outer)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::folder_list::Row;
    use crate::test_support::vault_root_with;

    #[test]
    fn a_folder_inside_upriv_or_around_the_data_folder_is_reserved() {
        let (_tmp, root) = vault_root_with(&[]);
        let beside = Destination::new(&root, UnlockedPlace::Beside, "Notes");
        check(&root, &beside).unwrap();
        for folder in [
            root.root().join(".upriv").join("Notes"),
            root.root().to_path_buf(),
            root.root().parent().unwrap().to_path_buf(),
        ] {
            let dest = Destination {
                folder,
                ..beside.clone()
            };
            let error = check(&root, &dest).unwrap_err();
            assert!(
                matches!(
                    error,
                    UprivError::PlainDestinationInvalid {
                        reason: PlainDestinationReason::Reserved,
                        ..
                    }
                ),
                "{error:?}"
            );
        }
    }

    #[test]
    fn the_leaf_must_be_missing_or_empty() {
        let tmp = tempfile::tempdir().unwrap();
        let folder = tmp.path().join("Notes");
        assert_eq!(inspect_leaf(&folder, "notes").unwrap(), Leaf::Missing);

        std::fs::create_dir(&folder).unwrap();
        assert_eq!(inspect_leaf(&folder, "notes").unwrap(), Leaf::Empty);

        let open = marker::Marker::open("notes", "t", &[], true);
        marker::write(&folder, &open).unwrap();
        assert!(matches!(
            inspect_leaf(&folder, "notes"),
            Err(UprivError::PlainLeftover)
        ));
        assert!(matches!(
            inspect_leaf(&folder, "other"),
            Err(UprivError::PlainDestinationInvalid {
                reason: PlainDestinationReason::Occupied,
                ..
            })
        ));

        marker::remove(&folder).unwrap();
        std::fs::write(folder.join("someone-else.txt"), b"x").unwrap();
        assert!(matches!(
            inspect_leaf(&folder, "notes"),
            Err(UprivError::PlainDestinationInvalid {
                reason: PlainDestinationReason::Occupied,
                ..
            })
        ));

        let file = tmp.path().join("file");
        std::fs::write(&file, b"x").unwrap();
        assert!(matches!(
            inspect_leaf(&file, "notes"),
            Err(UprivError::PlainDestinationInvalid {
                reason: PlainDestinationReason::NotAFolder,
                ..
            })
        ));
    }

    #[cfg(unix)]
    #[test]
    fn a_leaf_that_is_a_link_is_not_a_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let real = tmp.path().join("real");
        std::fs::create_dir(&real).unwrap();
        let link = tmp.path().join("Notes");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        assert!(matches!(
            inspect_leaf(&link, "notes"),
            Err(UprivError::PlainDestinationInvalid {
                reason: PlainDestinationReason::NotAFolder,
                ..
            })
        ));
    }

    #[test]
    fn an_unplugged_row_moves_the_walk_on_and_a_free_one_takes_it() {
        let (tmp, root) = vault_root_with(&[]);
        let gone = tmp.path().join("unplugged");
        let drive = tmp.path().join("drive");
        std::fs::create_dir(&drive).unwrap();
        let place = |path: &Path| {
            UnlockedPlace::AppRow(Row {
                number: 1,
                name: String::new(),
                path: path.display().to_string(),
            })
        };
        assert!(matches!(
            try_place(&root, "notes", &place(&gone), "Notes", false),
            Try::Fails(FolderState::Missing)
        ));
        match try_place(&root, "notes", &place(&drive), "Notes", true) {
            Try::Works(dest) => {
                assert_eq!(dest.folder, drive.join("upriv-unlocked").join("Notes"));
            }
            _ => panic!("a drive that answers takes the vault"),
        }
    }
}
