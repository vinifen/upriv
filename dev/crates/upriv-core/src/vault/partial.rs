//! The unfinished file a write leaves when it stops or fails: an export's
//! `.upriv-part`, a backup's `.partial`, or the data-folder zip's
//! `.zip.upriv-part`. It is removed, and the log says whether that worked, so
//! a file left behind is always on record. A plain-text export holds readable
//! vault files, so its partial is overwritten first. No path goes to the log.

use std::io::ErrorKind;
use std::path::Path;

use crate::error::UprivError;
use crate::logging::{log_event, LogLevel};

use super::backup::classify_write_failure;
use super::wipe::{wipe_file_then_unlink, WipeOptions};

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
/// already gone needs nothing and logs nothing.
pub fn discard_partial(path: &Path, work: PartialWork) {
    match crate::host_fs::remove_file(path) {
        Ok(()) => log_event(
            LogLevel::Info,
            "partial_removed",
            &[("work", work.as_str())],
        ),
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(error) => log_partial_failure("partial_remove_failed", work, error),
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
