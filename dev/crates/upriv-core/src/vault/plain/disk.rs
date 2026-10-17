//! Folder side of a plaintext vault: what an entry looks like on disk, the
//! scan, and the small file operations the sync uses.
//!
//! Nothing here follows a link. Entries are read with `lstat`, and files are
//! opened without following a final link.

use std::collections::HashMap;
use std::io;
use std::path::{Path, PathBuf};

#[allow(unused_imports)]
use crate::host_fs::HostFsQuery;
use crate::host_fs::{self, DirEntry};
use crate::store::{child_logical_path, is_reserved_logical, PLAIN_RESERVED_PREFIX};

/// Most entries one scan reads. Past it, nothing missing counts as removed.
pub(super) const MAX_SCAN_ENTRIES: usize = 200_000;
/// Deepest folder one scan enters. Anything deeper counts as unknown.
const MAX_SCAN_DEPTH: usize = 128;
/// A file the sync is writing. The scan and the import skip every name with
/// [`PLAIN_RESERVED_PREFIX`], so other apps never see it as a vault file.
const TEMP_PREFIX: &str = ".upriv-plain-tmp-";

/// What a file looked like on disk. Two equal stamps mean the bytes were not
/// rewritten in between, as far as the filesystem can tell.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(super) struct DiskStamp {
    pub len: u64,
    /// Last content write, in nanoseconds since the Unix epoch. A
    /// storage-access folder only keeps milliseconds.
    pub modified: i128,
    /// Last change to the file's content or attributes, which no app can set
    /// back (Unix `ctime`, Windows ChangeTime), in the same unit. Zero on a
    /// storage-access folder.
    pub changed: i128,
    /// `(device, file number)`. A rename keeps it. A storage-access folder has
    /// none, so a rename there is a removal and a new file.
    pub inode: Option<(u64, u64)>,
}

/// One scanned entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Seen {
    File(DiskStamp),
    Dir,
}

/// Everything one scan saw under the folder. Paths are store paths.
#[derive(Debug, Default)]
pub(super) struct Scan {
    pub entries: HashMap<String, Seen>,
    /// Folders (or entries) that could not be read. Paths under them are
    /// unknown, not gone.
    pub unreadable: Vec<String>,
    /// The scan stopped at [`MAX_SCAN_ENTRIES`]. Nothing missing is gone.
    pub truncated: bool,
    /// Links, pipes, devices, and names the vault cannot hold.
    pub skipped: u32,
}

impl Scan {
    /// True when the scan cannot tell whether `path` is missing.
    pub(super) fn unknown(&self, path: &str) -> bool {
        self.truncated
            || self
                .unreadable
                .iter()
                .any(|dir| dir.is_empty() || path == dir || is_under(path, dir))
    }
}

pub(super) fn is_under(path: &str, dir: &str) -> bool {
    path.len() > dir.len() && path.starts_with(dir) && path.as_bytes()[dir.len()] == b'/'
}

/// `folder` joined with a `/`-separated store path, one component at a time.
pub(super) fn os_path(folder: &Path, rel: &str) -> PathBuf {
    let mut path = folder.to_path_buf();
    for part in rel.split('/').filter(|part| !part.is_empty()) {
        path.push(part);
    }
    path
}

/// Read every entry under `folder`. The folder itself must be readable.
/// `skip_root` names at the top are left out (the marker and helper files).
pub(super) fn scan(folder: &Path, skip_root: &[&str]) -> io::Result<Scan> {
    let bridge = host_fs::is_bridge_path(folder);
    let mut scan = Scan::default();
    let mut pending = vec![(folder.to_path_buf(), String::new(), 0usize)];
    let mut top = true;
    while let Some((dir, rel, depth)) = pending.pop() {
        let entries = match host_fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(error) if top => return Err(error),
            Err(_) => {
                scan.unreadable.push(rel);
                continue;
            }
        };
        top = false;
        for entry in entries {
            let Ok(entry) = entry else {
                scan.unreadable.push(rel.clone());
                break;
            };
            if scan.entries.len() >= MAX_SCAN_ENTRIES {
                scan.truncated = true;
                return Ok(scan);
            }
            let name = entry.file_name();
            let Some(name) = name.to_str() else {
                scan.skipped += 1;
                continue;
            };
            if name.starts_with(PLAIN_RESERVED_PREFIX)
                || (rel.is_empty() && skip_root.contains(&name))
            {
                continue;
            }
            let child = match child_logical_path(&rel, name) {
                Ok(child) if !is_reserved_logical(&child) => child,
                _ => {
                    scan.skipped += 1;
                    continue;
                }
            };
            let Ok(file_type) = entry.file_type() else {
                scan.unreadable.push(child);
                continue;
            };
            if file_type.is_symlink() {
                scan.skipped += 1;
            } else if file_type.host_is_dir() {
                if depth + 1 >= MAX_SCAN_DEPTH {
                    scan.unreadable.push(child);
                    continue;
                }
                scan.entries.insert(child.clone(), Seen::Dir);
                pending.push((entry.path(), child, depth + 1));
            } else if file_type.host_is_file() {
                match file_stamp(&entry, bridge) {
                    Ok(Some(stamp)) => {
                        scan.entries.insert(child, Seen::File(stamp));
                    }
                    Ok(None) => {}
                    Err(_) => scan.unreadable.push(child),
                }
            } else {
                scan.skipped += 1;
            }
        }
    }
    Ok(scan)
}

/// Stamp of a listed file, from the same source [`stamp_at`] and
/// [`stamp_of_file`] use, so a file nobody touched keeps its stamp.
/// `None` when it vanished or stopped being a file after the listing.
fn file_stamp(entry: &DirEntry, bridge: bool) -> io::Result<Option<DiskStamp>> {
    if bridge {
        return Ok(Some(listed_stamp(entry)));
    }
    #[cfg(windows)]
    {
        Ok(match stamp_at(&entry.path())? {
            Some(Seen::File(stamp)) => Some(stamp),
            _ => None,
        })
    }
    #[cfg(not(windows))]
    {
        match entry.metadata() {
            Ok(meta) if meta.is_file() => Ok(Some(stamp_of_meta(&meta))),
            Ok(_) => Ok(None),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error),
        }
    }
}

/// The entry at `path` without following a link. `None` when nothing is
/// there, or when it is a link or a special file.
pub(super) fn stamp_at(path: &Path) -> io::Result<Option<Seen>> {
    if let Some(listed) = host_fs::bridge_stat(path) {
        return Ok(listed?.map(|stat| {
            if stat.dir {
                Seen::Dir
            } else {
                Seen::File(DiskStamp {
                    len: stat.len.unwrap_or(0),
                    modified: millis_to_nanos(stat.modified_ms),
                    changed: 0,
                    inode: None,
                })
            }
        }));
    }
    #[cfg(windows)]
    {
        let file = match host_fs::windows_open_attributes(path) {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error),
        };
        let info = host_fs::windows_file_info(&file)?;
        Ok(
            if info.attributes & host_fs::WINDOWS_FILE_ATTRIBUTE_REPARSE_POINT != 0 {
                None
            } else if info.attributes & host_fs::WINDOWS_FILE_ATTRIBUTE_DIRECTORY != 0 {
                Some(Seen::Dir)
            } else {
                Some(Seen::File(stamp_of_info(&info)))
            },
        )
    }
    #[cfg(not(windows))]
    {
        let meta = match std::fs::symlink_metadata(path) {
            Ok(meta) => meta,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error),
        };
        let file_type = meta.file_type();
        Ok(if file_type.is_symlink() {
            None
        } else if file_type.is_dir() {
            Some(Seen::Dir)
        } else if file_type.is_file() {
            Some(Seen::File(stamp_of_meta(&meta)))
        } else {
            None
        })
    }
}

/// Stamp of a storage-access entry from its listing row.
pub(super) fn listed_stamp(entry: &DirEntry) -> DiskStamp {
    DiskStamp {
        len: entry.known_len().unwrap_or(0),
        modified: millis_to_nanos(entry.known_modified_ms()),
        changed: 0,
        inode: None,
    }
}

fn millis_to_nanos(ms: Option<i64>) -> i128 {
    ms.map_or(0, |ms| i128::from(ms) * 1_000_000)
}

/// Stamp of an open file.
pub(super) fn stamp_of_file(file: &host_fs::File) -> io::Result<DiskStamp> {
    #[cfg(windows)]
    {
        Ok(stamp_of_info(&host_fs::windows_file_info(file)?))
    }
    #[cfg(not(windows))]
    {
        Ok(stamp_of_meta(&file.metadata()?))
    }
}

#[cfg(windows)]
pub(super) fn stamp_of_info(info: &host_fs::WindowsFileInfo) -> DiskStamp {
    DiskStamp {
        len: info.len,
        modified: filetime_to_unix_nanos(info.last_write),
        changed: filetime_to_unix_nanos(info.change),
        // FAT has no stable file number; zero there means "none".
        inode: (info.index != 0).then_some((u64::from(info.volume_serial), info.index)),
    }
}

/// FILETIME counts 100 ns ticks from 1601.
#[cfg(windows)]
fn filetime_to_unix_nanos(ticks: i64) -> i128 {
    const TICKS_TO_UNIX_EPOCH: i128 = 116_444_736_000_000_000;
    (i128::from(ticks) - TICKS_TO_UNIX_EPOCH) * 100
}

#[cfg(unix)]
fn stamp_of_meta(meta: &std::fs::Metadata) -> DiskStamp {
    use std::os::unix::fs::MetadataExt;
    DiskStamp {
        len: meta.len(),
        modified: i128::from(meta.mtime()) * 1_000_000_000 + i128::from(meta.mtime_nsec()),
        changed: i128::from(meta.ctime()) * 1_000_000_000 + i128::from(meta.ctime_nsec()),
        inode: Some((meta.dev(), meta.ino())),
    }
}

#[cfg(not(any(unix, windows)))]
fn stamp_of_meta(meta: &std::fs::Metadata) -> DiskStamp {
    DiskStamp {
        len: meta.len(),
        modified: 0,
        changed: 0,
        inode: None,
    }
}

/// True when a scan stamp and the stamp of the file that was then opened
/// describe the same bytes. A storage-access listing row only has a length
/// in common with the descriptor.
pub(super) fn opened_matches(scanned: &DiskStamp, opened: &DiskStamp, bridge: bool) -> bool {
    if bridge {
        scanned.len == opened.len
    } else {
        scanned == opened
    }
}

/// The same file with the same bytes, moved or not. A rename changes only
/// the change time.
pub(super) fn same_file(a: &DiskStamp, b: &DiskStamp) -> bool {
    a.len == b.len && a.modified == b.modified && a.inode == b.inode
}

/// True when no other name points at the open file, so overwriting it cannot
/// reach a file outside the folder.
pub(super) fn single_name(file: &host_fs::File) -> io::Result<bool> {
    #[cfg(windows)]
    {
        Ok(host_fs::windows_file_info(file)?.links <= 1)
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        Ok(file.metadata()?.nlink() <= 1)
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = file;
        Ok(false)
    }
}

/// Open a file to read it into the vault, without following a link.
pub(super) fn open_for_import(path: &Path) -> io::Result<host_fs::File> {
    crate::paths::open_nofollow(path, crate::paths::NofollowMode::Read)
}

/// A free name in `dir` that the scan, the import, and other apps' view of
/// the vault all skip.
pub(super) fn temp_path(dir: &Path) -> PathBuf {
    dir.join(format!("{TEMP_PREFIX}{}", uuid::Uuid::new_v4().simple()))
}

/// True for a name [`temp_path`] made. Close wipes these without asking.
pub(super) fn is_temp_name(name: &str) -> bool {
    name.strip_prefix(TEMP_PREFIX)
        .is_some_and(|rest| rest.len() == 32 && rest.bytes().all(|byte| byte.is_ascii_hexdigit()))
}

/// A new owner-only file in `dir` for bytes on their way to their real name.
pub(super) fn create_temp(dir: &Path) -> io::Result<(PathBuf, host_fs::File)> {
    let path = temp_path(dir);
    let mut opts = host_fs::OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
        opts.custom_flags(libc::O_NOFOLLOW);
    }
    let file = opts.open(&path)?;
    Ok((path, file))
}

/// One new owner-only folder. `AlreadyExists` when the name is taken.
pub(super) fn make_dir(path: &Path) -> io::Result<()> {
    if host_fs::is_bridge_path(path) {
        return host_fs::create_dir(path);
    }
    let mut builder = std::fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(path)
}

/// The vault's own folder: owner-only like [`make_dir`]. On Windows its
/// access list names only the current user, and everything inside inherits
/// that, so other accounts and services cannot read the files.
pub(super) fn make_leaf(path: &Path) -> io::Result<()> {
    make_dir(path)?;
    #[cfg(windows)]
    if !host_fs::is_bridge_path(path) {
        if let Err(error) = restrict_to_owner(path) {
            let _ = std::fs::remove_dir(path);
            return Err(error);
        }
    }
    Ok(())
}

#[cfg(windows)]
fn restrict_to_owner(path: &Path) -> io::Result<()> {
    use std::ffi::c_void;
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::io::AsRawHandle;
    use std::ptr::null_mut;

    #[repr(C)]
    struct SidAndAttributes {
        sid: *mut c_void,
        _attributes: u32,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetCurrentProcess() -> *mut c_void;
        fn CloseHandle(handle: *mut c_void) -> i32;
    }
    #[link(name = "advapi32")]
    extern "system" {
        fn OpenProcessToken(process: *mut c_void, access: u32, token: *mut *mut c_void) -> i32;
        fn GetTokenInformation(
            token: *mut c_void,
            class: i32,
            info: *mut c_void,
            len: u32,
            needed: *mut u32,
        ) -> i32;
        fn GetLengthSid(sid: *mut c_void) -> u32;
        fn InitializeAcl(acl: *mut c_void, len: u32, revision: u32) -> i32;
        fn AddAccessAllowedAceEx(
            acl: *mut c_void,
            revision: u32,
            flags: u32,
            mask: u32,
            sid: *mut c_void,
        ) -> i32;
        fn SetSecurityInfo(
            handle: *mut c_void,
            object_type: i32,
            info: u32,
            owner: *mut c_void,
            group: *mut c_void,
            dacl: *mut c_void,
            sacl: *mut c_void,
        ) -> u32;
    }
    const TOKEN_QUERY: u32 = 0x0008;
    const TOKEN_USER: i32 = 1;
    const ACL_REVISION: u32 = 2;
    const INHERIT_TO_FILES_AND_FOLDERS: u32 = 0x1 | 0x2;
    const FILE_ALL_ACCESS: u32 = 0x001F_01FF;
    const SE_FILE_OBJECT: i32 = 1;
    const DACL_ONLY_PROTECTED: u32 = 0x4 | 0x8000_0000;
    const WRITE_DAC: u32 = 0x0004_0000;
    const READ_CONTROL: u32 = 0x0002_0000;
    const FILE_READ_ATTRIBUTES: u32 = 0x80;
    const FILE_SHARE_ALL: u32 = 0x1 | 0x2 | 0x4;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;

    let mut token = null_mut();
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let mut needed = 0u32;
    unsafe { GetTokenInformation(token, TOKEN_USER, null_mut(), 0, &mut needed) };
    let mut user = vec![0u64; (needed as usize).div_ceil(8).max(2)];
    let got = unsafe {
        GetTokenInformation(
            token,
            TOKEN_USER,
            user.as_mut_ptr().cast(),
            (user.len() * 8) as u32,
            &mut needed,
        )
    };
    unsafe { CloseHandle(token) };
    if got == 0 {
        return Err(io::Error::last_os_error());
    }
    let sid = unsafe { &*user.as_ptr().cast::<SidAndAttributes>() }.sid;
    // ACL header, then one ACCESS_ALLOWED_ACE whose last field is the SID.
    let acl_len = 8 + 8 + unsafe { GetLengthSid(sid) } as usize;
    let mut acl = vec![0u32; acl_len.div_ceil(4)];
    let acl_ptr: *mut c_void = acl.as_mut_ptr().cast();
    if unsafe { InitializeAcl(acl_ptr, (acl.len() * 4) as u32, ACL_REVISION) } == 0
        || unsafe {
            AddAccessAllowedAceEx(
                acl_ptr,
                ACL_REVISION,
                INHERIT_TO_FILES_AND_FOLDERS,
                FILE_ALL_ACCESS,
                sid,
            )
        } == 0
    {
        return Err(io::Error::last_os_error());
    }
    let dir = std::fs::OpenOptions::new()
        .access_mode(WRITE_DAC | READ_CONTROL | FILE_READ_ATTRIBUTES)
        .share_mode(FILE_SHARE_ALL)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)?;
    let info = host_fs::windows_file_info(&dir)?;
    if info.attributes & host_fs::WINDOWS_FILE_ATTRIBUTE_REPARSE_POINT != 0
        || info.attributes & host_fs::WINDOWS_FILE_ATTRIBUTE_DIRECTORY == 0
    {
        return Err(io::Error::other("not a plain folder"));
    }
    let status = unsafe {
        SetSecurityInfo(
            dir.as_raw_handle().cast(),
            SE_FILE_OBJECT,
            DACL_ONLY_PROTECTED,
            null_mut(),
            null_mut(),
            acl_ptr,
            null_mut(),
        )
    };
    if status != 0 {
        return Err(io::Error::from_raw_os_error(status as i32));
    }
    Ok(())
}

/// Owner-only access to the folder (`0700`), or list-only (`0500`) when a
/// folder left from an earlier close has to be unlocked before it is removed.
/// Unix only: other systems have no mode bits for this.
pub(super) fn set_folder_writable(path: &Path, writable: bool) -> io::Result<()> {
    #[cfg(unix)]
    {
        if host_fs::is_bridge_path(path) {
            return Ok(());
        }
        use std::os::unix::fs::PermissionsExt;
        let mode = if writable { 0o700 } else { 0o500 };
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode))
    }
    #[cfg(not(unix))]
    {
        let _ = (path, writable);
        Ok(())
    }
}

/// True when the folder holds nothing but the names in `allowed`.
pub(super) fn holds_only(path: &Path, allowed: &[&str]) -> io::Result<bool> {
    for entry in host_fs::read_dir(path)? {
        let name = entry?.file_name();
        if !name.to_str().is_some_and(|name| allowed.contains(&name)) {
            return Ok(false);
        }
    }
    Ok(true)
}

/// What a wipe of the whole folder would remove: entries that are not
/// folders, and the bytes of the regular files among them. Unlike [`scan`]
/// it counts the names a vault refuses. Links are counted, never followed.
/// `skip_root` names at the top are left out. Stops at the scan limits.
pub(super) fn tally(folder: &Path, skip_root: &[&str]) -> io::Result<(u64, u64)> {
    let (mut files, mut bytes, mut seen) = (0u64, 0u64, 0usize);
    let mut pending = vec![(folder.to_path_buf(), 0usize)];
    while let Some((dir, depth)) = pending.pop() {
        let entries = match host_fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(error) if depth == 0 => return Err(error),
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            seen += 1;
            if seen > MAX_SCAN_ENTRIES {
                return Ok((files, bytes));
            }
            let name = entry.file_name();
            if depth == 0 && name.to_str().is_some_and(|name| skip_root.contains(&name)) {
                continue;
            }
            let file_type = entry.file_type().ok();
            if file_type.is_some_and(|kind| kind.host_is_dir() && !kind.is_symlink()) {
                if depth + 1 < MAX_SCAN_DEPTH {
                    pending.push((entry.path(), depth + 1));
                }
                continue;
            }
            files += 1;
            if file_type.is_some_and(|kind| kind.host_is_file()) {
                let len = entry
                    .known_len()
                    .or_else(|| entry.metadata().ok().map(|meta| meta.len()));
                bytes = bytes.saturating_add(len.unwrap_or(0));
            }
        }
    }
    Ok((files, bytes))
}

/// Remove a temp file the sync left behind. A missing file is fine.
pub(super) fn discard(path: &Path) {
    let _ = host_fs::remove_file(path);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_skips_internal_names_and_names_the_vault_refuses() {
        let tmp = tempfile::tempdir().unwrap();
        let folder = tmp.path();
        std::fs::create_dir_all(folder.join("docs/deep")).unwrap();
        std::fs::write(folder.join("docs/a.txt"), b"a").unwrap();
        std::fs::write(folder.join("docs/deep/b.txt"), b"bb").unwrap();
        std::fs::write(folder.join(".upriv-plain"), b"{}").unwrap();
        std::fs::write(folder.join("docs/.upriv-plain-tmp-1"), b"x").unwrap();
        std::fs::write(folder.join(".nomedia"), b"").unwrap();
        #[cfg(unix)]
        {
            std::fs::write(folder.join("what?.txt"), b"x").unwrap();
            std::os::unix::fs::symlink(folder.join("docs"), folder.join("link")).unwrap();
        }

        let scan = scan(folder, &[".nomedia"]).unwrap();
        let mut paths: Vec<&str> = scan.entries.keys().map(String::as_str).collect();
        paths.sort_unstable();
        assert_eq!(
            paths,
            vec!["docs", "docs/a.txt", "docs/deep", "docs/deep/b.txt"]
        );
        assert!(matches!(scan.entries["docs/deep/b.txt"], Seen::File(stamp) if stamp.len == 2));
        #[cfg(unix)]
        assert_eq!(scan.skipped, 2);
        assert!(!scan.truncated);
    }

    #[test]
    fn tally_counts_what_a_wipe_removes_and_skips_the_top_names() {
        let tmp = tempfile::tempdir().unwrap();
        let folder = tmp.path();
        std::fs::create_dir_all(folder.join("docs/empty")).unwrap();
        std::fs::write(folder.join("docs/a.txt"), b"abc").unwrap();
        std::fs::write(folder.join("docs/.upriv-plain-tmp-1"), b"x").unwrap();
        std::fs::write(folder.join(".upriv-workspace.json"), b"{}").unwrap();
        std::fs::write(folder.join(".upriv-plain"), b"marker").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(folder.join("docs"), folder.join("link")).unwrap();

        let (files, bytes) = tally(folder, &[".upriv-plain"]).unwrap();
        let links = if cfg!(unix) { 1 } else { 0 };
        assert_eq!((files, bytes), (3 + links, 6));
        assert!(tally(&folder.join("gone"), &[]).is_err());
    }

    #[test]
    fn scan_fails_when_the_folder_itself_is_missing() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(scan(&tmp.path().join("gone"), &[]).is_err());
    }

    #[test]
    fn unknown_covers_paths_under_an_unreadable_folder() {
        let scan = Scan {
            unreadable: vec!["docs".into()],
            ..Scan::default()
        };
        assert!(scan.unknown("docs"));
        assert!(scan.unknown("docs/a.txt"));
        assert!(!scan.unknown("docs2/a.txt"));
        assert!(!scan.unknown("other.txt"));
    }

    #[test]
    fn a_rewrite_changes_the_stamp() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("a.txt");
        std::fs::write(&path, b"one").unwrap();
        let Some(Seen::File(before)) = stamp_at(&path).unwrap() else {
            panic!("file");
        };
        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(&path, b"two").unwrap();
        let Some(Seen::File(after)) = stamp_at(&path).unwrap() else {
            panic!("file");
        };
        assert_ne!(before, after);
        assert_eq!(before.inode, after.inode);
    }

    #[test]
    fn os_path_joins_store_components() {
        let base = Path::new("base");
        assert_eq!(os_path(base, "a/b.txt"), base.join("a").join("b.txt"));
        assert_eq!(os_path(base, ""), base.to_path_buf());
    }
}
