//! Copies and traces of a plaintext folder's files that the system and other
//! apps keep elsewhere, and what the vault does about each.
//!
//! While the vault is open:
//! - Linux and Android: `.nomedia` keeps media scanners and desktop search out.
//! - macOS: `.metadata_never_index` asks Spotlight to stay out, and the folder
//!   is excluded from Time Machine.
//! - Windows: the folder and each written file are marked not to be indexed,
//!   and the marker file is hidden.
//! - Linux: freedesktop thumbnails under the folder are wiped every two minutes.
//!
//! After close (and after a leftover folder is removed):
//! - Linux: thumbnails, Trash items, and recent-file entries from the folder
//!   are wiped or dropped.
//! - Windows: Recycle Bin items that came from the folder are wiped.
//!
//! Not reachable from here: Explorer's thumbnail database and recent-item
//! shortcuts on Windows, the Trash and recent items on macOS, and copies other
//! apps make on their own. The app tells the user about those.

use std::path::Path;

use super::disk::{self, Seen};
use super::sweep::{self, Visit};
use crate::store::VaultIndex;
use crate::vault::wipe::WipeOptions;

/// Helper files this system uses, minus names the vault holds at its top.
pub(super) fn helper_names(index: &VaultIndex) -> Vec<String> {
    let names: &[&str] = if cfg!(any(target_os = "linux", target_os = "android")) {
        &[".nomedia"]
    } else if cfg!(target_os = "macos") {
        &[".metadata_never_index"]
    } else {
        &[]
    };
    names
        .iter()
        .filter(|name| index.find(name).is_none())
        .map(|name| name.to_string())
        .collect()
}

/// Write the helper files and the folder-wide exclusions. Best effort: a
/// system that refuses one still gets the vault's files.
pub(super) fn protect_folder(folder: &Path, helpers: &[String]) {
    for name in helpers {
        let mut opts = crate::host_fs::OpenOptions::new();
        opts.write(true).create_new(true);
        let _ = opts.open(folder.join(name));
    }
    #[cfg(target_os = "macos")]
    exclude_from_time_machine(folder);
    #[cfg(windows)]
    windows::add_attributes(folder, windows::NOT_CONTENT_INDEXED);
}

/// Hide a file the vault keeps in the folder for itself.
pub(super) fn hide(path: &Path) {
    #[cfg(windows)]
    windows::add_attributes(path, windows::HIDDEN | windows::NOT_CONTENT_INDEXED);
    #[cfg(not(windows))]
    let _ = path;
}

/// Keep the system indexer away from one file the vault wrote.
pub(super) fn exclude_file(path: &Path) {
    #[cfg(windows)]
    windows::add_attributes(path, windows::NOT_CONTENT_INDEXED);
    #[cfg(not(windows))]
    let _ = path;
}

/// While the vault is open, wipe previews of its files on a timer.
pub(super) fn watch(folder: &Path) {
    crate::mount::watch_vault_folder(folder);
}

/// Wipe what the system kept about the folder's files, on a thread of its
/// own: a large Trash item must not hold up close.
pub(super) fn purge_after_close(folder: &Path, opts: &WipeOptions) {
    crate::mount::unwatch_vault_folder(folder);
    crate::mount::purge_folder_thumbnails(folder);
    if crate::host_fs::is_bridge_path(folder) {
        return;
    }
    let folder = folder.to_path_buf();
    let opts = *opts;
    let spawned = std::thread::Builder::new()
        .name("upriv-plain-residue".into())
        .spawn(move || {
            #[cfg(target_os = "linux")]
            linux::purge(&folder, &opts);
            #[cfg(windows)]
            windows::purge_recycle_bin(&folder, &opts);
            #[cfg(not(any(target_os = "linux", windows)))]
            let _ = (&folder, &opts);
        });
    if spawned.is_err() {
        crate::logging::log_event(
            crate::logging::LogLevel::Warn,
            "vault_plain_residue_skipped",
            &[],
        );
    }
}

/// Wipe one copy of vault files outside the folder: a file, or a folder of
/// them. Links are removed, never followed.
#[cfg_attr(not(any(target_os = "linux", windows)), allow(dead_code))]
fn wipe_copy(path: &Path, opts: &WipeOptions) -> bool {
    match disk::stamp_at(path) {
        Ok(Some(Seen::File(stamp))) => sweep::wipe_path(path, &stamp, opts).unwrap_or(false),
        Ok(Some(Seen::Dir)) => {
            let swept = sweep::sweep_folder(path, &[], opts, &mut |_, _| Visit::Wipe);
            matches!(swept, Ok(swept) if swept.kept.is_empty())
                && crate::host_fs::remove_dir(path).is_ok()
        }
        Ok(None) => crate::host_fs::remove_file(path).is_ok() || !path.exists(),
        Err(_) => false,
    }
}

#[cfg(target_os = "macos")]
fn exclude_from_time_machine(folder: &Path) {
    use std::os::unix::ffi::OsStrExt;
    // What `tmutil addexclusion` writes: a binary plist holding the string
    // "com.apple.backupd".
    const VALUE: &[u8] = b"bplist00_\x10\x11com.apple.backupd\x08\x00\x00\x00\x00\x00\x00\x01\x01\x00\x00\x00\x00\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x1c";
    let Ok(path) = std::ffi::CString::new(folder.as_os_str().as_bytes()) else {
        return;
    };
    let name = c"com.apple.metadata:com_apple_backup_excludeItem";
    unsafe {
        libc::setxattr(
            path.as_ptr(),
            name.as_ptr(),
            VALUE.as_ptr().cast(),
            VALUE.len(),
            0,
            libc::XATTR_NOFOLLOW,
        )
    };
}

#[cfg(target_os = "linux")]
mod linux {
    use std::path::{Path, PathBuf};

    use super::wipe_copy;
    use crate::mount::uri_is_under_folder;
    use crate::vault::wipe::WipeOptions;

    /// Entries one list may hold before the purge stops reading it.
    const MAX_ENTRIES: usize = 20_000;
    /// Largest list file the purge reads.
    const MAX_LIST_BYTES: u64 = 16 * 1024 * 1024;

    pub(super) fn purge(folder: &Path, opts: &WipeOptions) {
        let mut wiped = 0u32;
        for trash in trash_dirs(folder) {
            wiped += purge_trash(&trash, folder, opts);
        }
        let dropped = purge_recent(folder);
        if wiped > 0 || dropped > 0 {
            crate::logging::log_event(
                crate::logging::LogLevel::Info,
                "vault_plain_residue_wiped",
                &[
                    ("trash", wiped.to_string().as_str()),
                    ("recent", dropped.to_string().as_str()),
                ],
            );
        }
    }

    fn data_home() -> Option<PathBuf> {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
            .or_else(|| {
                std::env::var_os("HOME")
                    .map(PathBuf::from)
                    .filter(|home| home.is_absolute())
                    .map(|home| home.join(".local/share"))
            })
    }

    /// The home Trash, and the Trash folders at the top of the folder's drive.
    fn trash_dirs(folder: &Path) -> Vec<PathBuf> {
        let mut dirs: Vec<PathBuf> = data_home().map(|home| home.join("Trash")).into_iter().collect();
        if let Some(top) = super::super::volume::mount_root(folder) {
            let uid = unsafe { libc::geteuid() };
            let shared = top.join(".Trash");
            if is_sticky_dir(&shared) {
                dirs.push(shared.join(uid.to_string()));
            }
            dirs.push(top.join(format!(".Trash-{uid}")));
        }
        dirs.retain(|dir| dir.join("info").is_dir());
        dirs
    }

    fn is_sticky_dir(path: &Path) -> bool {
        use std::os::unix::fs::PermissionsExt;
        std::fs::symlink_metadata(path).is_ok_and(|meta| {
            meta.file_type().is_dir() && meta.permissions().mode() & 0o1000 != 0
        })
    }

    /// Wipe each Trash item that was deleted from inside `folder`.
    fn purge_trash(trash: &Path, folder: &Path, opts: &WipeOptions) -> u32 {
        let Some(top) = trash.parent().map(|parent| {
            // `$top/.Trash/$uid` and `$top/.Trash-$uid` store paths relative to `$top`.
            if parent.file_name().is_some_and(|name| name == ".Trash") {
                parent.parent().unwrap_or(parent).to_path_buf()
            } else {
                parent.to_path_buf()
            }
        }) else {
            return 0;
        };
        let Ok(entries) = std::fs::read_dir(trash.join("info")) else {
            return 0;
        };
        let mut wiped = 0;
        let mut removed_names = Vec::new();
        for entry in entries.take(MAX_ENTRIES).flatten() {
            let info = entry.path();
            let Some(name) = info
                .file_name()
                .and_then(|name| name.to_str())
                .and_then(|name| name.strip_suffix(".trashinfo"))
                .map(str::to_string)
            else {
                continue;
            };
            let Some(original) = read_small(&info).and_then(|text| trashed_path(&text, &top)) else {
                continue;
            };
            if !original.starts_with(folder) {
                continue;
            }
            if wipe_copy(&trash.join("files").join(&name), opts) {
                let _ = std::fs::remove_file(&info);
                removed_names.push(name);
                wiped += 1;
            }
        }
        if !removed_names.is_empty() {
            drop_directory_sizes(trash, &removed_names);
        }
        wiped
    }

    fn read_small(path: &Path) -> Option<String> {
        let meta = std::fs::symlink_metadata(path).ok()?;
        if !meta.is_file() || meta.len() > MAX_LIST_BYTES {
            return None;
        }
        std::fs::read_to_string(path).ok()
    }

    /// `Path=` of a `.trashinfo`, absolute.
    fn trashed_path(text: &str, top: &Path) -> Option<PathBuf> {
        let raw = text.lines().find_map(|line| line.strip_prefix("Path="))?;
        let decoded = percent_decode(raw.trim())?;
        let path = PathBuf::from(decoded);
        Some(if path.is_absolute() { path } else { top.join(path) })
    }

    fn percent_decode(raw: &str) -> Option<String> {
        let bytes = raw.as_bytes();
        let mut out = Vec::with_capacity(bytes.len());
        let mut index = 0;
        while index < bytes.len() {
            if bytes[index] == b'%' {
                let hex = raw.get(index + 1..index + 3)?;
                out.push(u8::from_str_radix(hex, 16).ok()?);
                index += 3;
            } else {
                out.push(bytes[index]);
                index += 1;
            }
        }
        String::from_utf8(out).ok()
    }

    /// `directorysizes` caches one line per trashed folder; drop the purged ones.
    fn drop_directory_sizes(trash: &Path, names: &[String]) {
        let path = trash.join("directorysizes");
        let Some(text) = read_small(&path) else {
            return;
        };
        let kept: Vec<&str> = text
            .lines()
            .filter(|line| {
                let name = line.splitn(3, ' ').nth(2).and_then(percent_decode);
                !name.is_some_and(|name| names.contains(&name))
            })
            .collect();
        let mut body = kept.join("\n");
        if !body.is_empty() {
            body.push('\n');
        }
        let _ = replace_list(&path, body.as_bytes());
    }

    /// Drop recent-file entries for paths inside `folder`.
    fn purge_recent(folder: &Path) -> u32 {
        let Some(data) = data_home() else {
            return 0;
        };
        let mut dropped = purge_xbel(&data.join("recently-used.xbel"), folder);
        if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
            dropped += purge_xbel(&home.join(".recently-used.xbel"), folder);
            dropped += purge_kde_recent(&data.join("RecentDocuments"), folder, &home);
        }
        dropped
    }

    /// GTK's list: one `<bookmark href="file:///…">…</bookmark>` per file.
    fn purge_xbel(path: &Path, folder: &Path) -> u32 {
        let Some(text) = read_small(path) else {
            return 0;
        };
        let (kept, dropped) = drop_bookmarks(&text, folder);
        if dropped > 0 && replace_list(path, kept.as_bytes()).is_err() {
            return 0;
        }
        dropped
    }

    pub(super) fn drop_bookmarks(text: &str, folder: &Path) -> (String, u32) {
        let mut out = String::with_capacity(text.len());
        let mut rest = text;
        let mut dropped = 0;
        while let Some(start) = rest.find("<bookmark ") {
            let Some(end) = rest[start..].find("</bookmark>").map(|end| start + end + "</bookmark>".len())
            else {
                break;
            };
            let element = &rest[start..end];
            let under = bookmark_href(element)
                .is_some_and(|href| uri_is_under_folder(&unescape_xml(href), folder));
            out.push_str(&rest[..start]);
            if under {
                dropped += 1;
                // Drop the line break the element ended, too.
                rest = rest[end..].strip_prefix('\n').unwrap_or(&rest[end..]);
                out.truncate(out.trim_end_matches([' ', '\t']).len());
            } else {
                out.push_str(element);
                rest = &rest[end..];
            }
        }
        out.push_str(rest);
        (out, dropped)
    }

    fn bookmark_href(element: &str) -> Option<&str> {
        let head = &element[..element.find('>')?];
        let start = head.find("href=\"")? + "href=\"".len();
        let len = head[start..].find('"')?;
        Some(&head[start..start + len])
    }

    fn unescape_xml(raw: &str) -> String {
        raw.replace("&quot;", "\"")
            .replace("&apos;", "'")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&amp;", "&")
    }

    /// KDE keeps one `.desktop` file per recent document.
    fn purge_kde_recent(dir: &Path, folder: &Path, home: &Path) -> u32 {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return 0;
        };
        let mut dropped = 0;
        for entry in entries.take(MAX_ENTRIES).flatten() {
            let path = entry.path();
            if path.extension().is_none_or(|ext| ext != "desktop") {
                continue;
            }
            let Some(text) = read_small(&path) else {
                continue;
            };
            let under = text.lines().any(|line| {
                let Some((key, value)) = line.split_once('=') else {
                    return false;
                };
                if key.trim() != "URL" && key.trim() != "URL[$e]" {
                    return false;
                }
                let home = home.to_string_lossy();
                let value = value.trim().replace("$HOME", &home);
                let uri = match value.strip_prefix("file:") {
                    Some(rest) if !rest.starts_with("//") => format!("file://{rest}"),
                    _ => value,
                };
                uri_is_under_folder(&uri, folder)
            });
            if under && std::fs::remove_file(&path).is_ok() {
                dropped += 1;
            }
        }
        dropped
    }

    /// Replace a list file in one step, keeping its permissions.
    fn replace_list(path: &Path, body: &[u8]) -> std::io::Result<()> {
        use std::io::Write;
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        let mode = std::fs::metadata(path)?.permissions().mode() & 0o777;
        let temp = path.with_extension(format!("upriv-{}", uuid::Uuid::new_v4().simple()));
        let written = (|| {
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(mode)
                .custom_flags(libc::O_NOFOLLOW)
                .open(&temp)?;
            file.write_all(body)?;
            file.sync_all()?;
            std::fs::rename(&temp, path)
        })();
        if written.is_err() {
            let _ = std::fs::remove_file(&temp);
        }
        written
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn bookmarks_under_the_folder_are_dropped() {
            let text = concat!(
                "<?xml version=\"1.0\"?>\n<xbel>\n",
                "  <bookmark href=\"file:///home/a/Notes/plan%20b.txt\" added=\"x\">\n    <info/>\n  </bookmark>\n",
                "  <bookmark href=\"file:///home/a/Other/keep.txt\" added=\"x\">\n  </bookmark>\n",
                "  <bookmark href=\"file:///home/a/Notes2/keep.txt\">\n  </bookmark>\n",
                "</xbel>\n"
            );
            let (kept, dropped) = drop_bookmarks(text, Path::new("/home/a/Notes"));
            assert_eq!(dropped, 1);
            assert!(!kept.contains("plan%20b"));
            assert!(kept.contains("Other/keep.txt"));
            assert!(kept.contains("Notes2/keep.txt"));
            assert!(kept.starts_with("<?xml"));
            assert!(kept.ends_with("</xbel>\n"));
        }

        #[test]
        fn trash_paths_decode_and_resolve_against_the_drive_top() {
            let text = "[Trash Info]\nPath=Notes/a%20b.txt\nDeletionDate=2026-10-16T10:00:00\n";
            assert_eq!(
                trashed_path(text, Path::new("/media/usb")),
                Some(PathBuf::from("/media/usb/Notes/a b.txt"))
            );
            let absolute = "[Trash Info]\nPath=/home/a/Notes/x.txt\n";
            assert_eq!(
                trashed_path(absolute, Path::new("/")),
                Some(PathBuf::from("/home/a/Notes/x.txt"))
            );
            assert_eq!(trashed_path("[Trash Info]\nPath=%zz\n", Path::new("/")), None);
        }

        #[test]
        fn a_trashed_vault_file_is_wiped_and_others_stay() {
            let tmp = tempfile::tempdir().unwrap();
            let trash = tmp.path().join("Trash");
            std::fs::create_dir_all(trash.join("info")).unwrap();
            std::fs::create_dir_all(trash.join("files")).unwrap();
            let folder = tmp.path().join("Notes");
            for (name, original) in [("a.txt", folder.join("a.txt")), ("b.txt", tmp.path().join("b.txt"))] {
                std::fs::write(trash.join("files").join(name), b"secret").unwrap();
                std::fs::write(
                    trash.join("info").join(format!("{name}.trashinfo")),
                    format!("[Trash Info]\nPath={}\n", original.display()),
                )
                .unwrap();
            }
            let opts = WipeOptions {
                passes: 1,
                pattern: crate::config::vault_config::VaultWipePattern::Zeros,
            };
            assert_eq!(purge_trash(&trash, &folder, &opts), 1);
            assert!(!trash.join("files/a.txt").exists());
            assert!(!trash.join("info/a.txt.trashinfo").exists());
            assert!(trash.join("files/b.txt").exists());
        }
    }
}

#[cfg(windows)]
mod windows {
    use std::path::Path;

    use super::wipe_copy;
    use crate::vault::wipe::WipeOptions;

    pub(super) const HIDDEN: u32 = 0x2;
    pub(super) const NOT_CONTENT_INDEXED: u32 = 0x2000;
    const INVALID_FILE_ATTRIBUTES: u32 = u32::MAX;

    #[link(name = "kernel32")]
    extern "system" {
        fn GetFileAttributesW(path: *const u16) -> u32;
        fn SetFileAttributesW(path: *const u16, attributes: u32) -> i32;
        fn GetVolumePathNameW(file: *const u16, volume: *mut u16, len: u32) -> i32;
    }

    pub(super) fn add_attributes(path: &Path, added: u32) {
        let wide = crate::host_fs::windows_verbatim_wide(path);
        let current = unsafe { GetFileAttributesW(wide.as_ptr()) };
        if current != INVALID_FILE_ATTRIBUTES && current & added != added {
            unsafe { SetFileAttributesW(wide.as_ptr(), current | added) };
        }
    }

    /// Wipe Recycle Bin items deleted from inside `folder`.
    pub(super) fn purge_recycle_bin(folder: &Path, opts: &WipeOptions) {
        let wide = crate::host_fs::windows_verbatim_wide(folder);
        let mut root = vec![0u16; 1024];
        if unsafe { GetVolumePathNameW(wide.as_ptr(), root.as_mut_ptr(), root.len() as u32) } == 0 {
            return;
        }
        let end = root.iter().position(|unit| *unit == 0).unwrap_or(root.len());
        let root = String::from_utf16_lossy(&root[..end]);
        let root = root.strip_prefix(r"\\?\").unwrap_or(&root).to_string();
        let prefix = comparable(&folder.to_string_lossy());
        let Ok(users) = std::fs::read_dir(Path::new(&root).join("$Recycle.Bin")) else {
            return;
        };
        let mut wiped = 0u32;
        for user in users.flatten() {
            let Ok(items) = std::fs::read_dir(user.path()) else {
                continue;
            };
            for item in items.flatten() {
                let name = item.file_name().to_string_lossy().into_owned();
                let Some(suffix) = name.strip_prefix("$I") else {
                    continue;
                };
                let Some(original) = std::fs::read(item.path()).ok().and_then(|bytes| recycled_path(&bytes))
                else {
                    continue;
                };
                let original = comparable(&original);
                if original != prefix && !original.starts_with(&format!("{prefix}\\")) {
                    continue;
                }
                if wipe_copy(&user.path().join(format!("$R{suffix}")), opts) {
                    let _ = std::fs::remove_file(item.path());
                    wiped += 1;
                }
            }
        }
        if wiped > 0 {
            crate::logging::log_event(
                crate::logging::LogLevel::Info,
                "vault_plain_residue_wiped",
                &[("recycle_bin", wiped.to_string().as_str())],
            );
        }
    }

    fn comparable(path: &str) -> String {
        let path = path.strip_prefix(r"\\?\").unwrap_or(path);
        path.replace('/', "\\").trim_end_matches('\\').to_lowercase()
    }

    /// The original path in a `$I` file: version 1 (Vista to 8) keeps a fixed
    /// 260-character field, version 2 a length-prefixed one.
    pub(super) fn recycled_path(bytes: &[u8]) -> Option<String> {
        let version = u64::from_le_bytes(bytes.get(..8)?.try_into().ok()?);
        let units: Vec<u16> = match version {
            1 => bytes.get(24..24 + 520)?,
            2 => {
                let count = u32::from_le_bytes(bytes.get(24..28)?.try_into().ok()?) as usize;
                bytes.get(28..28 + count.checked_mul(2)?)?
            }
            _ => return None,
        }
        .chunks_exact(2)
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
        .take_while(|unit| *unit != 0)
        .collect();
        Some(String::from_utf16_lossy(&units))
    }
}
