//! Wipe inside a plaintext folder that other apps can also write.
//!
//! The walk never follows a link and never enters another filesystem. A file
//! is overwritten only while it has one name, so a hard link cannot carry the
//! overwrite to a file outside the folder; a file with more names is unlinked
//! here and keeps its other names. Links, pipes, and devices are unlinked
//! without being opened. On Unix every step is relative to an open directory
//! descriptor, so a folder swapped for a link mid-walk is not followed. On
//! Windows each folder is held open without delete sharing while its entries
//! are removed, so it cannot be renamed or replaced by a junction.

use std::path::Path;

use super::disk::DiskStamp;
use crate::vault::wipe::WipeOptions;

/// Deepest folder the walk enters. Anything deeper stays and is reported.
const MAX_DEPTH: usize = 128;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Visit {
    Wipe,
    Keep,
}

/// What one walk did. Paths are relative to the folder, `/`-separated.
#[derive(Debug, Default)]
pub(super) struct Sweep {
    pub wiped: u32,
    pub kept: Vec<String>,
}

impl Sweep {
    fn keep(&mut self, rel: &str) {
        self.kept.push(rel.to_string());
    }
}

/// Wipe what `choose` picks under `folder`, then remove the folders left
/// empty. `folder` itself stays. `skip_root` names at the top are left alone
/// and not reported.
pub(super) fn sweep_folder(
    folder: &Path,
    skip_root: &[&str],
    opts: &WipeOptions,
    choose: &mut dyn FnMut(&str, &DiskStamp) -> Visit,
) -> std::io::Result<Sweep> {
    let mut walk = Walk {
        opts,
        choose,
        skip_root,
        out: Sweep::default(),
    };
    if crate::host_fs::is_bridge_path(folder) {
        bridge::sweep(folder, &mut walk)?;
    } else {
        local::sweep(folder, &mut walk)?;
    }
    Ok(walk.out)
}

/// Overwrite and unlink one file the sync removes, when it still matches
/// `expected`. `Ok(false)` when the file is gone or changed.
pub(super) fn wipe_one(
    folder: &Path,
    rel: &str,
    expected: &DiskStamp,
    opts: &WipeOptions,
) -> std::io::Result<bool> {
    wipe_path(&super::disk::os_path(folder, rel), expected, opts)
}

/// [`wipe_one`] for a file named by its full path.
pub(super) fn wipe_path(
    path: &Path,
    expected: &DiskStamp,
    opts: &WipeOptions,
) -> std::io::Result<bool> {
    if crate::host_fs::is_bridge_path(path) {
        bridge::wipe_one(path, expected, opts)
    } else {
        local::wipe_one(path, expected, opts)
    }
}

struct Walk<'a> {
    opts: &'a WipeOptions,
    choose: &'a mut dyn FnMut(&str, &DiskStamp) -> Visit,
    skip_root: &'a [&'a str],
    out: Sweep,
}

impl Walk<'_> {
    fn skipped(&self, parent_rel: &str, name: &str) -> bool {
        parent_rel.is_empty() && self.skip_root.contains(&name)
    }
}

fn child_rel(parent: &str, name: &str) -> String {
    if parent.is_empty() {
        name.to_string()
    } else {
        format!("{parent}/{name}")
    }
}

fn overwrite(file: &mut std::fs::File, len: u64, opts: &WipeOptions) -> std::io::Result<()> {
    crate::vault::wipe::overwrite_contents(file, len, opts)
}

#[cfg(unix)]
mod local {
    use std::ffi::{CStr, CString};
    use std::io;
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
    use std::os::unix::ffi::OsStrExt;
    use std::path::Path;

    use super::{child_rel, overwrite, DiskStamp, Visit, Walk, MAX_DEPTH};
    use crate::vault::wipe::WipeOptions;

    #[derive(Clone, Copy, PartialEq, Eq)]
    enum Kind {
        File,
        Dir,
        Other,
    }

    #[derive(Clone, Copy)]
    struct Stat {
        kind: Kind,
        dev: u64,
        ino: u64,
        nlink: u64,
        stamp: DiskStamp,
    }

    impl Stat {
        fn same_node(&self, other: &Stat) -> bool {
            self.dev == other.dev && self.ino == other.ino && self.kind == other.kind
        }
    }

    // `libc::stat` field widths differ across Unix; the casts are no-ops on Linux.
    #[allow(clippy::unnecessary_cast)]
    fn from_raw(st: &libc::stat) -> Stat {
        let kind = match st.st_mode & libc::S_IFMT {
            libc::S_IFREG => Kind::File,
            libc::S_IFDIR => Kind::Dir,
            _ => Kind::Other,
        };
        let dev = st.st_dev as u64;
        let ino = st.st_ino as u64;
        Stat {
            kind,
            dev,
            ino,
            nlink: st.st_nlink as u64,
            stamp: DiskStamp {
                len: st.st_size.max(0) as u64,
                modified: nanos(st.st_mtime as i64, st.st_mtime_nsec as i64),
                changed: nanos(st.st_ctime as i64, st.st_ctime_nsec as i64),
                inode: Some((dev, ino)),
            },
        }
    }

    fn nanos(secs: i64, nsec: i64) -> i128 {
        i128::from(secs) * 1_000_000_000 + i128::from(nsec)
    }

    fn cstring(bytes: &[u8]) -> io::Result<CString> {
        CString::new(bytes).map_err(|_| io::Error::from(io::ErrorKind::InvalidInput))
    }

    fn check(rc: libc::c_int) -> io::Result<()> {
        if rc < 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    }

    struct Dir {
        fd: OwnedFd,
    }

    const DIR_FLAGS: libc::c_int =
        libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC;

    impl Dir {
        fn open(path: &Path) -> io::Result<(Self, Stat)> {
            let c = cstring(path.as_os_str().as_bytes())?;
            let fd = unsafe { libc::open(c.as_ptr(), DIR_FLAGS) };
            Self::adopt(fd)
        }

        fn open_child(&self, name: &CStr) -> io::Result<(Self, Stat)> {
            let fd = unsafe { libc::openat(self.fd.as_raw_fd(), name.as_ptr(), DIR_FLAGS) };
            Self::adopt(fd)
        }

        fn adopt(fd: libc::c_int) -> io::Result<(Self, Stat)> {
            if fd < 0 {
                return Err(io::Error::last_os_error());
            }
            let dir = Self {
                fd: unsafe { OwnedFd::from_raw_fd(fd) },
            };
            let stat = fstat(dir.fd.as_raw_fd())?;
            Ok((dir, stat))
        }

        fn stat_child(&self, name: &CStr) -> io::Result<Stat> {
            let mut st: libc::stat = unsafe { std::mem::zeroed() };
            check(unsafe {
                libc::fstatat(
                    self.fd.as_raw_fd(),
                    name.as_ptr(),
                    &mut st,
                    libc::AT_SYMLINK_NOFOLLOW,
                )
            })?;
            Ok(from_raw(&st))
        }

        fn names(&self) -> io::Result<Vec<CString>> {
            let dup = unsafe { libc::fcntl(self.fd.as_raw_fd(), libc::F_DUPFD_CLOEXEC, 0) };
            if dup < 0 {
                return Err(io::Error::last_os_error());
            }
            let stream = unsafe { libc::fdopendir(dup) };
            if stream.is_null() {
                let error = io::Error::last_os_error();
                unsafe { libc::close(dup) };
                return Err(error);
            }
            unsafe { libc::rewinddir(stream) };
            let mut names = Vec::new();
            loop {
                let entry = unsafe { libc::readdir(stream) };
                if entry.is_null() {
                    break;
                }
                let name = unsafe { CStr::from_ptr((*entry).d_name.as_ptr()) };
                let bytes = name.to_bytes();
                if bytes != b"." && bytes != b".." {
                    names.push(name.to_owned());
                }
            }
            unsafe { libc::closedir(stream) };
            Ok(names)
        }

        fn open_file(&self, name: &CStr, write: bool) -> io::Result<std::fs::File> {
            let access = if write {
                libc::O_WRONLY
            } else {
                libc::O_RDONLY
            };
            let flags =
                access | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_NOCTTY | libc::O_CLOEXEC;
            let fd = unsafe { libc::openat(self.fd.as_raw_fd(), name.as_ptr(), flags) };
            if fd < 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(unsafe { std::fs::File::from_raw_fd(fd) })
        }

        fn unlink(&self, name: &CStr, dir: bool) -> io::Result<()> {
            let flags = if dir { libc::AT_REMOVEDIR } else { 0 };
            match check(unsafe { libc::unlinkat(self.fd.as_raw_fd(), name.as_ptr(), flags) }) {
                Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
                other => other,
            }
        }
    }

    fn fstat(fd: libc::c_int) -> io::Result<Stat> {
        let mut st: libc::stat = unsafe { std::mem::zeroed() };
        check(unsafe { libc::fstat(fd, &mut st) })?;
        Ok(from_raw(&st))
    }

    pub(super) fn sweep(folder: &Path, walk: &mut Walk<'_>) -> io::Result<()> {
        let (root, stat) = Dir::open(folder)?;
        if stat.kind != Kind::Dir {
            return Err(io::Error::from(io::ErrorKind::NotADirectory));
        }
        sweep_dir(&root, "", stat.dev, 0, walk);
        Ok(())
    }

    /// True when the folder is empty afterwards.
    fn sweep_dir(dir: &Dir, rel: &str, root_dev: u64, depth: usize, walk: &mut Walk<'_>) -> bool {
        let Ok(names) = dir.names() else {
            walk.out.keep(rel);
            return false;
        };
        let mut emptied = true;
        for name in names {
            let text = String::from_utf8_lossy(name.to_bytes()).into_owned();
            if walk.skipped(rel, &text) {
                emptied = false;
                continue;
            }
            let child = child_rel(rel, &text);
            let stat = match dir.stat_child(&name) {
                Ok(stat) => stat,
                Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
                Err(_) => {
                    walk.out.keep(&child);
                    emptied = false;
                    continue;
                }
            };
            let removed = match stat.kind {
                Kind::Dir => sweep_child_dir(dir, &name, &child, &stat, root_dev, depth, walk),
                Kind::File => match (walk.choose)(&child, &stat.stamp) {
                    Visit::Keep => false,
                    Visit::Wipe => match wipe_file_at(dir, &name, &stat, walk.opts) {
                        Ok(()) => {
                            walk.out.wiped += 1;
                            true
                        }
                        Err(_) => false,
                    },
                },
                // A link, pipe, socket, or device holds no vault bytes.
                Kind::Other => dir.unlink(&name, false).is_ok(),
            };
            if !removed {
                if stat.kind != Kind::Dir {
                    walk.out.keep(&child);
                }
                emptied = false;
            }
        }
        emptied
    }

    fn sweep_child_dir(
        parent: &Dir,
        name: &CStr,
        rel: &str,
        seen: &Stat,
        root_dev: u64,
        depth: usize,
        walk: &mut Walk<'_>,
    ) -> bool {
        if seen.dev != root_dev || depth + 1 > MAX_DEPTH {
            walk.out.keep(rel);
            return false;
        }
        let child = match parent.open_child(name) {
            Ok((child, stat)) if stat.same_node(seen) => child,
            _ => {
                walk.out.keep(rel);
                return false;
            }
        };
        let emptied = sweep_dir(&child, rel, root_dev, depth + 1, walk);
        drop(child);
        if !emptied {
            return false;
        }
        if parent.unlink(name, true).is_err() {
            walk.out.keep(rel);
            return false;
        }
        true
    }

    fn wipe_file_at(dir: &Dir, name: &CStr, seen: &Stat, opts: &WipeOptions) -> io::Result<()> {
        if seen.nlink <= 1 && seen.stamp.len > 0 {
            let mut file = open_writable(dir, name, seen)?;
            let now = fstat(file.as_raw_fd())?;
            if !now.same_node(seen) {
                return Err(io::Error::other("file was replaced"));
            }
            if now.nlink <= 1 {
                overwrite(&mut file, now.stamp.len, opts)?;
            }
        }
        dir.unlink(name, false)
    }

    /// A read-only file is made writable through a read-only descriptor of the
    /// same file, so the mode change cannot land on a link swapped in later.
    fn open_writable(dir: &Dir, name: &CStr, seen: &Stat) -> io::Result<std::fs::File> {
        match dir.open_file(name, true) {
            Err(error) if error.kind() == io::ErrorKind::PermissionDenied => {
                let read_only = dir.open_file(name, false)?;
                if !fstat(read_only.as_raw_fd())?.same_node(seen) {
                    return Err(io::Error::other("file was replaced"));
                }
                check(unsafe { libc::fchmod(read_only.as_raw_fd(), 0o600 as libc::mode_t) })?;
                dir.open_file(name, true)
            }
            other => other,
        }
    }

    pub(super) fn wipe_one(
        path: &Path,
        expected: &DiskStamp,
        opts: &WipeOptions,
    ) -> io::Result<bool> {
        let (Some(parent), Some(name)) = (path.parent(), path.file_name()) else {
            return Ok(false);
        };
        let (dir, _) = match Dir::open(parent) {
            Ok(opened) => opened,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
            Err(error) => return Err(error),
        };
        let name = cstring(name.as_bytes())?;
        let stat = match dir.stat_child(&name) {
            Ok(stat) => stat,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
            Err(error) => return Err(error),
        };
        if stat.kind != Kind::File || stat.stamp != *expected {
            return Ok(false);
        }
        wipe_file_at(&dir, &name, &stat, opts)?;
        Ok(true)
    }
}

#[cfg(windows)]
mod local {
    use std::io;
    use std::os::windows::fs::OpenOptionsExt;
    use std::path::Path;

    use super::{child_rel, overwrite, DiskStamp, Visit, Walk, MAX_DEPTH};
    use crate::host_fs::{
        windows_file_info, windows_open_attributes, WindowsFileInfo,
        WINDOWS_FILE_ATTRIBUTE_DIRECTORY as DIRECTORY,
        WINDOWS_FILE_ATTRIBUTE_REPARSE_POINT as REPARSE_POINT,
    };
    use crate::vault::plain::disk::stamp_of_info;
    use crate::vault::wipe::WipeOptions;

    const FILE_SHARE_READ: u32 = 0x1;
    const FILE_SHARE_WRITE: u32 = 0x2;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    const FILE_ATTRIBUTE_READONLY: u32 = 0x1;

    /// The folder is open without delete sharing, so it cannot be renamed,
    /// removed, or replaced by a junction while this handle lives.
    fn hold_dir(path: &Path) -> io::Result<(std::fs::File, u32)> {
        let file = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
            .open(path)?;
        let info = windows_file_info(&file)?;
        if info.attributes & REPARSE_POINT != 0 || info.attributes & DIRECTORY == 0 {
            return Err(io::Error::other("not a plain folder"));
        }
        Ok((file, info.volume_serial))
    }

    /// The entry itself, never what a link or junction points at.
    fn inspect(path: &Path) -> io::Result<WindowsFileInfo> {
        windows_file_info(&windows_open_attributes(path)?)
    }

    pub(super) fn sweep(folder: &Path, walk: &mut Walk<'_>) -> io::Result<()> {
        let (hold, volume) = hold_dir(folder)?;
        sweep_dir(folder, "", volume, 0, walk);
        drop(hold);
        Ok(())
    }

    fn sweep_dir(path: &Path, rel: &str, volume: u32, depth: usize, walk: &mut Walk<'_>) -> bool {
        let Ok(entries) = std::fs::read_dir(path) else {
            walk.out.keep(rel);
            return false;
        };
        let mut emptied = true;
        for entry in entries {
            let Ok(entry) = entry else {
                emptied = false;
                continue;
            };
            let text = entry.file_name().to_string_lossy().into_owned();
            if walk.skipped(rel, &text) {
                emptied = false;
                continue;
            }
            let child = child_rel(rel, &text);
            let child_path = entry.path();
            let info = match inspect(&child_path) {
                Ok(info) => info,
                Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
                Err(_) => {
                    walk.out.keep(&child);
                    emptied = false;
                    continue;
                }
            };
            let is_dir = info.attributes & DIRECTORY != 0;
            let removed = if info.attributes & REPARSE_POINT != 0 {
                // A symlink or junction holds no vault bytes. Removing it
                // never touches its target.
                remove_link(&child_path, is_dir).is_ok()
            } else if is_dir {
                sweep_child_dir(&child_path, &child, volume, depth, walk)
            } else {
                match (walk.choose)(&child, &stamp_of_info(&info)) {
                    Visit::Keep => false,
                    Visit::Wipe => match wipe_file(&child_path, &info, walk.opts) {
                        Ok(()) => {
                            walk.out.wiped += 1;
                            true
                        }
                        Err(_) => false,
                    },
                }
            };
            if !removed {
                if !is_dir || info.attributes & REPARSE_POINT != 0 {
                    walk.out.keep(&child);
                }
                emptied = false;
            }
        }
        emptied
    }

    fn remove_link(path: &Path, is_dir: bool) -> io::Result<()> {
        if is_dir {
            std::fs::remove_dir(path)
        } else {
            std::fs::remove_file(path)
        }
    }

    fn sweep_child_dir(
        path: &Path,
        rel: &str,
        volume: u32,
        depth: usize,
        walk: &mut Walk<'_>,
    ) -> bool {
        if depth + 1 > MAX_DEPTH {
            walk.out.keep(rel);
            return false;
        }
        let hold = match hold_dir(path) {
            Ok((hold, child_volume)) if child_volume == volume => hold,
            _ => {
                walk.out.keep(rel);
                return false;
            }
        };
        let emptied = sweep_dir(path, rel, volume, depth + 1, walk);
        drop(hold);
        if !emptied {
            return false;
        }
        if std::fs::remove_dir(path).is_err() {
            walk.out.keep(rel);
            return false;
        }
        true
    }

    /// Overwrite the file `seen` describes, then remove its name. A file with
    /// another name elsewhere is only unlinked.
    fn wipe_file(path: &Path, seen: &WindowsFileInfo, opts: &WipeOptions) -> io::Result<()> {
        if seen.attributes & FILE_ATTRIBUTE_READONLY != 0 {
            let mut perms = std::fs::symlink_metadata(path)?.permissions();
            #[allow(clippy::permissions_set_readonly_false)]
            perms.set_readonly(false);
            std::fs::set_permissions(path, perms)?;
        }
        if seen.len > 0 {
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
                .open(path)?;
            let info = windows_file_info(&file)?;
            if info.attributes & (REPARSE_POINT | DIRECTORY) != 0
                || info.index != seen.index
                || info.volume_serial != seen.volume_serial
            {
                return Err(io::Error::other("file was replaced"));
            }
            if info.links <= 1 {
                overwrite(&mut file, info.len, opts)?;
                drop(file);
                overwrite_named_streams(path, opts)?;
            }
        }
        match std::fs::remove_file(path) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            other => other,
        }
    }

    /// Another app can keep bytes in a named stream (`notes.txt:draft`).
    /// Deleting the file frees them without an overwrite.
    fn overwrite_named_streams(path: &Path, opts: &WipeOptions) -> io::Result<()> {
        for (name, len) in named_streams(path)? {
            if len == 0 {
                continue;
            }
            let mut stream_path = path.as_os_str().to_owned();
            stream_path.push(":");
            stream_path.push(&name);
            let mut stream = std::fs::OpenOptions::new()
                .write(true)
                .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
                .open(Path::new(&stream_path))?;
            overwrite(&mut stream, len, opts)?;
        }
        Ok(())
    }

    /// Named streams of `path` as `(name, length)`, without the main stream.
    fn named_streams(path: &Path) -> io::Result<Vec<(String, u64)>> {
        const MAX_STREAM_NAME: usize = 260 + 36;
        const ERROR_HANDLE_EOF: i32 = 38;
        #[repr(C)]
        struct FindStreamData {
            size: i64,
            name: [u16; MAX_STREAM_NAME],
        }
        #[link(name = "kernel32")]
        extern "system" {
            fn FindFirstStreamW(
                file: *const u16,
                level: i32,
                data: *mut FindStreamData,
                flags: u32,
            ) -> *mut core::ffi::c_void;
            fn FindNextStreamW(find: *mut core::ffi::c_void, data: *mut FindStreamData) -> i32;
            fn FindClose(find: *mut core::ffi::c_void) -> i32;
        }
        let wide = crate::host_fs::windows_verbatim_wide(path);
        let mut data = FindStreamData {
            size: 0,
            name: [0; MAX_STREAM_NAME],
        };
        let find = unsafe { FindFirstStreamW(wide.as_ptr(), 0, &mut data, 0) };
        if find as isize == -1 {
            let error = io::Error::last_os_error();
            return if error.raw_os_error() == Some(ERROR_HANDLE_EOF) {
                Ok(Vec::new())
            } else {
                Err(error)
            };
        }
        let mut streams = Vec::new();
        loop {
            let end = data
                .name
                .iter()
                .position(|&unit| unit == 0)
                .unwrap_or(MAX_STREAM_NAME);
            let full = String::from_utf16_lossy(&data.name[..end]);
            // `:name:$DATA`; the main stream is `::$DATA`.
            if let Some(name) = full
                .strip_prefix(':')
                .and_then(|rest| rest.strip_suffix(":$DATA"))
                .filter(|name| !name.is_empty())
            {
                streams.push((name.to_string(), data.size.max(0) as u64));
            }
            if unsafe { FindNextStreamW(find, &mut data) } == 0 {
                break;
            }
        }
        unsafe { FindClose(find) };
        Ok(streams)
    }

    pub(super) fn wipe_one(
        path: &Path,
        expected: &DiskStamp,
        opts: &WipeOptions,
    ) -> io::Result<bool> {
        let info = match inspect(path) {
            Ok(info) => info,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
            Err(error) => return Err(error),
        };
        if info.attributes & (REPARSE_POINT | DIRECTORY) != 0 || stamp_of_info(&info) != *expected {
            return Ok(false);
        }
        wipe_file(path, &info, opts)?;
        Ok(true)
    }
}

#[cfg(not(any(unix, windows)))]
mod local {
    use std::io;
    use std::path::Path;

    use super::{DiskStamp, Walk};
    use crate::vault::wipe::WipeOptions;

    pub(super) fn sweep(_folder: &Path, _walk: &mut Walk<'_>) -> io::Result<()> {
        Err(io::Error::from(io::ErrorKind::Unsupported))
    }

    pub(super) fn wipe_one(
        _path: &Path,
        _expected: &DiskStamp,
        _opts: &WipeOptions,
    ) -> io::Result<bool> {
        Err(io::Error::from(io::ErrorKind::Unsupported))
    }
}

/// Storage-access folders have no links, hard links, or mount points.
mod bridge {
    use std::io;
    use std::path::Path;

    use super::{child_rel, DiskStamp, Visit, Walk, MAX_DEPTH};
    use crate::host_fs::{self, HostFsQuery};
    use crate::vault::plain::disk;
    use crate::vault::wipe::WipeOptions;

    pub(super) fn sweep(folder: &Path, walk: &mut Walk<'_>) -> io::Result<()> {
        if !folder.host_is_dir() {
            return Err(io::Error::from(io::ErrorKind::NotFound));
        }
        sweep_dir(folder, "", 0, walk);
        Ok(())
    }

    fn sweep_dir(path: &Path, rel: &str, depth: usize, walk: &mut Walk<'_>) -> bool {
        let Ok(entries) = host_fs::read_dir(path) else {
            walk.out.keep(rel);
            return false;
        };
        let mut emptied = true;
        for entry in entries {
            let Ok(entry) = entry else {
                emptied = false;
                continue;
            };
            let text = entry.file_name().to_string_lossy().into_owned();
            if walk.skipped(rel, &text) {
                emptied = false;
                continue;
            }
            let child = child_rel(rel, &text);
            let child_path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                walk.out.keep(&child);
                emptied = false;
                continue;
            };
            if file_type.host_is_dir() {
                if depth + 1 > MAX_DEPTH {
                    walk.out.keep(&child);
                    emptied = false;
                    continue;
                }
                let child_empty = sweep_dir(&child_path, &child, depth + 1, walk);
                if !child_empty || host_fs::remove_dir(&child_path).is_err() {
                    if child_empty {
                        walk.out.keep(&child);
                    }
                    emptied = false;
                }
                continue;
            }
            let stamp = disk::listed_stamp(&entry);
            let wiped = match (walk.choose)(&child, &stamp) {
                Visit::Keep => false,
                Visit::Wipe => wipe_file(&child_path, walk.opts).is_ok(),
            };
            if wiped {
                walk.out.wiped += 1;
            } else {
                walk.out.keep(&child);
                emptied = false;
            }
        }
        emptied
    }

    fn wipe_file(path: &Path, opts: &WipeOptions) -> io::Result<()> {
        crate::vault::wipe::wipe_file_then_unlink(path, opts)
    }

    pub(super) fn wipe_one(
        path: &Path,
        expected: &DiskStamp,
        opts: &WipeOptions,
    ) -> io::Result<bool> {
        match disk::stamp_at(path)? {
            Some(disk::Seen::File(stamp)) if stamp == *expected => {
                wipe_file(path, opts)?;
                Ok(true)
            }
            _ => Ok(false),
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::config::vault_config::VaultWipePattern;

    fn opts() -> WipeOptions {
        WipeOptions {
            passes: 1,
            pattern: VaultWipePattern::Zeros,
        }
    }

    fn wipe_all(_: &str, _: &DiskStamp) -> Visit {
        Visit::Wipe
    }

    #[test]
    fn sweep_wipes_files_and_folders_but_not_the_top_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let folder = tmp.path().join("leaf");
        std::fs::create_dir_all(folder.join("a/b")).unwrap();
        std::fs::write(folder.join("a/b/c.txt"), b"secret").unwrap();
        std::fs::write(folder.join("top.txt"), b"secret").unwrap();
        std::fs::write(folder.join(".upriv-plain"), b"marker").unwrap();

        let swept = sweep_folder(&folder, &[".upriv-plain"], &opts(), &mut wipe_all).unwrap();
        assert_eq!(swept.wiped, 2);
        assert!(swept.kept.is_empty());
        assert!(folder.is_dir());
        assert!(!folder.join("a").exists());
        assert!(folder.join(".upriv-plain").exists());
    }

    #[test]
    fn sweep_unlinks_a_link_and_never_touches_its_target() {
        let tmp = tempfile::tempdir().unwrap();
        let folder = tmp.path().join("leaf");
        let outside = tmp.path().join("outside");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("keep.txt"), b"not vault data").unwrap();
        std::os::unix::fs::symlink(&outside, folder.join("dir-link")).unwrap();
        std::os::unix::fs::symlink(outside.join("keep.txt"), folder.join("file-link")).unwrap();

        let swept = sweep_folder(&folder, &[], &opts(), &mut wipe_all).unwrap();
        assert!(swept.kept.is_empty());
        assert!(std::fs::symlink_metadata(folder.join("dir-link")).is_err());
        assert!(std::fs::symlink_metadata(folder.join("file-link")).is_err());
        assert_eq!(
            std::fs::read(outside.join("keep.txt")).unwrap(),
            b"not vault data"
        );
    }

    #[test]
    fn sweep_unlinks_a_hard_link_without_overwriting_the_other_name() {
        let tmp = tempfile::tempdir().unwrap();
        let folder = tmp.path().join("leaf");
        std::fs::create_dir_all(&folder).unwrap();
        let outside = tmp.path().join("elsewhere.txt");
        std::fs::write(&outside, b"other file").unwrap();
        std::fs::hard_link(&outside, folder.join("linked.txt")).unwrap();

        let swept = sweep_folder(&folder, &[], &opts(), &mut wipe_all).unwrap();
        assert_eq!(swept.wiped, 1);
        assert!(!folder.join("linked.txt").exists());
        assert_eq!(std::fs::read(&outside).unwrap(), b"other file");
    }

    #[test]
    fn sweep_overwrites_before_unlinking() {
        let tmp = tempfile::tempdir().unwrap();
        let folder = tmp.path().join("leaf");
        std::fs::create_dir_all(&folder).unwrap();
        let path = folder.join("secret.txt");
        std::fs::write(&path, b"plaintext").unwrap();
        // An open descriptor still sees the inode after the name is gone.
        let mut reader = std::fs::File::open(&path).unwrap();

        sweep_folder(&folder, &[], &opts(), &mut wipe_all).unwrap();
        let mut left = Vec::new();
        std::io::Read::read_to_end(&mut reader, &mut left).unwrap();
        assert_eq!(left, vec![0u8; b"plaintext".len()]);
    }

    #[test]
    fn sweep_keeps_what_choose_keeps_and_the_folders_that_hold_it() {
        let tmp = tempfile::tempdir().unwrap();
        let folder = tmp.path().join("leaf");
        std::fs::create_dir_all(folder.join("docs")).unwrap();
        std::fs::write(folder.join("docs/unsaved.txt"), b"new").unwrap();
        std::fs::write(folder.join("docs/saved.txt"), b"old").unwrap();

        let mut choose = |rel: &str, _: &DiskStamp| {
            if rel == "docs/unsaved.txt" {
                Visit::Keep
            } else {
                Visit::Wipe
            }
        };
        let swept = sweep_folder(&folder, &[], &opts(), &mut choose).unwrap();
        assert_eq!(swept.wiped, 1);
        assert_eq!(swept.kept, vec!["docs/unsaved.txt".to_string()]);
        assert!(folder.join("docs/unsaved.txt").exists());
        assert!(!folder.join("docs/saved.txt").exists());
    }

    #[test]
    fn sweep_wipes_a_read_only_file() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempfile::tempdir().unwrap();
        let folder = tmp.path().join("leaf");
        std::fs::create_dir_all(&folder).unwrap();
        let path = folder.join("locked.txt");
        std::fs::write(&path, b"secret").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o400)).unwrap();

        let swept = sweep_folder(&folder, &[], &opts(), &mut wipe_all).unwrap();
        assert_eq!(swept.wiped, 1);
        assert!(!path.exists());
    }

    #[test]
    fn sweep_refuses_a_top_folder_that_is_a_link() {
        let tmp = tempfile::tempdir().unwrap();
        let real = tmp.path().join("real");
        std::fs::create_dir_all(&real).unwrap();
        std::fs::write(real.join("keep.txt"), b"x").unwrap();
        let link = tmp.path().join("leaf");
        std::os::unix::fs::symlink(&real, &link).unwrap();

        assert!(sweep_folder(&link, &[], &opts(), &mut wipe_all).is_err());
        assert!(real.join("keep.txt").exists());
    }

    #[test]
    fn wipe_one_leaves_a_changed_file() {
        let tmp = tempfile::tempdir().unwrap();
        let folder = tmp.path().join("leaf");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("a.txt"), b"one").unwrap();
        let Some(super::super::disk::Seen::File(stamp)) =
            super::super::disk::stamp_at(&folder.join("a.txt")).unwrap()
        else {
            panic!("file");
        };
        std::fs::write(folder.join("a.txt"), b"changed by another app").unwrap();
        assert!(!wipe_one(&folder, "a.txt", &stamp, &opts()).unwrap());
        assert!(folder.join("a.txt").exists());

        let Some(super::super::disk::Seen::File(stamp)) =
            super::super::disk::stamp_at(&folder.join("a.txt")).unwrap()
        else {
            panic!("file");
        };
        assert!(wipe_one(&folder, "a.txt", &stamp, &opts()).unwrap());
        assert!(!folder.join("a.txt").exists());
    }
}
