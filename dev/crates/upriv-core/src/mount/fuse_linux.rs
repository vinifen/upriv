use std::collections::BTreeSet;
use std::ffi::OsStr;
use std::path::Path;
use std::sync::{Arc, RwLock};
use std::time::{Duration, SystemTime};

use fuser::{
    FileAttr, FileType, Filesystem, ReplyAttr, ReplyCreate, ReplyData, ReplyDirectory, ReplyEmpty,
    ReplyEntry, ReplyWrite, Request, TimeOrNow, FUSE_ROOT_ID,
};
use libc::{EEXIST, EIO, ENOENT, ENOTEMPTY};

use crate::error::{Result, UprivError};
use crate::store::index_doc::normalize_path;
use crate::store::EncryptedStore;

const TTL: Duration = Duration::from_secs(1);

/// Resolved target of an inode within the virtual filesystem.
enum Node {
    Dir(String),
    File(String),
}

fn join_path(parent: &str, name: &str) -> String {
    if parent.is_empty() {
        name.to_string()
    } else {
        format!("{parent}/{name}")
    }
}

pub struct FuseMount {
    _session: fuser::BackgroundSession,
}

impl FuseMount {
    pub fn mount(
        store: Arc<RwLock<EncryptedStore>>,
        mountpoint: &Path,
        disallow_copy_outside_mount: bool,
    ) -> Result<Self> {
        // Empty mountpoint must exist before `fuse_session_mount`; libfuse does not
        // reliably create it when the parent was just created.
        if !mountpoint.exists() {
            std::fs::create_dir(mountpoint).map_err(|err| UprivError::Mount(err.to_string()))?;
        }
        let owner_uid = unsafe { libc::getuid() };
        let fs = UprivFs {
            store,
            owner_uid,
            restrict_copy: disallow_copy_outside_mount,
        };
        let session = fuser::Session::new(
            fs,
            mountpoint,
            &[
                fuser::MountOption::RW,
                fuser::MountOption::FSName("upriv".into()),
            ],
        )
        .map_err(|err| UprivError::Mount(err.to_string()))?;
        let bg = session
            .spawn()
            .map_err(|err| UprivError::Mount(err.to_string()))?;
        Ok(Self { _session: bg })
    }
}

struct UprivFs {
    store: Arc<RwLock<EncryptedStore>>,
    owner_uid: u32,
    restrict_copy: bool,
}

impl UprivFs {
    fn inode_for_path(path: &str) -> u64 {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        let normalized = normalize_path(path);
        if normalized.is_empty() {
            return FUSE_ROOT_ID;
        }
        let mut hasher = DefaultHasher::new();
        normalized.hash(&mut hasher);
        hasher.finish().max(2)
    }

    /// All directory paths in the tree: explicit markers + every ancestor of a file.
    fn all_dirs(store: &EncryptedStore) -> BTreeSet<String> {
        let mut dirs = BTreeSet::new();
        for entry in store.file_entries() {
            let mut acc = String::new();
            let segments: Vec<&str> = entry.path.split('/').collect();
            for segment in &segments[..segments.len().saturating_sub(1)] {
                acc = if acc.is_empty() {
                    segment.to_string()
                } else {
                    format!("{acc}/{segment}")
                };
                dirs.insert(acc.clone());
            }
        }
        for dir in &store.index_dirs() {
            dirs.insert(dir.clone());
        }
        dirs
    }

    /// Map an inode back to its file/dir path.
    fn node_for_ino(store: &EncryptedStore, ino: u64) -> Option<Node> {
        if ino == FUSE_ROOT_ID {
            return Some(Node::Dir(String::new()));
        }
        for entry in store.file_entries() {
            if Self::inode_for_path(&entry.path) == ino {
                return Some(Node::File(entry.path.clone()));
            }
        }
        for dir in Self::all_dirs(store) {
            if Self::inode_for_path(&dir) == ino {
                return Some(Node::Dir(dir));
            }
        }
        None
    }

    fn dir_attr(ino: u64) -> FileAttr {
        FileAttr {
            ino,
            size: 0,
            blocks: 0,
            atime: SystemTime::now(),
            mtime: SystemTime::now(),
            ctime: SystemTime::now(),
            crtime: SystemTime::UNIX_EPOCH,
            kind: FileType::Directory,
            perm: 0o755,
            nlink: 2,
            uid: unsafe { libc::getuid() },
            gid: unsafe { libc::getgid() },
            rdev: 0,
            blksize: 512,
            flags: 0,
        }
    }

    fn file_attr(ino: u64, size: u64) -> FileAttr {
        FileAttr {
            ino,
            size,
            blocks: (size + 511) / 512,
            atime: SystemTime::now(),
            mtime: SystemTime::now(),
            ctime: SystemTime::now(),
            crtime: SystemTime::UNIX_EPOCH,
            kind: FileType::RegularFile,
            perm: 0o644,
            nlink: 1,
            uid: unsafe { libc::getuid() },
            gid: unsafe { libc::getgid() },
            rdev: 0,
            blksize: 512,
            flags: 0,
        }
    }
}

impl UprivFs {
    fn persist(store: &mut EncryptedStore) -> bool {
        store.flush().is_ok()
    }
}

impl Filesystem for UprivFs {
    fn lookup(&mut self, _req: &Request<'_>, parent: u64, name: &OsStr, reply: ReplyEntry) {
        let name = name.to_string_lossy();
        let store = self.store.read().expect("store lock");
        let Some(Node::Dir(parent_path)) = Self::node_for_ino(&store, parent) else {
            reply.error(ENOENT);
            return;
        };
        if name == "." || name == ".." {
            reply.entry(&TTL, &Self::dir_attr(parent), 0);
            return;
        }
        let path = join_path(&parent_path, &name);
        if store.file_exists(&path) {
            let size = store.read_file(&path).map(|b| b.len() as u64).unwrap_or(0);
            reply.entry(&TTL, &Self::file_attr(Self::inode_for_path(&path), size), 0);
        } else if store.dir_exists(&path) {
            reply.entry(&TTL, &Self::dir_attr(Self::inode_for_path(&path)), 0);
        } else {
            reply.error(ENOENT);
        }
    }

    fn getattr(&mut self, _req: &Request<'_>, ino: u64, _fh: Option<u64>, reply: ReplyAttr) {
        let store = self.store.read().expect("store lock");
        match Self::node_for_ino(&store, ino) {
            Some(Node::Dir(_)) => reply.attr(&TTL, &Self::dir_attr(ino)),
            Some(Node::File(path)) => {
                let size = store.read_file(&path).map(|b| b.len() as u64).unwrap_or(0);
                reply.attr(&TTL, &Self::file_attr(ino, size));
            }
            None => reply.error(ENOENT),
        }
    }

    fn setattr(
        &mut self,
        _req: &Request<'_>,
        ino: u64,
        _mode: Option<u32>,
        _uid: Option<u32>,
        _gid: Option<u32>,
        size: Option<u64>,
        _atime: Option<TimeOrNow>,
        _mtime: Option<TimeOrNow>,
        _ctime: Option<SystemTime>,
        _fh: Option<u64>,
        _crtime: Option<SystemTime>,
        _chgtime: Option<SystemTime>,
        _bkuptime: Option<SystemTime>,
        _flags: Option<u32>,
        reply: ReplyAttr,
    ) {
        let mut store = self.store.write().expect("store lock");
        let Some(Node::File(path)) = Self::node_for_ino(&store, ino) else {
            // Directory or unknown: report directory attrs for dirs, else error.
            if matches!(Self::node_for_ino(&store, ino), Some(Node::Dir(_))) {
                reply.attr(&TTL, &Self::dir_attr(ino));
            } else {
                reply.error(ENOENT);
            }
            return;
        };
        if let Some(new_size) = size {
            let mut data = store.read_file(&path).unwrap_or_default();
            data.resize(new_size as usize, 0);
            if store.write_file(&path, &data).is_err() {
                reply.error(EIO);
                return;
            }
            let _ = Self::persist(&mut store);
        }
        let size = store.read_file(&path).map(|b| b.len() as u64).unwrap_or(0);
        reply.attr(&TTL, &Self::file_attr(ino, size));
    }

    fn read(
        &mut self,
        req: &Request<'_>,
        ino: u64,
        _fh: u64,
        offset: i64,
        size: u32,
        _flags: i32,
        _lock_owner: Option<u64>,
        reply: ReplyData,
    ) {
        if self.restrict_copy && req.uid() != self.owner_uid {
            reply.error(libc::EACCES);
            return;
        }
        let store = self.store.read().expect("store lock");
        let Some(Node::File(path)) = Self::node_for_ino(&store, ino) else {
            reply.error(ENOENT);
            return;
        };
        match store.read_file(&path) {
            Ok(data) => {
                let start = offset.max(0) as usize;
                if start >= data.len() {
                    reply.data(&[]);
                    return;
                }
                let end = (start + size as usize).min(data.len());
                reply.data(&data[start..end]);
            }
            Err(_) => reply.error(EIO),
        }
    }

    fn write(
        &mut self,
        _req: &Request<'_>,
        ino: u64,
        _fh: u64,
        offset: i64,
        data: &[u8],
        _write_flags: u32,
        _flags: i32,
        _lock_owner: Option<u64>,
        reply: ReplyWrite,
    ) {
        let mut store = self.store.write().expect("store lock");
        let Some(Node::File(path)) = Self::node_for_ino(&store, ino) else {
            reply.error(ENOENT);
            return;
        };
        let mut current = store.read_file(&path).unwrap_or_default();
        let start = offset.max(0) as usize;
        if start > current.len() {
            current.resize(start, 0);
        }
        let end = start + data.len();
        if end > current.len() {
            current.resize(end, 0);
        }
        current[start..end].copy_from_slice(data);
        match store.write_file(&path, &current) {
            Ok(()) => {
                let _ = Self::persist(&mut store);
                reply.written(data.len() as u32);
            }
            Err(_) => reply.error(EIO),
        }
    }

    fn create(
        &mut self,
        _req: &Request<'_>,
        parent: u64,
        name: &OsStr,
        _mode: u32,
        _umask: u32,
        _flags: i32,
        reply: ReplyCreate,
    ) {
        let name = name.to_string_lossy();
        let mut store = self.store.write().expect("store lock");
        let Some(Node::Dir(parent_path)) = Self::node_for_ino(&store, parent) else {
            reply.error(ENOENT);
            return;
        };
        let path = join_path(&parent_path, &name);
        if store.write_file(&path, &[]).is_err() {
            reply.error(EIO);
            return;
        }
        let _ = Self::persist(&mut store);
        let attr = Self::file_attr(Self::inode_for_path(&path), 0);
        reply.created(&TTL, &attr, 0, 0, 0);
    }

    fn mkdir(
        &mut self,
        _req: &Request<'_>,
        parent: u64,
        name: &OsStr,
        _mode: u32,
        _umask: u32,
        reply: ReplyEntry,
    ) {
        let name = name.to_string_lossy();
        let mut store = self.store.write().expect("store lock");
        let Some(Node::Dir(parent_path)) = Self::node_for_ino(&store, parent) else {
            reply.error(ENOENT);
            return;
        };
        let path = join_path(&parent_path, &name);
        if store.file_exists(&path) || store.dir_exists(&path) {
            reply.error(EEXIST);
            return;
        }
        store.create_dir(&path);
        let _ = Self::persist(&mut store);
        reply.entry(&TTL, &Self::dir_attr(Self::inode_for_path(&path)), 0);
    }

    fn unlink(&mut self, _req: &Request<'_>, parent: u64, name: &OsStr, reply: ReplyEmpty) {
        let name = name.to_string_lossy();
        let mut store = self.store.write().expect("store lock");
        let Some(Node::Dir(parent_path)) = Self::node_for_ino(&store, parent) else {
            reply.error(ENOENT);
            return;
        };
        let path = join_path(&parent_path, &name);
        match store.remove_file(&path) {
            Ok(true) => {
                let _ = Self::persist(&mut store);
                reply.ok();
            }
            Ok(false) => reply.error(ENOENT),
            Err(_) => reply.error(EIO),
        }
    }

    fn rmdir(&mut self, _req: &Request<'_>, parent: u64, name: &OsStr, reply: ReplyEmpty) {
        let name = name.to_string_lossy();
        let mut store = self.store.write().expect("store lock");
        let Some(Node::Dir(parent_path)) = Self::node_for_ino(&store, parent) else {
            reply.error(ENOENT);
            return;
        };
        let path = join_path(&parent_path, &name);
        if !store.dir_exists(&path) {
            reply.error(ENOENT);
            return;
        }
        if store.remove_dir(&path) {
            let _ = Self::persist(&mut store);
            reply.ok();
        } else {
            reply.error(ENOTEMPTY);
        }
    }

    fn rename(
        &mut self,
        _req: &Request<'_>,
        parent: u64,
        name: &OsStr,
        newparent: u64,
        newname: &OsStr,
        _flags: u32,
        reply: ReplyEmpty,
    ) {
        let name = name.to_string_lossy();
        let newname = newname.to_string_lossy();
        let mut store = self.store.write().expect("store lock");
        let (Some(Node::Dir(from_parent)), Some(Node::Dir(to_parent))) = (
            Self::node_for_ino(&store, parent),
            Self::node_for_ino(&store, newparent),
        ) else {
            reply.error(ENOENT);
            return;
        };
        let from = join_path(&from_parent, &name);
        let to = join_path(&to_parent, &newname);
        if !store.file_exists(&from) && !store.dir_exists(&from) {
            reply.error(ENOENT);
            return;
        }
        // Replacing an existing destination file is allowed (POSIX); drop it first.
        if store.file_exists(&to) {
            let _ = store.remove_file(&to);
        }
        store.rename(&from, &to);
        let _ = Self::persist(&mut store);
        reply.ok();
    }

    fn fsync(&mut self, _req: &Request<'_>, _ino: u64, _fh: u64, _datasync: bool, reply: ReplyEmpty) {
        let mut store = self.store.write().expect("store lock");
        let _ = Self::persist(&mut store);
        reply.ok();
    }

    fn flush(&mut self, _req: &Request<'_>, _ino: u64, _fh: u64, _lock_owner: u64, reply: ReplyEmpty) {
        let mut store = self.store.write().expect("store lock");
        let _ = Self::persist(&mut store);
        reply.ok();
    }

    fn readdir(
        &mut self,
        _req: &Request<'_>,
        ino: u64,
        _fh: u64,
        offset: i64,
        mut reply: ReplyDirectory,
    ) {
        let store = self.store.read().expect("store lock");
        let Some(Node::Dir(dir_path)) = Self::node_for_ino(&store, ino) else {
            reply.error(ENOENT);
            return;
        };
        let parent_ino = if dir_path.is_empty() {
            FUSE_ROOT_ID
        } else {
            let parent = dir_path.rsplit_once('/').map(|(p, _)| p).unwrap_or("");
            Self::inode_for_path(parent)
        };
        let mut entries: Vec<(u64, FileType, String)> = vec![
            (ino, FileType::Directory, ".".into()),
            (parent_ino, FileType::Directory, "..".into()),
        ];
        for (name, is_dir) in store.list_dir(&dir_path) {
            let child = join_path(&dir_path, &name);
            let kind = if is_dir {
                FileType::Directory
            } else {
                FileType::RegularFile
            };
            entries.push((Self::inode_for_path(&child), kind, name));
        }
        for (i, (ino, kind, name)) in entries.into_iter().enumerate().skip(offset as usize) {
            if reply.add(ino, (i + 1) as i64, kind, name) {
                break;
            }
        }
        reply.ok();
    }
}
