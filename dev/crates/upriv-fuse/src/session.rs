//! FUSE session over daemon callbacks. Plaintext stays in the reply buffers.

use std::collections::HashMap;
use std::ffi::{CStr, CString, OsStr};
use std::os::unix::ffi::OsStrExt;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use fuser::{
    FileAttr, FileType, Filesystem, MountOption, ReplyAttr, ReplyCreate, ReplyData, ReplyDirectory,
    ReplyEmpty, ReplyEntry, ReplyWrite, Request, FUSE_ROOT_ID,
};
use libc::{c_char, EEXIST, EINVAL, ENOENT, EPERM};
use upriv_fuse_abi::{FuseHost, FuseStat};

const TTL: Duration = Duration::from_secs(1);
/// Empty mount-root file so Tracker skips the tree. Not a vault node.
const TRACKER_NOMEDIA: &str = ".nomedia";
const INTERNAL_WORKSPACE_FILE: &str = ".upriv-workspace.json";
const SEED_LOGICAL_PATH: &str = "upriv-seed.txt";

fn synthetic_tracker_nomedia(logical: &str, in_index: bool) -> bool {
    logical == TRACKER_NOMEDIA && !in_index
}

fn parent_logical(path: &str) -> Option<&str> {
    path.rsplit_once('/').map(|(parent, _)| parent)
}

fn file_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

/// Same reserved paths as the daemon: the seed file only at the mount root,
/// and the workspace file in every directory.
fn hidden_from_mount(logical: &str) -> bool {
    file_name(logical) == INTERNAL_WORKSPACE_FILE || logical == SEED_LOGICAL_PATH
}

struct EncryptedFs {
    host: FuseHost,
    root: CString,
    vault_id: CString,
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
            .filter(|path| path.starts_with(&prefix))
            .cloned()
            .collect();
        for child in children {
            if let Some(ino) = self.by_path.remove(&child) {
                self.by_ino.remove(&ino);
            }
        }
    }
}

fn logical_c(logical: &str) -> Result<CString, i32> {
    CString::new(logical).map_err(|_| EINVAL)
}

impl EncryptedFs {
    fn stat(&self, logical: &str) -> Result<FuseStat, i32> {
        let logical = logical_c(logical)?;
        let mut out = FuseStat {
            size: 0,
            modified_ms: 0,
            found: 0,
            is_dir: 0,
        };
        let rc = unsafe {
            (self.host.stat)(
                self.root.as_ptr(),
                self.vault_id.as_ptr(),
                logical.as_ptr(),
                &mut out,
            )
        };
        if rc == 0 {
            Ok(out)
        } else {
            Err(rc)
        }
    }

    fn list(&self, parent: &str) -> Result<Vec<(String, bool)>, i32> {
        let parent = logical_c(parent)?;
        let mut out = Vec::new();
        let rc = unsafe {
            (self.host.list)(
                self.root.as_ptr(),
                self.vault_id.as_ptr(),
                parent.as_ptr(),
                list_visit,
                (&mut out as *mut Vec<(String, bool)>).cast(),
            )
        };
        if rc == 0 {
            Ok(out)
        } else {
            Err(rc)
        }
    }

    fn is_synthetic_nomedia(&self, logical: &str) -> Result<bool, i32> {
        if logical != TRACKER_NOMEDIA {
            return Ok(false);
        }
        let stat = self.stat(logical)?;
        Ok(synthetic_tracker_nomedia(logical, stat.found != 0))
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

    fn attr_for(&self, logical: &str) -> Result<FileAttr, i32> {
        let mut inodes = self
            .inodes
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if logical.is_empty() {
            return Ok(self.dir_attr(FUSE_ROOT_ID, UNIX_EPOCH));
        }
        let ino = inodes.ino_for(logical);
        drop(inodes);
        if self.is_synthetic_nomedia(logical)? {
            return Ok(self.file_attr(ino, 0, UNIX_EPOCH));
        }
        let stat = self.stat(logical)?;
        if stat.found == 0 {
            return Err(ENOENT);
        }
        let time = UNIX_EPOCH + Duration::from_millis(stat.modified_ms);
        if stat.is_dir != 0 {
            Ok(self.dir_attr(ino, time))
        } else {
            Ok(self.file_attr(ino, stat.size, time))
        }
    }

    fn remove_node(&mut self, parent: u64, name: &OsStr, reply: ReplyEmpty) {
        let Some(name) = name.to_str() else {
            reply.error(EPERM);
            return;
        };
        let inodes = self
            .inodes
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(parent_path) = inodes.path(parent) else {
            reply.error(ENOENT);
            return;
        };
        drop(inodes);
        let logical = child_path(&parent_path, name);
        match self.is_synthetic_nomedia(&logical) {
            Ok(true) => {
                reply.error(EPERM);
                return;
            }
            Ok(false) => {}
            Err(code) => {
                reply.error(code);
                return;
            }
        }
        match self.delete(&logical) {
            Ok(()) => {
                self.inodes
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .forget_path(&logical);
                reply.ok();
            }
            Err(code) => reply.error(code),
        }
    }

    fn delete(&self, logical: &str) -> Result<(), i32> {
        let logical = logical_c(logical)?;
        let rc = unsafe {
            (self.host.delete)(self.root.as_ptr(), self.vault_id.as_ptr(), logical.as_ptr())
        };
        if rc == 0 {
            Ok(())
        } else {
            Err(rc)
        }
    }

    fn rmdir_at(&self, logical: &str) -> Result<(), i32> {
        let logical = logical_c(logical)?;
        let rc = unsafe {
            (self.host.rmdir)(self.root.as_ptr(), self.vault_id.as_ptr(), logical.as_ptr())
        };
        if rc == 0 {
            Ok(())
        } else {
            Err(rc)
        }
    }

    fn mkdir_at(&self, logical: &str) -> Result<(), i32> {
        let logical = logical_c(logical)?;
        let rc = unsafe {
            (self.host.mkdir)(self.root.as_ptr(), self.vault_id.as_ptr(), logical.as_ptr())
        };
        if rc == 0 {
            Ok(())
        } else {
            Err(rc)
        }
    }

    fn create_at(&self, parent: &str, name: &str) -> Result<(), i32> {
        let parent = logical_c(parent)?;
        let name = logical_c(name)?;
        let rc = unsafe {
            (self.host.create_file)(
                self.root.as_ptr(),
                self.vault_id.as_ptr(),
                parent.as_ptr(),
                name.as_ptr(),
            )
        };
        if rc == 0 {
            Ok(())
        } else {
            Err(rc)
        }
    }

    fn truncate_at(&self, logical: &str, size: u64) -> Result<(), i32> {
        let logical = logical_c(logical)?;
        let rc = unsafe {
            (self.host.truncate)(
                self.root.as_ptr(),
                self.vault_id.as_ptr(),
                logical.as_ptr(),
                size,
            )
        };
        if rc == 0 {
            Ok(())
        } else {
            Err(rc)
        }
    }

    fn read_at(&self, logical: &str, offset: u64, size: u64) -> Result<OwnedBuf, i32> {
        let logical = logical_c(logical)?;
        let mut ptr = std::ptr::null_mut();
        let mut len = 0usize;
        let rc = unsafe {
            (self.host.read_range)(
                self.root.as_ptr(),
                self.vault_id.as_ptr(),
                logical.as_ptr(),
                offset,
                size,
                &mut ptr,
                &mut len,
            )
        };
        if rc != 0 {
            return Err(rc);
        }
        Ok(OwnedBuf {
            free_buf: self.host.free_buf,
            ptr,
            len,
        })
    }

    fn write_at(&self, logical: &str, offset: u64, data: &[u8]) -> Result<(), i32> {
        let logical = logical_c(logical)?;
        let rc = unsafe {
            (self.host.write_range)(
                self.root.as_ptr(),
                self.vault_id.as_ptr(),
                logical.as_ptr(),
                offset,
                data.as_ptr(),
                data.len(),
            )
        };
        if rc == 0 {
            Ok(())
        } else {
            Err(rc)
        }
    }

    fn relocate_at(
        &self,
        from: &str,
        new_parent: &str,
        new_name: &str,
        replace: bool,
    ) -> Result<(), i32> {
        let from = logical_c(from)?;
        let new_parent = logical_c(new_parent)?;
        let new_name = logical_c(new_name)?;
        let rc = unsafe {
            (self.host.relocate)(
                self.root.as_ptr(),
                self.vault_id.as_ptr(),
                from.as_ptr(),
                new_parent.as_ptr(),
                new_name.as_ptr(),
                u8::from(replace),
            )
        };
        if rc == 0 {
            Ok(())
        } else {
            Err(rc)
        }
    }
}

struct OwnedBuf {
    free_buf: unsafe extern "C" fn(*mut u8, usize),
    ptr: *mut u8,
    len: usize,
}

impl OwnedBuf {
    fn as_slice(&self) -> &[u8] {
        if self.ptr.is_null() || self.len == 0 {
            &[]
        } else {
            unsafe { std::slice::from_raw_parts(self.ptr, self.len) }
        }
    }
}

impl Drop for OwnedBuf {
    fn drop(&mut self) {
        unsafe { (self.free_buf)(self.ptr, self.len) };
        self.ptr = std::ptr::null_mut();
        self.len = 0;
    }
}

fn child_path(parent: &str, name: &str) -> String {
    if parent.is_empty() {
        name.to_string()
    } else {
        format!("{parent}/{name}")
    }
}

unsafe extern "C" fn list_visit(ctx: *mut libc::c_void, path: *const c_char, is_dir: u8) {
    if ctx.is_null() || path.is_null() {
        return;
    }
    let list = unsafe { &mut *ctx.cast::<Vec<(String, bool)>>() };
    let Ok(path) = unsafe { CStr::from_ptr(path) }.to_str() else {
        return;
    };
    list.push((path.to_string(), is_dir != 0));
}

impl Filesystem for EncryptedFs {
    fn lookup(&mut self, _req: &Request<'_>, parent: u64, name: &OsStr, reply: ReplyEntry) {
        let Some(name) = name.to_str() else {
            reply.error(ENOENT);
            return;
        };
        let inodes = self
            .inodes
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(parent_path) = inodes.path(parent) else {
            reply.error(ENOENT);
            return;
        };
        drop(inodes);
        let logical = child_path(&parent_path, name);
        if hidden_from_mount(&logical) {
            reply.error(ENOENT);
            return;
        }
        match self.attr_for(&logical) {
            Ok(attr) => reply.entry(&TTL, &attr, 0),
            Err(code) => reply.error(code),
        }
    }

    fn getattr(&mut self, _req: &Request<'_>, ino: u64, _fh: Option<u64>, reply: ReplyAttr) {
        let inodes = self
            .inodes
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
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
        let inodes = self
            .inodes
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(parent) = inodes.path(ino) else {
            reply.error(ENOENT);
            return;
        };
        drop(inodes);
        let children = match self.list(&parent) {
            Ok(children) => children,
            Err(code) => {
                reply.error(code);
                return;
            }
        };
        let mut entries: Vec<(u64, FileType, String)> = Vec::new();
        let mut table = self
            .inodes
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let parent_ino = match parent_logical(&parent) {
            Some(path) => table.ino_for(path),
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
        if parent.is_empty() && !entries.iter().any(|(_, _, name)| name == TRACKER_NOMEDIA) {
            let nomedia = table.ino_for(TRACKER_NOMEDIA);
            entries.push((nomedia, FileType::RegularFile, TRACKER_NOMEDIA.into()));
        }
        drop(table);
        for (index, (child_ino, kind, name)) in
            entries.into_iter().enumerate().skip(offset as usize)
        {
            if reply.add(child_ino, (index + 1) as i64, kind, name) {
                break;
            }
        }
        reply.ok();
    }

    fn open(&mut self, _req: &Request<'_>, ino: u64, _flags: i32, reply: fuser::ReplyOpen) {
        let inodes = self
            .inodes
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
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
        let inodes = self
            .inodes
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(path) = inodes.path(ino) else {
            reply.error(ENOENT);
            return;
        };
        drop(inodes);
        match self.is_synthetic_nomedia(&path) {
            Ok(true) => {
                reply.data(&[]);
                return;
            }
            Ok(false) => {}
            Err(code) => {
                reply.error(code);
                return;
            }
        }
        match self.read_at(&path, offset as u64, size as u64) {
            Ok(bytes) => reply.data(bytes.as_slice()),
            Err(code) => reply.error(code),
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
        let inodes = self
            .inodes
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(path) = inodes.path(ino) else {
            reply.error(ENOENT);
            return;
        };
        drop(inodes);
        match self.is_synthetic_nomedia(&path) {
            Ok(true) => {
                reply.error(EPERM);
                return;
            }
            Ok(false) => {}
            Err(code) => {
                reply.error(code);
                return;
            }
        }
        match self.write_at(&path, offset as u64, data) {
            Ok(()) => reply.written(data.len() as u32),
            Err(code) => reply.error(code),
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
        let inodes = self
            .inodes
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(parent_path) = inodes.path(parent) else {
            reply.error(ENOENT);
            return;
        };
        drop(inodes);
        let logical = child_path(&parent_path, name);
        match self.is_synthetic_nomedia(&logical) {
            Ok(true) => {
                reply.error(EPERM);
                return;
            }
            Ok(false) => {}
            Err(code) => {
                reply.error(code);
                return;
            }
        }
        match self.mkdir_at(&logical) {
            Ok(()) => match self.attr_for(&logical) {
                Ok(attr) => reply.entry(&TTL, &attr, 0),
                Err(code) => reply.error(code),
            },
            Err(code) => reply.error(code),
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
        let inodes = self
            .inodes
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(parent_path) = inodes.path(parent) else {
            reply.error(ENOENT);
            return;
        };
        drop(inodes);
        let logical = child_path(&parent_path, name);
        match self.is_synthetic_nomedia(&logical) {
            Ok(true) => {
                reply.error(EPERM);
                return;
            }
            Ok(false) => {}
            Err(code) => {
                reply.error(code);
                return;
            }
        }
        match self.create_at(&parent_path, name) {
            Ok(()) => match self.attr_for(&logical) {
                Ok(attr) => reply.created(&TTL, &attr, 0, 0, 0),
                Err(code) => reply.error(code),
            },
            Err(code) if code == EEXIST && flags & libc::O_EXCL == 0 => {
                match self.attr_for(&logical) {
                    Ok(attr) if attr.kind == FileType::RegularFile => {
                        if flags & libc::O_TRUNC != 0 {
                            if let Err(code) = self.truncate_at(&logical, 0) {
                                reply.error(code);
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
            Err(code) => reply.error(code),
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
        let inodes = self
            .inodes
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(parent_path) = inodes.path(parent) else {
            reply.error(ENOENT);
            return;
        };
        drop(inodes);
        let logical = child_path(&parent_path, name);
        match self.rmdir_at(&logical) {
            Ok(()) => {
                self.inodes
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .forget_path(&logical);
                reply.ok();
            }
            Err(code) => reply.error(code),
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
        let inodes = self
            .inodes
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(parent_path) = inodes.path(parent) else {
            reply.error(ENOENT);
            return;
        };
        let Some(new_parent) = inodes.path(newparent) else {
            reply.error(ENOENT);
            return;
        };
        drop(inodes);
        let from = child_path(&parent_path, name);
        let replace = flags & libc::RENAME_NOREPLACE == 0;
        let dest_logical = child_path(&new_parent, newname);
        match (
            self.is_synthetic_nomedia(&from),
            self.is_synthetic_nomedia(&dest_logical),
        ) {
            (Ok(true), _) | (_, Ok(true)) => {
                reply.error(EPERM);
                return;
            }
            (Err(code), _) | (_, Err(code)) => {
                reply.error(code);
                return;
            }
            (Ok(false), Ok(false)) => {}
        }
        match self.relocate_at(&from, &new_parent, newname, replace) {
            Ok(()) => {
                self.inodes
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .remap_path(&from, &dest_logical);
                reply.ok();
            }
            Err(code) => reply.error(code),
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
        let inodes = self
            .inodes
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(path) = inodes.path(ino) else {
            reply.error(ENOENT);
            return;
        };
        drop(inodes);
        if let Some(size) = size {
            match self.is_synthetic_nomedia(&path) {
                Ok(true) => {
                    reply.error(EPERM);
                    return;
                }
                Ok(false) => {}
                Err(code) => {
                    reply.error(code);
                    return;
                }
            }
            if let Err(code) = self.truncate_at(&path, size) {
                reply.error(code);
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

struct LiveMount {
    _session: fuser::BackgroundSession,
}

fn write_error(buf: *mut u8, cap: usize, message: &str) {
    if buf.is_null() || cap == 0 {
        return;
    }
    let bytes = message.as_bytes();
    let len = bytes.len().min(cap - 1);
    unsafe {
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), buf, len);
        *buf.add(len) = 0;
    }
}

/// Mount `mount_point`. Null means failure; `error_buf` then holds the reason.
///
/// # Safety
/// `host` is a live [`FuseHost`] for the rest of the process. The three strings
/// are nul-terminated. `error_buf` has `error_cap` bytes.
#[no_mangle]
pub unsafe extern "C" fn upriv_fuse_mount(
    host: *const FuseHost,
    root: *const c_char,
    vault_id: *const c_char,
    mount_point: *const c_char,
    error_buf: *mut u8,
    error_cap: usize,
) -> *mut libc::c_void {
    if host.is_null() || root.is_null() || vault_id.is_null() || mount_point.is_null() {
        write_error(
            error_buf,
            error_cap,
            "FUSE mount helper was called without a session",
        );
        return std::ptr::null_mut();
    }
    let root = unsafe { CStr::from_ptr(root) }.to_owned();
    let vault_id = unsafe { CStr::from_ptr(vault_id) }.to_owned();
    let point = PathBuf::from(OsStr::from_bytes(
        unsafe { CStr::from_ptr(mount_point) }.to_bytes(),
    ));
    let uid = unsafe { libc::getuid() };
    let gid = unsafe { libc::getgid() };
    let fs = EncryptedFs {
        host: unsafe { *host },
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
    match fuser::spawn_mount2(fs, &point, &options) {
        Ok(session) => Box::into_raw(Box::new(LiveMount { _session: session })).cast(),
        Err(error) => {
            write_error(
                error_buf,
                error_cap,
                &format!("FUSE mount failed at {}: {error}", point.display()),
            );
            std::ptr::null_mut()
        }
    }
}

/// Unmount the session returned by [`upriv_fuse_mount`].
///
/// # Safety
/// `raw` is null or a pointer returned by [`upriv_fuse_mount`] and not yet freed.
#[no_mangle]
pub unsafe extern "C" fn upriv_fuse_unmount(raw: *mut libc::c_void) {
    if raw.is_null() {
        return;
    }
    drop(unsafe { Box::from_raw(raw.cast::<LiveMount>()) });
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
    fn seed_file_is_hidden_only_at_the_mount_root() {
        assert!(hidden_from_mount("upriv-seed.txt"));
        assert!(hidden_from_mount(".upriv-workspace.json"));
        assert!(hidden_from_mount("notes/.upriv-workspace.json"));
        assert!(!hidden_from_mount("notes/upriv-seed.txt"));
        assert!(!hidden_from_mount("notes.txt"));
    }

    #[test]
    fn tracker_nomedia_is_only_a_missing_mount_root_file() {
        assert!(synthetic_tracker_nomedia(".nomedia", false));
        assert!(!synthetic_tracker_nomedia(".nomedia", true));
        assert!(!synthetic_tracker_nomedia("docs/.nomedia", false));
        assert!(!synthetic_tracker_nomedia("notes.txt", false));
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
