//! Resolve the data folder on launch: an explicit path, then this device's
//! choice in the data folder list.
//!
//! `UPRIV_VAULT_ROOT` (or a caller's explicit path) always wins, and nothing
//! is written for it. Otherwise the list in the app home
//! (`.upriv-data-folder`, [`crate::folder_list::data_folder`]) says what this
//! device uses:
//! - Default (a device with no group too): the folder beside the app for a
//!   portable copy, the per-user app folder for an installed one. No `.upriv`
//!   there is the first run, or, while this device has rows to try,
//!   `SelectedFailed`.
//! - A row: its folder. One that does not answer is `SelectedFailed`.
//!
//! On `SelectedFailed` the UI searches this device's rows and Default
//! ([`crate::search_data_folder`]) while the person may pick. A data folder
//! lost while Upriv runs stays selected, so the next resolve lands here too.
//!
//! The app home:
//! - **Portable / AppImage** (writable folder): directory of `$APPIMAGE` / exe
//! - **System install** (e.g. `/opt`, Program Files): user data dir
//!   (`$XDG_DATA_HOME/upriv`, `%LOCALAPPDATA%\Upriv`, …)
//! - **Electron `--dev`:** `UPRIV_DEFAULT_ROOT_ANCHOR` (`upriv/dev/`)
//!
//! Electron sets `UPRIV_DEFAULT_ROOT_ANCHOR` after a writability probe; when unset,
//! [`app_home_dir`] applies the same fallback.
//!
//! ## Incomplete `.upriv/`
//!
//! A selected folder whose `.upriv` is incomplete propagates
//! [`UprivError::VaultRootIncomplete`] so the Gate offers Repair; it never
//! hands over. When Default is found by the upward or sibling walk (not the
//! start directory itself), an incomplete candidate is skipped and the walk
//! goes on.

#[allow(unused_imports)]
use crate::host_fs::HostFsQuery;
use std::path::{Path, PathBuf};

use crate::device::{this_device, DeviceSystem};
use crate::error::{Result, UprivError};
use crate::folder_list::data_folder::{load_data_folder_list, selected_place, DataFolderPlace};
use crate::folder_list::{path_issue, ListKind, Row};
use crate::folder_probe::FolderState;
use crate::paths::fs_env::{
    cleanup_stale_write_probes, dir_is_writable, env_appimage_dir, env_default_root_anchor,
    is_inside_macos_app_bundle, same_dir,
};
use crate::paths::{is_vault_root_marker, VaultRoot};

/// Max parent levels walked upward by [`discover_vault_root_upward`].
/// Caps the walk so a misplaced install under `$HOME` does not scan the whole tree
/// (PRD portable layout: root is at the app home, not arbitrarily deep).
const PARENT_WALK_MAX_DEPTH: usize = 8;

/// How the data folder was found this launch (wire: `"explicit"` |
/// `"default"` | `"row"`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultRootSource {
    /// `UPRIV_VAULT_ROOT`, or an explicit path from the caller.
    Explicit,
    /// Default: beside the app, or the per-user app folder.
    Default,
    /// A row of this device's data folder list.
    Row,
}

impl VaultRootSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Explicit => "explicit",
            Self::Default => "default",
            Self::Row => "row",
        }
    }
}

/// Outcome of launch-time resolution.
#[derive(Debug, Clone)]
pub enum ResolveVaultRoot {
    Found {
        root: VaultRoot,
        source: VaultRootSource,
    },
    /// The first run: Default is selected, holds no `.upriv`, and this device
    /// has no row to try. Setup shows the list, and Continue makes one there.
    NeedsSetup {
        /// Where Default is: the folder beside the app, or the per-user app folder.
        default_root_anchor: PathBuf,
        distribution: crate::paths::AppDistribution,
    },
    /// The selected choice did not answer as a data folder. The UI shows the
    /// list while [`crate::search_data_folder`] looks for one that does.
    SelectedFailed {
        place: DataFolderPlace,
        reason: FolderState,
    },
}

/// Inputs for [`resolve_vault_root`].
#[derive(Debug, Clone, Default)]
pub struct ResolveVaultRootOptions {
    /// Highest priority: CLI / env / caller override.
    pub explicit: Option<PathBuf>,
    /// Directory that contains the executable (tests inject a temp dir).
    /// When set, becomes the app home (list + Default) and env override is ignored.
    pub binary_dir: Option<PathBuf>,
}

/// Directory that owns the binary.
fn binary_dir() -> Result<PathBuf> {
    let exe = std::env::current_exe()?;
    exe.parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| UprivError::Io(std::io::Error::other("executable has no parent directory")))
}

/// App home: owns `.upriv-data-folder` and is the `default_root` create target.
///
/// Order:
/// 1. `UPRIV_DEFAULT_ROOT_ANCHOR` (Electron always sets this after a writability probe)
/// 2. Directory of `$APPIMAGE` if writable, else [`resolve_user_data_app_home`]
/// 3. Directory of the running binary if writable, else [`resolve_user_data_app_home`]
///
/// Paths under a macOS `.app/Contents/` bundle always use [`resolve_user_data_app_home`]
/// (never probe or store portable data inside the signed bundle).
///
/// Does not create directories; writers use [`crate::paths::write_bytes_atomic`] /
/// `initialize_vault_root` which create as needed.
pub fn app_home_dir() -> Result<PathBuf> {
    let path = if let Some(path) = env_default_root_anchor() {
        path
    } else if let Some(path) = env_appimage_dir() {
        prefer_writable_app_home(path)?
    } else {
        prefer_writable_app_home(binary_dir()?)?
    };
    if path.host_is_dir() {
        cleanup_stale_write_probes(&path);
    }
    Ok(path)
}

/// Prefer `candidate` when writable; otherwise the per-user data directory.
fn prefer_writable_app_home(candidate: PathBuf) -> Result<PathBuf> {
    if is_inside_macos_app_bundle(&candidate) {
        return resolve_user_data_app_home();
    }
    if dir_is_writable(&candidate) {
        Ok(candidate)
    } else {
        resolve_user_data_app_home()
    }
}

/// User-owned app home for system installs (`/opt`, Program Files, …).
///
/// Pure path resolution — does **not** create the directory: the first
/// write under it does.
pub(crate) fn resolve_user_data_app_home() -> Result<PathBuf> {
    let path = if cfg!(windows) {
        std::env::var_os("LOCALAPPDATA")
            .map(|v| PathBuf::from(v).join("Upriv"))
            .or_else(|| {
                std::env::var_os("USERPROFILE")
                    .map(|v| PathBuf::from(v).join("AppData").join("Local").join("Upriv"))
            })
    } else if cfg!(target_os = "macos") {
        std::env::var_os("HOME").map(|v| {
            PathBuf::from(v)
                .join("Library")
                .join("Application Support")
                .join("Upriv")
        })
    } else {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .filter(|p| p.is_absolute())
            .map(|p| p.join("upriv"))
            .or_else(|| {
                std::env::var_os("HOME")
                    .map(|v| PathBuf::from(v).join(".local").join("share").join("upriv"))
            })
    };
    path.ok_or_else(|| {
        UprivError::Io(std::io::Error::other(
            "cannot resolve user data app home (HOME / XDG_DATA_HOME / LOCALAPPDATA unset)",
        ))
    })
}

pub fn discover_vault_root_upward(start: impl AsRef<Path>) -> Option<PathBuf> {
    let start = start.as_ref().canonicalize().ok()?;
    let mut current = start.clone();
    for depth in 0..PARENT_WALK_MAX_DEPTH {
        if is_vault_root_marker(&current) {
            return current.canonicalize().ok();
        }
        if depth == 0 {
            if let Ok(entries) = crate::host_fs::read_dir(&current) {
                // Deterministic pick when multiple sibling roots exist.
                let mut siblings: Vec<PathBuf> = entries
                    .flatten()
                    .map(|e| e.path())
                    .filter(|path| path.host_is_dir() && is_vault_root_marker(path))
                    .collect();
                siblings.sort();
                if let Some(path) = siblings.into_iter().next() {
                    return path.canonicalize().ok();
                }
            }
        }
        current = current.parent()?.to_path_buf();
    }
    None
}

/// Open a `default_root` candidate: preserve Incomplete / permission Io; absence → `Ok(None)`.
///
/// [`VaultRoot::discover`] only returns `Io`, [`UprivError::VaultRootNotFound`], or
/// [`UprivError::VaultRootIncomplete`] — unexpected variants propagate as `Err`.
fn open_default_root_candidate(path: &Path) -> Result<Option<VaultRoot>> {
    match VaultRoot::discover(path) {
        Ok(root) => Ok(Some(root)),
        Err(error @ UprivError::VaultRootIncomplete { .. }) => Err(error),
        Err(UprivError::Io(ref error)) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error @ UprivError::Io(_)) => Err(error),
        Err(UprivError::VaultRootNotFound(_)) => Ok(None),
        Err(other) => Err(other),
    }
}

/// Open `path` as vault-root, preserving incomplete vs missing vs permission I/O.
fn open_or_classify(path: &Path) -> Result<VaultRoot> {
    match VaultRoot::discover(path) {
        Ok(root) => Ok(root),
        Err(error @ UprivError::VaultRootIncomplete { .. }) => Err(error),
        Err(UprivError::Io(ref error)) if error.kind() == std::io::ErrorKind::NotFound => Err(
            UprivError::VaultRootNotFound(path.join(crate::paths::VAULT_ROOT_SETTINGS_REL)),
        ),
        Err(error @ UprivError::Io(_)) => Err(error),
        Err(UprivError::VaultRootNotFound(p)) => Err(UprivError::VaultRootNotFound(p)),
        Err(other) => Err(other),
    }
}

fn resolve_app_home(options: &ResolveVaultRootOptions) -> Result<PathBuf> {
    if let Some(dir) = &options.binary_dir {
        return Ok(dir.clone());
    }
    app_home_dir()
}

/// The explicit path that wins over the list: the caller's, or `UPRIV_VAULT_ROOT`.
pub fn explicit_data_folder() -> Option<PathBuf> {
    env_vault_root_explicit()
}

/// Resolve the data folder for app launch: explicit, then this device's
/// choice in the list. Reads only.
pub fn resolve_vault_root(options: ResolveVaultRootOptions) -> Result<ResolveVaultRoot> {
    let app_home = resolve_app_home(&options)?;
    let default_root_anchor = match options.binary_dir.as_deref() {
        Some(dir) => crate::paths::default_vault_root_anchor_for(Some(dir))?,
        None => default_data_folder()?,
    };
    let distribution = crate::paths::detect_app_distribution();

    if let Some(explicit) = options.explicit.clone().or_else(env_vault_root_explicit) {
        let root = open_or_classify(&explicit)?;
        return Ok(ResolveVaultRoot::Found {
            root,
            source: VaultRootSource::Explicit,
        });
    }

    let list = load_data_folder_list(&app_home)?;
    let device = this_device();
    match selected_place(&list, device) {
        DataFolderPlace::Default => match find_default_root(&options, &default_root_anchor)? {
            Some(root) => Ok(ResolveVaultRoot::Found {
                root,
                source: VaultRootSource::Default,
            }),
            // A row may hold the data folder Default lost: search before Setup.
            None if !list.devices.rows_here(device).is_empty() => {
                Ok(ResolveVaultRoot::SelectedFailed {
                    place: DataFolderPlace::Default,
                    reason: FolderState::Missing,
                })
            }
            None => Ok(ResolveVaultRoot::NeedsSetup {
                default_root_anchor,
                distribution,
            }),
        },
        DataFolderPlace::Row(row) => {
            let system = list
                .devices
                .here(device)
                .map_or(DeviceSystem::current(), |group| group.system);
            if path_issue(system, ListKind::DataFolder, &row.path).is_some() {
                return Ok(ResolveVaultRoot::SelectedFailed {
                    place: DataFolderPlace::Row(row),
                    reason: FolderState::Refused,
                });
            }
            let folder = data_folder_in_use(&row);
            if crate::host_fs::is_unmounted_saf_root(&folder) {
                // The platform could not mount the row's tree: its drive is
                // away or its grant is gone.
                return Ok(ResolveVaultRoot::SelectedFailed {
                    place: DataFolderPlace::Row(row),
                    reason: FolderState::Missing,
                });
            }
            match open_default_root_candidate(&folder) {
                Ok(Some(root)) => Ok(ResolveVaultRoot::Found {
                    root,
                    source: VaultRootSource::Row,
                }),
                Ok(None) => Ok(ResolveVaultRoot::SelectedFailed {
                    place: DataFolderPlace::Row(row),
                    reason: FolderState::Missing,
                }),
                Err(error @ UprivError::VaultRootIncomplete { .. }) => Err(error),
                Err(UprivError::Io(error)) => Ok(ResolveVaultRoot::SelectedFailed {
                    place: DataFolderPlace::Row(row),
                    reason: FolderState::of_io(&error),
                }),
                Err(error) => Err(error),
            }
        }
    }
}

/// Where the data folder of a selected row is used: its folder on a
/// computer; on a phone the tree the platform mounted for it as the data
/// folder.
pub(crate) fn data_folder_in_use(row: &Row) -> PathBuf {
    if crate::paths::is_content_uri(row.path.trim()) {
        PathBuf::from(crate::host_fs::SAF_VAULT_ROOT)
    } else {
        PathBuf::from(row.path.trim())
    }
}

/// The data folder this device uses now, without the explicit override:
/// `None` when its choice holds no data folder yet.
pub(crate) fn chosen_data_folder() -> Result<Option<VaultRoot>> {
    if let Some(explicit) = env_vault_root_explicit() {
        return open_or_classify(&explicit).map(Some);
    }
    match resolve_vault_root(ResolveVaultRootOptions::default())? {
        ResolveVaultRoot::Found { root, .. } => Ok(Some(root)),
        ResolveVaultRoot::NeedsSetup { .. } | ResolveVaultRoot::SelectedFailed { .. } => Ok(None),
    }
}

/// Default's folder on this device: the folder beside the app for a portable
/// copy, the per-user app folder for an installed one. On a phone it is
/// Documents/Upriv, which the platform mounts as the data folder.
pub(crate) fn default_data_folder() -> Result<PathBuf> {
    if DeviceSystem::current() == DeviceSystem::Android {
        Ok(PathBuf::from(crate::host_fs::SAF_VAULT_ROOT))
    } else {
        setup_default_root_anchor()
    }
}

/// The folder this device's selection names, for a message about it.
fn selected_folder() -> Result<PathBuf> {
    let list = load_data_folder_list(&app_home_dir()?)?;
    match selected_place(&list, this_device()) {
        DataFolderPlace::Row(row) => Ok(PathBuf::from(row.path)),
        DataFolderPlace::Default => default_data_folder(),
    }
}

/// The error of a data folder lost while Upriv ran (case B). The selection
/// stays as it is: the UI resolves again, as at launch, and the search finds
/// another data folder or the person picks one.
pub fn data_folder_lost() -> UprivError {
    let path = selected_folder().unwrap_or_default();
    UprivError::VaultRootNotFound(path.join(crate::paths::VAULT_ROOT_SETTINGS_REL))
}

/// Default: the anchor, or for a portable copy without Electron's anchor
/// the walk up from it and from the working directory. On a phone, the
/// Documents/Upriv tree once the platform mounted it.
fn find_default_root(
    options: &ResolveVaultRootOptions,
    default_root_anchor: &Path,
) -> Result<Option<VaultRoot>> {
    use crate::paths::AppDistribution;

    if options.binary_dir.is_none() && DeviceSystem::current() == DeviceSystem::Android {
        if crate::host_fs::is_unmounted_saf_root(default_root_anchor) {
            return Ok(None);
        }
        return open_default_root_candidate(default_root_anchor);
    }

    // Installed packages never walk; Electron always sets `UPRIV_DEFAULT_ROOT_ANCHOR`, so
    // portable/dev are also exact-anchor only when that env is present.
    let distribution = crate::paths::detect_app_distribution();
    let only_anchor = options.binary_dir.is_none()
        && (distribution == AppDistribution::Installed || env_default_root_anchor().is_some());
    if only_anchor {
        return open_default_root_candidate(default_root_anchor);
    }

    let mut starts = vec![default_root_anchor.to_path_buf()];
    if options.binary_dir.is_none() {
        if let Ok(cwd) = std::env::current_dir() {
            if !same_dir(&cwd, default_root_anchor) {
                starts.push(cwd);
            }
        }
    }

    for start in starts {
        // Incomplete at a primary start (anchor/cwd) propagates — Gate/Repair.
        if let Some(root) = open_default_root_candidate(&start)? {
            return Ok(Some(root));
        }
        if let Some(found) = discover_vault_root_upward(&start) {
            if !same_dir(&found, &start) {
                // Incomplete on a walk sibling is skipped (see the module's Incomplete policy).
                match open_default_root_candidate(&found) {
                    Ok(Some(root)) => return Ok(Some(root)),
                    Ok(None) | Err(UprivError::VaultRootIncomplete { .. }) => {}
                    Err(error) => return Err(error),
                }
            }
        }
    }
    Ok(None)
}

fn env_vault_root_explicit() -> Option<PathBuf> {
    std::env::var_os("UPRIV_VAULT_ROOT").and_then(|value| {
        let path = PathBuf::from(value);
        if path.as_os_str().is_empty() || !path.is_absolute() {
            None
        } else {
            Some(path)
        }
    })
}

/// Default's folder on a computer: beside the app, or the per-user app folder.
pub fn setup_default_root_anchor() -> Result<PathBuf> {
    crate::paths::default_vault_root_anchor()
}

#[cfg(test)]
mod starts_order_tests {
    use super::*;
    #[allow(unused_imports)]
    use crate::host_fs::HostFsQuery;
    use crate::paths::{initialize_vault_root, ENV_LOCK};

    /// Regression: `starts` tries default_root_anchor before cwd (do not invert the vec).
    #[test]
    fn default_root_anchor_preferred_over_cwd_root() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let _env = crate::paths::EnvGuard::capture(&["UPRIV_DEFAULT_ROOT_ANCHOR", "APPIMAGE"]);
        std::env::remove_var("UPRIV_DEFAULT_ROOT_ANCHOR");

        let appimage_dir = tempfile::tempdir().unwrap();
        let appimage = appimage_dir.path().join("Upriv.AppImage");
        crate::host_fs::write(&appimage, b"fake").unwrap();
        initialize_vault_root(appimage_dir.path()).unwrap();

        let cwd_root = tempfile::tempdir().unwrap();
        initialize_vault_root(cwd_root.path()).unwrap();

        std::env::set_var("APPIMAGE", &appimage);
        let prev_cwd = std::env::current_dir().unwrap();
        std::env::set_current_dir(cwd_root.path()).unwrap();
        let resolved = resolve_vault_root(ResolveVaultRootOptions::default());
        let _ = std::env::set_current_dir(prev_cwd);
        std::env::remove_var("APPIMAGE");

        match resolved.unwrap() {
            ResolveVaultRoot::Found { root, source } => {
                assert_eq!(source, VaultRootSource::Default);
                assert_eq!(
                    root.root(),
                    appimage_dir.path().canonicalize().unwrap(),
                    "anchor must win over cwd when both have a valid root"
                );
            }
            other => panic!("expected anchor root, got {other:?}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::folder_list::data_folder::{
        save_data_folder_list, DataFolderChoice, DataFolderList,
    };
    use crate::folder_list::DeviceGroup;
    use crate::folder_list::Selection;
    #[allow(unused_imports)]
    use crate::host_fs::HostFsQuery;
    use crate::paths::initialize_vault_root;
    use crate::paths::ENV_LOCK;

    fn bin_options(bin: &Path) -> ResolveVaultRootOptions {
        ResolveVaultRootOptions {
            explicit: None,
            binary_dir: Some(bin.to_path_buf()),
        }
    }

    /// The list in `home` with this device's rows, `selected` chosen.
    fn list_with(home: &Path, rows: &[&Path], selected: Selection<DataFolderChoice>) {
        let device = this_device();
        let mut list = DataFolderList::default();
        list.devices.0.insert(
            device.id.clone().expect("tests need this device's ID"),
            DeviceGroup {
                rows: rows
                    .iter()
                    .zip(1..)
                    .map(|(path, number)| Row {
                        number,
                        name: String::new(),
                        path: path.display().to_string(),
                    })
                    .collect(),
                selected,
                next_number: rows.len() as u32 + 1,
                ..DeviceGroup::for_device(device)
            },
        );
        save_data_folder_list(home, &list).unwrap();
    }

    #[test]
    fn default_finds_the_data_folder_at_the_anchor() {
        let dir = tempfile::tempdir().unwrap();
        let root = initialize_vault_root(dir.path()).unwrap();
        let nested = dir.path().join("bin");
        crate::host_fs::create_dir_all(&nested).unwrap();

        match resolve_vault_root(bin_options(&nested)).unwrap() {
            ResolveVaultRoot::Found {
                root: found,
                source,
            } => {
                assert_eq!(source, VaultRootSource::Default);
                assert_eq!(found.root(), root.root());
            }
            other => panic!("expected the anchor's data folder, got {other:?}"),
        }
    }

    #[test]
    fn default_with_no_data_folder_is_the_first_run() {
        let bin = tempfile::tempdir().unwrap();
        match resolve_vault_root(bin_options(bin.path())).unwrap() {
            ResolveVaultRoot::NeedsSetup { .. } => {}
            other => panic!("expected the first run, got {other:?}"),
        }
    }

    #[test]
    fn default_with_no_data_folder_and_rows_to_try_failed() {
        let bin = tempfile::tempdir().unwrap();
        let usb = tempfile::tempdir().unwrap();
        initialize_vault_root(usb.path()).unwrap();
        list_with(
            bin.path(),
            &[usb.path()],
            Selection::Fixed(DataFolderChoice::Default),
        );
        match resolve_vault_root(bin_options(bin.path())).unwrap() {
            ResolveVaultRoot::SelectedFailed { place, reason } => {
                assert_eq!(place, DataFolderPlace::Default);
                assert_eq!(reason, FolderState::Missing);
            }
            other => panic!("expected Default to fail, got {other:?}"),
        }
        assert!(!bin.path().join(".upriv").exists());
    }

    #[test]
    fn a_selected_row_opens_its_data_folder() {
        let bin = tempfile::tempdir().unwrap();
        let usb = tempfile::tempdir().unwrap();
        initialize_vault_root(usb.path()).unwrap();
        initialize_vault_root(bin.path()).unwrap();
        list_with(bin.path(), &[usb.path()], Selection::Row(1));
        match resolve_vault_root(bin_options(bin.path())).unwrap() {
            ResolveVaultRoot::Found { root, source } => {
                assert_eq!(source, VaultRootSource::Row);
                assert_eq!(root.root(), usb.path().canonicalize().unwrap());
            }
            other => panic!("expected the row's data folder, got {other:?}"),
        }
    }

    #[test]
    fn a_selected_row_that_is_gone_failed_and_nothing_is_made() {
        let bin = tempfile::tempdir().unwrap();
        let gone = bin.path().join("unplugged");
        list_with(bin.path(), &[&gone], Selection::Row(1));
        match resolve_vault_root(bin_options(bin.path())).unwrap() {
            ResolveVaultRoot::SelectedFailed { place, reason } => {
                assert!(matches!(place, DataFolderPlace::Row(row) if row.number == 1));
                assert_eq!(reason, FolderState::Missing);
            }
            other => panic!("expected the selected row to fail, got {other:?}"),
        }
        assert!(!gone.exists());
    }

    #[test]
    fn an_incomplete_selected_row_goes_to_repair() {
        let bin = tempfile::tempdir().unwrap();
        let broken = tempfile::tempdir().unwrap();
        crate::host_fs::create_dir_all(broken.path().join(".upriv")).unwrap();
        list_with(bin.path(), &[broken.path()], Selection::Row(1));
        assert!(matches!(
            resolve_vault_root(bin_options(bin.path())),
            Err(UprivError::VaultRootIncomplete { .. })
        ));
    }

    #[test]
    fn an_unreadable_list_stops_resolve() {
        let bin = tempfile::tempdir().unwrap();
        std::fs::write(bin.path().join(".upriv-data-folder"), "not a list").unwrap();
        assert!(matches!(
            resolve_vault_root(bin_options(bin.path())),
            Err(UprivError::DataFolderListInvalid { .. })
        ));
    }

    #[test]
    fn explicit_invalid_errors() {
        let bin = tempfile::tempdir().unwrap();
        let missing = bin.path().join("no-root-here");
        let err = resolve_vault_root(ResolveVaultRootOptions {
            explicit: Some(missing.clone()),
            binary_dir: Some(bin.path().to_path_buf()),
        })
        .unwrap_err();
        assert!(matches!(err, UprivError::VaultRootNotFound(_)));
    }

    #[test]
    fn explicit_incomplete_errors_incomplete() {
        let bin = tempfile::tempdir().unwrap();
        let broken = tempfile::tempdir().unwrap();
        crate::host_fs::create_dir_all(broken.path().join(".upriv")).unwrap();
        crate::host_fs::write(broken.path().join(".upriv/settings.toml"), "broken").unwrap();

        let err = resolve_vault_root(ResolveVaultRootOptions {
            explicit: Some(broken.path().to_path_buf()),
            binary_dir: Some(bin.path().to_path_buf()),
        })
        .unwrap_err();
        assert!(matches!(err, UprivError::VaultRootIncomplete { .. }));
    }

    #[test]
    fn explicit_wins_over_the_list() {
        let bin = tempfile::tempdir().unwrap();
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        initialize_vault_root(a.path()).unwrap();
        initialize_vault_root(b.path()).unwrap();
        list_with(bin.path(), &[a.path()], Selection::Row(1));

        let resolved = resolve_vault_root(ResolveVaultRootOptions {
            explicit: Some(b.path().to_path_buf()),
            binary_dir: Some(bin.path().to_path_buf()),
        })
        .unwrap();
        match resolved {
            ResolveVaultRoot::Found { root, source } => {
                assert_eq!(source, VaultRootSource::Explicit);
                assert_eq!(root.root(), b.path().canonicalize().unwrap());
            }
            _ => panic!("expected explicit"),
        }
    }

    #[test]
    fn app_home_prefers_env_for_the_list_and_default() {
        let _lock = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let _env = crate::paths::EnvGuard::capture(&["UPRIV_DEFAULT_ROOT_ANCHOR", "APPIMAGE"]);
        let anchor = tempfile::tempdir().unwrap();
        std::env::set_var("UPRIV_DEFAULT_ROOT_ANCHOR", anchor.path());
        std::env::remove_var("APPIMAGE");
        assert_eq!(app_home_dir().unwrap(), anchor.path());
        assert_eq!(setup_default_root_anchor().unwrap(), anchor.path());
        assert_eq!(
            crate::folder_list::data_folder::list_path(&app_home_dir().unwrap()),
            anchor.path().join(".upriv-data-folder")
        );
    }

    #[test]
    fn app_home_prefers_appimage_dir_over_binary() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let _env = crate::paths::EnvGuard::capture(&["UPRIV_DEFAULT_ROOT_ANCHOR", "APPIMAGE"]);
        let appimage_dir = tempfile::tempdir().unwrap();
        let appimage = appimage_dir.path().join("Upriv.AppImage");
        crate::host_fs::write(&appimage, b"fake").unwrap();
        std::env::remove_var("UPRIV_DEFAULT_ROOT_ANCHOR");
        std::env::set_var("APPIMAGE", &appimage);
        assert_eq!(app_home_dir().unwrap(), appimage_dir.path());
        std::env::remove_var("APPIMAGE");
    }

    #[test]
    #[cfg(unix)]
    fn app_home_falls_back_when_appimage_dir_not_writable() {
        use std::os::unix::fs::PermissionsExt;

        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let _env = crate::paths::EnvGuard::capture(&[
            "UPRIV_DEFAULT_ROOT_ANCHOR",
            "APPIMAGE",
            "XDG_DATA_HOME",
        ]);
        let install = tempfile::tempdir().unwrap();
        let appimage = install.path().join("Upriv.AppImage");
        crate::host_fs::write(&appimage, b"fake").unwrap();

        let data = tempfile::tempdir().unwrap();
        std::env::remove_var("UPRIV_DEFAULT_ROOT_ANCHOR");
        std::env::set_var("APPIMAGE", &appimage);
        std::env::set_var("XDG_DATA_HOME", data.path());

        crate::host_fs::set_permissions(
            install.path(),
            crate::host_fs::Permissions::from_mode(0o555),
        )
        .unwrap();
        let home = app_home_dir().unwrap();
        assert_eq!(home, data.path().join("upriv"));
        // Resolve is pure: the first write under the home makes it.
        assert!(!home.host_exists());

        crate::host_fs::set_permissions(
            install.path(),
            crate::host_fs::Permissions::from_mode(0o755),
        )
        .unwrap();
        std::env::remove_var("APPIMAGE");
        std::env::remove_var("XDG_DATA_HOME");
    }

    #[test]
    #[cfg(unix)]
    fn app_home_env_wins_even_when_not_writable() {
        use std::os::unix::fs::PermissionsExt;

        // Electron may set UPRIV_DEFAULT_ROOT_ANCHOR to an already-resolved home; trust it
        // even if a later probe would fail (no double fallback fight).
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let _env = crate::paths::EnvGuard::capture(&["UPRIV_DEFAULT_ROOT_ANCHOR", "APPIMAGE"]);
        let anchor = tempfile::tempdir().unwrap();
        std::env::set_var("UPRIV_DEFAULT_ROOT_ANCHOR", anchor.path());
        std::env::remove_var("APPIMAGE");
        crate::host_fs::set_permissions(
            anchor.path(),
            crate::host_fs::Permissions::from_mode(0o555),
        )
        .unwrap();
        assert_eq!(app_home_dir().unwrap(), anchor.path());
        crate::host_fs::set_permissions(
            anchor.path(),
            crate::host_fs::Permissions::from_mode(0o755),
        )
        .unwrap();
        std::env::remove_var("UPRIV_DEFAULT_ROOT_ANCHOR");
    }

    #[test]
    fn installed_needs_setup_uses_app_home_as_default_root_anchor() {
        use crate::paths::{AppDistribution, ENV_DISTRIBUTION};

        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let _env = crate::paths::EnvGuard::capture(&[
            "HOME",
            "APPIMAGE",
            "UPRIV_DEFAULT_ROOT_ANCHOR",
            ENV_DISTRIBUTION,
        ]);
        let home = tempfile::tempdir().unwrap();
        let appdata = home.path().join("appdata");
        crate::host_fs::create_dir_all(&appdata).unwrap();
        std::env::set_var("HOME", home.path());
        std::env::set_var(ENV_DISTRIBUTION, "installed");
        std::env::set_var("UPRIV_DEFAULT_ROOT_ANCHOR", &appdata);
        std::env::remove_var("APPIMAGE");

        let resolved = resolve_vault_root(ResolveVaultRootOptions::default()).unwrap();
        match resolved {
            ResolveVaultRoot::NeedsSetup {
                default_root_anchor,
                distribution,
            } => {
                assert_eq!(distribution, AppDistribution::Installed);
                assert_eq!(default_root_anchor, appdata);
            }
            _ => panic!("expected needs_setup"),
        }

        std::env::remove_var(ENV_DISTRIBUTION);
        std::env::remove_var("UPRIV_DEFAULT_ROOT_ANCHOR");
        std::env::remove_var("HOME");
    }

    #[test]
    fn installed_first_run_creates_absent_app_home_on_setup() {
        use crate::paths::{initialize_vault_root, ENV_DISTRIBUTION};

        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let _env = crate::paths::EnvGuard::capture(&[
            "APPIMAGE",
            "UPRIV_DEFAULT_ROOT_ANCHOR",
            ENV_DISTRIBUTION,
        ]);
        let base = tempfile::tempdir().unwrap();
        let app_home = base.path().join("missing-app-home");
        assert!(!app_home.host_exists());

        std::env::set_var(ENV_DISTRIBUTION, "installed");
        std::env::set_var("UPRIV_DEFAULT_ROOT_ANCHOR", &app_home);
        std::env::remove_var("APPIMAGE");

        // Resolve is path-only — Electron does not mkdir; first write creates.
        assert_eq!(app_home_dir().unwrap(), app_home);
        assert_eq!(setup_default_root_anchor().unwrap(), app_home);
        assert!(!app_home.host_exists());

        let root = initialize_vault_root(&app_home).unwrap();
        assert!(app_home.host_is_dir());
        assert!(root
            .root()
            .join(".upriv")
            .join("settings.toml")
            .host_is_file());

        std::env::remove_var(ENV_DISTRIBUTION);
        std::env::remove_var("UPRIV_DEFAULT_ROOT_ANCHOR");
    }
}
