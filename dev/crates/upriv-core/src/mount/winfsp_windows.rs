//! WinFsp adapter over the open-session file API. Plaintext stays in RAM.
//!
//! The WinFsp DLL is loaded at runtime. The daemon does not link a WinFsp
//! crate: the published crate is GPL-3.0 and its build script needs libclang.
//! Upriv is MIT. A missing DLL fails the mount; the in-app file manager still
//! works. The process keeps the DLL mapped after the first successful load.
//!
//! The volume is `WinFsp.Disk` on the directory the user chose. `WinFsp.Net`
//! cannot mount on a directory. Thumbnail policy lives in [`super::explorer`].

#![allow(clippy::too_many_arguments)]

use std::ffi::{c_void, OsStr};
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard, OnceLock};

use crate::error::{Result, UprivError};
use crate::paths::VaultRoot;
use crate::session::with_open_session;
use crate::store::{
    file_name, parent_logical, to_ui_path, INTERNAL_WORKSPACE_FILE, SEED_LOGICAL_PATH,
    VAULT_FS_MAX_INLINE_BYTES,
};
use crate::vault::fs as vfs;

use super::explorer::{
    disk_device_name, nt_to_logical, rejected_file_name, renamed_open_path, reported_attributes,
    resolve_stored_case, RejectedName,
};
use super::MountedVault;

const FILE_DIRECTORY_FILE: u32 = 0x0000_0001;
const FILE_NON_DIRECTORY_FILE: u32 = 0x0000_0040;
const FILE_DELETE_ON_CLOSE: u32 = 0x0000_1000;
const FSP_CLEANUP_DELETE: u32 = 0x01;

const STATUS_SUCCESS: i32 = 0;
const STATUS_ACCESS_DENIED: u32 = 0xC000_0022;
const STATUS_OBJECT_NAME_INVALID: u32 = 0xC000_0033;
const STATUS_OBJECT_NAME_NOT_FOUND: u32 = 0xC000_0034;
const STATUS_OBJECT_NAME_COLLISION: u32 = 0xC000_0035;
const STATUS_OBJECT_PATH_NOT_FOUND: u32 = 0xC000_003A;
const STATUS_FILE_IS_A_DIRECTORY: u32 = 0xC000_00BA;
const STATUS_UNEXPECTED_IO_ERROR: u32 = 0xC000_00E9;
const STATUS_DIRECTORY_NOT_EMPTY: u32 = 0xC000_0101;
const STATUS_NOT_A_DIRECTORY: u32 = 0xC000_0103;
const STATUS_FILE_TOO_LARGE: u32 = 0xC000_0904;

const CASE_PRESERVED_NAMES: u32 = 1 << 1;
const UNICODE_ON_DISK: u32 = 1 << 2;
const POST_CLEANUP_WHEN_MODIFIED_ONLY: u32 = 1 << 10;
const ALWAYS_USE_DOUBLE_BUFFERING: u32 = 1 << 12;
const FLUSH_AND_PURGE_ON_CLEANUP: u32 = 1 << 14;
const UM_FILE_CONTEXT_IS_USER_CONTEXT2: u32 = 1 << 16;
const SUPPORTS_POSIX_UNLINK_RENAME: u32 = 1 << 29;

const USER_CONTEXT_OFFSET: usize = 8;
const NOT_INSTALLED: &str = "WinFsp is not installed; use the in-app file manager";

#[link(name = "kernel32")]
extern "system" {
    fn LoadLibraryW(name: *const u16) -> *mut c_void;
    fn GetProcAddress(module: *mut c_void, name: *const i8) -> *mut c_void;
}

fn nt(code: u32) -> i32 {
    code as i32
}

fn volume_flags() -> u32 {
    CASE_PRESERVED_NAMES
        | UNICODE_ON_DISK
        | POST_CLEANUP_WHEN_MODIFIED_ONLY
        | ALWAYS_USE_DOUBLE_BUFFERING
        | FLUSH_AND_PURGE_ON_CLEANUP
        | UM_FILE_CONTEXT_IS_USER_CONTEXT2
        | SUPPORTS_POSIX_UNLINK_RENAME
}

/// `FSP_FSCTL_VOLUME_PARAMS`. 504 bytes, 8-byte aligned.
#[repr(C)]
#[derive(Clone, Copy)]
struct VolumeParams {
    version: u16,
    sector_size: u16,
    sectors_per_allocation_unit: u16,
    max_component_length: u16,
    volume_creation_time: u64,
    volume_serial_number: u32,
    transact_timeout: u32,
    irp_timeout: u32,
    irp_capacity: u32,
    file_info_timeout: u32,
    flags: u32,
    prefix: [u16; 192],
    file_system_name: [u16; 16],
    flags2: u32,
    volume_info_timeout: u32,
    dir_info_timeout: u32,
    security_timeout: u32,
    stream_info_timeout: u32,
    ea_timeout: u32,
    fsext_control_code: u32,
    reserved32: u32,
    reserved64: [u64; 2],
}

impl Default for VolumeParams {
    fn default() -> Self {
        Self {
            version: 0,
            sector_size: 512,
            sectors_per_allocation_unit: 8,
            max_component_length: 255,
            volume_creation_time: 0,
            volume_serial_number: 0x5550_5256,
            transact_timeout: 0,
            irp_timeout: 0,
            irp_capacity: 0,
            file_info_timeout: 1000,
            flags: volume_flags(),
            prefix: [0; 192],
            file_system_name: [0; 16],
            flags2: 0,
            volume_info_timeout: 0,
            dir_info_timeout: 0,
            security_timeout: 0,
            stream_info_timeout: 0,
            ea_timeout: 0,
            fsext_control_code: 0,
            reserved32: 0,
            reserved64: [0; 2],
        }
    }
}

/// `FSP_FSCTL_FILE_INFO`. 72 bytes.
#[repr(C)]
#[derive(Clone, Copy)]
struct FileInfo {
    file_attributes: u32,
    reparse_tag: u32,
    allocation_size: u64,
    file_size: u64,
    creation_time: u64,
    last_access_time: u64,
    last_write_time: u64,
    change_time: u64,
    index_number: u64,
    hard_links: u32,
    ea_size: u32,
}

/// `FSP_FSCTL_VOLUME_INFO`. 88 bytes with trailing alignment.
#[repr(C)]
struct VolumeInfo {
    total_size: u64,
    free_size: u64,
    volume_label_length: u16,
    volume_label: [u16; 32],
}

/// `FSP_FSCTL_DIR_INFO` plus a 255-unit name. `size` is the used prefix.
#[repr(C)]
struct DirEntry {
    size: u16,
    _pad: [u8; 6],
    file_info: FileInfo,
    padding: [u8; 24],
    name: [u16; 255],
}

type CreateHost = unsafe extern "C" fn(
    device: *mut u16,
    params: *const VolumeParams,
    interface: *const Interface,
    out_fs: *mut *mut c_void,
) -> i32;
type DeleteHost = unsafe extern "C" fn(fs: *mut c_void);
type SetMount = unsafe extern "C" fn(fs: *mut c_void, mount: *mut u16) -> i32;
type RemoveMount = unsafe extern "C" fn(fs: *mut c_void);
type StartDispatcher = unsafe extern "C" fn(fs: *mut c_void, threads: u32) -> i32;
type StopDispatcher = unsafe extern "C" fn(fs: *mut c_void);
type AddDirInfo = unsafe extern "C" fn(
    dir_info: *mut DirEntry,
    buffer: *mut c_void,
    length: u32,
    bytes: *mut u32,
) -> u8;
type UnusedOp = Option<unsafe extern "C" fn()>;

#[derive(Clone, Copy)]
struct Api {
    create: CreateHost,
    delete: DeleteHost,
    set_mount_point: SetMount,
    remove_mount_point: RemoveMount,
    start_dispatcher: StartDispatcher,
    stop_dispatcher: StopDispatcher,
    add_dir_info: AddDirInfo,
}

static API: OnceLock<Api> = OnceLock::new();

#[repr(C)]
struct Interface {
    get_volume_info: Option<GetVolumeInfo>,
    set_volume_label: Option<SetVolumeLabel>,
    get_security_by_name: Option<GetSecurityByName>,
    create: Option<CreateFile>,
    open: Option<OpenFile>,
    overwrite: Option<OverwriteFile>,
    cleanup: Option<CleanupFile>,
    close: Option<CloseFile>,
    read: Option<ReadFile>,
    write: Option<WriteFile>,
    flush: Option<FlushFile>,
    get_file_info: Option<GetFileInfo>,
    set_basic_info: Option<SetBasicInfo>,
    set_file_size: Option<SetFileSize>,
    can_delete: Option<CanDelete>,
    rename: Option<RenameFile>,
    get_security: Option<GetSecurity>,
    set_security: UnusedOp,
    read_directory: Option<ReadDirectory>,
    resolve_reparse: UnusedOp,
    get_reparse: UnusedOp,
    set_reparse: UnusedOp,
    delete_reparse: UnusedOp,
    get_stream_info: UnusedOp,
    get_dir_info_by_name: UnusedOp,
    control: UnusedOp,
    set_delete: Option<SetDelete>,
    create_ex: UnusedOp,
    overwrite_ex: UnusedOp,
    get_ea: UnusedOp,
    set_ea: UnusedOp,
    obsolete0: UnusedOp,
    dispatcher_stopped: UnusedOp,
    reserved: [UnusedOp; 31],
}

type GetVolumeInfo = unsafe extern "C" fn(*mut c_void, *mut VolumeInfo) -> i32;
type SetVolumeLabel = unsafe extern "C" fn(*mut c_void, *mut u16, *mut VolumeInfo) -> i32;
type GetSecurityByName =
    unsafe extern "C" fn(*mut c_void, *mut u16, *mut u32, *mut c_void, *mut usize) -> i32;
type CreateFile = unsafe extern "C" fn(
    *mut c_void,
    *mut u16,
    u32,
    u32,
    u32,
    *mut c_void,
    u64,
    *mut *mut c_void,
    *mut FileInfo,
) -> i32;
type OpenFile =
    unsafe extern "C" fn(*mut c_void, *mut u16, u32, u32, *mut *mut c_void, *mut FileInfo) -> i32;
type OverwriteFile =
    unsafe extern "C" fn(*mut c_void, *mut c_void, u32, u8, u64, *mut FileInfo) -> i32;
type CleanupFile = unsafe extern "C" fn(*mut c_void, *mut c_void, *mut u16, u32);
type CloseFile = unsafe extern "C" fn(*mut c_void, *mut c_void);
type ReadFile =
    unsafe extern "C" fn(*mut c_void, *mut c_void, *mut c_void, u64, u32, *mut u32) -> i32;
type WriteFile = unsafe extern "C" fn(
    *mut c_void,
    *mut c_void,
    *mut c_void,
    u64,
    u32,
    u8,
    u8,
    *mut u32,
    *mut FileInfo,
) -> i32;
type FlushFile = unsafe extern "C" fn(*mut c_void, *mut c_void, *mut FileInfo) -> i32;
type GetFileInfo = unsafe extern "C" fn(*mut c_void, *mut c_void, *mut FileInfo) -> i32;
type SetBasicInfo =
    unsafe extern "C" fn(*mut c_void, *mut c_void, u32, u64, u64, u64, u64, *mut FileInfo) -> i32;
type SetFileSize = unsafe extern "C" fn(*mut c_void, *mut c_void, u64, u8, *mut FileInfo) -> i32;
type CanDelete = unsafe extern "C" fn(*mut c_void, *mut c_void, *mut u16) -> i32;
type RenameFile = unsafe extern "C" fn(*mut c_void, *mut c_void, *mut u16, *mut u16, u8) -> i32;
type GetSecurity = unsafe extern "C" fn(*mut c_void, *mut c_void, *mut c_void, *mut usize) -> i32;
type ReadDirectory = unsafe extern "C" fn(
    *mut c_void,
    *mut c_void,
    *mut u16,
    *mut u16,
    *mut c_void,
    u32,
    *mut u32,
) -> i32;
type SetDelete = unsafe extern "C" fn(*mut c_void, *mut c_void, *mut u16, u8) -> i32;

static INTERFACE: Interface = Interface {
    get_volume_info: Some(get_volume_info),
    set_volume_label: Some(set_volume_label),
    get_security_by_name: Some(get_security_by_name),
    create: Some(create_file),
    open: Some(open_file),
    overwrite: Some(overwrite_file),
    cleanup: Some(cleanup_file),
    close: Some(close_file),
    read: Some(read_file),
    write: Some(write_file),
    flush: Some(flush_file),
    get_file_info: Some(get_file_info),
    set_basic_info: Some(set_basic_info),
    set_file_size: Some(set_file_size),
    can_delete: Some(can_delete),
    rename: Some(rename_file),
    get_security: Some(get_security),
    set_security: None,
    read_directory: Some(read_directory),
    resolve_reparse: None,
    get_reparse: None,
    set_reparse: None,
    delete_reparse: None,
    get_stream_info: None,
    get_dir_info_by_name: None,
    control: None,
    set_delete: Some(set_delete),
    create_ex: None,
    overwrite_ex: None,
    get_ea: None,
    set_ea: None,
    obsolete0: None,
    dispatcher_stopped: None,
    reserved: [None; 31],
};

fn dll_file_name() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "winfsp-a64.dll"
    } else if cfg!(target_arch = "x86") {
        "winfsp-x86.dll"
    } else {
        "winfsp-x64.dll"
    }
}

fn dll_candidates() -> [String; 3] {
    let file = dll_file_name();
    [
        file.to_string(),
        format!(r"C:\Program Files (x86)\WinFsp\bin\{file}"),
        format!(r"C:\Program Files\WinFsp\bin\{file}"),
    ]
}

fn load_module(path: &str) -> Option<*mut c_void> {
    let wide: Vec<u16> = OsStr::new(path).encode_wide().chain(Some(0)).collect();
    let handle = unsafe { LoadLibraryW(wide.as_ptr()) };
    if handle.is_null() {
        None
    } else {
        Some(handle)
    }
}

fn symbol<T>(module: *mut c_void, name: &[u8]) -> Option<T> {
    if std::mem::size_of::<T>() != std::mem::size_of::<*mut c_void>() {
        return None;
    }
    let ptr = unsafe { GetProcAddress(module, name.as_ptr().cast()) };
    if ptr.is_null() {
        None
    } else {
        Some(unsafe { std::mem::transmute_copy(&ptr) })
    }
}

fn load_api() -> Option<Api> {
    for path in dll_candidates() {
        let Some(module) = load_module(&path) else {
            continue;
        };
        let Some(api) = (|| {
            Some(Api {
                create: symbol(module, b"FspFileSystemCreate\0")?,
                delete: symbol(module, b"FspFileSystemDelete\0")?,
                set_mount_point: symbol(module, b"FspFileSystemSetMountPoint\0")?,
                remove_mount_point: symbol(module, b"FspFileSystemRemoveMountPoint\0")?,
                start_dispatcher: symbol(module, b"FspFileSystemStartDispatcher\0")?,
                stop_dispatcher: symbol(module, b"FspFileSystemStopDispatcher\0")?,
                add_dir_info: symbol(module, b"FspFileSystemAddDirInfo\0")?,
            })
        })() else {
            continue;
        };
        return Some(api);
    }
    None
}

fn ensure_api() -> Option<Api> {
    if let Some(api) = API.get() {
        return Some(*api);
    }
    let api = load_api()?;
    Some(*API.get_or_init(|| api))
}

fn wide_z(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(Some(0)).collect()
}

fn wide_z_os(path: &Path) -> Vec<u16> {
    let wide: Vec<u16> = path.as_os_str().encode_wide().collect();
    let mut text = strip_verbatim_prefix(&wide);
    text.push(0);
    text
}

/// `\\?\C:\...` is a Mount Manager path in WinFsp. A plain `C:\...` directory
/// is the junction mount. `\\?\UNC\server\share` becomes `\\server\share`.
fn strip_verbatim_prefix(wide: &[u16]) -> Vec<u16> {
    const VERBATIM: [u16; 4] = [b'\\' as u16, b'\\' as u16, b'?' as u16, b'\\' as u16];
    const UNC: [u16; 4] = [b'U' as u16, b'N' as u16, b'C' as u16, b'\\' as u16];
    let Some(rest) = wide.strip_prefix(&VERBATIM) else {
        return wide.to_vec();
    };
    if let Some(unc) = rest.strip_prefix(&UNC) {
        let mut out = Vec::with_capacity(2 + unc.len());
        out.push(b'\\' as u16);
        out.push(b'\\' as u16);
        out.extend_from_slice(unc);
        return out;
    }
    rest.to_vec()
}

fn write_wide_field(dst: &mut [u16], text: &str) {
    for (slot, unit) in dst.iter_mut().zip(text.encode_utf16()) {
        *slot = unit;
    }
}

struct NodeSnap {
    logical: String,
    is_dir: bool,
    size: u64,
    created_at: u64,
    modified_at: u64,
}

impl NodeSnap {
    fn root() -> Self {
        Self {
            logical: String::new(),
            is_dir: true,
            size: 0,
            created_at: 0,
            modified_at: 0,
        }
    }
}

struct Opened {
    id: u64,
    is_dir: bool,
    delete_on_cleanup: AtomicBool,
}

struct EncryptedFs {
    root: VaultRoot,
    vault_id: String,
    paths: Mutex<std::collections::HashMap<u64, String>>,
    next_id: AtomicU64,
}

impl EncryptedFs {
    fn paths(&self) -> MutexGuard<'_, std::collections::HashMap<u64, String>> {
        self.paths
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
    }

    fn insert_path(&self, logical: String) -> u64 {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        self.paths().insert(id, logical);
        id
    }

    fn path_of(&self, id: u64) -> std::result::Result<String, i32> {
        self.paths()
            .get(&id)
            .cloned()
            .ok_or_else(|| nt(STATUS_OBJECT_NAME_NOT_FOUND))
    }

    fn forget_path(&self, id: u64) {
        self.paths().remove(&id);
    }

    fn rewrite_paths(&self, from: &str, to: &str) {
        let mut paths = self.paths();
        for path in paths.values_mut() {
            *path = renamed_open_path(path, from, to);
        }
    }

    fn vault_dir(&self) -> std::result::Result<PathBuf, i32> {
        self.root
            .vault_dir(&self.vault_id)
            .map_err(|_| nt(STATUS_UNEXPECTED_IO_ERROR))
    }

    fn find_node(&self, requested: &str) -> std::result::Result<NodeSnap, i32> {
        if is_hidden(requested) {
            return Err(nt(STATUS_OBJECT_NAME_NOT_FOUND));
        }
        if requested.is_empty() {
            return Ok(NodeSnap::root());
        }
        let dir = self.vault_dir()?;
        let found = with_open_session(&dir, |session| {
            let stored = session.index.nodes.iter().map(|node| node.path.as_str());
            let Some(canon) = resolve_stored_case(stored, requested) else {
                return Err(UprivError::VaultPathNotFound(requested.to_string()));
            };
            let canon = canon.to_string();
            let node = session
                .index
                .find(&canon)
                .ok_or_else(|| UprivError::VaultPathNotFound(canon.clone()))?;
            let size = node.as_file().map(|(_, size, _)| size).unwrap_or(0);
            Ok(NodeSnap {
                logical: canon,
                is_dir: node.is_dir(),
                size,
                created_at: node.created_at,
                modified_at: node.modified_at,
            })
        })
        .map_err(map_err);
        match found {
            Ok(snap) => Ok(snap),
            Err(status) if status == nt(STATUS_OBJECT_NAME_NOT_FOUND) => {
                let parent = parent_logical(requested).unwrap_or("");
                if parent.is_empty() {
                    Err(status)
                } else {
                    match self.find_node(parent) {
                        Ok(_) => Err(nt(STATUS_OBJECT_NAME_NOT_FOUND)),
                        Err(parent_status)
                            if parent_status == nt(STATUS_OBJECT_NAME_NOT_FOUND)
                                || parent_status == nt(STATUS_OBJECT_PATH_NOT_FOUND) =>
                        {
                            Err(nt(STATUS_OBJECT_PATH_NOT_FOUND))
                        }
                        Err(other) => Err(other),
                    }
                }
            }
            Err(status) => Err(status),
        }
    }

    fn file_info_of(&self, snap: &NodeSnap) -> FileInfo {
        let created = super::explorer::filetime_from_unix_millis(snap.created_at);
        let written = super::explorer::filetime_from_unix_millis(snap.modified_at);
        FileInfo {
            file_attributes: reported_attributes(snap.is_dir),
            reparse_tag: 0,
            allocation_size: allocation_size(snap.size),
            file_size: snap.size,
            creation_time: created,
            last_access_time: written,
            last_write_time: written,
            change_time: written,
            index_number: index_number(&snap.logical),
            hard_links: 0,
            ea_size: 0,
        }
    }

    fn open_snap(&self, snap: NodeSnap, delete_on_close: bool) -> Opened {
        Opened {
            id: self.insert_path(snap.logical),
            is_dir: snap.is_dir,
            delete_on_cleanup: AtomicBool::new(delete_on_close),
        }
    }

    fn directory_entries(
        &self,
        logical: &str,
    ) -> std::result::Result<Vec<(String, FileInfo)>, i32> {
        let dir = self.vault_dir()?;
        let (self_snap, parent_snap, mut children) = with_open_session(&dir, |session| {
            let self_snap = snap_in(session, logical)?;
            let parent = parent_logical(logical).unwrap_or("");
            let parent_snap = snap_in(session, parent)?;
            let mut children = Vec::new();
            for node in &session.index.nodes {
                if is_hidden(&node.path) {
                    continue;
                }
                if parent_logical(&node.path).unwrap_or("") != logical {
                    continue;
                }
                children.push(snap_from(node));
            }
            Ok((self_snap, parent_snap, children))
        })
        .map_err(map_err)?;
        children.sort_by(|left, right| {
            file_name(&left.logical)
                .to_ascii_lowercase()
                .cmp(&file_name(&right.logical).to_ascii_lowercase())
        });
        let mut entries = Vec::with_capacity(children.len() + 2);
        entries.push((".".to_string(), self.file_info_of(&self_snap)));
        entries.push(("..".to_string(), self.file_info_of(&parent_snap)));
        for child in children {
            let name = file_name(&child.logical).to_string();
            entries.push((name, self.file_info_of(&child)));
        }
        Ok(entries)
    }

    fn has_user_child(&self, logical: &str) -> std::result::Result<bool, i32> {
        let dir = self.vault_dir()?;
        with_open_session(&dir, |session| {
            Ok(session.index.nodes.iter().any(|node| {
                !is_hidden(&node.path) && parent_logical(&node.path).unwrap_or("") == logical
            }))
        })
        .map_err(map_err)
    }

    fn read_bytes(
        &self,
        logical: &str,
        buffer: &mut [u8],
        offset: u64,
    ) -> std::result::Result<u32, i32> {
        let snap = self.find_node(logical)?;
        if snap.is_dir {
            return Err(nt(STATUS_FILE_IS_A_DIRECTORY));
        }
        if buffer.is_empty() || offset >= snap.size {
            return Ok(0);
        }
        let want = ((snap.size - offset) as usize).min(buffer.len());
        let mut filled = 0;
        while filled < want {
            let chunk = (want - filled).min(VAULT_FS_MAX_INLINE_BYTES as usize);
            let bytes = vfs::fs_read_range(
                &self.root,
                &self.vault_id,
                &to_ui_path(logical),
                offset + filled as u64,
                chunk as u64,
            )
            .map_err(map_err)?;
            if bytes.is_empty() {
                break;
            }
            let n = bytes.len().min(want - filled);
            buffer[filled..filled + n].copy_from_slice(&bytes[..n]);
            filled += n;
        }
        Ok(filled as u32)
    }

    fn write_bytes(
        &self,
        logical: &str,
        data: &[u8],
        offset: u64,
    ) -> std::result::Result<u32, i32> {
        let mut written = 0;
        while written < data.len() {
            let chunk = (data.len() - written).min(VAULT_FS_MAX_INLINE_BYTES as usize);
            vfs::fs_write_range(
                &self.root,
                &self.vault_id,
                &to_ui_path(logical),
                offset + written as u64,
                &data[written..written + chunk],
            )
            .map_err(map_err)?;
            written += chunk;
        }
        Ok(written as u32)
    }

    fn attributes_of(&self, logical: &str) -> std::result::Result<u32, i32> {
        if !logical.is_empty() {
            if let Err(status) = refuse_leaf(logical) {
                if self.find_node(logical).is_err() {
                    return Err(status);
                }
            }
        }
        let snap = self.find_node(logical)?;
        Ok(reported_attributes(snap.is_dir))
    }

    fn place(&self, logical: &str, make_dir: bool) -> std::result::Result<NodeSnap, i32> {
        refuse_leaf(logical)?;
        let (parent, name) = match logical.rsplit_once('/') {
            Some((parent, name)) => (parent.to_string(), name.to_string()),
            None => (String::new(), logical.to_string()),
        };
        let parent_snap = self.find_node(&parent)?;
        if !parent_snap.is_dir {
            return Err(nt(STATUS_NOT_A_DIRECTORY));
        }
        let full = if parent_snap.logical.is_empty() {
            name.clone()
        } else {
            format!("{}/{}", parent_snap.logical, name)
        };
        if self.find_node(&full).is_ok() {
            return Err(nt(STATUS_OBJECT_NAME_COLLISION));
        }
        if make_dir {
            vfs::fs_mkdir(&self.root, &self.vault_id, &to_ui_path(&full)).map_err(map_err)?;
        } else {
            vfs::fs_create_named_file(
                &self.root,
                &self.vault_id,
                &to_ui_path(&parent_snap.logical),
                &name,
            )
            .map_err(map_err)?;
        }
        self.find_node(&full)
    }

    fn delete_opened(&self, opened: &Opened) {
        let Ok(logical) = self.path_of(opened.id) else {
            return;
        };
        if logical.is_empty() || is_hidden(&logical) {
            return;
        }
        let ui = to_ui_path(&logical);
        if opened.is_dir {
            let _ = vfs::fs_rmdir(&self.root, &self.vault_id, &ui);
        } else {
            let _ = vfs::fs_delete(&self.root, &self.vault_id, &ui);
        }
    }

    fn ensure_deletable(&self, opened: &Opened) -> std::result::Result<(), i32> {
        let logical = self.path_of(opened.id)?;
        if logical.is_empty() || is_hidden(&logical) {
            return Err(nt(STATUS_ACCESS_DENIED));
        }
        if opened.is_dir && self.has_user_child(&logical)? {
            return Err(nt(STATUS_DIRECTORY_NOT_EMPTY));
        }
        Ok(())
    }

    fn mark_delete(&self, opened: &Opened, delete_file: bool) -> std::result::Result<(), i32> {
        if !delete_file {
            opened.delete_on_cleanup.store(false, Ordering::Relaxed);
            return Ok(());
        }
        self.ensure_deletable(opened)?;
        opened.delete_on_cleanup.store(true, Ordering::Relaxed);
        Ok(())
    }

    fn relocate(&self, opened: &Opened, dest: &str, replace: bool) -> std::result::Result<(), i32> {
        let from = self.path_of(opened.id)?;
        if from.is_empty() || is_hidden(&from) {
            return Err(nt(STATUS_ACCESS_DENIED));
        }
        refuse_leaf(dest)?;
        let (parent, name) = match dest.rsplit_once('/') {
            Some((parent, name)) => (parent.to_string(), name.to_string()),
            None => (String::new(), dest.to_string()),
        };
        let parent_snap = self.find_node(&parent)?;
        if !parent_snap.is_dir {
            return Err(nt(STATUS_NOT_A_DIRECTORY));
        }
        let (stored, _) = vfs::fs_relocate(
            &self.root,
            &self.vault_id,
            &to_ui_path(&from),
            &to_ui_path(&parent_snap.logical),
            &name,
            replace,
        )
        .map_err(map_err)?;
        let stored = stored.trim_start_matches('/');
        self.rewrite_paths(&from, stored);
        Ok(())
    }
}

fn snap_in(
    session: &mut crate::session::OpenSession,
    logical: &str,
) -> std::result::Result<NodeSnap, UprivError> {
    if is_hidden(logical) {
        return Err(UprivError::VaultPathNotFound(logical.to_string()));
    }
    if logical.is_empty() {
        return Ok(NodeSnap::root());
    }
    let stored = session.index.nodes.iter().map(|node| node.path.as_str());
    let Some(canon) = resolve_stored_case(stored, logical) else {
        return Err(UprivError::VaultPathNotFound(logical.to_string()));
    };
    let node = session
        .index
        .find(canon)
        .ok_or_else(|| UprivError::VaultPathNotFound(canon.to_string()))?;
    Ok(snap_from(node))
}

fn snap_from(node: &crate::store::VaultNode) -> NodeSnap {
    NodeSnap {
        logical: node.path.clone(),
        is_dir: node.is_dir(),
        size: node.as_file().map(|(_, size, _)| size).unwrap_or(0),
        created_at: node.created_at,
        modified_at: node.modified_at,
    }
}

fn is_hidden(logical: &str) -> bool {
    file_name(logical) == INTERNAL_WORKSPACE_FILE || logical == SEED_LOGICAL_PATH
}

fn allocation_size(size: u64) -> u64 {
    const UNIT: u64 = 4096;
    if size == 0 {
        0
    } else {
        size.div_ceil(UNIT) * UNIT
    }
}

fn index_number(logical: &str) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    for byte in logical.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    if hash == 0 {
        1
    } else {
        hash
    }
}

fn map_err(error: UprivError) -> i32 {
    let code = match &error {
        UprivError::VaultPathNotFound(_) | UprivError::VaultNotOpen(_) => {
            STATUS_OBJECT_NAME_NOT_FOUND
        }
        UprivError::VaultPathExists(_) => STATUS_OBJECT_NAME_COLLISION,
        UprivError::VaultFileTooLarge { .. } => STATUS_FILE_TOO_LARGE,
        UprivError::VaultStoreInvalid { detail, .. } if detail.contains("not empty") => {
            STATUS_DIRECTORY_NOT_EMPTY
        }
        UprivError::VaultStoreInvalid { detail, .. } if detail.contains("is a directory") => {
            STATUS_FILE_IS_A_DIRECTORY
        }
        UprivError::VaultStoreInvalid { detail, .. } if detail.contains("not a directory") => {
            STATUS_NOT_A_DIRECTORY
        }
        UprivError::VaultStoreInvalid { detail, .. } if detail.contains("reserved") => {
            STATUS_ACCESS_DENIED
        }
        _ => STATUS_UNEXPECTED_IO_ERROR,
    };
    nt(code)
}

fn wide_to_string(ptr: *const u16) -> std::result::Result<String, i32> {
    if ptr.is_null() {
        return Ok(String::new());
    }
    unsafe {
        let mut len = 0usize;
        while *ptr.add(len) != 0 {
            len += 1;
            if len > 32_768 {
                return Err(nt(STATUS_OBJECT_NAME_INVALID));
            }
        }
        let slice = std::slice::from_raw_parts(ptr, len);
        String::from_utf16(slice).map_err(|_| nt(STATUS_OBJECT_NAME_INVALID))
    }
}

fn parse_nt(name: *const u16) -> std::result::Result<String, i32> {
    let text = wide_to_string(name)?;
    nt_to_logical(&text).map_err(|_| nt(STATUS_OBJECT_NAME_INVALID))
}

fn refuse_leaf(logical: &str) -> std::result::Result<(), i32> {
    if logical.is_empty() {
        return Ok(());
    }
    match rejected_file_name(file_name(logical)) {
        None if !is_hidden(logical) => Ok(()),
        Some(RejectedName::Invalid) => Err(nt(STATUS_OBJECT_NAME_INVALID)),
        _ => Err(nt(STATUS_ACCESS_DENIED)),
    }
}

fn check_create_options(create_options: u32, is_dir: bool) -> std::result::Result<(), i32> {
    if create_options & FILE_DIRECTORY_FILE != 0 && !is_dir {
        return Err(nt(STATUS_NOT_A_DIRECTORY));
    }
    if create_options & FILE_NON_DIRECTORY_FILE != 0 && is_dir {
        return Err(nt(STATUS_FILE_IS_A_DIRECTORY));
    }
    Ok(())
}

fn marker_allows(marker: Option<&str>, name: &str) -> bool {
    let Some(marker) = marker.filter(|value| !value.is_empty()) else {
        return true;
    };
    dir_key(name) > dir_key(marker)
}

fn dir_key(name: &str) -> (u8, std::borrow::Cow<'_, str>) {
    match name {
        "." => (0, std::borrow::Cow::Borrowed("")),
        ".." => (1, std::borrow::Cow::Borrowed("")),
        other => (2, std::borrow::Cow::Owned(other.to_ascii_lowercase())),
    }
}

fn fill_dir(entry: &mut DirEntry, name: &str, info: FileInfo) -> std::result::Result<(), i32> {
    entry.file_info = info;
    entry.padding = [0; 24];
    entry.name = [0; 255];
    let mut units = 0usize;
    for unit in name.encode_utf16() {
        if units + 1 >= entry.name.len() {
            return Err(nt(STATUS_OBJECT_NAME_INVALID));
        }
        entry.name[units] = unit;
        units += 1;
    }
    let header = std::mem::offset_of!(DirEntry, name);
    entry.size = (header + (units + 1) * 2) as u16;
    Ok(())
}

fn set_volume_label_text(info: &mut VolumeInfo, label: &str) {
    info.volume_label = [0; 32];
    let mut units = 0usize;
    for unit in label.encode_utf16() {
        if units + 1 >= info.volume_label.len() {
            break;
        }
        info.volume_label[units] = unit;
        units += 1;
    }
    info.volume_label_length = (units * 2) as u16;
}

fn volume_info() -> VolumeInfo {
    const TIB: u64 = 1024 * 1024 * 1024 * 1024;
    let mut info = VolumeInfo {
        total_size: TIB,
        free_size: TIB,
        volume_label_length: 0,
        volume_label: [0; 32],
    };
    set_volume_label_text(&mut info, "Upriv");
    info
}

fn catch_status(body: impl FnOnce() -> std::result::Result<(), i32>) -> i32 {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(body)) {
        Ok(Ok(())) => STATUS_SUCCESS,
        Ok(Err(status)) => status,
        Err(_) => nt(STATUS_UNEXPECTED_IO_ERROR),
    }
}

fn vault<'a>(file_system: *mut c_void) -> std::result::Result<&'a EncryptedFs, i32> {
    if file_system.is_null() {
        return Err(nt(STATUS_UNEXPECTED_IO_ERROR));
    }
    unsafe {
        let slot = file_system
            .cast::<u8>()
            .add(USER_CONTEXT_OFFSET)
            .cast::<*mut EncryptedFs>();
        let ptr = *slot;
        if ptr.is_null() {
            Err(nt(STATUS_UNEXPECTED_IO_ERROR))
        } else {
            Ok(&*ptr)
        }
    }
}

fn opened<'a>(context: *mut c_void) -> std::result::Result<&'a Opened, i32> {
    if context.is_null() {
        Err(nt(STATUS_UNEXPECTED_IO_ERROR))
    } else {
        unsafe { Ok(&*(context as *const Opened)) }
    }
}

fn write_info(dst: *mut FileInfo, info: FileInfo) {
    if !dst.is_null() {
        unsafe { *dst = info };
    }
}

fn publish_open(
    fs: &EncryptedFs,
    snap: NodeSnap,
    delete_on_close: bool,
    file_context: *mut *mut c_void,
    file_info: *mut FileInfo,
) -> std::result::Result<(), i32> {
    if file_context.is_null() {
        return Err(nt(STATUS_UNEXPECTED_IO_ERROR));
    }
    let info = fs.file_info_of(&snap);
    let opened = Box::into_raw(Box::new(fs.open_snap(snap, delete_on_close)));
    unsafe {
        *file_context = opened.cast();
    }
    write_info(file_info, info);
    Ok(())
}

unsafe extern "C" fn get_volume_info(_fs: *mut c_void, out: *mut VolumeInfo) -> i32 {
    catch_status(|| {
        if out.is_null() {
            return Err(nt(STATUS_UNEXPECTED_IO_ERROR));
        }
        unsafe { *out = volume_info() };
        Ok(())
    })
}

unsafe extern "C" fn set_volume_label(
    _fs: *mut c_void,
    _label: *mut u16,
    _out: *mut VolumeInfo,
) -> i32 {
    nt(STATUS_ACCESS_DENIED)
}

unsafe extern "C" fn get_security_by_name(
    fs: *mut c_void,
    file_name: *mut u16,
    attributes: *mut u32,
    _security: *mut c_void,
    security_size: *mut usize,
) -> i32 {
    catch_status(|| {
        let fs = vault(fs)?;
        let logical = parse_nt(file_name)?;
        let attrs = fs.attributes_of(&logical)?;
        unsafe {
            if !attributes.is_null() {
                *attributes = attrs;
            }
            if !security_size.is_null() {
                *security_size = 0;
            }
        }
        Ok(())
    })
}

unsafe extern "C" fn open_file(
    fs: *mut c_void,
    file_name: *mut u16,
    create_options: u32,
    _granted: u32,
    file_context: *mut *mut c_void,
    file_info: *mut FileInfo,
) -> i32 {
    catch_status(|| {
        let fs = vault(fs)?;
        let logical = parse_nt(file_name)?;
        let snap = fs.find_node(&logical)?;
        check_create_options(create_options, snap.is_dir)?;
        publish_open(
            fs,
            snap,
            create_options & FILE_DELETE_ON_CLOSE != 0,
            file_context,
            file_info,
        )
    })
}

unsafe extern "C" fn create_file(
    fs: *mut c_void,
    file_name: *mut u16,
    create_options: u32,
    _granted: u32,
    _attributes: u32,
    _security: *mut c_void,
    _allocation: u64,
    file_context: *mut *mut c_void,
    file_info: *mut FileInfo,
) -> i32 {
    catch_status(|| {
        let fs = vault(fs)?;
        let logical = parse_nt(file_name)?;
        let snap = fs.place(&logical, create_options & FILE_DIRECTORY_FILE != 0)?;
        publish_open(
            fs,
            snap,
            create_options & FILE_DELETE_ON_CLOSE != 0,
            file_context,
            file_info,
        )
    })
}

unsafe extern "C" fn overwrite_file(
    fs: *mut c_void,
    context: *mut c_void,
    _attributes: u32,
    _replace: u8,
    _allocation: u64,
    file_info: *mut FileInfo,
) -> i32 {
    catch_status(|| {
        let fs = vault(fs)?;
        let opened = opened(context)?;
        if opened.is_dir {
            return Err(nt(STATUS_FILE_IS_A_DIRECTORY));
        }
        let logical = fs.path_of(opened.id)?;
        vfs::fs_truncate(&fs.root, &fs.vault_id, &to_ui_path(&logical), 0).map_err(map_err)?;
        write_info(file_info, fs.file_info_of(&fs.find_node(&logical)?));
        Ok(())
    })
}

unsafe extern "C" fn cleanup_file(
    fs: *mut c_void,
    context: *mut c_void,
    _name: *mut u16,
    flags: u32,
) {
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let Ok(fs) = vault(fs) else {
            return;
        };
        let Ok(opened) = opened(context) else {
            return;
        };
        let marked = opened.delete_on_cleanup.load(Ordering::Relaxed);
        if flags & FSP_CLEANUP_DELETE == 0 && !marked {
            return;
        }
        fs.delete_opened(opened);
    }));
}

unsafe extern "C" fn close_file(fs: *mut c_void, context: *mut c_void) {
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        if context.is_null() {
            return;
        }
        let opened = unsafe { Box::from_raw(context as *mut Opened) };
        if let Ok(fs) = vault(fs) {
            fs.forget_path(opened.id);
        }
    }));
}

unsafe extern "C" fn read_file(
    fs: *mut c_void,
    context: *mut c_void,
    buffer: *mut c_void,
    offset: u64,
    length: u32,
    bytes: *mut u32,
) -> i32 {
    catch_status(|| {
        let fs = vault(fs)?;
        let opened = opened(context)?;
        if buffer.is_null() || bytes.is_null() {
            return Err(nt(STATUS_UNEXPECTED_IO_ERROR));
        }
        let logical = fs.path_of(opened.id)?;
        let n = {
            let slice =
                unsafe { std::slice::from_raw_parts_mut(buffer.cast::<u8>(), length as usize) };
            fs.read_bytes(&logical, slice, offset)?
        };
        unsafe { *bytes = n };
        Ok(())
    })
}

unsafe extern "C" fn write_file(
    fs: *mut c_void,
    context: *mut c_void,
    buffer: *mut c_void,
    mut offset: u64,
    length: u32,
    write_to_eof: u8,
    constrained_io: u8,
    bytes: *mut u32,
    file_info: *mut FileInfo,
) -> i32 {
    catch_status(|| {
        let fs = vault(fs)?;
        let opened = opened(context)?;
        if opened.is_dir {
            return Err(nt(STATUS_FILE_IS_A_DIRECTORY));
        }
        if buffer.is_null() || bytes.is_null() {
            return Err(nt(STATUS_UNEXPECTED_IO_ERROR));
        }
        let logical = fs.path_of(opened.id)?;
        let snap = fs.find_node(&logical)?;
        if write_to_eof != 0 {
            offset = snap.size;
        }
        let data = unsafe { std::slice::from_raw_parts(buffer.cast::<u8>(), length as usize) };
        let data = if constrained_io != 0 {
            if offset >= snap.size {
                write_info(file_info, fs.file_info_of(&snap));
                unsafe { *bytes = 0 };
                return Ok(());
            }
            let room = (snap.size - offset) as usize;
            &data[..data.len().min(room)]
        } else {
            data
        };
        let n = fs.write_bytes(&logical, data, offset)?;
        unsafe { *bytes = n };
        write_info(file_info, fs.file_info_of(&fs.find_node(&logical)?));
        Ok(())
    })
}

unsafe extern "C" fn flush_file(
    fs: *mut c_void,
    context: *mut c_void,
    file_info: *mut FileInfo,
) -> i32 {
    catch_status(|| {
        if context.is_null() {
            return Ok(());
        }
        let fs = vault(fs)?;
        let opened = opened(context)?;
        let logical = fs.path_of(opened.id)?;
        write_info(file_info, fs.file_info_of(&fs.find_node(&logical)?));
        Ok(())
    })
}

unsafe extern "C" fn get_file_info(
    fs: *mut c_void,
    context: *mut c_void,
    file_info: *mut FileInfo,
) -> i32 {
    catch_status(|| {
        let fs = vault(fs)?;
        let opened = opened(context)?;
        let logical = fs.path_of(opened.id)?;
        write_info(file_info, fs.file_info_of(&fs.find_node(&logical)?));
        Ok(())
    })
}

unsafe extern "C" fn set_basic_info(
    fs: *mut c_void,
    context: *mut c_void,
    _attributes: u32,
    _created: u64,
    _accessed: u64,
    _written: u64,
    _changed: u64,
    file_info: *mut FileInfo,
) -> i32 {
    catch_status(|| {
        let fs = vault(fs)?;
        let opened = opened(context)?;
        let logical = fs.path_of(opened.id)?;
        write_info(file_info, fs.file_info_of(&fs.find_node(&logical)?));
        Ok(())
    })
}

unsafe extern "C" fn set_file_size(
    fs: *mut c_void,
    context: *mut c_void,
    new_size: u64,
    set_allocation_size: u8,
    file_info: *mut FileInfo,
) -> i32 {
    catch_status(|| {
        let fs = vault(fs)?;
        let opened = opened(context)?;
        if opened.is_dir {
            return Err(nt(STATUS_FILE_IS_A_DIRECTORY));
        }
        let logical = fs.path_of(opened.id)?;
        let truncate = if set_allocation_size != 0 {
            fs.find_node(&logical)?.size > new_size
        } else {
            true
        };
        if truncate {
            vfs::fs_truncate(&fs.root, &fs.vault_id, &to_ui_path(&logical), new_size)
                .map_err(map_err)?;
        }
        write_info(file_info, fs.file_info_of(&fs.find_node(&logical)?));
        Ok(())
    })
}

unsafe extern "C" fn can_delete(fs: *mut c_void, context: *mut c_void, _name: *mut u16) -> i32 {
    catch_status(|| {
        let fs = vault(fs)?;
        let opened = opened(context)?;
        fs.ensure_deletable(opened)
    })
}

unsafe extern "C" fn rename_file(
    fs: *mut c_void,
    context: *mut c_void,
    _name: *mut u16,
    new_name: *mut u16,
    replace_if_exists: u8,
) -> i32 {
    catch_status(|| {
        let fs = vault(fs)?;
        let opened = opened(context)?;
        let dest = parse_nt(new_name)?;
        fs.relocate(opened, &dest, replace_if_exists != 0)
    })
}

unsafe extern "C" fn get_security(
    _fs: *mut c_void,
    _context: *mut c_void,
    _security: *mut c_void,
    security_size: *mut usize,
) -> i32 {
    catch_status(|| {
        if security_size.is_null() {
            return Err(nt(STATUS_UNEXPECTED_IO_ERROR));
        }
        unsafe { *security_size = 0 };
        Ok(())
    })
}

unsafe extern "C" fn read_directory(
    fs: *mut c_void,
    context: *mut c_void,
    _pattern: *mut u16,
    marker: *mut u16,
    buffer: *mut c_void,
    length: u32,
    bytes: *mut u32,
) -> i32 {
    catch_status(|| {
        let fs = vault(fs)?;
        let opened = opened(context)?;
        if !opened.is_dir {
            return Err(nt(STATUS_NOT_A_DIRECTORY));
        }
        if buffer.is_null() || bytes.is_null() {
            return Err(nt(STATUS_UNEXPECTED_IO_ERROR));
        }
        let Some(api) = API.get().copied() else {
            return Err(nt(STATUS_UNEXPECTED_IO_ERROR));
        };
        unsafe { *bytes = 0 };
        let logical = fs.path_of(opened.id)?;
        let marker = wide_to_string(marker)?;
        let marker = if marker.is_empty() {
            None
        } else {
            Some(marker)
        };
        for (name, info) in fs.directory_entries(&logical)? {
            if !marker_allows(marker.as_deref(), &name) {
                continue;
            }
            let mut entry = DirEntry {
                size: 0,
                _pad: [0; 6],
                file_info: info,
                padding: [0; 24],
                name: [0; 255],
            };
            fill_dir(&mut entry, &name, info)?;
            let added = (api.add_dir_info)(&mut entry, buffer, length, bytes);
            if added == 0 {
                return Ok(());
            }
        }
        let _ = (api.add_dir_info)(std::ptr::null_mut(), buffer, length, bytes);
        Ok(())
    })
}

unsafe extern "C" fn set_delete(
    fs: *mut c_void,
    context: *mut c_void,
    _name: *mut u16,
    delete_file: u8,
) -> i32 {
    catch_status(|| {
        let fs = vault(fs)?;
        let opened = opened(context)?;
        fs.mark_delete(opened, delete_file != 0)
    })
}

pub(crate) struct WinFspVolume {
    file_system: *mut c_void,
    context: *mut EncryptedFs,
    api: Api,
}

// The dispatcher threads use `context` through WinFsp, not this handle.
// Drop runs once, after `StopDispatcher` joins those threads.
unsafe impl Send for WinFspVolume {}

impl Drop for WinFspVolume {
    fn drop(&mut self) {
        unsafe {
            (self.api.remove_mount_point)(self.file_system);
            (self.api.stop_dispatcher)(self.file_system);
            (self.api.delete)(self.file_system);
            drop(Box::from_raw(self.context));
        }
    }
}

pub(super) fn spawn(
    root: VaultRoot,
    vault_id: String,
    mount_point: PathBuf,
) -> Result<MountedVault> {
    let Some(api) = ensure_api() else {
        return Err(UprivError::VaultMountFailed(NOT_INSTALLED.into()));
    };
    let fs = EncryptedFs {
        root,
        vault_id,
        paths: Mutex::new(std::collections::HashMap::new()),
        next_id: AtomicU64::new(1),
    };
    let context = Box::into_raw(Box::new(fs));
    let mut params = VolumeParams::default();
    write_wide_field(&mut params.file_system_name, "upriv");
    let device = wide_z(disk_device_name());
    let mut file_system = std::ptr::null_mut();
    let status = unsafe {
        (api.create)(
            device.as_ptr().cast_mut(),
            &params,
            &INTERFACE,
            &mut file_system,
        )
    };
    if status != STATUS_SUCCESS || file_system.is_null() {
        drop(unsafe { Box::from_raw(context) });
        return Err(mount_failed(&mount_point, status));
    }
    unsafe {
        let slot = file_system
            .cast::<u8>()
            .add(USER_CONTEXT_OFFSET)
            .cast::<*mut EncryptedFs>();
        *slot = context;
    }
    let mount_wide = wide_z_os(&mount_point);
    let status = unsafe { (api.set_mount_point)(file_system, mount_wide.as_ptr().cast_mut()) };
    if status != STATUS_SUCCESS {
        unsafe { (api.delete)(file_system) };
        drop(unsafe { Box::from_raw(context) });
        return Err(mount_failed(&mount_point, status));
    }
    let status = unsafe { (api.start_dispatcher)(file_system, 0) };
    if status != STATUS_SUCCESS {
        unsafe {
            (api.remove_mount_point)(file_system);
            (api.delete)(file_system);
            drop(Box::from_raw(context));
        }
        return Err(mount_failed(&mount_point, status));
    }
    Ok(MountedVault {
        mount_point,
        winfsp: Some(WinFspVolume {
            file_system,
            context,
            api,
        }),
    })
}

fn mount_failed(mount_point: &Path, status: i32) -> UprivError {
    UprivError::VaultMountFailed(format!(
        "WinFsp mount failed at {}: status {status:#010x}",
        mount_point.display()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn volume_layout_matches_winfsp() {
        assert_eq!(std::mem::size_of::<VolumeParams>(), 504);
        assert_eq!(std::mem::align_of::<VolumeParams>(), 8);
        assert_eq!(std::mem::offset_of!(VolumeParams, flags), 36);
        assert_eq!(std::mem::offset_of!(VolumeParams, prefix), 40);
        assert_eq!(std::mem::offset_of!(VolumeParams, file_system_name), 424);
        assert_eq!(std::mem::offset_of!(VolumeParams, flags2), 456);
        assert_eq!(std::mem::size_of::<FileInfo>(), 72);
        assert_eq!(std::mem::size_of::<VolumeInfo>(), 88);
        assert_eq!(std::mem::offset_of!(DirEntry, name), 104);
        assert_eq!(std::mem::size_of::<Interface>(), 512);
        assert_eq!(std::mem::align_of::<Interface>(), 8);
    }

    #[test]
    fn disk_volume_keeps_names_and_does_not_cache_forever() {
        let params = VolumeParams::default();
        assert_eq!(params.flags & 1, 0);
        assert_eq!(params.flags & (1 << 3), 0);
        assert_eq!(params.flags & (1 << 6), 0);
        assert_ne!(params.flags & ALWAYS_USE_DOUBLE_BUFFERING, 0);
        assert_ne!(params.flags & UM_FILE_CONTEXT_IS_USER_CONTEXT2, 0);
        assert_eq!(params.prefix, [0; 192]);
        assert_eq!(params.file_info_timeout, 1000);
        assert_eq!(params.sector_size, 512);
        assert_eq!(params.sectors_per_allocation_unit, 8);
        assert!(params.file_info_timeout != u32::MAX);
    }

    #[test]
    fn directory_marker_is_exclusive_and_case_insensitive() {
        assert!(marker_allows(None, "."));
        assert!(marker_allows(Some("."), ".."));
        assert!(!marker_allows(Some("."), "."));
        assert!(marker_allows(Some(".."), "notes.txt"));
        assert!(!marker_allows(Some(".."), ".."));
        assert!(!marker_allows(Some("B"), "a"));
        assert!(!marker_allows(Some("B"), "b"));
        assert!(marker_allows(Some("B"), "c"));
    }

    #[test]
    fn allocation_uses_the_4096_byte_unit() {
        assert_eq!(allocation_size(0), 0);
        assert_eq!(allocation_size(1), 4096);
        assert_eq!(allocation_size(4096), 4096);
        assert_eq!(allocation_size(4097), 8192);
    }

    #[test]
    fn dll_names_follow_the_process_and_a_missing_file_does_not_load() {
        let name = dll_file_name();
        assert!(dll_candidates().iter().all(|path| path.ends_with(name)));
        assert!(load_module(r"C:\upriv-missing-winfsp\winfsp-x64.dll").is_none());
    }

    #[test]
    fn verbatim_prefix_is_a_plain_directory_for_winfsp() {
        let plain = decode_wide(&wide_z_os(Path::new(r"\\?\C:\Users\me\workspace\test")));
        assert_eq!(plain, r"C:\Users\me\workspace\test");
        let already = decode_wide(&wide_z_os(Path::new(r"C:\Users\me\workspace\test")));
        assert_eq!(already, r"C:\Users\me\workspace\test");
        let unc = decode_wide(&wide_z_os(Path::new(r"\\?\UNC\server\share\vault")));
        assert_eq!(unc, r"\\server\share\vault");
    }

    fn decode_wide(wide: &[u16]) -> String {
        let end = wide
            .iter()
            .position(|unit| *unit == 0)
            .unwrap_or(wide.len());
        String::from_utf16_lossy(&wide[..end])
    }
}
