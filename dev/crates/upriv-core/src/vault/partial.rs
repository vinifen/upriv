//! The unfinished file a write leaves when it stops or fails: an export's
//! `.upriv-part`, a backup's `.partial`, or the data-folder zip's
//! `.zip.upriv-part`. It is removed, and the log says whether that worked, so
//! a file left behind is always on record. A plain-text export holds readable
//! vault files, so its partial is overwritten first, on a thread of its own
//! ([`wipe_partial_behind`]), so the stop that left it answers at once. No
//! path goes to the log.

use std::collections::HashSet;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Condvar, LazyLock, Mutex};

use crate::error::UprivError;
use crate::logging::{log_event, LogLevel};
use crate::paths::VaultRoot;
use crate::session::lock_table;

use super::unfinished::forget_file;
use super::wipe::{wipe_file_then_unlink, WipeOptions};
use crate::failure::classify_write_failure;

/// Plaintext partials being overwritten off the thread that left them.
static WIPING: LazyLock<(Mutex<HashSet<PathBuf>>, Condvar)> =
    LazyLock::new(|| (Mutex::new(HashSet::new()), Condvar::new()));

/// Overwrite and remove the unfinished plaintext file at `path`, then forget
/// its record in `state.json`, on a thread of its own: the stop or the sweep
/// that found it answers at once. The record stays until the file is gone, so
/// a crash or Close now before then leaves it to the next launch; a normal
/// quit waits ([`wait_for_partial_wipes`]). A file in a
/// picked storage-access folder is wiped here, while that folder is mounted.
pub(super) fn wipe_partial_behind(
    root: &VaultRoot,
    path: &Path,
    work: PartialWork,
    opts: WipeOptions,
) {
    if crate::host_fs::export_tree_uri(path).is_some() {
        return wipe_and_forget(root, path, work, &opts);
    }
    let Some(mark) = WipingMark::enter(path) else {
        // Already on its way out.
        return;
    };
    let behind = {
        let root = root.clone();
        let path = path.to_path_buf();
        move || {
            wipe_and_forget(&root, &path, work, &opts);
            drop(mark);
        }
    };
    if std::thread::Builder::new()
        .name("upriv-wipe".into())
        .spawn(behind)
        .is_err()
    {
        // No thread to spare: the wipe runs here.
        if let Some(_mark) = WipingMark::enter(path) {
            wipe_and_forget(root, path, work, &opts);
        }
    }
}

fn wipe_and_forget(root: &VaultRoot, path: &Path, work: PartialWork, opts: &WipeOptions) {
    if wipe_partial(path, work, opts) {
        forget_file(root, path);
    }
}

/// The mark [`wipe_partial_behind`] keeps on a path while it wipes it, taken
/// off when dropped: also when the wipe panicked, so a quit never waits for a
/// wipe that is over.
struct WipingMark(PathBuf);

impl WipingMark {
    /// `None` while that path is already being wiped.
    fn enter(path: &Path) -> Option<Self> {
        lock_table(&WIPING.0)
            .insert(path.to_path_buf())
            .then(|| Self(path.to_path_buf()))
    }
}

impl Drop for WipingMark {
    fn drop(&mut self) {
        let (wiping, done) = &*WIPING;
        lock_table(wiping).remove(&self.0);
        done.notify_all();
    }
}

/// True while [`wipe_partial_behind`] works on `path`.
pub(super) fn is_wiping(path: &Path) -> bool {
    lock_table(&WIPING.0).contains(path)
}

/// Wait until every [`wipe_partial_behind`] has finished, or until
/// [`hurry_partial_wipes`]. A normal quit (`app_shutdown`) and the desktop
/// core's exit call this, so a normal quit leaves no readable bytes behind
/// that a wipe had begun. Close now does not wait for it: what the wipe has
/// not reached keeps its record for the next launch.
pub fn wait_for_partial_wipes() {
    wait_for_wipes_unless(&WIPES_HURRIED);
}

fn wait_for_wipes_unless(hurried: &AtomicBool) {
    let (wiping, done) = &*WIPING;
    let mut pending = lock_table(wiping);
    while !pending.is_empty() && !hurried.load(Ordering::Relaxed) {
        pending = done
            .wait(pending)
            .unwrap_or_else(std::sync::PoisonError::into_inner);
    }
}

/// Set once Close now asks the quit not to wait for wipes; it never clears,
/// because the process is about to exit.
static WIPES_HURRIED: AtomicBool = AtomicBool::new(false);

/// Close now: end every [`wait_for_partial_wipes`], now and later. The wipes
/// go on until the process exits, and their records stay for the next launch.
pub fn hurry_partial_wipes() {
    hurry_wipes(&WIPES_HURRIED);
}

fn hurry_wipes(hurried: &AtomicBool) {
    hurried.store(true, Ordering::Relaxed);
    let (wiping, done) = &*WIPING;
    // Under the lock, so a waiter between its check and its wait still wakes.
    let _held = lock_table(wiping);
    done.notify_all();
}

/// What was writing the unfinished file, as the log names it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PartialWork {
    /// A vault `.zip`, `.7z`, or plain-text `.zip` export.
    VaultExport,
    /// Back up now.
    BackupSave,
    /// The backup a close or a password / unlock-RAM change writes.
    Backup,
    /// A copy of backup zips into a chosen folder.
    BackupExport,
    /// The zip of the whole data folder.
    DataFolderExport,
}

impl PartialWork {
    pub fn as_str(self) -> &'static str {
        match self {
            PartialWork::VaultExport => "vault_export",
            PartialWork::BackupSave => "backup_save",
            PartialWork::Backup => "backup",
            PartialWork::BackupExport => "backup_export",
            PartialWork::DataFolderExport => "data_folder_export",
        }
    }
}

/// Remove the unfinished file at `path` and log the outcome. A file that is
/// already gone needs nothing and logs nothing. Returns false while the file is
/// still there.
pub fn discard_partial(path: &Path, work: PartialWork) -> bool {
    match crate::host_fs::remove_file(path) {
        Ok(()) => {
            log_event(
                LogLevel::Info,
                "partial_removed",
                &[("work", work.as_str())],
            );
            true
        }
        Err(error) if error.kind() == ErrorKind::NotFound => true,
        Err(error) => {
            log_partial_failure("partial_remove_failed", work, error);
            false
        }
    }
}

/// Overwrite the unfinished plaintext file at `path`, remove it, and log the
/// outcome. A file the overwrite could not reach still loses its name. Returns
/// false while the file is still there, so a later launch can try again.
pub fn wipe_partial(path: &Path, work: PartialWork, opts: &WipeOptions) -> bool {
    match wipe_file_then_unlink(path, opts) {
        Ok(()) => {
            log_event(LogLevel::Info, "partial_wiped", &[("work", work.as_str())]);
            true
        }
        Err(error) if error.kind() == ErrorKind::NotFound => true,
        Err(error) => {
            log_partial_failure("partial_wipe_failed", work, error);
            match crate::host_fs::remove_file(path) {
                Ok(()) => true,
                Err(error) if error.kind() == ErrorKind::NotFound => true,
                Err(error) => {
                    log_partial_failure("partial_remove_failed", work, error);
                    false
                }
            }
        }
    }
}

fn log_partial_failure(event: &str, work: PartialWork, error: std::io::Error) {
    let class = classify_write_failure(&UprivError::Io(error));
    let os = class.os.map(|code| code.to_string());
    let mut fields = vec![
        ("work", work.as_str()),
        ("reason", class.reason),
        ("kind", class.kind),
    ];
    if let Some(code) = os.as_deref() {
        fields.push(("os", code));
    }
    log_event(LogLevel::Warn, event, &fields);
}

#[cfg(test)]
mod tests {
    use super::*;
    #[allow(unused_imports)]
    use crate::host_fs::HostFsQuery;

    #[test]
    fn removes_the_file_and_leaves_a_missing_one_alone() {
        let dir = tempfile::tempdir().unwrap();
        let partial = dir.path().join("Notes.zip.upriv-part");
        crate::host_fs::write(&partial, b"half").unwrap();
        discard_partial(&partial, PartialWork::VaultExport);
        assert!(!partial.host_exists());
        discard_partial(&partial, PartialWork::VaultExport);
        assert!(!partial.host_exists());
    }

    #[test]
    fn a_wipe_overwrites_the_file_before_its_name_goes() {
        use crate::config::vault_config::VaultWipePattern;
        let opts = WipeOptions {
            passes: 1,
            pattern: VaultWipePattern::Zeros,
        };
        let dir = tempfile::tempdir().unwrap();
        let partial = dir.path().join("Notes plain text.zip.upriv-part");
        crate::host_fs::write(&partial, b"readable vault file").unwrap();
        // A second name keeps the bytes readable after the first one goes.
        let second = dir.path().join("second-name");
        std::fs::hard_link(&partial, &second).unwrap();
        assert!(wipe_partial(&partial, PartialWork::VaultExport, &opts));
        assert!(!partial.host_exists());
        assert_eq!(crate::host_fs::read(&second).unwrap(), vec![0u8; 19]);
        assert!(wipe_partial(&partial, PartialWork::VaultExport, &opts));
    }

    #[test]
    fn a_wipe_that_panicked_is_no_longer_waited_for() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Notes-plain-text.zip.upriv-part");
        let marked = path.clone();
        let panicked = std::thread::spawn(move || {
            let _mark = WipingMark::enter(&marked).unwrap();
            assert!(WipingMark::enter(&marked).is_none());
            panic!("the wipe went wrong");
        })
        .join();
        assert!(panicked.is_err());
        assert!(!is_wiping(&path));
        wait_for_partial_wipes();
    }

    #[test]
    fn close_now_ends_the_wait_for_a_wipe_still_running() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Notes-plain-text.zip.upriv-part");
        let mark = WipingMark::enter(&path).unwrap();
        let hurried = std::sync::Arc::new(AtomicBool::new(false));
        let waiter = {
            let hurried = std::sync::Arc::clone(&hurried);
            std::thread::spawn(move || wait_for_wipes_unless(&hurried))
        };
        hurry_wipes(&hurried);
        waiter.join().unwrap();
        assert!(is_wiping(&path));
        drop(mark);
    }

    #[cfg(unix)]
    #[test]
    fn a_file_that_cannot_be_removed_stays() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let partial = dir.path().join("Notes.zip.upriv-part");
        crate::host_fs::write(&partial, b"half").unwrap();
        let locked = std::fs::Permissions::from_mode(0o500);
        std::fs::set_permissions(dir.path(), locked).unwrap();
        discard_partial(&partial, PartialWork::VaultExport);
        let still_there = partial.host_exists();
        std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        // Root removes it anyway; anyone else keeps the file and gets a warning line.
        if !running_as_root() {
            assert!(still_there);
        }
    }

    #[cfg(unix)]
    fn running_as_root() -> bool {
        // SAFETY: `geteuid` has no preconditions.
        unsafe { libc::geteuid() == 0 }
    }
}
