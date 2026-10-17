//! Where an open plaintext vault writes its files, and whether that place may
//! hold them.
//!
//! The place follows the existing settings: this vault's own path for this
//! system puts the folder at `{path}/{name}`; otherwise the app place puts it
//! at `{data folder}/workspace/{name}` or `{app path}/workspace/{name}`.

use std::ffi::OsString;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;

use super::marker::{self, MarkerState};
use super::volume::{self, PlainFolderClass};
use crate::config::{load_app_settings_at, load_vault_config, VaultConfig};
use crate::error::{PlainDestinationReason, Result, UprivError};
#[allow(unused_imports)]
use crate::host_fs::HostFsQuery;
use crate::paths::{
    app_workspace_place, is_reserved_upriv_workspace_path, path_is_under_reserved_upriv_tree,
    sanitize_display_leaf, VaultRoot, WorkspacePlace, WorkspaceSystem,
};

/// Which setting chose the folder. The confirmed policy records it with the path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum PlaceSource {
    /// `workspace/` next to the data folder.
    DataFolder,
    /// The app's workspace path for this system.
    App(String),
    /// This vault's own path for this system.
    Vault(String),
}

/// The folder for this system and the setting it came from.
#[derive(Debug, Clone)]
pub(super) struct Destination {
    pub folder: PathBuf,
    pub source: PlaceSource,
}

impl Destination {
    pub(super) fn in_data_folder(&self) -> bool {
        self.source == PlaceSource::DataFolder
    }

    /// The folder that must already exist. `workspace/` under an app place is
    /// created on open, like an encrypted file-manager folder.
    fn base(&self, root: &VaultRoot) -> PathBuf {
        match &self.source {
            PlaceSource::DataFolder => root.root().to_path_buf(),
            PlaceSource::App(path) | PlaceSource::Vault(path) => PathBuf::from(path),
        }
    }
}

/// Which setting a destination follows, for the place modal and the confirm.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PlainPlace {
    DataFolder,
    App,
    Vault,
}

/// `vault_plain_destination`: the folder an unlock would write.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlainDestination {
    pub path: String,
    pub place: PlainPlace,
    pub class: PlainFolderClass,
}

/// The folder this system would use for `vault_id`, checked the way open
/// checks it. `WorkspaceUnset` when this system has no place yet.
pub fn plain_destination(root: &VaultRoot, vault_id: &str) -> Result<PlainDestination> {
    let vault_dir = root.vault_dir(vault_id)?;
    let config = load_vault_config(&vault_dir)?;
    let dest = resolve(root, &config)?;
    check(root, vault_id, &dest)?;
    inspect_leaf(&dest.folder, vault_id)?;
    Ok(PlainDestination {
        path: dest.folder.display().to_string(),
        place: match dest.source {
            PlaceSource::DataFolder => PlainPlace::DataFolder,
            PlaceSource::App(_) => PlainPlace::App,
            PlaceSource::Vault(_) => PlainPlace::Vault,
        },
        class: volume::inspect(&dest.folder).class,
    })
}

/// This system's folder for the vault. A vault path of its own wins.
pub(super) fn resolve(root: &VaultRoot, config: &VaultConfig) -> Result<Destination> {
    let system = WorkspaceSystem::current();
    let leaf = sanitize_display_leaf(&config.vault.display_name);
    let own = trimmed(&config.mount.row(system).path);
    if !own.is_empty() {
        return Ok(Destination {
            folder: PathBuf::from(own).join(leaf),
            source: PlaceSource::Vault(own.to_string()),
        });
    }
    let app = load_app_settings_at(root.root())?.settings.workspace.0;
    let row = app.row(system);
    let (base, source) = match app_workspace_place(row) {
        WorkspacePlace::Unset => return Err(UprivError::WorkspaceUnset),
        WorkspacePlace::Beside => (root.root().to_path_buf(), PlaceSource::DataFolder),
        WorkspacePlace::Custom => {
            let path = trimmed(&row.path).to_string();
            (PathBuf::from(&path), PlaceSource::App(path))
        }
    };
    Ok(Destination {
        folder: base.join("workspace").join(leaf),
        source,
    })
}

fn trimmed(path: &str) -> &str {
    path.trim().trim_end_matches(['/', '\\'])
}

fn refused(path: &Path, reason: PlainDestinationReason) -> UprivError {
    UprivError::PlainDestinationInvalid {
        path: path.to_path_buf(),
        reason,
    }
}

/// Refuse a place other apps could not use, one inside `.upriv` or around
/// the data folder, a system folder, or one that overlaps another vault.
pub(super) fn check(root: &VaultRoot, vault_id: &str, dest: &Destination) -> Result<()> {
    let folder = &dest.folder;
    if cfg!(target_os = "android") && !crate::host_fs::is_bridge_path(folder) {
        return Err(refused(folder, PlainDestinationReason::PrivateStorage));
    }
    if !crate::paths::is_absolute_filesystem_path(folder) && !crate::host_fs::is_bridge_path(folder)
    {
        return Err(UprivError::WorkspacePathInvalid {
            path: folder.clone(),
            detail: "workspace path must be absolute".into(),
        });
    }
    let parts = place_parts(folder);
    if path_is_under_reserved_upriv_tree(folder)
        || is_reserved_upriv_workspace_path(folder, root.root())
        || nested_under(&place_parts(root.root()), &parts)
    {
        return Err(refused(folder, PlainDestinationReason::Reserved));
    }
    if is_system_folder(folder) {
        return Err(refused(folder, PlainDestinationReason::SystemFolder));
    }
    for other in other_vault_folders(root, vault_id) {
        let other = place_parts(&other);
        if nested_under(&parts, &other) || nested_under(&other, &parts) {
            return Err(refused(folder, PlainDestinationReason::Overlap));
        }
    }
    Ok(())
}

/// What is at the folder path before open writes anything.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Leaf {
    Missing,
    /// An empty folder the user made. Open never removes it or changes its
    /// permissions.
    Empty,
    /// This vault's folder from an earlier session, wiped at close.
    Closed { made_folder: bool },
}

impl Leaf {
    pub(super) fn made_by_upriv(self) -> bool {
        match self {
            Self::Missing => true,
            Self::Empty => false,
            Self::Closed { made_folder } => made_folder,
        }
    }
}

/// The folder may be missing, empty, or hold only this vault's closed marker.
/// A folder with this vault's open marker is a crash leftover.
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
    let marker = marker::read(folder).map_err(|_| occupied())?;
    let leaf = match &marker {
        None => Leaf::Empty,
        Some(found) if found.vault_id != vault_id => return Err(occupied()),
        Some(found) if found.state == MarkerState::Open => return Err(UprivError::PlainLeftover),
        Some(found) => Leaf::Closed {
            made_folder: found.made_folder,
        },
    };
    let allowed: &[&str] = if marker.is_some() {
        &[marker::MARKER_NAME]
    } else {
        &[]
    };
    if !super::disk::holds_only(folder, allowed)? {
        return Err(occupied());
    }
    Ok(leaf)
}

/// Make `workspace/` under the chosen place when it is missing. The place
/// itself must exist: a drive that is not plugged in is not created.
pub(super) fn ensure_parent(root: &VaultRoot, dest: &Destination) -> Result<()> {
    let base = dest.base(root);
    if !base.host_is_dir() {
        return Err(UprivError::WorkspaceUnavailable(base));
    }
    let Some(parent) = dest.folder.parent() else {
        return Err(UprivError::WorkspaceUnavailable(dest.folder.clone()));
    };
    if parent != base && !parent.host_is_dir() {
        crate::host_fs::create_dir(parent).or_else(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists && parent.host_is_dir() {
                Ok(())
            } else {
                Err(error)
            }
        })?;
    }
    Ok(())
}

#[cfg(unix)]
fn owned_by_current_user(folder: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    if crate::host_fs::is_bridge_path(folder) {
        return true;
    }
    std::fs::symlink_metadata(folder)
        .is_ok_and(|meta| meta.uid() == unsafe { libc::geteuid() })
}

#[cfg(not(unix))]
fn owned_by_current_user(_folder: &Path) -> bool {
    true
}

/// Folders and mounts other vaults have on this computer: open sessions in
/// this process, mounts and plaintext folders `state.json` still records.
fn other_vault_folders(root: &VaultRoot, vault_id: &str) -> Vec<PathBuf> {
    let mut folders = Vec::new();
    for id in crate::session::open_session_ids() {
        if id == vault_id {
            continue;
        }
        let Ok(dir) = root.vault_dir(&id) else {
            continue;
        };
        let _ = crate::session::with_open_session(&dir, |session| {
            if let Some(plain) = session.plain.as_ref() {
                folders.push(plain.folder().to_path_buf());
            }
            if let Some(mount) = session.mount.as_ref() {
                folders.push(mount.mount_point().to_path_buf());
            }
            Ok(())
        });
    }
    let host = crate::lockfile::hostname().ok();
    if let Ok(state) = crate::runtime_state::load_runtime_state(root) {
        for (id, entry) in state.vaults {
            if id == vault_id {
                continue;
            }
            if let Some(mount) = entry.mount_point {
                folders.push(PathBuf::from(mount));
            }
            folders.extend(
                entry
                    .plain
                    .iter()
                    .filter(|record| record.reachable_here(host.as_deref()))
                    .map(|record| record.folder(root)),
            );
        }
    }
    folders
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
        match (existing.file_name().map(|name| name.to_os_string()), existing.parent()) {
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

/// A drive or filesystem root, the home folder, or a folder that holds it.
fn is_system_folder(folder: &Path) -> bool {
    let resolved = resolve_existing(folder);
    if !resolved
        .components()
        .any(|component| matches!(component, Component::Normal(_)))
    {
        return true;
    }
    home_dir().is_some_and(|home| nested_under(&place_parts(&home), &place_parts(folder)))
}

fn home_dir() -> Option<PathBuf> {
    let key = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var_os(key)
        .map(PathBuf::from)
        .filter(|home| home.is_absolute())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::vault_root_with;

    fn dest(folder: PathBuf) -> Destination {
        Destination {
            folder,
            source: PlaceSource::Vault(String::new()),
        }
    }

    #[test]
    fn a_folder_inside_upriv_or_around_the_data_folder_is_reserved() {
        let (_tmp, root) = vault_root_with(&[]);
        for folder in [
            root.root().join(".upriv").join("Notes"),
            root.root().to_path_buf(),
            root.root().parent().unwrap().to_path_buf(),
        ] {
            let error = check(&root, "notes", &dest(folder)).unwrap_err();
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
        check(&root, "notes", &dest(root.root().join("workspace").join("Notes"))).unwrap();
    }

    #[test]
    fn the_home_folder_and_its_parents_are_system_folders() {
        let Some(home) = home_dir() else {
            return;
        };
        assert!(is_system_folder(&home));
        if let Some(parent) = home.parent() {
            assert!(is_system_folder(parent));
        }
        assert!(is_system_folder(Path::new("/")));
        assert!(!is_system_folder(&home.join("Upriv").join("Notes")));
    }

    #[test]
    fn a_folder_inside_or_around_another_vault_folder_overlaps() {
        let (tmp, root) = vault_root_with(&[]);
        let other = tmp.path().join("places").join("Other");
        std::fs::create_dir_all(&other).unwrap();
        crate::runtime_state::mark_session_open(&root, "other", Some(other.display().to_string()))
            .unwrap();
        for folder in [other.join("Notes"), other.clone(), tmp.path().join("places")] {
            let error = check(&root, "notes", &dest(folder)).unwrap_err();
            assert!(
                matches!(
                    error,
                    UprivError::PlainDestinationInvalid {
                        reason: PlainDestinationReason::Overlap,
                        ..
                    }
                ),
                "{error:?}"
            );
        }
        check(&root, "notes", &dest(tmp.path().join("places").join("Notes"))).unwrap();
    }

    #[test]
    fn the_leaf_must_be_missing_empty_or_this_vaults_closed_folder() {
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

        marker::write(&folder, &open.closed()).unwrap();
        assert_eq!(
            inspect_leaf(&folder, "notes").unwrap(),
            Leaf::Closed { made_folder: true }
        );

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
}
