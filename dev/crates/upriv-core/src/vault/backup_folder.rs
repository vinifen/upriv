//! The folder a vault's backups go to when it is not the data folder: which
//! one it is, and whether it can take a backup right now.
//!
//! A chosen folder can be a drive that is unplugged, full, read-only, or a
//! network share that stopped answering. The check tells these apart without
//! ever holding up its caller for long, and a stuck folder costs one thread
//! however many times it is asked about.

#[allow(unused_imports)]
use crate::host_fs::HostFsQuery;
use std::collections::HashMap;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, LazyLock, Mutex, PoisonError};
use std::time::{Duration, Instant};

use crate::config::{known_vault_ids, load_app_settings_at, load_vault_config_raw, VaultConfig};
use crate::error::{Result, UprivError};
use crate::failure::{classify_write_failure, io_is_disk_full, io_is_permission};
use crate::paths::{
    own_backups_folder, path_is_under_reserved_upriv_tree, paths_equal_or_under_casefold,
    resolve_chosen_backup_folder, resolve_vault_mount_point, resolved_workspace_parent,
    shared_backups_folder, BackupFolderTable, ChosenBackupFolder, VaultRoot, WorkspaceSystem,
    WorkspaceTable,
};
use crate::session::lock_table;

use super::persistence::load_vault_persistence;

/// `backups/` of a vault folder.
pub(super) const BACKUPS_DIR: &str = "backups";
/// How long one check of a folder may take. Only the check: a backup has no limit.
const BACKUP_FOLDER_CHECK_LIMIT: Duration = Duration::from_secs(5);
const PROBE_FILE_BYTES: usize = 4096;

/// What a chosen folder can do right now.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BackupFolderStatus {
    Ok,
    /// The folder, or this vault's folder inside it, is gone.
    Missing,
    NoPermission,
    NoRoom,
    /// The zip would be larger than this file system allows for one file.
    FileTooLarge,
    NotResponding,
    /// Inside a `.upriv`, or it overlaps a vault's file manager folder.
    Reserved,
    Other,
}

impl BackupFolderStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ok => "ok",
            Self::Missing => "missing",
            Self::NoPermission => "no_permission",
            Self::NoRoom => "no_room",
            Self::FileTooLarge => "file_too_large",
            Self::NotResponding => "not_responding",
            Self::Reserved => "reserved",
            Self::Other => "other",
        }
    }

    /// Why a write to the folder failed.
    pub(super) fn of_failure(error: &UprivError) -> Self {
        let class = classify_write_failure(error);
        match class.reason {
            "disk_full" => Self::NoRoom,
            "permission" => Self::NoPermission,
            _ if class.os.is_some_and(is_file_too_large_code) => Self::FileTooLarge,
            _ => Self::Other,
        }
    }

    fn of_io(error: &std::io::Error) -> Self {
        if io_is_disk_full(error) {
            Self::NoRoom
        } else if io_is_permission(error) {
            Self::NoPermission
        } else if error.kind() == ErrorKind::NotFound {
            Self::Missing
        } else if error.raw_os_error().is_some_and(is_file_too_large_code) {
            Self::FileTooLarge
        } else {
            Self::Other
        }
    }
}

#[cfg(unix)]
fn is_file_too_large_code(code: i32) -> bool {
    code == libc::EFBIG
}

/// `ERROR_FILE_TOO_LARGE`.
#[cfg(windows)]
fn is_file_too_large_code(code: i32) -> bool {
    code == 223
}

#[cfg(not(any(unix, windows)))]
fn is_file_too_large_code(_code: i32) -> bool {
    false
}

/// A flush this file system does not offer: it is as flushed as it gets there.
pub(super) fn flush_is_unsupported(error: &std::io::Error) -> bool {
    #[cfg(unix)]
    {
        matches!(
            error.raw_os_error(),
            Some(libc::ENOSYS | libc::EINVAL | libc::ENOTSUP)
        )
    }
    #[cfg(not(unix))]
    {
        let _ = error;
        false
    }
}

/// Where this vault's backups are kept.
#[derive(Debug, Clone)]
pub(super) struct BackupPlaces {
    /// `vaults/<id>/backups/`.
    pub data_folder: PathBuf,
    pub chosen: Option<ChosenBackupFolder>,
}

fn saved_folder_id(vault_dir: &Path, vault_id: &str) -> String {
    load_vault_persistence(vault_dir)
        .ok()
        .flatten()
        .and_then(|saved| saved.backup_folder_id)
        .unwrap_or_else(|| vault_id.to_string())
}

fn app_backup_folders(root: &VaultRoot) -> BackupFolderTable {
    load_app_settings_at(root.root())
        .map(|loaded| loaded.settings.backups)
        .unwrap_or_default()
}

/// The places a vault's backups are in on this system. Settings that cannot be
/// read mean the data folder, the one place that always exists.
pub(super) fn backup_places(root: &VaultRoot, vault_id: &str, vault_dir: &Path) -> BackupPlaces {
    let data_folder = vault_dir.join(BACKUPS_DIR);
    let Ok(config) = load_vault_config_raw(vault_dir) else {
        return BackupPlaces {
            data_folder,
            chosen: None,
        };
    };
    let system = WorkspaceSystem::current();
    let app = app_backup_folders(root);
    let chosen = resolve_chosen_backup_folder(
        app.row(system),
        config.backup.folder_row(system),
        &saved_folder_id(vault_dir, vault_id),
    );
    BackupPlaces {
        data_folder,
        chosen,
    }
}

/// True when this machine has written to `dir` before.
pub(super) fn used_here(vault_dir: &Path, dir: &Path) -> bool {
    load_vault_persistence(vault_dir)
        .ok()
        .flatten()
        .and_then(|saved| saved.this_host_record().cloned())
        .and_then(|record| record.chosen_dir)
        .is_some_and(|last| Path::new(&last) == dir)
}

fn folders_overlap(left: &Path, right: &Path) -> bool {
    paths_equal_or_under_casefold(left, right) || paths_equal_or_under_casefold(right, left)
}

/// One vault's folders on this system: its file manager or plain-text folder,
/// and its chosen backup folder.
struct VaultFolders {
    id: String,
    mount: Option<PathBuf>,
    backups: Option<PathBuf>,
}

fn vault_folders(
    root: &VaultRoot,
    id: &str,
    config: &VaultConfig,
    workspace: &WorkspaceTable,
    backups: &BackupFolderTable,
) -> VaultFolders {
    let system = WorkspaceSystem::current();
    let own_folder = !config.mount.row(system).path.trim().is_empty();
    let parent = resolved_workspace_parent(workspace, &config.mount, system, root.root());
    let mount = resolve_vault_mount_point(&parent, &config.vault.display_name, own_folder);
    let folder_id = root
        .vault_dir(id)
        .map_or_else(|_| id.to_string(), |dir| saved_folder_id(&dir, id));
    let chosen = resolve_chosen_backup_folder(
        backups.row(system),
        config.backup.folder_row(system),
        &folder_id,
    );
    VaultFolders {
        id: id.to_string(),
        mount,
        backups: chosen.map(|folder| folder.dir),
    }
}

/// Every vault's folders, with `replacing` in place of what its `config.toml` holds.
fn all_vault_folders(
    root: &VaultRoot,
    workspace: &WorkspaceTable,
    backups: &BackupFolderTable,
    replacing: Option<(&str, &VaultConfig)>,
) -> Result<Vec<VaultFolders>> {
    let mut out = Vec::new();
    for id in known_vault_ids(root)? {
        if let Some((replaced, config)) = replacing {
            if replaced == id {
                out.push(vault_folders(root, &id, config, workspace, backups));
                continue;
            }
        }
        let Ok(config) = load_vault_config_raw(root.vault_dir(&id)?) else {
            continue;
        };
        out.push(vault_folders(root, &id, &config, workspace, backups));
    }
    Ok(out)
}

/// A backup folder that overlaps a vault's file manager or plain-text folder.
/// A plain-text close wipes its folder, and an encrypted mount hides what is
/// under it. With `only`, just the pairs that involve that vault.
fn first_overlap(folders: &[VaultFolders], only: Option<&str>) -> Option<PathBuf> {
    for holder in folders {
        let Some(backups) = holder.backups.as_deref() else {
            continue;
        };
        for vault in folders {
            let Some(mount) = vault.mount.as_deref() else {
                continue;
            };
            let involved = only.is_none_or(|id| id == holder.id || id == vault.id);
            if involved && folders_overlap(backups, mount) {
                return Some(backups.to_path_buf());
            }
        }
    }
    None
}

/// Refuse a vault's new folders when its backup folder and any vault's file
/// manager or plain-text folder would overlap, either way round.
pub(crate) fn refuse_vault_backup_overlap(
    root: &VaultRoot,
    vault_id: &str,
    after: &VaultConfig,
) -> Result<()> {
    let settings = load_app_settings_at(root.root())?.settings;
    let folders = all_vault_folders(
        root,
        &settings.workspace,
        &settings.backups,
        Some((vault_id, after)),
    )?;
    match first_overlap(&folders, Some(vault_id)) {
        Some(path) => Err(UprivError::WorkspacePathReserved(path)),
        None => Ok(()),
    }
}

/// Refuse app defaults that would put any vault's backups and any vault's file
/// manager or plain-text folder in one place.
pub(crate) fn refuse_app_backup_overlap(
    root: &VaultRoot,
    workspace: &WorkspaceTable,
    backups: &BackupFolderTable,
) -> Result<()> {
    let folders = all_vault_folders(root, workspace, backups, None)?;
    match first_overlap(&folders, None) {
        Some(path) => Err(UprivError::WorkspacePathReserved(path)),
        None => Ok(()),
    }
}

fn is_reserved_here(root: &VaultRoot, dir: &Path) -> bool {
    if path_is_under_reserved_upriv_tree(dir) {
        return true;
    }
    let Ok(settings) = load_app_settings_at(root.root()).map(|loaded| loaded.settings) else {
        return false;
    };
    all_vault_folders(root, &settings.workspace, &settings.backups, None).is_ok_and(|folders| {
        folders.iter().any(|vault| {
            vault
                .mount
                .as_deref()
                .is_some_and(|mount| folders_overlap(dir, mount))
        })
    })
}

/// What a check may do and needs to know.
#[derive(Debug, Clone, Copy)]
pub(super) struct FolderCheck {
    /// This machine has written to the vault's folder before, so its absence
    /// means the drive is not there.
    pub used_here: bool,
    /// Make the vault's folder when this is its first use here.
    pub create: bool,
    /// Bytes the next zip takes, when that matters.
    pub needed: Option<u64>,
}

/// Whether the vault's chosen folder can take a backup right now.
pub(super) fn check_chosen_folder(
    root: &VaultRoot,
    chosen: &ChosenBackupFolder,
    check: FolderCheck,
) -> BackupFolderStatus {
    if is_reserved_here(root, &chosen.dir) {
        return BackupFolderStatus::Reserved;
    }
    let folder = chosen.clone();
    within_limit(&chosen.dir, BACKUP_FOLDER_CHECK_LIMIT, move || {
        probe_folder(&folder, check)
    })
}

/// Whether a folder typed into the settings can hold backups. `vault_id` is the
/// vault that would use it as its own; without one it is the app default.
pub fn check_typed_backup_folder(
    root: &VaultRoot,
    path: &Path,
    vault_id: Option<&str>,
) -> BackupFolderStatus {
    if crate::paths::validate_workspace_global_path(&path.to_string_lossy(), Some(root.root()))
        .is_err()
    {
        return BackupFolderStatus::Reserved;
    }
    let (dir, needed) = match vault_id {
        // The folder a backup would go to: named by the id the vault kept
        // from its first backup there, which a rename leaves as it was.
        Some(id) => {
            let Ok(vault_dir) = root.vault_dir(id) else {
                return BackupFolderStatus::Other;
            };
            (
                own_backups_folder(path, &saved_folder_id(&vault_dir, id)),
                zip_bytes_of(&vault_dir),
            )
        }
        None => (shared_backups_folder(path), None),
    };
    if is_reserved_here(root, &dir) {
        return BackupFolderStatus::Reserved;
    }
    let folder = ChosenBackupFolder {
        chosen: path.to_path_buf(),
        dir,
    };
    within_limit(path, BACKUP_FOLDER_CHECK_LIMIT, move || {
        probe_folder(
            &folder,
            FolderCheck {
                used_here: false,
                create: false,
                needed,
            },
        )
    })
}

/// Size of the next zip of this vault.
pub(super) fn zip_bytes_of(vault_dir: &Path) -> Option<u64> {
    super::zip_io::store_zip_bytes(&vault_dir.join(crate::paths::STORE_DIR_NAME)).ok()
}

fn probe_folder(folder: &ChosenBackupFolder, check: FolderCheck) -> BackupFolderStatus {
    if !folder.chosen.host_is_dir() {
        return BackupFolderStatus::Missing;
    }
    let mut target = folder.dir.as_path();
    if !folder.dir.host_is_dir() {
        if check.used_here {
            return BackupFolderStatus::Missing;
        }
        if check.create {
            if let Err(error) = crate::host_fs::create_dir_all(&folder.dir) {
                return BackupFolderStatus::of_io(&error);
            }
        } else {
            target = folder.chosen.as_path();
        }
    }
    if let Err(error) = write_probe_file(target) {
        return BackupFolderStatus::of_io(&error);
    }
    let Some(needed) = check.needed else {
        return BackupFolderStatus::Ok;
    };
    if crate::host_fs::free_bytes(target).is_some_and(|free| free < needed) {
        return BackupFolderStatus::NoRoom;
    }
    if file_size_limit(target).is_some_and(|limit| needed > limit) {
        return BackupFolderStatus::FileTooLarge;
    }
    BackupFolderStatus::Ok
}

/// A permission check alone is not enough: this makes, writes, flushes, renames,
/// and deletes a small file, the steps a backup takes.
fn write_probe_file(dir: &Path) -> std::io::Result<()> {
    let unique: u64 = rand::random();
    let probe = dir.join(format!(".upriv-check-{unique:016x}"));
    let renamed = dir.join(format!(".upriv-check-{unique:016x}.done"));
    let written = (|| {
        let mut file = crate::host_fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&probe)?;
        file.write_all(&[0u8; PROBE_FILE_BYTES])?;
        match file.sync_all() {
            Err(error) if !flush_is_unsupported(&error) => return Err(error),
            _ => {}
        }
        drop(file);
        crate::host_fs::rename(&probe, &renamed)
    })();
    let _ = crate::host_fs::remove_file(&probe);
    let removed = crate::host_fs::remove_file(&renamed);
    written?;
    removed
}

/// FAT32 holds no file of 4 GiB or more. `None` when this file system has no
/// such limit, or its type cannot be read; a write past a limit still fails
/// with the same reason.
fn file_size_limit(path: &Path) -> Option<u64> {
    is_fat32(path).then_some(u64::from(u32::MAX))
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn is_fat32(path: &Path) -> bool {
    use std::os::unix::ffi::OsStrExt;
    /// `MSDOS_SUPER_MAGIC`.
    const FAT_MAGIC: i64 = 0x4d44;
    let Ok(c_path) = std::ffi::CString::new(path.as_os_str().as_bytes()) else {
        return false;
    };
    let mut st: libc::statfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statfs(c_path.as_ptr(), &mut st) } != 0 {
        return false;
    }
    #[allow(clippy::unnecessary_cast)]
    let kind = st.f_type as i64;
    kind == FAT_MAGIC
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn is_fat32(path: &Path) -> bool {
    use std::ffi::CStr;
    use std::os::unix::ffi::OsStrExt;
    let Ok(c_path) = std::ffi::CString::new(path.as_os_str().as_bytes()) else {
        return false;
    };
    let mut st: libc::statfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statfs(c_path.as_ptr(), &mut st) } != 0 {
        return false;
    }
    unsafe { CStr::from_ptr(st.f_fstypename.as_ptr()) }.to_bytes() == b"msdos"
}

#[cfg(windows)]
fn is_fat32(path: &Path) -> bool {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn GetVolumePathNameW(file: *const u16, buffer: *mut u16, size: u32) -> i32;
        fn GetVolumeInformationW(
            root: *const u16,
            volume_name: *mut u16,
            volume_name_size: u32,
            serial: *mut u32,
            max_component: *mut u32,
            flags: *mut u32,
            fs_name: *mut u16,
            fs_name_size: u32,
        ) -> i32;
    }
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut root = [0u16; 260];
    if unsafe { GetVolumePathNameW(wide.as_ptr(), root.as_mut_ptr(), root.len() as u32) } == 0 {
        return false;
    }
    let mut fs_name = [0u16; 32];
    if unsafe {
        GetVolumeInformationW(
            root.as_ptr(),
            std::ptr::null_mut(),
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            fs_name.as_mut_ptr(),
            fs_name.len() as u32,
        )
    } == 0
    {
        return false;
    }
    let end = fs_name
        .iter()
        .position(|unit| *unit == 0)
        .unwrap_or(fs_name.len());
    String::from_utf16_lossy(&fs_name[..end]).starts_with("FAT")
}

#[cfg(not(any(
    target_os = "linux",
    target_os = "android",
    target_os = "macos",
    target_os = "ios",
    windows
)))]
fn is_fat32(_path: &Path) -> bool {
    false
}

/// One check in flight, shared by everyone asking about that folder.
struct Probe {
    started: Instant,
    result: Mutex<Option<BackupFolderStatus>>,
    done: Condvar,
}

static PROBES: LazyLock<Mutex<HashMap<PathBuf, Arc<Probe>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Takes a finished check off the table, also when it panicked.
struct ProbeSlot(PathBuf);

impl Drop for ProbeSlot {
    fn drop(&mut self) {
        lock_table(&PROBES).remove(&self.0);
    }
}

/// Run `work` on a thread of its own and wait at most `limit`. A folder that
/// stopped answering blocks its thread for good, so a second request joins the
/// running check instead of starting another.
fn within_limit(
    folder: &Path,
    limit: Duration,
    work: impl FnOnce() -> BackupFolderStatus + Send + 'static,
) -> BackupFolderStatus {
    let (probe, is_first) = {
        let mut probes = lock_table(&PROBES);
        match probes.get(folder) {
            Some(running) => (Arc::clone(running), false),
            None => {
                let started = Arc::new(Probe {
                    started: Instant::now(),
                    result: Mutex::new(None),
                    done: Condvar::new(),
                });
                probes.insert(folder.to_path_buf(), Arc::clone(&started));
                (started, true)
            }
        }
    };
    if is_first {
        let running = Arc::clone(&probe);
        let slot = ProbeSlot(folder.to_path_buf());
        let spawned = std::thread::Builder::new()
            .name("upriv-backup-check".into())
            .spawn(move || {
                let status = work();
                drop(slot);
                *lock_table(&running.result) = Some(status);
                running.done.notify_all();
            });
        if spawned.is_err() {
            return BackupFolderStatus::Other;
        }
    }
    let remaining = limit.saturating_sub(probe.started.elapsed());
    let result = lock_table(&probe.result);
    let (result, _) = probe
        .done
        .wait_timeout_while(result, remaining, |status| status.is_none())
        .unwrap_or_else(PoisonError::into_inner);
    result.unwrap_or(BackupFolderStatus::NotResponding)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::{VaultBackupFolderRow, VaultBackupPlace};
    use crate::test_support::vault_root_with;
    use crate::vault::create_vault;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn chosen_in(base: &Path) -> ChosenBackupFolder {
        ChosenBackupFolder {
            chosen: base.to_path_buf(),
            dir: base.join("upriv-backups").join("notes"),
        }
    }

    fn check(used_here: bool, create: bool, needed: Option<u64>) -> FolderCheck {
        FolderCheck {
            used_here,
            create,
            needed,
        }
    }

    #[test]
    fn a_writable_folder_is_ok_and_keeps_no_probe_file() {
        let tmp = tempfile::tempdir().unwrap();
        let folder = chosen_in(tmp.path());
        assert_eq!(
            probe_folder(&folder, check(false, false, None)),
            BackupFolderStatus::Ok
        );
        assert_eq!(crate::host_fs::read_dir(tmp.path()).unwrap().count(), 0);
    }

    #[test]
    fn only_a_write_makes_the_vaults_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let folder = chosen_in(tmp.path());
        probe_folder(&folder, check(false, false, None));
        assert!(!folder.dir.host_exists());
        assert_eq!(
            probe_folder(&folder, check(false, true, None)),
            BackupFolderStatus::Ok
        );
        assert!(folder.dir.host_is_dir());
    }

    #[test]
    fn a_chosen_folder_that_is_gone_is_never_made() {
        let tmp = tempfile::tempdir().unwrap();
        let folder = chosen_in(&tmp.path().join("unplugged"));
        assert_eq!(
            probe_folder(&folder, check(false, true, None)),
            BackupFolderStatus::Missing
        );
        assert!(!folder.chosen.host_exists());
    }

    #[test]
    fn a_folder_this_machine_used_is_not_made_again() {
        let tmp = tempfile::tempdir().unwrap();
        let folder = chosen_in(tmp.path());
        assert_eq!(
            probe_folder(&folder, check(true, true, None)),
            BackupFolderStatus::Missing
        );
        assert!(!folder.dir.host_exists());
    }

    #[cfg(unix)]
    #[test]
    fn a_read_only_folder_reports_no_permission() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempfile::tempdir().unwrap();
        let folder = chosen_in(tmp.path());
        std::fs::set_permissions(tmp.path(), std::fs::Permissions::from_mode(0o500)).unwrap();
        let status = probe_folder(&folder, check(false, false, None));
        std::fs::set_permissions(tmp.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        if nix_is_root() {
            return;
        }
        assert_eq!(status, BackupFolderStatus::NoPermission);
    }

    #[cfg(unix)]
    fn nix_is_root() -> bool {
        unsafe { libc::geteuid() == 0 }
    }

    #[test]
    fn a_zip_larger_than_the_free_space_is_no_room() {
        let tmp = tempfile::tempdir().unwrap();
        let folder = chosen_in(tmp.path());
        assert_eq!(
            probe_folder(&folder, check(false, false, Some(u64::MAX))),
            BackupFolderStatus::NoRoom
        );
    }

    #[test]
    fn a_folder_that_does_not_answer_is_not_responding_and_costs_one_thread() {
        let tmp = tempfile::tempdir().unwrap();
        let key = tmp.path().join("stuck");
        let runs = Arc::new(AtomicUsize::new(0));
        let (release, wait) = std::sync::mpsc::channel::<()>();
        let counted = Arc::clone(&runs);
        let status = within_limit(&key, Duration::from_millis(30), move || {
            counted.fetch_add(1, Ordering::SeqCst);
            let _ = wait.recv();
            BackupFolderStatus::Ok
        });
        assert_eq!(status, BackupFolderStatus::NotResponding);

        let counted = Arc::clone(&runs);
        let again = within_limit(&key, Duration::from_millis(30), move || {
            counted.fetch_add(1, Ordering::SeqCst);
            BackupFolderStatus::Ok
        });
        assert_eq!(again, BackupFolderStatus::NotResponding);
        assert_eq!(runs.load(Ordering::SeqCst), 1, "no second thread");

        release.send(()).unwrap();
        for _ in 0..200 {
            if !lock_table(&PROBES).contains_key(&key) {
                break;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        let later = within_limit(&key, Duration::from_secs(2), || BackupFolderStatus::Ok);
        assert_eq!(later, BackupFolderStatus::Ok);
    }

    #[test]
    fn a_read_only_error_is_a_permission_problem() {
        let error = std::io::Error::from(ErrorKind::ReadOnlyFilesystem);
        assert_eq!(
            BackupFolderStatus::of_io(&error),
            BackupFolderStatus::NoPermission
        );
    }

    fn encrypted(id: &str, name: &str) -> VaultConfig {
        toml::from_str(&format!(
            "[vault]\nid = \"{id}\"\ndisplay_name = \"{name}\"\norder = 1\n[storage]\nmode = \"encrypted_dir\"\n"
        ))
        .unwrap()
    }

    #[test]
    fn a_folder_inside_a_upriv_is_reserved() {
        let (_tmp, root) = vault_root_with(&[]);
        let inside = root.root().join(".upriv/vaults");
        assert_eq!(
            check_typed_backup_folder(&root, &inside, None),
            BackupFolderStatus::Reserved
        );
    }

    #[test]
    fn a_typed_check_for_a_vault_id_that_is_no_folder_name_probes_nothing() {
        let (tmp, root) = vault_root_with(&[]);
        let drive = tmp.path().join("drive");
        crate::host_fs::create_dir_all(&drive).unwrap();
        assert_eq!(
            check_typed_backup_folder(&root, &drive, Some("../escape")),
            BackupFolderStatus::Other
        );
        assert_eq!(crate::host_fs::read_dir(&drive).unwrap().count(), 0);
    }

    #[test]
    fn a_backup_folder_inside_a_vaults_file_folder_is_refused_both_ways() {
        let (tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            encrypted("notes", "Notes"),
            b"pass-word-ok",
            crate::store::KdfUnlockPreset::M32,
        )
        .unwrap();
        let files = tmp.path().join("files");
        crate::host_fs::create_dir_all(&files).unwrap();

        // The vault's own file manager folder is `{files}/Notes`.
        let mut mounted = encrypted("notes", "Notes");
        mounted.mount.row_mut(WorkspaceSystem::current()).path =
            files.to_string_lossy().into_owned();
        crate::config::save_vault_config(root.vault_dir("notes").unwrap(), &mounted).unwrap();
        assert_eq!(
            check_typed_backup_folder(&root, &files.join("Notes"), None),
            BackupFolderStatus::Reserved
        );

        let mut backing_up = mounted.clone();
        let inside = VaultBackupFolderRow {
            place: VaultBackupPlace::Custom,
            path: files.join("Notes").to_string_lossy().into_owned(),
        };
        backing_up.backup.linux = inside.clone();
        backing_up.backup.windows = inside.clone();
        backing_up.backup.macos = inside;
        assert!(matches!(
            refuse_vault_backup_overlap(&root, "notes", &backing_up),
            Err(UprivError::WorkspacePathReserved(_))
        ));

        let elsewhere = VaultBackupFolderRow {
            place: VaultBackupPlace::Custom,
            path: tmp.path().join("drive").to_string_lossy().into_owned(),
        };
        backing_up.backup.linux = elsewhere.clone();
        backing_up.backup.windows = elsewhere.clone();
        backing_up.backup.macos = elsewhere;
        refuse_vault_backup_overlap(&root, "notes", &backing_up).unwrap();
    }

    #[test]
    fn a_new_file_folder_may_not_contain_a_backup_folder() {
        let (tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            encrypted("notes", "Notes"),
            b"pass-word-ok",
            crate::store::KdfUnlockPreset::M32,
        )
        .unwrap();
        let drive = tmp.path().join("drive");
        let row = VaultBackupFolderRow {
            place: VaultBackupPlace::Custom,
            path: drive.join("Notes").to_string_lossy().into_owned(),
        };
        let mut config = encrypted("notes", "Notes");
        config.backup.linux = row.clone();
        config.backup.windows = row.clone();
        config.backup.macos = row;
        crate::config::save_vault_config(root.vault_dir("notes").unwrap(), &config).unwrap();

        let mut moved = config.clone();
        moved.mount.row_mut(WorkspaceSystem::current()).path = drive.to_string_lossy().into_owned();
        assert!(matches!(
            refuse_vault_backup_overlap(&root, "notes", &moved),
            Err(UprivError::WorkspacePathReserved(_))
        ));
    }
}
