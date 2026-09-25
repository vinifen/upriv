//! Linux FUSE adapter over the open-session file API (no plaintext tree).

use std::collections::HashMap;
use std::ffi::OsStr;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use fuser::{
    FileAttr, FileType, Filesystem, MountOption, ReplyAttr, ReplyCreate, ReplyData, ReplyDirectory,
    ReplyEmpty, ReplyEntry, ReplyWrite, Request, FUSE_ROOT_ID,
};
use libc::{EEXIST, EIO, ENOENT, ENOTDIR, ENOTEMPTY, EPERM};

use crate::error::UprivError;
use crate::paths::VaultRoot;
use crate::session::with_open_session;
use crate::store::{file_name, parent_logical, INTERNAL_WORKSPACE_FILE, SEED_LOGICAL_PATH};
use crate::vault::fs as vfs;

use super::MountedVault;

const TTL: Duration = Duration::from_secs(1);

struct EncryptedFs {
    root: VaultRoot,
    vault_id: String,
    uid: u32,
    gid: u32,
    inodes: Mutex<InodeTable>,
}

#[derive(Default)]
struct InodeTable {
    by_ino: HashMap<u64, String>,
    by_path: HashMap<String, u64>,
    next: u64,
}

impl InodeTable {
    fn new() -> Self {
        let mut table = Self {
            by_ino: HashMap::new(),
            by_path: HashMap::new(),
            next: FUSE_ROOT_ID + 1,
        };
        table.by_ino.insert(FUSE_ROOT_ID, String::new());
        table.by_path.insert(String::new(), FUSE_ROOT_ID);
        table
    }

    fn ino_for(&mut self, logical: &str) -> u64 {
        if let Some(ino) = self.by_path.get(logical) {
            return *ino;
        }
        let ino = self.next;
        self.next += 1;
        self.by_path.insert(logical.to_string(), ino);
        self.by_ino.insert(ino, logical.to_string());
        ino
    }

    fn path(&self, ino: u64) -> Option<String> {
        self.by_ino.get(&ino).cloned()
    }

    fn remap_path(&mut self, from: &str, to: &str) {
        if from == to {
            return;
        }
        self.forget_path(to);
        let mut pairs: Vec<(u64, String)> = Vec::new();
        if let Some(ino) = self.by_path.remove(from) {
            self.by_ino.remove(&ino);
            pairs.push((ino, to.to_string()));
        }
        let prefix = format!("{from}/");
        let children: Vec<(String, u64)> = self
            .by_path
            .iter()
            .filter(|(path, _)| path.starts_with(&prefix))
            .map(|(path, ino)| (path.clone(), *ino))
            .collect();
        for (old, ino) in children {
            self.by_path.remove(&old);
            self.by_ino.remove(&ino);
            let rest = &old[from.len()..];
            pairs.push((ino, format!("{to}{rest}")));
        }
        for (ino, path) in pairs {
            self.by_path.insert(path.clone(), ino);
            self.by_ino.insert(ino, path);
        }
    }

    fn forget_path(&mut self, logical: &str) {
        if let Some(ino) = self.by_path.remove(logical) {
            self.by_ino.remove(&ino);
        }
        let prefix = format!("{logical}/");
        let children: Vec<String> = self
            .by_path
            .keys()
            .filter(|p| p.starts_with(&prefix))
            .cloned()
            .collect();
        for child in children {
            if let Some(ino) = self.by_path.remove(&child) {
                self.by_ino.remove(&ino);
            }
        }
    }
}

fn ui(logical: &str) -> String {
    crate::store::to_ui_path(logical)
}

fn map_err(error: UprivError) -> i32 {
    match error {
        UprivError::VaultPathNotFound(_) | UprivError::VaultNotOpen(_) => ENOENT,
        UprivError::VaultPathExists(_) => EEXIST,
        UprivError::VaultFileTooLarge { .. } => libc::EFBIG,
        _ => EIO,
    }
}

fn time_from_millis(ms: u64) -> SystemTime {
    UNIX_EPOCH + Duration::from_millis(ms)
}

impl EncryptedFs {
    fn with_index<T>(
        &self,
        f: impl FnOnce(&crate::store::VaultIndex) -> Result<T, UprivError>,
    ) -> Result<T, UprivError> {
        let dir = self.root.vault_dir(&self.vault_id)?;
        with_open_session(&dir, |session| f(&session.index))
    }

    fn attr_for(&self, logical: &str) -> Result<FileAttr, i32> {
        let mut inodes = self.inodes.lock().unwrap_or_else(|p| p.into_inner());
        if logical.is_empty() {
            return Ok(self.dir_attr(FUSE_ROOT_ID, UNIX_EPOCH));
        }
        let ino = inodes.ino_for(logical);
        drop(inodes);
        self.with_index(|index| {
            let node = index
                .find(logical)
                .ok_or_else(|| UprivError::VaultPathNotFound(logical.into()))?;
            let atime = time_from_millis(node.modified_at);
            if node.is_dir() {
                Ok(self.dir_attr(ino, atime))
            } else {
                let size = node.as_file().map(|(_, size, _)| size).unwrap_or(0);
                Ok(self.file_attr(ino, size, atime))
            }
        })
        .map_err(map_err)
    }

    fn dir_attr(&self, ino: u64, time: SystemTime) -> FileAttr {
        FileAttr {
            ino,
            size: 0,
            blocks: 0,
            atime: time,
            mtime: time,
            ctime: time,
            crtime: time,
            kind: FileType::Directory,
            perm: 0o700,
            nlink: 2,
            uid: self.uid,
            gid: self.gid,
            rdev: 0,
            blksize: 4096,
            flags: 0,
        }
    }

    fn file_attr(&self, ino: u64, size: u64, time: SystemTime) -> FileAttr {
        FileAttr {
            ino,
            size,
            blocks: size.div_ceil(512),
            atime: time,
            mtime: time,
            ctime: time,
            crtime: time,
            kind: FileType::RegularFile,
            perm: 0o600,
            nlink: 1,
            uid: self.uid,
            gid: self.gid,
            rdev: 0,
            blksize: 4096,
            flags: 0,
        }
    }

    fn remove_node(&mut self, parent: u64, name: &OsStr, reply: ReplyEmpty) {
        let Some(name) = name.to_str() else {
            reply.error(EPERM);
            return;
        };
        let inodes = self.inodes.lock().unwrap_or_else(|p| p.into_inner());
        let Some(parent_path) = inodes.path(parent) else {
            reply.error(ENOENT);
            return;
        };
        drop(inodes);
        let logical = if parent_path.is_empty() {
            name.to_string()
        } else {
            format!("{parent_path}/{name}")
        };
        match vfs::fs_delete(&self.root, &self.vault_id, &ui(&logical)) {
            Ok(_) => {
                self.inodes
                    .lock()
                    .unwrap_or_else(|p| p.into_inner())
                    .forget_path(&logical);
                reply.ok();
            }
            Err(error) => {
                let code = match error {
                    UprivError::VaultStoreInvalid { detail, .. }
                        if detail.contains("not empty") =>
                    {
                        ENOTEMPTY
                    }
                    UprivError::VaultStoreInvalid { detail, .. }
                        if detail.contains("directory") =>
                    {
                        ENOTDIR
                    }
                    other => map_err(other),
                };
                reply.error(code);
            }
        }
    }
}

impl Filesystem for EncryptedFs {
    fn lookup(&mut self, _req: &Request<'_>, parent: u64, name: &OsStr, reply: ReplyEntry) {
        let Some(name) = name.to_str() else {
            reply.error(ENOENT);
            return;
        };
        if name == INTERNAL_WORKSPACE_FILE || name == SEED_LOGICAL_PATH {
            reply.error(ENOENT);
            return;
        }
        let inodes = self.inodes.lock().unwrap_or_else(|p| p.into_inner());
        let Some(parent_path) = inodes.path(parent) else {
            reply.error(ENOENT);
            return;
        };
        drop(inodes);
        let logical = if parent_path.is_empty() {
            name.to_string()
        } else {
            format!("{parent_path}/{name}")
        };
        match self.attr_for(&logical) {
            Ok(attr) => reply.entry(&TTL, &attr, 0),
            Err(code) => reply.error(code),
        }
    }

    fn getattr(&mut self, _req: &Request<'_>, ino: u64, _fh: Option<u64>, reply: ReplyAttr) {
        let inodes = self.inodes.lock().unwrap_or_else(|p| p.into_inner());
        let Some(path) = inodes.path(ino) else {
            reply.error(ENOENT);
            return;
        };
        drop(inodes);
        match self.attr_for(&path) {
            Ok(attr) => reply.attr(&TTL, &attr),
            Err(code) => reply.error(code),
        }
    }

    fn readdir(
        &mut self,
        _req: &Request<'_>,
        ino: u64,
        _fh: u64,
        offset: i64,
        mut reply: ReplyDirectory,
    ) {
        let inodes = self.inodes.lock().unwrap_or_else(|p| p.into_inner());
        let Some(parent) = inodes.path(ino) else {
            reply.error(ENOENT);
            return;
        };
        drop(inodes);
        let children = match self.with_index(|index| {
            let mut out = Vec::new();
            for node in &index.nodes {
                if file_name(&node.path) == INTERNAL_WORKSPACE_FILE
                    || node.path == SEED_LOGICAL_PATH
                {
                    continue;
                }
                let p = parent_logical(&node.path).unwrap_or("");
                if p == parent {
                    out.push((node.path.clone(), node.is_dir()));
                }
            }
            Ok(out)
        }) {
            Ok(c) => c,
            Err(error) => {
                reply.error(map_err(error));
                return;
            }
        };
        let mut entries: Vec<(u64, FileType, String)> = Vec::new();
        let mut table = self.inodes.lock().unwrap_or_else(|p| p.into_inner());
        let parent_ino = match parent_logical(&parent) {
            Some(p) => table.ino_for(p),
            None => FUSE_ROOT_ID,
        };
        entries.push((ino, FileType::Directory, ".".into()));
        entries.push((parent_ino, FileType::Directory, "..".into()));
        for (path, is_dir) in children {
            let child_ino = table.ino_for(&path);
            let name = file_name(&path).to_string();
            let kind = if is_dir {
                FileType::Directory
            } else {
                FileType::RegularFile
            };
            entries.push((child_ino, kind, name));
        }
        drop(table);
        for (i, (child_ino, kind, name)) in entries.into_iter().enumerate().skip(offset as usize) {
            if reply.add(child_ino, (i + 1) as i64, kind, name) {
                break;
            }
        }
        reply.ok();
    }

    fn open(&mut self, _req: &Request<'_>, ino: u64, _flags: i32, reply: fuser::ReplyOpen) {
        let inodes = self.inodes.lock().unwrap_or_else(|p| p.into_inner());
        if inodes.path(ino).is_none() {
            reply.error(ENOENT);
            return;
        }
        reply.opened(0, 0);
    }

    fn read(
        &mut self,
        _req: &Request<'_>,
        ino: u64,
        _fh: u64,
        offset: i64,
        size: u32,
        _flags: i32,
        _lock: Option<u64>,
        reply: ReplyData,
    ) {
        let inodes = self.inodes.lock().unwrap_or_else(|p| p.into_inner());
        let Some(path) = inodes.path(ino) else {
            reply.error(ENOENT);
            return;
        };
        drop(inodes);
        match vfs::fs_read_range(
            &self.root,
            &self.vault_id,
            &ui(&path),
            offset as u64,
            size as u64,
        ) {
            Ok(bytes) => reply.data(&bytes),
            Err(error) => reply.error(map_err(error)),
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
        _lock: Option<u64>,
        reply: ReplyWrite,
    ) {
        let inodes = self.inodes.lock().unwrap_or_else(|p| p.into_inner());
        let Some(path) = inodes.path(ino) else {
            reply.error(ENOENT);
            return;
        };
        drop(inodes);
        match vfs::fs_write_range(&self.root, &self.vault_id, &ui(&path), offset as u64, data) {
            Ok(_) => reply.written(data.len() as u32),
            Err(error) => reply.error(map_err(error)),
        }
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
        let Some(name) = name.to_str() else {
            reply.error(EPERM);
            return;
        };
        let inodes = self.inodes.lock().unwrap_or_else(|p| p.into_inner());
        let Some(parent_path) = inodes.path(parent) else {
            reply.error(ENOENT);
            return;
        };
        drop(inodes);
        let logical = if parent_path.is_empty() {
            name.to_string()
        } else {
            format!("{parent_path}/{name}")
        };
        match vfs::fs_mkdir(&self.root, &self.vault_id, &ui(&logical)) {
            Ok(_) => match self.attr_for(&logical) {
                Ok(attr) => reply.entry(&TTL, &attr, 0),
                Err(code) => reply.error(code),
            },
            Err(error) => reply.error(map_err(error)),
        }
    }

    fn create(
        &mut self,
        _req: &Request<'_>,
        parent: u64,
        name: &OsStr,
        _mode: u32,
        _umask: u32,
        flags: i32,
        reply: ReplyCreate,
    ) {
        let Some(name) = name.to_str() else {
            reply.error(EPERM);
            return;
        };
        let inodes = self.inodes.lock().unwrap_or_else(|p| p.into_inner());
        let Some(parent_path) = inodes.path(parent) else {
            reply.error(ENOENT);
            return;
        };
        drop(inodes);
        let logical = if parent_path.is_empty() {
            name.to_string()
        } else {
            format!("{parent_path}/{name}")
        };
        match vfs::fs_create_named_file(&self.root, &self.vault_id, &ui(&parent_path), name) {
            Ok(_) => match self.attr_for(&logical) {
                Ok(attr) => reply.created(&TTL, &attr, 0, 0, 0),
                Err(code) => reply.error(code),
            },
            Err(UprivError::VaultPathExists(_)) if flags & libc::O_EXCL == 0 => {
                match self.attr_for(&logical) {
                    Ok(attr) if attr.kind == FileType::RegularFile => {
                        if flags & libc::O_TRUNC != 0 {
                            if let Err(error) =
                                vfs::fs_truncate(&self.root, &self.vault_id, &ui(&logical), 0)
                            {
                                reply.error(map_err(error));
                                return;
                            }
                            match self.attr_for(&logical) {
                                Ok(attr) => reply.created(&TTL, &attr, 0, 0, 0),
                                Err(code) => reply.error(code),
                            }
                        } else {
                            reply.created(&TTL, &attr, 0, 0, 0);
                        }
                    }
                    Ok(_) => reply.error(EEXIST),
                    Err(code) => reply.error(code),
                }
            }
            Err(error) => reply.error(map_err(error)),
        }
    }

    fn unlink(&mut self, _req: &Request<'_>, parent: u64, name: &OsStr, reply: ReplyEmpty) {
        self.remove_node(parent, name, reply);
    }

    fn rmdir(&mut self, _req: &Request<'_>, parent: u64, name: &OsStr, reply: ReplyEmpty) {
        let Some(name) = name.to_str() else {
            reply.error(EPERM);
            return;
        };
        let inodes = self.inodes.lock().unwrap_or_else(|p| p.into_inner());
        let Some(parent_path) = inodes.path(parent) else {
            reply.error(ENOENT);
            return;
        };
        drop(inodes);
        let logical = if parent_path.is_empty() {
            name.to_string()
        } else {
            format!("{parent_path}/{name}")
        };
        match vfs::fs_rmdir(&self.root, &self.vault_id, &ui(&logical)) {
            Ok(_) => {
                self.inodes
                    .lock()
                    .unwrap_or_else(|p| p.into_inner())
                    .forget_path(&logical);
                reply.ok();
            }
            Err(error) => {
                let code = match error {
                    UprivError::VaultStoreInvalid { detail, .. }
                        if detail.contains("not empty") =>
                    {
                        ENOTEMPTY
                    }
                    UprivError::VaultStoreInvalid { detail, .. }
                        if detail.contains("directory") =>
                    {
                        ENOTDIR
                    }
                    other => map_err(other),
                };
                reply.error(code);
            }
        }
    }

    fn rename(
        &mut self,
        _req: &Request<'_>,
        parent: u64,
        name: &OsStr,
        newparent: u64,
        newname: &OsStr,
        flags: u32,
        reply: ReplyEmpty,
    ) {
        let (Some(name), Some(newname)) = (name.to_str(), newname.to_str()) else {
            reply.error(EPERM);
            return;
        };
        let inodes = self.inodes.lock().unwrap_or_else(|p| p.into_inner());
        let Some(parent_path) = inodes.path(parent) else {
            reply.error(ENOENT);
            return;
        };
        let Some(new_parent) = inodes.path(newparent) else {
            reply.error(ENOENT);
            return;
        };
        drop(inodes);
        let from = if parent_path.is_empty() {
            name.to_string()
        } else {
            format!("{parent_path}/{name}")
        };
        let replace = flags & libc::RENAME_NOREPLACE == 0;
        match vfs::fs_relocate(
            &self.root,
            &self.vault_id,
            &ui(&from),
            &ui(&new_parent),
            newname,
            replace,
        ) {
            Ok(_) => {
                let dest = if new_parent.is_empty() {
                    newname.to_string()
                } else {
                    format!("{new_parent}/{newname}")
                };
                self.inodes
                    .lock()
                    .unwrap_or_else(|p| p.into_inner())
                    .remap_path(&from, &dest);
                reply.ok();
            }
            Err(error) => {
                let code = match error {
                    UprivError::VaultStoreInvalid { detail, .. }
                        if detail.contains("not empty") =>
                    {
                        ENOTEMPTY
                    }
                    other => map_err(other),
                };
                reply.error(code);
            }
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
        _atime: Option<fuser::TimeOrNow>,
        _mtime: Option<fuser::TimeOrNow>,
        _ctime: Option<SystemTime>,
        _fh: Option<u64>,
        _crtime: Option<SystemTime>,
        _chgtime: Option<SystemTime>,
        _bkuptime: Option<SystemTime>,
        _flags: Option<u32>,
        reply: ReplyAttr,
    ) {
        let inodes = self.inodes.lock().unwrap_or_else(|p| p.into_inner());
        let Some(path) = inodes.path(ino) else {
            reply.error(ENOENT);
            return;
        };
        drop(inodes);
        if let Some(size) = size {
            if let Err(error) = vfs::fs_truncate(&self.root, &self.vault_id, &ui(&path), size) {
                reply.error(map_err(error));
                return;
            }
        }
        match self.attr_for(&path) {
            Ok(attr) => reply.attr(&TTL, &attr),
            Err(code) => reply.error(code),
        }
    }

    fn fsync(
        &mut self,
        _req: &Request<'_>,
        _ino: u64,
        _fh: u64,
        _datasync: bool,
        reply: ReplyEmpty,
    ) {
        reply.ok();
    }

    fn statfs(&mut self, _req: &Request<'_>, _ino: u64, reply: fuser::ReplyStatfs) {
        reply.statfs(0, 0, 0, 0, 0, 512, 255, 0);
    }
}

pub(super) fn spawn(
    root: VaultRoot,
    vault_id: String,
    mount_point: PathBuf,
) -> crate::error::Result<MountedVault> {
    let uid = unsafe { libc::getuid() };
    let gid = unsafe { libc::getgid() };
    let fs = EncryptedFs {
        root,
        vault_id,
        uid,
        gid,
        inodes: Mutex::new(InodeTable::new()),
    };
    let options = [
        MountOption::FSName("upriv".into()),
        MountOption::DefaultPermissions,
        MountOption::NoAtime,
    ];
    let session = fuser::spawn_mount2(fs, &mount_point, &options).map_err(|error| {
        UprivError::VaultMountFailed(format!(
            "FUSE mount failed at {}: {error}",
            mount_point.display()
        ))
    })?;
    Ok(MountedVault {
        mount_point,
        session: Some(session),
    })
}

#[cfg(test)]
mod inode_tests {
    use super::*;

    #[test]
    fn remap_keeps_ino_and_rewrites_children() {
        let mut table = InodeTable::new();
        let dir = table.ino_for("docs");
        let file = table.ino_for("docs/a.txt");
        let sibling = table.ino_for("other.txt");
        table.remap_path("docs", "inbox");
        assert_eq!(table.path(dir).as_deref(), Some("inbox"));
        assert_eq!(table.path(file).as_deref(), Some("inbox/a.txt"));
        assert_eq!(table.by_path.get("inbox/a.txt").copied(), Some(file));
        assert!(!table.by_path.contains_key("docs/a.txt"));
        assert_eq!(table.path(sibling).as_deref(), Some("other.txt"));
    }

    #[test]
    fn remap_overwrite_forgets_destination() {
        let mut table = InodeTable::new();
        let from = table.ino_for("old.txt");
        let dest = table.ino_for("new.txt");
        table.remap_path("old.txt", "new.txt");
        assert_eq!(table.path(from).as_deref(), Some("new.txt"));
        assert!(table.path(dest).is_none());
    }
}
