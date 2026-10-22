//! Windows Explorer rules for a vault folder.
//!
//! The folder is a directory the user chose, so the volume is `WinFsp.Disk`.
//! `WinFsp.Net` cannot mount on a directory: Windows only allows a drive letter
//! for a network file system. A disk mount would normally let Explorer build
//! content thumbnails, so file nodes report `FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS`.
//! That tells the shell that reading bytes is a fetch, and Explorer does not
//! open the file to draw a preview.
//!
//! `%LocalAppData%\Microsoft\Windows\Explorer\thumbcache_*.db` is not a
//! per-folder cache. Entries are hash keys, and Explorer keeps the databases
//! open. Deleting those files would wipe every thumbnail on the machine, so
//! this module never opens them. `Thumbs.db` (written inside the folder by
//! older Windows) is refused and is not stored in the vault.

/// Device name passed to `FspFileSystemCreate` for a directory mount.
pub fn disk_device_name() -> &'static str {
    "WinFsp.Disk"
}

/// `FILE_ATTRIBUTE_DIRECTORY`.
pub const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x0000_0010;
/// `FILE_ATTRIBUTE_ARCHIVE`. Combined with other attributes; not `NORMAL`.
pub const FILE_ATTRIBUTE_ARCHIVE: u32 = 0x0000_0020;
/// Shell must not read the file just to draw a thumbnail.
pub const FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS: u32 = 0x0040_0000;

/// 100-nanosecond ticks from 1601-01-01 to 1970-01-01.
const WINDOWS_UNIX_EPOCH_100NS: u64 = 116_444_736_000_000_000;

/// Why a Windows file name cannot be created on the mount.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RejectedName {
    ThumbnailCache,
    ReservedDevice,
    Invalid,
}

/// Attributes reported for a vault node.
///
/// Directories stay ordinary directories so Explorer can list them. Files
/// carry the recall attribute so a thumbnail handler does not read them.
pub fn reported_attributes(is_dir: bool) -> u32 {
    if is_dir {
        FILE_ATTRIBUTE_DIRECTORY
    } else {
        FILE_ATTRIBUTE_ARCHIVE | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS
    }
}

/// `Thumbs.db` in any case. Explorer writes this inside a folder.
pub fn is_explorer_thumbnail_name(name: &str) -> bool {
    name.eq_ignore_ascii_case("thumbs.db")
}

/// Final path component that must not be created or renamed onto.
pub fn rejected_file_name(name: &str) -> Option<RejectedName> {
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.ends_with('.')
        || name.ends_with(' ')
        || name.contains(':')
        || name.contains('/')
        || name.contains('\\')
        || name.contains('\0')
        || name.chars().any(|ch| ch.is_control())
    {
        return Some(RejectedName::Invalid);
    }
    if is_explorer_thumbnail_name(name) {
        return Some(RejectedName::ThumbnailCache);
    }
    if crate::paths::is_windows_reserved_device_name(name) {
        return Some(RejectedName::ReservedDevice);
    }
    None
}

/// Stored logical path whose ASCII case matches `logical`, if one exists.
pub fn resolve_stored_case<'a>(
    stored: impl IntoIterator<Item = &'a str>,
    logical: &str,
) -> Option<&'a str> {
    stored
        .into_iter()
        .find(|path| path.eq_ignore_ascii_case(logical))
}

/// NT path (`\Docs\A.txt`, or `\` for the root) to a vault logical path.
///
/// `Thumbs.db` and reserved device names parse. Create and rename refuse them.
pub fn nt_to_logical(raw: &str) -> Result<String, RejectedName> {
    let trimmed = raw.trim_matches('\\');
    if trimmed.is_empty() {
        return Ok(String::new());
    }
    let mut parts = Vec::new();
    for part in trimmed.split('\\') {
        if part.is_empty()
            || part == "."
            || part == ".."
            || part.contains(':')
            || part.contains('/')
            || part.contains('\0')
        {
            return Err(RejectedName::Invalid);
        }
        parts.push(part);
    }
    Ok(parts.join("/"))
}

/// Path stored on an open handle after `from` was renamed to `to`.
///
/// The renamed node and everything under it move. Other open handles stay.
pub fn renamed_open_path(path: &str, from: &str, to: &str) -> String {
    if from.is_empty() {
        return path.to_string();
    }
    if path == from {
        return to.to_string();
    }
    let prefix = format!("{from}/");
    if let Some(rest) = path.strip_prefix(&prefix) {
        if to.is_empty() {
            rest.to_string()
        } else {
            format!("{to}/{rest}")
        }
    } else {
        path.to_string()
    }
}

/// Unix milliseconds to a Windows `FILETIME` count.
pub fn filetime_from_unix_millis(ms: u64) -> u64 {
    ms.saturating_mul(10_000)
        .saturating_add(WINDOWS_UNIX_EPOCH_100NS)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Logical path (`Docs/A.txt`, or empty for the root) to the NT path
    /// Windows sends back into [`nt_to_logical`].
    fn logical_to_nt(logical: &str) -> String {
        if logical.is_empty() {
            return "\\".to_string();
        }
        let mut out = String::from("\\");
        out.push_str(&logical.replace('/', "\\"));
        out
    }

    /// Inverse of [`filetime_from_unix_millis`], to check the round trip.
    fn unix_millis_from_filetime(filetime: u64) -> Option<u64> {
        let ticks = filetime.checked_sub(WINDOWS_UNIX_EPOCH_100NS)?;
        Some(ticks / 10_000)
    }

    #[test]
    fn directory_mount_uses_the_disk_device() {
        assert_eq!(disk_device_name(), "WinFsp.Disk");
        assert!(!disk_device_name().contains('\\'));
    }

    #[test]
    fn files_ask_the_shell_not_to_preview_them() {
        let file = reported_attributes(false);
        let dir = reported_attributes(true);
        assert_eq!(
            file & FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS,
            FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS
        );
        assert_eq!(file & FILE_ATTRIBUTE_DIRECTORY, 0);
        assert_eq!(dir, FILE_ATTRIBUTE_DIRECTORY);
        assert_eq!(dir & FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS, 0);
    }

    #[test]
    fn thumbs_db_is_refused_in_any_case() {
        assert_eq!(
            rejected_file_name("Thumbs.db"),
            Some(RejectedName::ThumbnailCache)
        );
        assert_eq!(
            rejected_file_name("thumbs.db"),
            Some(RejectedName::ThumbnailCache)
        );
        assert_eq!(
            rejected_file_name("THUMBS.DB"),
            Some(RejectedName::ThumbnailCache)
        );
        assert_eq!(rejected_file_name("notes.txt"), None);
    }

    #[test]
    fn reserved_device_names_and_streams_are_refused() {
        assert_eq!(
            rejected_file_name("CON"),
            Some(RejectedName::ReservedDevice)
        );
        assert_eq!(
            rejected_file_name("nul.txt"),
            Some(RejectedName::ReservedDevice)
        );
        assert_eq!(
            rejected_file_name("file:stream"),
            Some(RejectedName::Invalid)
        );
        assert_eq!(rejected_file_name("trail."), Some(RejectedName::Invalid));
        assert_eq!(rejected_file_name(".."), Some(RejectedName::Invalid));
    }

    #[test]
    fn nt_paths_become_logical_paths() {
        assert_eq!(nt_to_logical(r"\").as_deref(), Ok(""));
        assert_eq!(nt_to_logical(r"\Docs\A.txt").as_deref(), Ok("Docs/A.txt"));
        assert_eq!(nt_to_logical(r"Docs\A.txt").as_deref(), Ok("Docs/A.txt"));
        assert_eq!(nt_to_logical(r"\Docs\..\A.txt"), Err(RejectedName::Invalid));
        assert_eq!(
            nt_to_logical(r"\file:Zone.Identifier"),
            Err(RejectedName::Invalid)
        );
        assert_eq!(logical_to_nt("Docs/A.txt"), r"\Docs\A.txt");
        assert_eq!(logical_to_nt(""), r"\");
    }

    #[test]
    fn thumbs_db_path_parses_so_create_can_refuse_it() {
        assert_eq!(nt_to_logical(r"\Thumbs.db").as_deref(), Ok("Thumbs.db"));
        assert!(is_explorer_thumbnail_name(
            nt_to_logical(r"\Photos\Thumbs.db")
                .unwrap()
                .rsplit('/')
                .next()
                .unwrap()
        ));
    }

    #[test]
    fn stored_case_wins_over_the_name_windows_sent() {
        let stored = ["Docs/A.txt", "other.bin"];
        assert_eq!(
            resolve_stored_case(stored, "docs/a.txt"),
            Some("Docs/A.txt")
        );
        assert_eq!(resolve_stored_case(stored, "missing"), None);
    }

    #[test]
    fn rename_rewrites_the_open_handle_and_its_children() {
        assert_eq!(renamed_open_path("docs", "docs", "inbox"), "inbox");
        assert_eq!(
            renamed_open_path("docs/a.txt", "docs", "inbox"),
            "inbox/a.txt"
        );
        assert_eq!(renamed_open_path("other.txt", "docs", "inbox"), "other.txt");
        assert_eq!(renamed_open_path("docs", "", "inbox"), "docs");
    }

    #[test]
    fn filetime_round_trip_uses_the_windows_epoch() {
        assert_eq!(filetime_from_unix_millis(0), WINDOWS_UNIX_EPOCH_100NS);
        assert_eq!(
            unix_millis_from_filetime(filetime_from_unix_millis(1_500)),
            Some(1_500)
        );
    }
}
