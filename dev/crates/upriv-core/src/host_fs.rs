//! Filesystem gate for vault I/O.
//!
//! Desktop paths use `std::fs`. On Android a user-chosen data folder is a
//! storage-access tree (`content://`), which is not a path `std::fs` can open.
//! While that folder is mounted, every path under [`SAF_VAULT_ROOT`] is sent to
//! the bridge. The logical path is never created on disk.

use std::fs::OpenOptions as StdOpenOptions;
use std::io::{self, Read, Seek, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

pub use std::fs::{FileType, Metadata, Permissions};

/// Logical vault root while a storage-access tree is the data folder.
/// Not a directory on disk. Bytes live in the mounted bridge.
pub const SAF_VAULT_ROOT: &str = "/upriv-saf-root";

/// Android (or a test) implementation of the mounted data folder.
pub trait SafBridge: Send + Sync {
    /// `op` is `stat`, `mkdir`, `remove_file`, `remove_dir`, `remove_dir_all`,
    /// `rename`, `list`, or `open`. `payload` and the returned text are JSON.
    /// Failures are `{"ok":false,"err":"...","message":"..."}` with `err` one of
    /// `not_found`, `already_exists`, `is_a_directory`, `not_a_directory`,
    /// `not_empty`, `permission_denied`, `invalid_input`, `other`.
    fn dispatch(&self, op: &str, payload: &str) -> io::Result<String>;
}

#[derive(Clone)]
enum Mounted {
    Bridge(Arc<dyn SafBridge>),
}

static MOUNT: Mutex<Option<Mounted>> = Mutex::new(None);

fn mount_lock() -> std::sync::MutexGuard<'static, Option<Mounted>> {
    MOUNT
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Send later vault I/O under [`SAF_VAULT_ROOT`] to `bridge`.
pub fn mount_bridge(bridge: Arc<dyn SafBridge>) {
    *mount_lock() = Some(Mounted::Bridge(bridge));
}

/// Drop the mounted data folder. Later I/O under [`SAF_VAULT_ROOT`] fails.
pub fn unmount() {
    *mount_lock() = None;
}

/// Whether a storage-access tree is currently attached at [`SAF_VAULT_ROOT`].
pub fn is_saf_mounted() -> bool {
    mount_lock().is_some()
}

/// The alias path is the logical root, and no grant is mounted yet.
///
/// That path is not a disk folder. Opening it before the mount is not a
/// failed read of the data folder.
pub fn is_unmounted_saf_root(path: &Path) -> bool {
    path == Path::new(SAF_VAULT_ROOT) && !is_saf_mounted()
}

/// Create, write, and exclusive-lock one file on the mounted data folder, then delete it.
///
/// A folder that fails this cannot host a vault. The lock is the same `flock` the
/// open-vault lockfile uses.
pub fn probe_mounted() -> io::Result<()> {
    let path = Path::new(SAF_VAULT_ROOT).join(".upriv-write-probe");
    let _ = remove_file(&path);
    let mut file = File::create(&path)?;
    let result = probe_file(&mut file);
    drop(file);
    let _ = remove_file(&path);
    result
}

fn probe_file(file: &mut File) -> io::Result<()> {
    file.write_all(&[0])?;
    file.sync_all()?;
    exclusive_lock(file)
}

/// `flock` / `fsync` on a storage-access fd often returns these. The bytes
/// still persist when the fd is closed.
pub(crate) fn unsupported_fs_op(error: &io::Error) -> bool {
    #[cfg(unix)]
    {
        matches!(
            error.raw_os_error(),
            Some(libc::EINVAL | libc::EOPNOTSUPP | libc::ENOSYS)
        )
    }
    #[cfg(not(unix))]
    {
        let _ = error;
        false
    }
}

/// `ftruncate` on a storage-access fd. The bytes already written stay; the
/// provider persists them when the fd is closed. These errnos mean the fd
/// cannot be resized, not that the write failed.
fn bridge_truncate_unsupported(error: &io::Error) -> bool {
    if unsupported_fs_op(error) {
        return true;
    }
    #[cfg(unix)]
    {
        matches!(
            error.raw_os_error(),
            Some(
                libc::EPERM
                    | libc::EACCES
                    | libc::EBADF
                    | libc::ENOTTY
                    | libc::ESPIPE
                    | libc::EROFS
            )
        )
    }
    #[cfg(not(unix))]
    {
        false
    }
}

#[cfg(unix)]
fn exclusive_lock(file: &File) -> io::Result<()> {
    let fd = std::os::fd::AsRawFd::as_raw_fd(file);
    let locked = unsafe { libc::flock(fd, libc::LOCK_EX | libc::LOCK_NB) };
    if locked != 0 {
        let error = io::Error::last_os_error();
        return if unsupported_fs_op(&error) {
            Ok(())
        } else {
            Err(error)
        };
    }
    let unlocked = unsafe { libc::flock(fd, libc::LOCK_UN) };
    if unlocked != 0 {
        let error = io::Error::last_os_error();
        if unsupported_fs_op(&error) {
            return Ok(());
        }
        return Err(error);
    }
    Ok(())
}

#[cfg(not(unix))]
fn exclusive_lock(_file: &File) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "storage-access probe is only available on Android",
    ))
}

pub trait HostFsQuery {
    fn host_is_dir(&self) -> bool;
    fn host_is_file(&self) -> bool;
    fn host_exists(&self) -> bool;
}

impl HostFsQuery for Path {
    fn host_is_dir(&self) -> bool {
        is_dir(self)
    }

    fn host_is_file(&self) -> bool {
        is_file(self)
    }

    fn host_exists(&self) -> bool {
        exists(self)
    }
}

impl HostFsQuery for PathBuf {
    fn host_is_dir(&self) -> bool {
        is_dir(self)
    }

    fn host_is_file(&self) -> bool {
        is_file(self)
    }

    fn host_exists(&self) -> bool {
        exists(self)
    }
}

impl HostFsQuery for Metadata {
    fn host_is_dir(&self) -> bool {
        Metadata::is_dir(self)
    }

    fn host_is_file(&self) -> bool {
        Metadata::is_file(self)
    }

    fn host_exists(&self) -> bool {
        true
    }
}

impl HostFsQuery for FileType {
    fn host_is_dir(&self) -> bool {
        FileType::is_dir(self)
    }

    fn host_is_file(&self) -> bool {
        FileType::is_file(self)
    }

    fn host_exists(&self) -> bool {
        true
    }
}

/// Kind of one directory entry. Listed bridge rows do not need a `FileType`
/// loaded from a temporary file.
#[derive(Clone, Copy)]
pub struct EntryFileType {
    kind: EntryFileKind,
}

#[derive(Clone, Copy)]
enum EntryFileKind {
    Disk(FileType),
    Listed { dir: bool },
}

impl EntryFileType {
    fn from_disk(file_type: FileType) -> Self {
        Self {
            kind: EntryFileKind::Disk(file_type),
        }
    }

    fn listed(dir: bool) -> Self {
        Self {
            kind: EntryFileKind::Listed { dir },
        }
    }

    pub fn is_symlink(&self) -> bool {
        match self.kind {
            EntryFileKind::Disk(file_type) => file_type.is_symlink(),
            // A storage-access listing has no symlink nodes.
            EntryFileKind::Listed { .. } => false,
        }
    }
}

impl HostFsQuery for EntryFileType {
    fn host_is_dir(&self) -> bool {
        match self.kind {
            EntryFileKind::Disk(file_type) => file_type.is_dir(),
            EntryFileKind::Listed { dir } => dir,
        }
    }

    fn host_is_file(&self) -> bool {
        match self.kind {
            EntryFileKind::Disk(file_type) => file_type.is_file(),
            EntryFileKind::Listed { dir } => !dir,
        }
    }

    fn host_exists(&self) -> bool {
        true
    }
}

enum Route {
    Local,
    Bridge {
        rel: String,
        bridge: Arc<dyn SafBridge>,
        logical: PathBuf,
    },
}

fn route(path: &Path) -> io::Result<Route> {
    let logical = match classify_saf(path)? {
        SafPath::Outside => return Ok(Route::Local),
        SafPath::Inside(logical) => logical,
    };
    let mounted = mount_lock().clone();
    match mounted {
        Some(Mounted::Bridge(bridge)) => Ok(Route::Bridge {
            rel: rel_of(&logical)?,
            bridge,
            logical,
        }),
        None => Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "storage-access data folder is not mounted",
        )),
    }
}

enum SafPath {
    /// Not under the logical data folder. Desktop paths use the real disk.
    Outside,
    /// Normalizes to a child of [`SAF_VAULT_ROOT`].
    Inside(PathBuf),
}

/// A path that names the logical root and then climbs out of it is rejected.
/// Falling through to `std::fs` would create that file on the real disk.
fn classify_saf(path: &Path) -> io::Result<SafPath> {
    if !path.is_absolute() {
        return Ok(SafPath::Outside);
    }
    // A normal absolute path is rejected from its first name. Copying every
    // component first allocated on each desktop call and then threw the copy
    // away. `..` can still climb into the logical root, so that form is
    // normalized below.
    let mut climbed = false;
    let mut first_normal = None;
    for component in path.components() {
        match component {
            Component::Prefix(_) => return Ok(SafPath::Outside),
            Component::ParentDir => climbed = true,
            Component::Normal(part) if first_normal.is_none() => first_normal = Some(part),
            Component::RootDir | Component::CurDir | Component::Normal(_) => {}
        }
    }
    if !climbed && first_normal.is_none_or(|part| part != "upriv-saf-root") {
        return Ok(SafPath::Outside);
    }

    let mut parts: Vec<std::ffi::OsString> = Vec::new();
    let mut escaped = false;
    for component in path.components() {
        match component {
            Component::RootDir | Component::CurDir => {}
            Component::ParentDir => {
                if parts.len() == 1 && parts[0] == "upriv-saf-root" {
                    escaped = true;
                }
                parts.pop();
            }
            Component::Normal(part) => {
                if parts.is_empty() && part == "upriv-saf-root" {
                    escaped = false;
                }
                parts.push(part.to_os_string());
            }
            Component::Prefix(_) => return Ok(SafPath::Outside),
        }
    }
    if escaped {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "path is outside the data folder",
        ));
    }
    if parts.first().is_none_or(|part| part != "upriv-saf-root") {
        return Ok(SafPath::Outside);
    }
    let mut out = PathBuf::from("/");
    for part in parts {
        out.push(part);
    }
    Ok(SafPath::Inside(out))
}

fn rel_of(logical: &Path) -> io::Result<String> {
    let root = Path::new(SAF_VAULT_ROOT);
    if logical == root {
        return Ok(String::new());
    }
    let rel = logical.strip_prefix(root).map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "path is outside the data folder",
        )
    })?;
    let mut parts = Vec::new();
    for component in rel.components() {
        match component {
            Component::Normal(part) => {
                let text = part.to_str().ok_or_else(|| {
                    io::Error::new(io::ErrorKind::InvalidInput, "data folder path is not utf-8")
                })?;
                if text.is_empty() || text == "." || text == ".." || text.contains('\0') {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidInput,
                        "data folder path is invalid",
                    ));
                }
                parts.push(text);
            }
            _ => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "data folder path is invalid",
                ));
            }
        }
    }
    Ok(parts.join("/"))
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum NodeKind {
    Missing,
    File,
    Dir,
}

struct NodeStat {
    kind: NodeKind,
}

fn bridge_call(
    bridge: &dyn SafBridge,
    op: &str,
    payload: serde_json::Value,
) -> io::Result<serde_json::Value> {
    let text = bridge.dispatch(op, &payload.to_string())?;
    let value: serde_json::Value = serde_json::from_str(&text)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    if value.get("ok").and_then(|flag| flag.as_bool()) != Some(true) {
        return Err(bridge_error(&value));
    }
    Ok(value)
}

fn bridge_error(value: &serde_json::Value) -> io::Error {
    let code = value
        .get("err")
        .and_then(|item| item.as_str())
        .unwrap_or("other");
    let message = value
        .get("message")
        .and_then(|item| item.as_str())
        .unwrap_or(code);
    let kind = match code {
        "not_found" => io::ErrorKind::NotFound,
        "already_exists" => io::ErrorKind::AlreadyExists,
        "is_a_directory" => io::ErrorKind::IsADirectory,
        "not_a_directory" => io::ErrorKind::NotADirectory,
        "not_empty" => io::ErrorKind::DirectoryNotEmpty,
        "permission_denied" => io::ErrorKind::PermissionDenied,
        "invalid_input" => io::ErrorKind::InvalidInput,
        _ => io::ErrorKind::Other,
    };
    io::Error::new(kind, message)
}

fn stat_bridge(bridge: &dyn SafBridge, rel: &str) -> io::Result<NodeStat> {
    let value = bridge_call(bridge, "stat", serde_json::json!({ "rel": rel }))?;
    let kind = match value
        .get("kind")
        .and_then(|item| item.as_str())
        .unwrap_or("missing")
    {
        "file" => NodeKind::File,
        "dir" => NodeKind::Dir,
        _ => NodeKind::Missing,
    };
    Ok(NodeStat { kind })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EntryKind {
    File,
    Dir,
    Symlink,
}

/// Kind of `path` without opening a storage-access file.
/// A bridge file's `Metadata` would otherwise open a second descriptor.
pub fn entry_kind(path: &Path) -> io::Result<EntryKind> {
    match route(path)? {
        Route::Local => {
            let meta = std::fs::symlink_metadata(path)?;
            let file_type = meta.file_type();
            if file_type.is_symlink() {
                Ok(EntryKind::Symlink)
            } else if file_type.is_file() {
                Ok(EntryKind::File)
            } else {
                Ok(EntryKind::Dir)
            }
        }
        Route::Bridge { rel, bridge, .. } => match stat_bridge(bridge.as_ref(), &rel)?.kind {
            NodeKind::Missing => Err(io::Error::new(
                io::ErrorKind::NotFound,
                "no such file or directory",
            )),
            NodeKind::File => Ok(EntryKind::File),
            NodeKind::Dir => Ok(EntryKind::Dir),
        },
    }
}

fn metadata_of(path: &Path, follow: bool) -> io::Result<Metadata> {
    match route(path)? {
        Route::Local => {
            if follow {
                std::fs::metadata(path)
            } else {
                std::fs::symlink_metadata(path)
            }
        }
        Route::Bridge { rel, bridge, .. } => {
            let stat = stat_bridge(bridge.as_ref(), &rel)?;
            match stat.kind {
                NodeKind::Missing => Err(io::Error::new(
                    io::ErrorKind::NotFound,
                    "no such file or directory",
                )),
                NodeKind::Dir => dir_template_metadata(),
                NodeKind::File => {
                    let file = open_bridge_file(bridge.as_ref(), &rel, &OpenFlags::read_only())?;
                    file.metadata()
                }
            }
        }
    }
}

fn dir_template_metadata() -> io::Result<Metadata> {
    let path = dir_template_path()?;
    std::fs::metadata(path)
}

fn dir_template_path() -> io::Result<&'static Path> {
    static DIR: OnceLock<PathBuf> = OnceLock::new();
    let path = DIR.get_or_init(|| {
        let path = std::env::temp_dir().join("upriv-saf-dir-meta");
        let _ = std::fs::create_dir_all(&path);
        path
    });
    if !path.is_dir() {
        std::fs::create_dir_all(path)?;
    }
    Ok(path)
}

pub fn metadata<P: AsRef<Path>>(path: P) -> io::Result<Metadata> {
    metadata_of(path.as_ref(), true)
}

pub fn symlink_metadata<P: AsRef<Path>>(path: P) -> io::Result<Metadata> {
    metadata_of(path.as_ref(), false)
}

pub fn exists(path: &Path) -> bool {
    match bridge_kind(path) {
        Some(kind) => matches!(kind, Ok(NodeKind::File | NodeKind::Dir)),
        None => metadata_of(path, true).is_ok(),
    }
}

pub fn is_dir(path: &Path) -> bool {
    match bridge_kind(path) {
        Some(kind) => matches!(kind, Ok(NodeKind::Dir)),
        None => metadata_of(path, true).is_ok_and(|meta| meta.is_dir()),
    }
}

pub fn is_file(path: &Path) -> bool {
    match bridge_kind(path) {
        Some(kind) => matches!(kind, Ok(NodeKind::File)),
        None => metadata_of(path, true).is_ok_and(|meta| meta.is_file()),
    }
}

/// `Some` when `path` is the mounted data folder. Kind comes from the provider
/// query, so a file check does not open a descriptor.
fn bridge_kind(path: &Path) -> Option<io::Result<NodeKind>> {
    match route(path) {
        Ok(Route::Local) => None,
        Ok(Route::Bridge { rel, bridge, .. }) => {
            Some(stat_bridge(bridge.as_ref(), &rel).map(|stat| stat.kind))
        }
        Err(error) => Some(Err(error)),
    }
}

/// True when `path` is served by the mounted storage-access bridge.
pub fn is_bridge_path(path: &Path) -> bool {
    matches!(route(path), Ok(Route::Bridge { .. }))
}

pub fn read<P: AsRef<Path>>(path: P) -> io::Result<Vec<u8>> {
    let mut file = File::open(path)?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    Ok(bytes)
}

pub fn read_to_string<P: AsRef<Path>>(path: P) -> io::Result<String> {
    let bytes = read(path)?;
    String::from_utf8(bytes).map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
}

pub fn write<P: AsRef<Path>>(path: P, contents: impl AsRef<[u8]>) -> io::Result<()> {
    let mut file = File::create(path)?;
    file.write_all(contents.as_ref())?;
    Ok(())
}

pub fn create_dir<P: AsRef<Path>>(path: P) -> io::Result<()> {
    let path = path.as_ref();
    match route(path)? {
        Route::Local => std::fs::create_dir(path),
        Route::Bridge { rel, bridge, .. } => {
            if rel.is_empty() {
                return Err(io::Error::new(
                    io::ErrorKind::AlreadyExists,
                    "data folder already exists",
                ));
            }
            bridge_call(bridge.as_ref(), "mkdir", serde_json::json!({ "rel": rel })).map(|_| ())
        }
    }
}

pub fn create_dir_all<P: AsRef<Path>>(path: P) -> io::Result<()> {
    let path = path.as_ref();
    match route(path)? {
        Route::Local => std::fs::create_dir_all(path),
        Route::Bridge { rel, bridge, .. } => {
            if rel.is_empty() {
                return match stat_bridge(bridge.as_ref(), "")?.kind {
                    NodeKind::Dir => Ok(()),
                    NodeKind::Missing => Err(io::Error::new(
                        io::ErrorKind::NotFound,
                        "data folder is not mounted",
                    )),
                    NodeKind::File => Err(io::Error::new(
                        io::ErrorKind::AlreadyExists,
                        "data folder is a file",
                    )),
                };
            }
            let mut acc = String::new();
            for part in rel.split('/') {
                if !acc.is_empty() {
                    acc.push('/');
                }
                acc.push_str(part);
                match stat_bridge(bridge.as_ref(), &acc)?.kind {
                    NodeKind::Dir => {}
                    NodeKind::Missing => {
                        bridge_call(bridge.as_ref(), "mkdir", serde_json::json!({ "rel": acc }))?;
                    }
                    NodeKind::File => {
                        return Err(io::Error::new(
                            io::ErrorKind::NotADirectory,
                            "a parent of the data folder path is a file",
                        ));
                    }
                }
            }
            Ok(())
        }
    }
}

pub fn remove_file<P: AsRef<Path>>(path: P) -> io::Result<()> {
    let path = path.as_ref();
    match route(path)? {
        Route::Local => std::fs::remove_file(path),
        Route::Bridge { rel, bridge, .. } => bridge_call(
            bridge.as_ref(),
            "remove_file",
            serde_json::json!({ "rel": rel }),
        )
        .map(|_| ()),
    }
}

pub fn remove_dir<P: AsRef<Path>>(path: P) -> io::Result<()> {
    let path = path.as_ref();
    match route(path)? {
        Route::Local => std::fs::remove_dir(path),
        Route::Bridge { rel, bridge, .. } => bridge_call(
            bridge.as_ref(),
            "remove_dir",
            serde_json::json!({ "rel": rel }),
        )
        .map(|_| ()),
    }
}

pub fn remove_dir_all<P: AsRef<Path>>(path: P) -> io::Result<()> {
    let path = path.as_ref();
    match route(path)? {
        Route::Local => std::fs::remove_dir_all(path),
        Route::Bridge { rel, bridge, .. } => bridge_call(
            bridge.as_ref(),
            "remove_dir_all",
            serde_json::json!({ "rel": rel }),
        )
        .map(|_| ()),
    }
}

pub fn rename<P: AsRef<Path>, Q: AsRef<Path>>(from: P, to: Q) -> io::Result<()> {
    let from = from.as_ref();
    let to = to.as_ref();
    match (route(from)?, route(to)?) {
        (Route::Local, Route::Local) => std::fs::rename(from, to),
        (
            Route::Bridge {
                rel: from_rel,
                bridge,
                ..
            },
            Route::Bridge { rel: to_rel, .. },
        ) => bridge_call(
            bridge.as_ref(),
            "rename",
            serde_json::json!({ "from": from_rel, "to": to_rel }),
        )
        .map(|_| ()),
        _ => Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "cannot rename across the data folder boundary",
        )),
    }
}

pub fn copy<P: AsRef<Path>, Q: AsRef<Path>>(from: P, to: Q) -> io::Result<u64> {
    let mut input = File::open(from)?;
    let mut output = File::create(to)?;
    io::copy(&mut input, &mut output)
}

pub fn set_permissions<P: AsRef<Path>>(path: P, perm: Permissions) -> io::Result<()> {
    let path = path.as_ref();
    match route(path)? {
        Route::Local => std::fs::set_permissions(path, perm),
        // Storage-access documents have no Unix mode bits. Vault durability
        // does not depend on them.
        Route::Bridge { .. } => Ok(()),
    }
}

pub fn canonicalize<P: AsRef<Path>>(path: P) -> io::Result<PathBuf> {
    let path = path.as_ref();
    match route(path)? {
        Route::Local => std::fs::canonicalize(path),
        Route::Bridge {
            logical,
            bridge,
            rel,
        } => match stat_bridge(bridge.as_ref(), &rel)?.kind {
            NodeKind::Missing => Err(io::Error::new(
                io::ErrorKind::NotFound,
                "no such file or directory",
            )),
            NodeKind::File | NodeKind::Dir => Ok(logical),
        },
    }
}

pub struct ReadDir {
    inner: ReadDirInner,
}

enum ReadDirInner {
    Std(std::fs::ReadDir),
    Listed(std::vec::IntoIter<DirEntry>),
}

impl Iterator for ReadDir {
    type Item = io::Result<DirEntry>;

    fn next(&mut self) -> Option<Self::Item> {
        match &mut self.inner {
            ReadDirInner::Std(read_dir) => {
                read_dir.next().map(|entry| entry.map(DirEntry::from_disk))
            }
            ReadDirInner::Listed(entries) => entries.next().map(Ok),
        }
    }
}

pub struct DirEntry {
    kind: DirEntryKind,
}

enum ListedKind {
    File,
    Dir,
}

enum DirEntryKind {
    Disk(std::fs::DirEntry),
    /// Kind and length came from the directory listing, so `file_type` does not
    /// open the document.
    Named {
        path: PathBuf,
        name: std::ffi::OsString,
        listed: ListedKind,
        /// `None` when the provider did not report a length. `Some(0)` is an
        /// empty file, not an unknown size.
        len: Option<u64>,
    },
}

impl DirEntry {
    fn from_disk(entry: std::fs::DirEntry) -> Self {
        Self {
            kind: DirEntryKind::Disk(entry),
        }
    }

    pub fn path(&self) -> PathBuf {
        match &self.kind {
            DirEntryKind::Disk(entry) => entry.path(),
            DirEntryKind::Named { path, .. } => path.clone(),
        }
    }

    pub fn file_name(&self) -> std::ffi::OsString {
        match &self.kind {
            DirEntryKind::Disk(entry) => entry.file_name(),
            DirEntryKind::Named { name, .. } => name.clone(),
        }
    }

    /// Length from the listing. `None` for a local entry, or when the provider
    /// omitted the size. `Some(0)` is a reported empty file.
    pub fn known_len(&self) -> Option<u64> {
        match &self.kind {
            DirEntryKind::Named { len, .. } => *len,
            DirEntryKind::Disk(_) => None,
        }
    }

    pub fn file_type(&self) -> io::Result<EntryFileType> {
        match &self.kind {
            DirEntryKind::Disk(entry) => Ok(EntryFileType::from_disk(entry.file_type()?)),
            DirEntryKind::Named { listed, .. } => {
                Ok(EntryFileType::listed(matches!(listed, ListedKind::Dir)))
            }
        }
    }

    pub fn metadata(&self) -> io::Result<Metadata> {
        match &self.kind {
            DirEntryKind::Disk(entry) => entry.metadata(),
            DirEntryKind::Named { path, .. } => metadata(path),
        }
    }
}

pub fn read_dir<P: AsRef<Path>>(path: P) -> io::Result<ReadDir> {
    let path = path.as_ref();
    match route(path)? {
        Route::Local => Ok(ReadDir {
            inner: ReadDirInner::Std(std::fs::read_dir(path)?),
        }),
        Route::Bridge {
            rel,
            bridge,
            logical,
        } => {
            let value = bridge_call(bridge.as_ref(), "list", serde_json::json!({ "rel": rel }))?;
            let entries = value
                .get("entries")
                .and_then(|item| item.as_array())
                .cloned()
                .unwrap_or_default();
            let mut listed = Vec::with_capacity(entries.len());
            for entry in entries {
                let Some(name) = entry.get("name").and_then(|item| item.as_str()) else {
                    continue;
                };
                if name.is_empty()
                    || name == "."
                    || name == ".."
                    || name.contains('/')
                    || name.contains('\0')
                {
                    continue;
                }
                let listed_kind = match entry.get("kind").and_then(|item| item.as_str()) {
                    Some("dir") => ListedKind::Dir,
                    Some("file") => ListedKind::File,
                    _ => continue,
                };
                // Missing or negative: the provider did not report a size.
                // Zero stays `Some(0)` so an empty file is not opened again.
                let len = entry.get("len").and_then(|item| item.as_u64());
                listed.push(DirEntry {
                    kind: DirEntryKind::Named {
                        path: logical.join(name),
                        name: std::ffi::OsString::from(name),
                        listed: listed_kind,
                        len,
                    },
                });
            }
            Ok(ReadDir {
                inner: ReadDirInner::Listed(listed.into_iter()),
            })
        }
    }
}

#[derive(Clone, Debug)]
struct OpenFlags {
    read: bool,
    write: bool,
    append: bool,
    truncate: bool,
    create: bool,
    create_new: bool,
}

impl OpenFlags {
    fn read_only() -> Self {
        Self {
            read: true,
            write: false,
            append: false,
            truncate: false,
            create: false,
            create_new: false,
        }
    }

    fn wants_write(&self) -> bool {
        self.write || self.append || self.create || self.create_new || self.truncate
    }
}

fn open_bridge_file(
    bridge: &dyn SafBridge,
    rel: &str,
    flags: &OpenFlags,
) -> io::Result<std::fs::File> {
    let value = bridge_call(
        bridge,
        "open",
        serde_json::json!({
            "rel": rel,
            "read": flags.read || flags.append,
            "write": flags.wants_write(),
            "append": flags.append,
            "truncate": flags.truncate,
            "create": flags.create || flags.append,
            "create_new": flags.create_new,
        }),
    )?;
    let fd = value
        .get("fd")
        .and_then(|item| item.as_i64())
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                "data folder open did not return a file",
            )
        })?;
    if fd < 0 || fd > i64::from(i32::MAX) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "data folder open returned a bad file descriptor",
        ));
    }
    #[cfg(unix)]
    {
        use std::os::fd::FromRawFd;
        // The bridge detached this fd and transferred ownership to us.
        let raw = i32::try_from(fd).map_err(|_| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                "data folder open returned a bad file descriptor",
            )
        })?;
        Ok(unsafe { std::fs::File::from_raw_fd(raw) })
    }
    #[cfg(not(unix))]
    {
        let _ = fd;
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "storage-access files are only available on Android",
        ))
    }
}

fn open_routed(
    path: &Path,
    flags: &OpenFlags,
    unix_mode: Option<u32>,
    unix_custom: Option<i32>,
) -> io::Result<File> {
    match route(path)? {
        Route::Local => {
            let mut opts = StdOpenOptions::new();
            opts.read(flags.read)
                .write(flags.write || flags.append)
                .append(flags.append)
                .truncate(flags.truncate)
                .create(flags.create)
                .create_new(flags.create_new);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                if let Some(mode) = unix_mode {
                    opts.mode(mode);
                }
                if let Some(custom) = unix_custom {
                    opts.custom_flags(custom);
                }
            }
            #[cfg(not(unix))]
            {
                let _ = (unix_mode, unix_custom);
            }
            opts.open(path).map(File::local)
        }
        Route::Bridge { rel, bridge, .. } => {
            if !flags.wants_write() {
                if let NodeKind::Dir = stat_bridge(bridge.as_ref(), &rel)?.kind {
                    return std::fs::File::open(dir_template_path()?).map(File::local);
                }
            }
            let mut file = open_bridge_file(bridge.as_ref(), &rel, flags)?;
            if flags.append {
                file.seek(io::SeekFrom::End(0))?;
            }
            if flags.truncate {
                // Providers that reject a truncating open still return a writable fd.
                // Shrink here. A filesystem with no truncate still accepts the write.
                // Growing a file may ignore the same errnos (`place_reserved` checks
                // the length). A swallowed truncate that still reports bytes must not.
                if let Err(error) = file.set_len(0) {
                    if !bridge_truncate_unsupported(&error) {
                        return Err(error);
                    }
                    if file.metadata().is_ok_and(|meta| meta.len() > 0) {
                        return Err(io::Error::new(
                            io::ErrorKind::InvalidInput,
                            "truncate left the previous bytes",
                        ));
                    }
                }
            }
            Ok(File::bridge(file))
        }
    }
}

#[derive(Debug)]
pub struct File {
    inner: std::fs::File,
    /// Opened through the storage-access bridge. `fsync` / `ftruncate` may be
    /// unsupported; the provider persists the bytes when the fd is closed.
    bridge: bool,
}

impl File {
    fn local(inner: std::fs::File) -> Self {
        Self {
            inner,
            bridge: false,
        }
    }

    fn bridge(inner: std::fs::File) -> Self {
        Self {
            inner,
            bridge: true,
        }
    }

    fn ignore_bridge_unsupported(&self, error: io::Error) -> io::Result<()> {
        if self.bridge && unsupported_fs_op(&error) {
            Ok(())
        } else {
            Err(error)
        }
    }

    pub fn open<P: AsRef<Path>>(path: P) -> io::Result<Self> {
        OpenOptions::new().read(true).open(path)
    }

    pub fn create<P: AsRef<Path>>(path: P) -> io::Result<Self> {
        OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(path)
    }

    pub fn metadata(&self) -> io::Result<Metadata> {
        self.inner.metadata()
    }

    pub fn set_len(&self, size: u64) -> io::Result<()> {
        self.inner.set_len(size).or_else(|error| {
            if self.bridge && bridge_truncate_unsupported(&error) {
                Ok(())
            } else {
                Err(error)
            }
        })
    }

    pub fn sync_all(&self) -> io::Result<()> {
        if self.bridge {
            // The storage provider persists the bytes when the fd is closed.
            // Calling fsync here stalls every chunk write on shared storage.
            return Ok(());
        }
        self.inner.sync_all()
    }

    pub fn sync_data(&self) -> io::Result<()> {
        if self.bridge {
            return Ok(());
        }
        self.inner.sync_data()
    }

    pub fn set_permissions(&self, perm: Permissions) -> io::Result<()> {
        self.inner
            .set_permissions(perm)
            .or_else(|error| self.ignore_bridge_unsupported(error))
    }

    pub fn try_clone(&self) -> io::Result<Self> {
        self.inner.try_clone().map(|inner| Self {
            inner,
            bridge: self.bridge,
        })
    }
}

impl Read for File {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        self.inner.read(buf)
    }
}

impl Write for File {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.inner.write(buf)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}

impl Seek for File {
    fn seek(&mut self, pos: io::SeekFrom) -> io::Result<u64> {
        self.inner.seek(pos)
    }
}

#[cfg(unix)]
impl std::os::fd::AsRawFd for File {
    fn as_raw_fd(&self) -> std::os::fd::RawFd {
        self.inner.as_raw_fd()
    }
}

#[cfg(unix)]
impl std::os::fd::AsFd for File {
    fn as_fd(&self) -> std::os::fd::BorrowedFd<'_> {
        self.inner.as_fd()
    }
}

#[derive(Clone, Debug)]
pub struct OpenOptions {
    flags: OpenFlags,
    #[cfg(unix)]
    mode: Option<u32>,
    #[cfg(unix)]
    custom_flags: Option<i32>,
    #[cfg(windows)]
    custom_flags: Option<u32>,
}

impl OpenOptions {
    pub fn new() -> Self {
        Self {
            flags: OpenFlags {
                read: false,
                write: false,
                append: false,
                truncate: false,
                create: false,
                create_new: false,
            },
            #[cfg(unix)]
            mode: None,
            #[cfg(unix)]
            custom_flags: None,
            #[cfg(windows)]
            custom_flags: None,
        }
    }

    pub fn read(&mut self, read: bool) -> &mut Self {
        self.flags.read = read;
        self
    }

    pub fn write(&mut self, write: bool) -> &mut Self {
        self.flags.write = write;
        self
    }

    pub fn append(&mut self, append: bool) -> &mut Self {
        self.flags.append = append;
        self
    }

    pub fn truncate(&mut self, truncate: bool) -> &mut Self {
        self.flags.truncate = truncate;
        self
    }

    pub fn create(&mut self, create: bool) -> &mut Self {
        self.flags.create = create;
        self
    }

    pub fn create_new(&mut self, create_new: bool) -> &mut Self {
        self.flags.create_new = create_new;
        self
    }

    pub fn open<P: AsRef<Path>>(&self, path: P) -> io::Result<File> {
        #[cfg(unix)]
        {
            open_routed(path.as_ref(), &self.flags, self.mode, self.custom_flags)
        }
        #[cfg(not(unix))]
        {
            open_routed(path.as_ref(), &self.flags, None, None)
        }
    }
}

impl Default for OpenOptions {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(unix)]
impl std::os::unix::fs::OpenOptionsExt for OpenOptions {
    fn mode(&mut self, mode: u32) -> &mut Self {
        self.mode = Some(mode);
        self
    }

    fn custom_flags(&mut self, flags: i32) -> &mut Self {
        self.custom_flags = Some(flags);
        self
    }
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::{Arc, Mutex};

    static TEST_MOUNT: Mutex<()> = Mutex::new(());

    use super::{mount_bridge, unmount, SafBridge, SAF_VAULT_ROOT};

    struct TempBridge {
        root: PathBuf,
        /// Android's document provider rejects rename when the destination name
        /// already exists. Local `rename` replaces, so tests opt into the refusal.
        refuse_rename_over: bool,
        stats: AtomicU32,
        opens: AtomicU32,
    }

    impl TempBridge {
        fn path(&self, rel: &str) -> PathBuf {
            if rel.is_empty() {
                self.root.clone()
            } else {
                self.root.join(rel)
            }
        }
    }

    impl SafBridge for TempBridge {
        fn dispatch(&self, op: &str, payload: &str) -> std::io::Result<String> {
            let value: serde_json::Value = serde_json::from_str(payload)
                .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;
            let rel = value
                .get("rel")
                .and_then(|item| item.as_str())
                .unwrap_or("");
            let path = self.path(rel);
            let ok = |body: serde_json::Value| {
                let mut out = body;
                out["ok"] = serde_json::json!(true);
                Ok(out.to_string())
            };
            let err = |code: &str| {
                Ok(serde_json::json!({ "ok": false, "err": code, "message": code }).to_string())
            };
            match op {
                "stat" => {
                    self.stats.fetch_add(1, Ordering::Relaxed);
                    match std::fs::symlink_metadata(&path) {
                        Ok(meta) if meta.is_dir() => {
                            ok(serde_json::json!({ "kind": "dir", "len": 0 }))
                        }
                        Ok(meta) => ok(serde_json::json!({ "kind": "file", "len": meta.len() })),
                        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                            ok(serde_json::json!({ "kind": "missing", "len": 0 }))
                        }
                        Err(error) => Err(error),
                    }
                }
                "mkdir" => match std::fs::create_dir(&path) {
                    Ok(()) => ok(serde_json::json!({})),
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                        err("already_exists")
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => err("not_found"),
                    Err(error) => Err(error),
                },
                "remove_file" => match std::fs::remove_file(&path) {
                    Ok(()) => ok(serde_json::json!({})),
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => err("not_found"),
                    Err(error) => Err(error),
                },
                "remove_dir" => match std::fs::remove_dir(&path) {
                    Ok(()) => ok(serde_json::json!({})),
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => err("not_found"),
                    Err(error) if error.kind() == std::io::ErrorKind::DirectoryNotEmpty => {
                        err("not_empty")
                    }
                    Err(error) => Err(error),
                },
                "remove_dir_all" => match std::fs::remove_dir_all(&path) {
                    Ok(()) => ok(serde_json::json!({})),
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => err("not_found"),
                    Err(error) => Err(error),
                },
                "rename" => {
                    let from = self.path(
                        value
                            .get("from")
                            .and_then(|item| item.as_str())
                            .unwrap_or(""),
                    );
                    let to =
                        self.path(value.get("to").and_then(|item| item.as_str()).unwrap_or(""));
                    if self.refuse_rename_over && to.exists() {
                        return err("other");
                    }
                    match std::fs::rename(&from, &to) {
                        Ok(()) => ok(serde_json::json!({})),
                        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                            err("not_found")
                        }
                        Err(error) => Err(error),
                    }
                }
                "list" => {
                    let mut entries = Vec::new();
                    for entry in std::fs::read_dir(&path)? {
                        let entry = entry?;
                        let name = entry.file_name();
                        let Some(name) = name.to_str() else {
                            continue;
                        };
                        let kind = entry.file_type()?;
                        let node = if kind.is_dir() {
                            "dir"
                        } else if kind.is_symlink() {
                            continue;
                        } else {
                            "file"
                        };
                        let mut listed = serde_json::json!({ "name": name, "kind": node });
                        if let Ok(meta) = entry.metadata() {
                            listed["len"] = serde_json::json!(meta.len());
                        }
                        entries.push(listed);
                    }
                    ok(serde_json::json!({ "entries": entries }))
                }
                "open" => {
                    self.opens.fetch_add(1, Ordering::Relaxed);
                    let mut opts = std::fs::OpenOptions::new();
                    let read = value
                        .get("read")
                        .and_then(|item| item.as_bool())
                        .unwrap_or(false);
                    let write = value
                        .get("write")
                        .and_then(|item| item.as_bool())
                        .unwrap_or(false);
                    let truncate = value
                        .get("truncate")
                        .and_then(|item| item.as_bool())
                        .unwrap_or(false);
                    let create = value
                        .get("create")
                        .and_then(|item| item.as_bool())
                        .unwrap_or(false);
                    let create_new = value
                        .get("create_new")
                        .and_then(|item| item.as_bool())
                        .unwrap_or(false);
                    opts.read(read || write)
                        .write(write)
                        .truncate(truncate)
                        .create(create)
                        .create_new(create_new);
                    match opts.open(&path) {
                        Ok(file) => {
                            use std::os::fd::IntoRawFd;
                            let fd = file.into_raw_fd();
                            ok(serde_json::json!({ "fd": fd }))
                        }
                        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                            err("not_found")
                        }
                        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                            err("already_exists")
                        }
                        Err(error) => Err(error),
                    }
                }
                _ => err("other"),
            }
        }
    }

    struct Mounted(tempfile::TempDir);

    impl Mounted {
        fn new() -> Self {
            let dir = tempfile::tempdir().unwrap();
            mount_bridge(Arc::new(TempBridge {
                root: dir.path().to_path_buf(),
                refuse_rename_over: false,
                stats: AtomicU32::new(0),
                opens: AtomicU32::new(0),
            }));
            Self(dir)
        }

        fn root(&self) -> &Path {
            self.0.path()
        }
    }

    impl Drop for Mounted {
        fn drop(&mut self) {
            unmount();
        }
    }

    #[test]
    fn unmounted_saf_root_is_not_created_on_disk() {
        let _guard = TEST_MOUNT.lock().unwrap();
        unmount();
        let error = super::create_dir_all(SAF_VAULT_ROOT).unwrap_err();
        assert_eq!(error.kind(), std::io::ErrorKind::PermissionDenied);
        let error = super::probe_mounted().unwrap_err();
        assert_eq!(error.kind(), std::io::ErrorKind::PermissionDenied);
        assert!(!Path::new(SAF_VAULT_ROOT).exists());
    }

    #[test]
    fn unmounted_saf_alias_is_not_a_data_folder_error() {
        let _env = crate::paths::ENV_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let _guard = TEST_MOUNT.lock().unwrap();
        let _vars = crate::paths::EnvGuard::capture(&["APPIMAGE", "UPRIV_DEFAULT_ROOT_ANCHOR"]);
        unmount();
        let home = tempfile::tempdir().unwrap();
        std::env::remove_var("APPIMAGE");
        std::env::set_var("UPRIV_DEFAULT_ROOT_ANCHOR", home.path());
        std::fs::write(
            home.path().join(".upriv-root"),
            "status=active\n/upriv-saf-root\n",
        )
        .unwrap();

        let absent = crate::config::discover_bootstrap_root().unwrap();
        assert!(absent.is_none());

        let dir = tempfile::tempdir().unwrap();
        mount_bridge(Arc::new(TempBridge {
            root: dir.path().to_path_buf(),
            refuse_rename_over: false,
            stats: AtomicU32::new(0),
            opens: AtomicU32::new(0),
        }));
        struct Unmount;
        impl Drop for Unmount {
            fn drop(&mut self) {
                unmount();
            }
        }
        let _unmount = Unmount;
        let logical = Path::new(SAF_VAULT_ROOT);
        crate::paths::initialize_vault_root(logical).unwrap();
        let found = crate::config::discover_bootstrap_root().unwrap().unwrap();
        assert_eq!(found.root(), logical);
        std::env::remove_var("UPRIV_DEFAULT_ROOT_ANCHOR");
    }

    #[test]
    fn bridge_replace_when_provider_refuses_rename_over_existing() {
        let _guard = TEST_MOUNT.lock().unwrap();
        let dir = tempfile::tempdir().unwrap();
        mount_bridge(Arc::new(TempBridge {
            root: dir.path().to_path_buf(),
            refuse_rename_over: true,
            stats: AtomicU32::new(0),
            opens: AtomicU32::new(0),
        }));
        struct Unmount;
        impl Drop for Unmount {
            fn drop(&mut self) {
                unmount();
            }
        }
        let _unmount = Unmount;
        let logical = Path::new(SAF_VAULT_ROOT).join(".upriv/settings.toml");
        crate::paths::write_bytes_atomic(&logical, b"theme = \"dark\"\nlocale = \"en\"\n").unwrap();
        crate::paths::write_bytes_atomic(&logical, b"theme = \"light\"\n").unwrap();
        assert_eq!(super::read(&logical).unwrap(), b"theme = \"light\"\n");
        let names: Vec<_> = std::fs::read_dir(dir.path().join(".upriv"))
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec!["settings.toml".to_string()]);
    }

    #[test]
    fn mounted_root_stores_vault_bytes_off_the_logical_path() {
        // Vault create logs through the process env. Hold the same lock the
        // logging tests use so those runs do not see this vault's lines.
        let _env = crate::paths::ENV_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let _guard = TEST_MOUNT.lock().unwrap();
        let mounted = Mounted::new();
        super::probe_mounted().unwrap();
        let logical = Path::new(SAF_VAULT_ROOT);
        super::create_dir_all(logical.join(".upriv/vaults")).unwrap();
        super::write(logical.join(".upriv/vaults/note.txt"), b"cipher").unwrap();
        assert_eq!(
            super::read(logical.join(".upriv/vaults/note.txt")).unwrap(),
            b"cipher"
        );
        assert!(mounted.root().join(".upriv/vaults/note.txt").is_file());
        assert!(!logical.exists());

        let root = crate::paths::initialize_vault_root(logical).unwrap();
        assert_eq!(root.root(), logical);
        let config: crate::config::VaultConfig = toml::from_str(
            r#"
[vault]
id = "notes"
display_name = "Notes"
order = 1
[storage]
mode = "encrypted_dir"
"#,
        )
        .unwrap();
        crate::vault::create_vault(
            &root,
            config,
            b"pass-word-ok",
            crate::store::KdfUnlockPreset::M32,
        )
        .unwrap();
        let listed = crate::vault::list_vaults(&root).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, "notes");
        let vault_dir = root.vault_dir("notes").unwrap();
        assert!(
            !vault_dir.is_dir(),
            "the logical vault path is not a real directory"
        );
        assert!(crate::host_fs::is_dir(&vault_dir));
        crate::config::load_vault_config(&vault_dir).unwrap();
        let store = root.vault_store_dir("notes").unwrap();
        let opened = crate::store::open_store(&store, b"pass-word-ok").unwrap();
        let expected = crate::store::seed_plaintext(opened.header.content_identity);
        let got = crate::store::read_logical_file(
            &store,
            &opened.header,
            &opened.content_key,
            &opened.index,
            crate::store::SEED_LOGICAL_PATH,
        )
        .unwrap();
        assert_eq!(got, expected);
        crate::vault::open_vault(&root, "notes", b"pass-word-ok").unwrap();
        crate::vault::fs_write_file(&root, "notes", "hello.txt", b"hello").unwrap();
        crate::vault::close_vault(&root, "notes", Some(b"pass-word-ok")).unwrap();
        assert!(mounted
            .root()
            .join(".upriv/vaults/notes/config.toml")
            .is_file());
        assert!(!logical.exists());
        let _ = mounted;
    }

    #[test]
    fn file_check_does_not_open_and_parent_dir_still_reaches_the_root() {
        let _guard = TEST_MOUNT.lock().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let bridge = Arc::new(TempBridge {
            root: dir.path().to_path_buf(),
            refuse_rename_over: false,
            stats: AtomicU32::new(0),
            opens: AtomicU32::new(0),
        });
        mount_bridge(bridge.clone());
        struct Unmount;
        impl Drop for Unmount {
            fn drop(&mut self) {
                unmount();
            }
        }
        let _unmount = Unmount;

        let logical = Path::new(SAF_VAULT_ROOT).join("note.txt");
        super::write(&logical, b"hi").unwrap();
        bridge.opens.store(0, Ordering::Relaxed);
        bridge.stats.store(0, Ordering::Relaxed);

        assert!(super::is_file(&logical));
        assert!(super::exists(&logical));
        assert!(!super::is_dir(&logical));
        assert_eq!(bridge.opens.load(Ordering::Relaxed), 0);
        assert!(bridge.stats.load(Ordering::Relaxed) >= 1);
        assert!(!super::is_bridge_path(Path::new(
            "/tmp/ordinary-vault-path"
        )));
        assert!(!super::is_bridge_path(Path::new(
            "/upriv-saf-root/../tmp/left-the-root"
        )));

        let climbed = Path::new("/var/../upriv-saf-root/note.txt");
        assert_eq!(super::read(climbed).unwrap(), b"hi");
    }

    #[test]
    fn climbing_out_of_the_logical_root_does_not_touch_the_disk() {
        let _guard = TEST_MOUNT.lock().unwrap();
        let dir = tempfile::tempdir().unwrap();
        mount_bridge(Arc::new(TempBridge {
            root: dir.path().to_path_buf(),
            refuse_rename_over: false,
            stats: AtomicU32::new(0),
            opens: AtomicU32::new(0),
        }));
        struct Unmount;
        impl Drop for Unmount {
            fn drop(&mut self) {
                unmount();
            }
        }
        let _unmount = Unmount;

        let spilled = dir.path().join("left-the-root");
        let mut escaped_logical = PathBuf::from(SAF_VAULT_ROOT);
        escaped_logical.push("..");
        for component in spilled.components() {
            if matches!(
                component,
                std::path::Component::RootDir | std::path::Component::Prefix(_)
            ) {
                continue;
            }
            escaped_logical.push(component);
        }
        let error = super::write(&escaped_logical, b"no").unwrap_err();
        assert_eq!(error.kind(), std::io::ErrorKind::InvalidInput);
        assert!(!spilled.exists());
        assert!(!super::is_bridge_path(&escaped_logical));
    }

    struct DotDotList;

    impl SafBridge for DotDotList {
        fn dispatch(&self, op: &str, _payload: &str) -> std::io::Result<String> {
            if op != "list" {
                return Err(std::io::Error::other(op));
            }
            Ok(r#"{"ok":true,"entries":[{"name":".","kind":"dir"},{"name":"..","kind":"dir"},{"name":"note.txt","kind":"file","len":1}]}"#.into())
        }
    }

    #[test]
    fn listing_skips_dot_and_dot_dot() {
        let _guard = TEST_MOUNT.lock().unwrap();
        mount_bridge(Arc::new(DotDotList));
        struct Unmount;
        impl Drop for Unmount {
            fn drop(&mut self) {
                unmount();
            }
        }
        let _unmount = Unmount;
        let names: Vec<_> = super::read_dir(SAF_VAULT_ROOT)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().into_string().unwrap())
            .collect();
        assert_eq!(names, vec!["note.txt".to_string()]);
    }
}

#[cfg(windows)]
impl std::os::windows::fs::OpenOptionsExt for OpenOptions {
    fn access_mode(&mut self, _access: u32) -> &mut Self {
        self
    }

    fn share_mode(&mut self, _share: u32) -> &mut Self {
        self
    }

    fn custom_flags(&mut self, flags: u32) -> &mut Self {
        self.custom_flags = Some(flags);
        self
    }

    fn attributes(&mut self, _attributes: u32) -> &mut Self {
        self
    }

    fn security_qos_flags(&mut self, _flags: u32) -> &mut Self {
        self
    }
}
