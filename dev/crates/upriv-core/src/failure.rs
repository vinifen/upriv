//! Why a write failed, for the log, without a filesystem path.

use std::io::ErrorKind;

use crate::error::UprivError;

/// `reason` is `disk_full`, `permission`, or `other`. `kind` names the error
/// (`io`, `store`, `config`, `path`, `other`). `os` is the raw code when one exists.
pub(crate) struct WriteFailureClass {
    pub reason: &'static str,
    pub kind: &'static str,
    pub os: Option<i32>,
}

/// Why a job, a backup, or a file removal failed.
pub(crate) fn classify_write_failure(error: &UprivError) -> WriteFailureClass {
    let kind = match error {
        UprivError::Io(_) => "io",
        UprivError::VaultStoreInvalid { .. } => "store",
        UprivError::VaultConfigInvalid { .. } => "config",
        UprivError::VaultPathNotFound(_) => "path",
        _ => "other",
    };
    let reason = if failure_is_disk_full(error) {
        "disk_full"
    } else if failure_is_permission(error) {
        "permission"
    } else {
        "other"
    };
    WriteFailureClass {
        reason,
        kind,
        os: failure_os_code(error),
    }
}

fn failure_is_disk_full(error: &UprivError) -> bool {
    match error {
        UprivError::Io(io) => io_is_disk_full(io),
        UprivError::VaultStoreInvalid { detail, .. } => text_is_disk_full(detail),
        _ => false,
    }
}

fn failure_is_permission(error: &UprivError) -> bool {
    match error {
        UprivError::Io(io) => io_is_permission(io),
        UprivError::VaultStoreInvalid { detail, .. } => text_is_permission(detail),
        _ => false,
    }
}

fn failure_os_code(error: &UprivError) -> Option<i32> {
    match error {
        UprivError::Io(io) => io.raw_os_error(),
        UprivError::VaultStoreInvalid { detail, .. } => os_code_in_text(detail),
        _ => None,
    }
}

/// This system's codes for a full disk. The same number means something else
/// on another system (Linux 39 is a folder that is not empty).
#[cfg(unix)]
const DISK_FULL_CODES: &[i32] = &[libc::ENOSPC];
/// `ERROR_HANDLE_DISK_FULL`, `ERROR_DISK_FULL`.
#[cfg(windows)]
const DISK_FULL_CODES: &[i32] = &[39, 112];
#[cfg(not(any(unix, windows)))]
const DISK_FULL_CODES: &[i32] = &[];

#[cfg(unix)]
const PERMISSION_CODES: &[i32] = &[libc::EACCES, libc::EPERM];
/// `ERROR_ACCESS_DENIED`.
#[cfg(windows)]
const PERMISSION_CODES: &[i32] = &[5];
#[cfg(not(any(unix, windows)))]
const PERMISSION_CODES: &[i32] = &[];

/// An error that only kept its text names the code as `os error N`.
fn text_names_code(detail: &str, codes: &[i32]) -> bool {
    os_code_in_text(detail).is_some_and(|code| codes.contains(&code))
}

fn io_is_disk_full(error: &std::io::Error) -> bool {
    error.kind() == ErrorKind::StorageFull || text_is_disk_full(&error.to_string())
}

fn io_is_permission(error: &std::io::Error) -> bool {
    error.kind() == ErrorKind::PermissionDenied || text_is_permission(&error.to_string())
}

fn text_is_disk_full(detail: &str) -> bool {
    let lower = detail.to_ascii_lowercase();
    lower.contains("no space left")
        || lower.contains("not enough space")
        || lower.contains("disk full")
        || text_names_code(&lower, DISK_FULL_CODES)
}

fn text_is_permission(detail: &str) -> bool {
    let lower = detail.to_ascii_lowercase();
    lower.contains("permission denied")
        || lower.contains("access is denied")
        || text_names_code(&lower, PERMISSION_CODES)
}

fn os_code_in_text(detail: &str) -> Option<i32> {
    let lower = detail.to_ascii_lowercase();
    let rest = lower.split("os error ").nth(1)?;
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(any(unix, windows))]
    #[test]
    fn classifies_a_full_disk_without_a_path() {
        let code = DISK_FULL_CODES[0];
        let io = UprivError::Io(std::io::Error::from_raw_os_error(code));
        let class = classify_write_failure(&io);
        assert_eq!(class.reason, "disk_full");
        assert_eq!(class.kind, "io");
        assert_eq!(class.os, Some(code));

        let wrapped = UprivError::VaultStoreInvalid {
            path: std::path::PathBuf::from("/secret/store/file"),
            detail: format!("write failed (os error {code})"),
        };
        let class = classify_write_failure(&wrapped);
        assert_eq!(class.reason, "disk_full");
        assert_eq!(class.kind, "store");
        assert_eq!(class.os, Some(code));
    }

    #[test]
    fn classifies_permission_and_leaves_other_failures_generic() {
        let denied = UprivError::Io(std::io::Error::from(std::io::ErrorKind::PermissionDenied));
        assert_eq!(classify_write_failure(&denied).reason, "permission");
        let other = UprivError::Io(std::io::Error::from(std::io::ErrorKind::AlreadyExists));
        let class = classify_write_failure(&other);
        assert_eq!(class.reason, "other");
        assert_eq!(class.kind, "io");
    }

    /// The same number is a different error on another system.
    #[cfg(target_os = "linux")]
    #[test]
    fn linux_codes_that_mean_something_else_on_windows_stay_generic() {
        for code in [libc::ENOTEMPTY, libc::EIO] {
            let io = UprivError::Io(std::io::Error::from_raw_os_error(code));
            assert_eq!(classify_write_failure(&io).reason, "other", "errno {code}");
            let wrapped = UprivError::VaultStoreInvalid {
                path: std::path::PathBuf::new(),
                detail: format!("failed (os error {code})"),
            };
            assert_eq!(
                classify_write_failure(&wrapped).reason,
                "other",
                "errno {code}"
            );
        }
        let longer = UprivError::VaultStoreInvalid {
            path: std::path::PathBuf::new(),
            detail: "failed (os error 130)".into(),
        };
        assert_eq!(classify_write_failure(&longer).reason, "other");
    }
}
