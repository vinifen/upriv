//! An open encrypted vault's unlocked folder: the folder of the OS where its
//! files appear to other apps (FUSE on Linux, WinFsp on Windows).
//!
//! The open never waits for it. Once the vault is open, the desktop asks for
//! it with [`attach_unlocked_folder`], a job of its own that walks the
//! unlocked folder chain, mounts, and saves a switch when the selected folder
//! failed. A close stops it, and none starts once a close has begun.

#[allow(unused_imports)]
use crate::host_fs::HostFsQuery;
use std::collections::HashSet;
use std::convert::Infallible;
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::unlocked_destination::UnlockedDestination;
use crate::config::list_saves::save_unlocked_switch;
use crate::config::{load_app_settings_at, load_vault_config, VaultConfig};
use crate::device::{this_device, DeviceSystem};
use crate::error::{Result, UprivError};
use crate::folder_list::unlocked::{
    self, encrypted_folder_on, ensure_container, remove_container_if_empty, UnlockedPlace,
};
use crate::folder_list::{fail_over, path_issue, Failover, ListKind, Switch, Try};
use crate::folder_probe::{
    probe_writable, within_limit, FolderState, FOLDER_STATUS_CHECK_LIMIT, FOLDER_SWITCH_CHECK_LIMIT,
};
use crate::logging::{log_event, LogLevel};
use crate::mount::MountedVault;
use crate::paths::VaultRoot;
use crate::runtime_state::mark_session_open;
use crate::session::{
    is_vault_closing_at, open_session_ids, with_open_session, with_vault_dir_lock, AttachState,
    Job, JobKind,
};
use crate::store::VaultStorageMode;

/// What [`attach_unlocked_folder`] did.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum AttachAnswer {
    /// The folder the selection names is mounted.
    Mounted { path: String },
    /// The selected folder failed, and the vault's folder is mounted in the
    /// first choice of the chain that works.
    Switched { path: String, switches: Vec<Switch> },
    /// The vault's switch is off, or this device mounts no folder.
    Off,
    /// FUSE or WinFsp is not installed.
    DriverMissing,
    /// Nothing is selected on this device.
    Unset,
    /// No folder of the chain works, and the selection stays. `reason` is the
    /// selected folder's.
    Unavailable { path: String, reason: FolderState },
    /// The mount failed for a reason that is not the folder's.
    Failed,
}

/// Why the walk stopped at a folder without trying the next.
enum Stop {
    Driver,
    Cancelled,
    Failed,
}

/// `vault_unlocked_folder_attach`: mount the open encrypted vault's unlocked
/// folder, as the job `job_id`. Each folder check has its own limit; the job
/// has none. Refused when the vault is not open or a close has begun.
pub fn attach_unlocked_folder(
    root: &VaultRoot,
    vault_id: &str,
    job_id: &str,
) -> Result<AttachAnswer> {
    let vault_dir = root.vault_dir(vault_id)?;
    Job::run(
        job_id,
        JobKind::UnlockedFolderAttach,
        Some(vault_id),
        |job| {
            if let Some(path) = begin(&vault_dir, job)? {
                return Ok(AttachAnswer::Mounted { path });
            }
            let answer = attach(root, vault_id, &vault_dir, job);
            let _ = with_open_session(&vault_dir, |session| {
                session.attach = AttachState::Idle;
                Ok(())
            });
            answer
        },
    )
}

/// Mark the attach as running. `Some(path)` when the vault is mounted already.
fn begin(vault_dir: &Path, job: &Job) -> Result<Option<String>> {
    if is_vault_closing_at(vault_dir) {
        return Err(UprivError::JobCancelled);
    }
    with_open_session(vault_dir, |session| {
        if let Some(mount) = session.mount.as_ref() {
            return Ok(Some(mount.mount_point().display().to_string()));
        }
        if matches!(session.attach, AttachState::Running(_)) {
            return Err(UprivError::VaultBusy);
        }
        session.attach = AttachState::Running(job.stop_flag());
        Ok(None)
    })
}

fn attach(root: &VaultRoot, vault_id: &str, vault_dir: &Path, job: &Job) -> Result<AttachAnswer> {
    // A session whose open reset its storage value gets no folder, whatever
    // the files say: they are what something changed outside Upriv.
    if with_open_session(vault_dir, |session| Ok(session.storage_reset))? {
        return Ok(AttachAnswer::Off);
    }
    let config = load_vault_config(vault_dir)?;
    if config.storage_mode() != VaultStorageMode::EncryptedDir
        || !DeviceSystem::current().mounts_folders()
    {
        return Ok(AttachAnswer::Off);
    }
    let app = load_app_settings_at(root.root())?.settings.unlocked_folders;
    let vault = &config.unlocked_folder;
    if !encrypted_folder_on(&app, vault) {
        return Ok(AttachAnswer::Off);
    }
    let device = this_device();
    let Some(selected) = unlocked::selected_place(&app, vault, device) else {
        return Ok(AttachAnswer::Unset);
    };
    let chain = unlocked::chain(&app, vault, device);
    let display_name = config.vault.display_name.as_str();
    let outcome = fail_over(&selected, &chain, |place| {
        try_mount(root, vault_id, vault_dir, place, display_name, job)
    });
    match outcome {
        Failover::Kept(mounted) => install(root, vault_id, vault_dir, mounted, job)
            .map(|path| AttachAnswer::Mounted { path }),
        Failover::Switched {
            link,
            value,
            reason,
        } => {
            let path = install(root, vault_id, vault_dir, value, job)?;
            let taking = unlocked::selections_taking(&app, vault, device, link);
            let mut switches = unlocked::switches(&app, vault, device, vault_id, taking, reason);
            let saved = with_vault_dir_lock(vault_dir, || {
                Ok(save_unlocked_switch(root, vault_dir, taking))
            })
            .unwrap_or(false);
            for switch in &mut switches {
                switch.saved = saved;
                switch.log();
            }
            Ok(AttachAnswer::Switched { path, switches })
        }
        Failover::Stopped(Stop::Driver) => Ok(AttachAnswer::DriverMissing),
        Failover::Stopped(Stop::Cancelled) => Err(UprivError::JobCancelled),
        Failover::Stopped(Stop::Failed) => Ok(AttachAnswer::Failed),
        Failover::Unavailable(reason) => {
            log_event(
                LogLevel::Warn,
                "unlocked_folder_unavailable",
                &[("id", vault_id), ("reason", reason.as_str())],
            );
            Ok(AttachAnswer::Unavailable {
                path: selected.container(root.root()).display().to_string(),
                reason,
            })
        }
    }
}

/// The encrypted half of [`crate::vault::unlocked_destination`]: the folder
/// the attach would mount, each place of the chain checked the way the
/// attach checks it, with nothing made.
pub(crate) fn mount_destination(
    root: &VaultRoot,
    vault_id: &str,
    config: &VaultConfig,
) -> Result<UnlockedDestination> {
    if !DeviceSystem::current().mounts_folders() {
        return Ok(UnlockedDestination::Off);
    }
    let app = load_app_settings_at(root.root())?.settings.unlocked_folders;
    let vault = &config.unlocked_folder;
    if !encrypted_folder_on(&app, vault) {
        return Ok(UnlockedDestination::Off);
    }
    let device = this_device();
    let Some(selected) = unlocked::selected_place(&app, vault, device) else {
        return Ok(UnlockedDestination::Unset);
    };
    let chain = unlocked::chain(&app, vault, device);
    let display_name = config.vault.display_name.as_str();
    let outcome = fail_over(&selected, &chain, |place| {
        let state = check_place(root, place, FOLDER_SWITCH_CHECK_LIMIT, false);
        if state.is_ok() {
            Try::<PathBuf, Infallible>::Works(place.vault_folder(root.root(), display_name))
        } else {
            Try::Fails(state)
        }
    });
    let (path, switches) = match outcome {
        Failover::Kept(path) => (path, Vec::new()),
        Failover::Switched {
            link,
            value,
            reason,
        } => {
            let taking = unlocked::selections_taking(&app, vault, device, link);
            let switches = unlocked::switches(&app, vault, device, vault_id, taking, reason);
            (value, switches)
        }
        Failover::Stopped(never) => match never {},
        Failover::Unavailable(reason) => {
            return Ok(UnlockedDestination::Unavailable {
                path: selected.container(root.root()).display().to_string(),
                reason,
            })
        }
    };
    Ok(UnlockedDestination::Folder {
        path: path.display().to_string(),
        class: None,
        switches,
    })
}

/// Whether `place` can hold an unlocked folder now: its folder answers and
/// takes a write. With `make`, `upriv-unlocked` is made there with its folder
/// ID file. Within `limit`; the folder of the row is never made.
pub(crate) fn check_place(
    root: &VaultRoot,
    place: &UnlockedPlace,
    limit: std::time::Duration,
    make: bool,
) -> FolderState {
    if place
        .row_path()
        .is_some_and(|path| path_issue(DeviceSystem::current(), ListKind::Unlocked, path).is_some())
    {
        return FolderState::Refused;
    }
    let container = place.container(root.root());
    let base = place.base(root.root());
    let key = base.clone();
    let kind = if make {
        "unlocked_place_make"
    } else {
        "unlocked_place"
    };
    within_limit(&key, kind, limit, move || {
        let target = if container.host_is_dir() {
            &container
        } else {
            &base
        };
        let state = probe_writable(target);
        if !state.is_ok() || !make {
            return state;
        }
        match ensure_container(&container) {
            Ok(_) => FolderState::Ok,
            Err(error) => FolderState::of_failure(&error),
        }
    })
    .unwrap_or(FolderState::NotResponding)
}

fn try_mount(
    root: &VaultRoot,
    vault_id: &str,
    vault_dir: &Path,
    place: &UnlockedPlace,
    display_name: &str,
    job: &Job,
) -> Try<MountedVault, Stop> {
    if job.is_stopped() || is_vault_closing_at(vault_dir) {
        return Try::Stop(Stop::Cancelled);
    }
    let state = check_place(root, place, FOLDER_SWITCH_CHECK_LIMIT, true);
    if !state.is_ok() {
        return Try::Fails(state);
    }
    let mount_point = place.vault_folder(root.root(), display_name);
    match crate::mount::mount_encrypted_dir(root.clone(), vault_id.to_string(), mount_point) {
        Ok(mounted) => Try::Works(mounted),
        Err(UprivError::MountDriverMissing) => Try::Stop(Stop::Driver),
        Err(UprivError::MountFilesystemUnsupported(_)) => {
            remove_container_if_empty(&place.container(root.root()));
            Try::Fails(FolderState::Unsupported)
        }
        Err(error) => {
            log_event(
                LogLevel::Warn,
                "vault_mount_failed",
                &[("id", vault_id), ("detail", error.to_string().as_str())],
            );
            Try::Stop(Stop::Failed)
        }
    }
}

/// Put the mount in the session and record it, unless a close began or the
/// job was stopped meanwhile: then it is let go.
fn install(
    root: &VaultRoot,
    vault_id: &str,
    vault_dir: &Path,
    mounted: MountedVault,
    job: &Job,
) -> Result<String> {
    let path = mounted.mount_point().display().to_string();
    let mut pending = Some(mounted);
    let installed = with_open_session(vault_dir, |session| {
        if job.is_stopped() || is_vault_closing_at(vault_dir) {
            return Err(UprivError::JobCancelled);
        }
        mark_session_open(root, vault_id, Some(path.clone()))?;
        session.mount = pending.take();
        Ok(())
    });
    if let Err(error) = installed {
        drop(pending);
        return Err(error);
    }
    log_event(LogLevel::Info, "vault_mounted", &[("id", vault_id)]);
    Ok(path)
}

/// Stop the attach of a vault whose close begins, or whose session ends with
/// the data folder Upriv left.
pub(crate) fn stop_attach(vault_dir: &Path) {
    let _ = with_open_session(vault_dir, |session| {
        if let AttachState::Running(stop) = &session.attach {
            stop.store(true, std::sync::atomic::Ordering::Relaxed);
        }
        Ok(())
    });
}

/// The folders open vaults use now: mounts and plain-text folders.
fn folders_in_use(root: &VaultRoot) -> Vec<PathBuf> {
    let mut folders = Vec::new();
    for id in open_session_ids() {
        let Ok(dir) = root.vault_dir(&id) else {
            continue;
        };
        let _ = with_open_session(&dir, |session| {
            if let Some(plain) = session.plain.as_ref() {
                folders.push(plain.folder().to_path_buf());
            }
            if let Some(mount) = session.mount.as_ref() {
                folders.push(mount.mount_point().to_path_buf());
            }
            Ok(())
        });
    }
    folders
}

/// The names of the vaults open now in `container`.
pub(crate) fn open_vault_names_under(root: &VaultRoot, container: &Path) -> Vec<String> {
    let mut names = Vec::new();
    for id in open_session_ids() {
        let Ok(dir) = root.vault_dir(&id) else {
            continue;
        };
        let _ = with_open_session(&dir, |session| {
            let folder = session
                .plain
                .as_ref()
                .map(|plain| plain.folder().to_path_buf())
                .or_else(|| {
                    session
                        .mount
                        .as_ref()
                        .map(|mount| mount.mount_point().to_path_buf())
                });
            if folder.is_some_and(|folder| folder.starts_with(container)) {
                names.push(session.display_name.clone());
            }
            Ok(())
        });
    }
    names.sort();
    names
}

/// Refuse to let rows go while an open vault uses their `upriv-unlocked`.
pub(crate) fn refuse_folders_in_use(root: &VaultRoot, leaving: &[UnlockedPlace]) -> Result<()> {
    if leaving.is_empty() {
        return Ok(());
    }
    let in_use = folders_in_use(root);
    for place in leaving {
        let container = place.container(root.root());
        if in_use.iter().any(|folder| folder.starts_with(&container)) {
            return Err(UprivError::FolderInUse {
                path: container.display().to_string(),
            });
        }
    }
    Ok(())
}

/// Every `upriv-unlocked` this device's lists name: Beside the data folder,
/// the app's rows, and each vault's rows.
pub(crate) fn unlocked_containers_named(root: &VaultRoot) -> HashSet<PathBuf> {
    let device = this_device();
    let mut named = HashSet::new();
    named.insert(UnlockedPlace::Beside.container(root.root()));
    if let Ok(loaded) = load_app_settings_at(root.root()) {
        for row in loaded.settings.unlocked_folders.devices.rows_here(device) {
            named.insert(UnlockedPlace::AppRow(row.clone()).container(root.root()));
        }
    }
    for id in crate::config::known_vault_ids(root).unwrap_or_default() {
        let Ok(config) = root.vault_dir(&id).and_then(load_vault_config) else {
            continue;
        };
        for row in config.unlocked_folder.devices.rows_here(device) {
            named.insert(UnlockedPlace::VaultRow(row.clone()).container(root.root()));
        }
    }
    named
}

/// Remove `container` when it holds nothing but its folder ID file. This
/// device's records of plain-text folders under it that are gone are dropped
/// first, while that is still provable. True when it is gone.
pub(crate) fn release_unlocked_container(root: &VaultRoot, container: &Path) -> bool {
    let root = root.clone();
    let target = container.to_path_buf();
    within_limit(container, "release", FOLDER_STATUS_CHECK_LIMIT, move || {
        super::plain::forget_gone_records_under(&root, &target);
        remove_container_if_empty(&target)
    })
    .unwrap_or(false)
}

/// What a vault's unlocked folder is on this device, for its Info window.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnlockedFolderInfo {
    /// The vault's own choice: a row, or the app's.
    pub choice: crate::folder_list::ChoiceName,
    /// The vault's folder there, when something is selected.
    pub path: Option<String>,
    pub mounted: bool,
}

/// [`UnlockedFolderInfo`] of `vault_id`.
pub fn unlocked_folder_info(root: &VaultRoot, vault_id: &str) -> Result<UnlockedFolderInfo> {
    let vault_dir = root.vault_dir(vault_id)?;
    let config = load_vault_config(&vault_dir)?;
    let app = load_app_settings_at(root.root())?.settings.unlocked_folders;
    let device = this_device();
    let path = unlocked::selected_place(&app, &config.unlocked_folder, device).map(|place| {
        place
            .vault_folder(root.root(), &config.vault.display_name)
            .display()
            .to_string()
    });
    let mounted = with_open_session(&vault_dir, |session| {
        Ok(session.mount.is_some() || session.plain.is_some())
    })
    .unwrap_or(false);
    Ok(UnlockedFolderInfo {
        choice: unlocked::vault_choice_name(&config.unlocked_folder, device),
        path,
        mounted,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::folder_list::unlocked::UNLOCKED_ID_FILE;
    use crate::folder_list::Row;
    use crate::test_support::vault_root_with;

    fn row(path: &Path) -> UnlockedPlace {
        UnlockedPlace::AppRow(Row {
            number: 1,
            name: String::new(),
            path: path.display().to_string(),
        })
    }

    #[test]
    fn a_folder_that_answers_gets_upriv_unlocked_with_its_id() {
        let (tmp, root) = vault_root_with(&[]);
        let drive = tmp.path().join("drive");
        std::fs::create_dir(&drive).unwrap();
        assert_eq!(
            check_place(&root, &row(&drive), FOLDER_STATUS_CHECK_LIMIT, true),
            FolderState::Ok
        );
        assert!(drive
            .join("upriv-unlocked")
            .join(UNLOCKED_ID_FILE)
            .is_file());
    }

    #[test]
    fn an_unplugged_drive_is_missing_and_never_made() {
        let (tmp, root) = vault_root_with(&[]);
        let drive = tmp.path().join("unplugged");
        assert_eq!(
            check_place(&root, &row(&drive), FOLDER_STATUS_CHECK_LIMIT, true),
            FolderState::Missing
        );
        assert!(!drive.exists());
    }

    #[test]
    fn a_row_the_rules_refuse_is_refused_before_any_check() {
        let (tmp, root) = vault_root_with(&[]);
        let inside = tmp.path().join("x").join("upriv-backups").join("notes");
        assert_eq!(
            check_place(&root, &row(&inside), FOLDER_STATUS_CHECK_LIMIT, true),
            FolderState::Refused
        );
    }

    #[test]
    fn an_empty_container_goes_and_the_row_folder_stays() {
        let (tmp, root) = vault_root_with(&[]);
        let drive = tmp.path().join("drive");
        std::fs::create_dir(&drive).unwrap();
        let place = row(&drive);
        check_place(&root, &place, FOLDER_STATUS_CHECK_LIMIT, true);
        let container = place.container(root.root());
        assert!(release_unlocked_container(&root, &container));
        assert!(!container.exists());
        assert!(drive.exists());
    }
}
