//! Time-limited checks of the folders in the lists: whether a folder answers,
//! can be written, and has room.
//!
//! A folder can be a drive that is unplugged, full, read-only, or a network
//! share that stopped answering. A check tells these apart without holding
//! up its caller for long: each runs on a thread of its own, and a folder
//! that stopped answering costs that one thread however many callers ask.

#[allow(unused_imports)]
use crate::host_fs::HostFsQuery;
use std::any::Any;
use std::collections::HashMap;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, LazyLock, Mutex, PoisonError};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::error::UprivError;
use crate::failure::{classify_write_failure, io_is_disk_full, io_is_permission};
use crate::session::lock_table;

/// How long the check behind a row's status may take. Only the check: the
/// work that follows has no limit.
pub const FOLDER_STATUS_CHECK_LIMIT: Duration = Duration::from_secs(5);
/// How long a check that decides a switch may take: a slow drive gets more
/// time before Upriv leaves it.
pub const FOLDER_SWITCH_CHECK_LIMIT: Duration = Duration::from_secs(30);

const PROBE_FILE_BYTES: usize = 4096;
/// Prefix of the file a check writes and removes again.
pub const PROBE_FILE_PREFIX: &str = ".upriv-check-";

/// What a folder can do right now. Every state but `Ok` is a failure of the
/// folder itself, the kind that hands a selection over.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FolderState {
    Ok,
    /// The folder, or the part of it Upriv uses, is gone.
    Missing,
    NotResponding,
    NoPermission,
    NoRoom,
    /// What Upriv writes is larger than this file system allows for one file.
    FileTooLarge,
    /// This file system cannot hold what Upriv puts there (an encrypted
    /// vault's unlocked folder on exFAT or FAT under Windows).
    Unsupported,
    /// Names of the vault's files this file system cannot hold.
    NamesUnsupported,
    /// A path the list's rules refuse.
    Refused,
    Other,
}

impl FolderState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ok => "ok",
            Self::Missing => "missing",
            Self::NotResponding => "not_responding",
            Self::NoPermission => "no_permission",
            Self::NoRoom => "no_room",
            Self::FileTooLarge => "file_too_large",
            Self::Unsupported => "unsupported",
            Self::NamesUnsupported => "names_unsupported",
            Self::Refused => "refused",
            Self::Other => "other",
        }
    }

    pub fn is_ok(self) -> bool {
        self == Self::Ok
    }

    /// Why a write into the folder failed.
    pub fn of_failure(error: &UprivError) -> Self {
        match error {
            UprivError::Io(io) => Self::of_io(io),
            UprivError::PlainSpaceShort { .. } => Self::NoRoom,
            UprivError::PlainNamesUnsupported { .. } => Self::NamesUnsupported,
            UprivError::MountFilesystemUnsupported(_) => Self::Unsupported,
            UprivError::FolderPathRefused { .. } => Self::Refused,
            other => {
                let class = classify_write_failure(other);
                match class.reason {
                    "disk_full" => Self::NoRoom,
                    "permission" => Self::NoPermission,
                    _ if class.os.is_some_and(is_file_too_large_code) => Self::FileTooLarge,
                    _ => Self::Other,
                }
            }
        }
    }

    pub fn of_io(error: &std::io::Error) -> Self {
        if io_is_disk_full(error) {
            Self::NoRoom
        } else if io_is_permission(error) {
            Self::NoPermission
        } else if error.kind() == ErrorKind::NotFound || crate::host_fs::is_unreachable(error) {
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
pub(crate) fn flush_is_unsupported(error: &std::io::Error) -> bool {
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

/// Whether `dir` is a folder that takes a write. A permission check alone is
/// not enough: this makes, writes, flushes, renames, and deletes a small
/// file, the steps Upriv's own writes take.
pub fn probe_writable(dir: &Path) -> FolderState {
    match crate::host_fs::entry_kind(dir) {
        Ok(crate::host_fs::EntryKind::Dir) => {}
        Ok(_) => return FolderState::Missing,
        Err(error) => return FolderState::of_io(&error),
    }
    match write_probe_file(dir) {
        Ok(()) => FolderState::Ok,
        Err(error) => FolderState::of_io(&error),
    }
}

fn write_probe_file(dir: &Path) -> std::io::Result<()> {
    let unique: u64 = rand::random();
    let probe = dir.join(format!("{PROBE_FILE_PREFIX}{unique:016x}"));
    let renamed = dir.join(format!("{PROBE_FILE_PREFIX}{unique:016x}.done"));
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

/// Whether a file of `bytes` fits in `dir` now: free space, and the largest
/// file its file system holds.
pub fn room_for(dir: &Path, bytes: u64) -> FolderState {
    if crate::host_fs::free_bytes(dir).is_some_and(|free| free < bytes) {
        return FolderState::NoRoom;
    }
    if file_size_limit(dir).is_some_and(|limit| bytes > limit) {
        return FolderState::FileTooLarge;
    }
    FolderState::Ok
}

/// FAT32 holds no file of 4 GiB or more. `None` when this file system has no
/// such limit, or its type cannot be read; a write past a limit still fails
/// with the same reason.
pub(crate) fn file_size_limit(path: &Path) -> Option<u64> {
    is_fat32(path).then_some(u64::from(u32::MAX))
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn is_fat32(path: &Path) -> bool {
    use std::os::unix::ffi::OsStrExt;
    /// `MSDOS_SUPER_MAGIC`.
    const FAT_MAGIC: i64 = 0x4d44;
    if crate::host_fs::is_bridge_path(path) {
        return false;
    }
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
    file_system_name(path).is_some_and(|name| name == "FAT32" || name == "FAT")
}

/// The file system of the volume that holds `path` (`NTFS`, `exFAT`, …).
#[cfg(windows)]
pub(crate) fn file_system_name(path: &Path) -> Option<String> {
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
        return None;
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
        return None;
    }
    let end = fs_name
        .iter()
        .position(|unit| *unit == 0)
        .unwrap_or(fs_name.len());
    Some(String::from_utf16_lossy(&fs_name[..end]))
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

/// Whether an encrypted vault's unlocked folder can live on the file system
/// of `path`. Only Windows refuses some: exFAT and FAT hold no directory
/// junction, which WinFsp mounts as.
pub fn holds_unlocked_mount(path: &Path) -> bool {
    #[cfg(windows)]
    {
        !file_system_name(path)
            .is_some_and(|name| name.eq_ignore_ascii_case("exFAT") || name.starts_with("FAT"))
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        true
    }
}

/// One check in flight, shared by everyone asking the same about a folder.
struct Probe {
    kind: &'static str,
    started: Instant,
    result: Mutex<Option<Arc<dyn Any + Send + Sync>>>,
    done: Condvar,
}

type ProbeKey = (PathBuf, &'static str);

static PROBES: LazyLock<Mutex<HashMap<ProbeKey, Arc<Probe>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Takes a finished check off the table, also when it panicked.
struct ProbeSlot(ProbeKey);

impl Drop for ProbeSlot {
    fn drop(&mut self) {
        lock_table(&PROBES).remove(&self.0);
    }
}

/// Run `work` on a thread of its own and wait at most `limit`; `None` when
/// the folder did not answer in time.
///
/// `kind` names what `work` checks, and each kind always returns the same
/// `T`. A second caller asking the same kind about the same folder joins the
/// check already running. A folder with any check stuck past `limit` gets no
/// new thread: a folder that stopped answering holds one thread, not one per
/// question.
pub fn within_limit<T>(
    folder: &Path,
    kind: &'static str,
    limit: Duration,
    work: impl FnOnce() -> T + Send + 'static,
) -> Option<T>
where
    T: Clone + Send + Sync + 'static,
{
    let key = (folder.to_path_buf(), kind);
    let (probe, is_first) = {
        let mut probes = lock_table(&PROBES);
        if let Some(running) = probes.get(&key) {
            (Arc::clone(running), false)
        } else {
            let stuck = probes
                .iter()
                .any(|((path, _), probe)| path == folder && probe.started.elapsed() >= limit);
            if stuck {
                return None;
            }
            let started = Arc::new(Probe {
                kind,
                started: Instant::now(),
                result: Mutex::new(None),
                done: Condvar::new(),
            });
            probes.insert(key.clone(), Arc::clone(&started));
            (started, true)
        }
    };
    if is_first {
        let running = Arc::clone(&probe);
        let slot = ProbeSlot(key);
        let spawned = std::thread::Builder::new()
            .name(format!("upriv-check-{}", probe.kind))
            .spawn(move || {
                let value = work();
                drop(slot);
                *lock_table(&running.result) = Some(Arc::new(value));
                running.done.notify_all();
            });
        // A thread that cannot start drops its slot, which clears the table.
        if spawned.is_err() {
            return None;
        }
    }
    let remaining = limit.saturating_sub(probe.started.elapsed());
    let result = lock_table(&probe.result);
    let (result, _) = probe
        .done
        .wait_timeout_while(result, remaining, |value| value.is_none())
        .unwrap_or_else(PoisonError::into_inner);
    result
        .as_ref()
        .and_then(|value| value.downcast_ref::<T>().cloned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn a_writable_folder_is_ok_and_keeps_no_probe_file() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(probe_writable(tmp.path()), FolderState::Ok);
        assert_eq!(crate::host_fs::read_dir(tmp.path()).unwrap().count(), 0);
    }

    #[test]
    fn a_folder_that_is_gone_is_missing_and_never_made() {
        let tmp = tempfile::tempdir().unwrap();
        let gone = tmp.path().join("unplugged");
        assert_eq!(probe_writable(&gone), FolderState::Missing);
        assert!(!gone.host_exists());
    }

    #[test]
    fn a_file_where_a_folder_should_be_is_missing() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("file");
        std::fs::write(&file, b"x").unwrap();
        assert_eq!(probe_writable(&file), FolderState::Missing);
    }

    #[cfg(unix)]
    #[test]
    fn a_read_only_folder_reports_no_permission() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempfile::tempdir().unwrap();
        std::fs::set_permissions(tmp.path(), std::fs::Permissions::from_mode(0o500)).unwrap();
        let state = probe_writable(tmp.path());
        std::fs::set_permissions(tmp.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        if unsafe { libc::geteuid() } == 0 {
            return;
        }
        assert_eq!(state, FolderState::NoPermission);
    }

    #[test]
    fn a_file_larger_than_the_free_space_has_no_room() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(room_for(tmp.path(), u64::MAX), FolderState::NoRoom);
        assert_eq!(room_for(tmp.path(), 1), FolderState::Ok);
    }

    #[test]
    fn a_read_only_error_is_a_permission_problem() {
        let error = std::io::Error::from(ErrorKind::ReadOnlyFilesystem);
        assert_eq!(FolderState::of_io(&error), FolderState::NoPermission);
    }

    #[test]
    fn a_folder_that_does_not_answer_costs_one_thread() {
        let tmp = tempfile::tempdir().unwrap();
        let key = tmp.path().join("stuck");
        let runs = Arc::new(AtomicUsize::new(0));
        let (release, wait) = std::sync::mpsc::channel::<()>();
        let counted = Arc::clone(&runs);
        let first = within_limit(&key, "test", Duration::from_millis(30), move || {
            counted.fetch_add(1, Ordering::SeqCst);
            let _ = wait.recv();
            FolderState::Ok
        });
        assert_eq!(first, None);

        let counted = Arc::clone(&runs);
        let again = within_limit(&key, "test", Duration::from_millis(30), move || {
            counted.fetch_add(1, Ordering::SeqCst);
            FolderState::Ok
        });
        assert_eq!(again, None);
        let counted = Arc::clone(&runs);
        let other_kind = within_limit(&key, "other", Duration::from_millis(30), move || {
            counted.fetch_add(1, Ordering::SeqCst);
            7u32
        });
        assert_eq!(other_kind, None);
        assert_eq!(runs.load(Ordering::SeqCst), 1, "no second thread");

        release.send(()).unwrap();
        for _ in 0..200 {
            if !lock_table(&PROBES).keys().any(|(path, _)| path == &key) {
                break;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        let later = within_limit(&key, "test", Duration::from_secs(2), || FolderState::Ok);
        assert_eq!(later, Some(FolderState::Ok));
    }
}
