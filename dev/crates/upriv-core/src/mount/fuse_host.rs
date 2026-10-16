//! Loads `libupriv_fuse.so` at mount time and serves its callbacks.
//!
//! The daemon binary does not link `libfuse3`. A missing library fails this
//! mount and leaves the in-app file manager running.

use std::ffi::{CStr, CString, OsStr};
use std::os::unix::ffi::{OsStrExt, OsStringExt};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use libc::c_char;
use upriv_fuse_abi::{FuseHost, FuseStat};
use zeroize::Zeroize;

use crate::error::{Result, UprivError};
use crate::paths::VaultRoot;
use crate::session::with_open_session;
use crate::store::{
    file_name, parent_logical, to_ui_path, INTERNAL_WORKSPACE_FILE, SEED_LOGICAL_PATH,
};
use crate::vault::fs as vfs;

const FUSE_LIBRARY_NAME: &str = "libupriv_fuse.so";
const FUSE_NOT_INSTALLED: &str = "FUSE is not installed; use the in-app file manager";

pub(crate) struct FuseSession {
    raw: *mut libc::c_void,
    unmount: unsafe extern "C" fn(*mut libc::c_void),
}

// The helper session is dropped on this thread. The pointer is owned here.
unsafe impl Send for FuseSession {}

impl Drop for FuseSession {
    fn drop(&mut self) {
        if self.raw.is_null() {
            return;
        }
        unsafe { (self.unmount)(self.raw) };
        self.raw = std::ptr::null_mut();
    }
}

pub(crate) fn spawn(
    root: VaultRoot,
    vault_id: String,
    mount_point: PathBuf,
) -> Result<super::MountedVault> {
    let api = load_api()?;
    let root_c = c_path(root.root())?;
    let vault_c = CString::new(vault_id)
        .map_err(|_| UprivError::VaultMountFailed("vault id is not a mount string".into()))?;
    let point_c = c_path(&mount_point)?;
    let mut error = vec![0u8; 1024];
    let raw = unsafe {
        (api.mount)(
            &HOST,
            root_c.as_ptr(),
            vault_c.as_ptr(),
            point_c.as_ptr(),
            error.as_mut_ptr(),
            error.len(),
        )
    };
    if raw.is_null() {
        return Err(UprivError::VaultMountFailed(error_text(&error)));
    }
    let mounted = super::MountedVault {
        mount_point,
        fuse: Some(FuseSession {
            raw,
            unmount: api.unmount,
        }),
    };
    super::watch_open_mount(mounted.mount_point());
    Ok(mounted)
}

pub(crate) fn library_beside(exe: &Path) -> PathBuf {
    match exe.parent() {
        Some(dir) if !dir.as_os_str().is_empty() => dir.join(FUSE_LIBRARY_NAME),
        _ => PathBuf::from(FUSE_LIBRARY_NAME),
    }
}

pub(crate) fn library_error(detail: &str) -> String {
    if detail.to_ascii_lowercase().contains("libfuse") {
        FUSE_NOT_INSTALLED.to_string()
    } else {
        format!("FUSE mount helper failed to load: {detail}")
    }
}

fn c_path(path: &Path) -> Result<CString> {
    CString::new(path.as_os_str().as_bytes())
        .map_err(|_| UprivError::VaultMountFailed("mount path contains a nul byte".into()))
}

fn error_text(buf: &[u8]) -> String {
    let end = buf.iter().position(|byte| *byte == 0).unwrap_or(buf.len());
    let text = String::from_utf8_lossy(&buf[..end]).trim().to_string();
    if text.is_empty() {
        "FUSE mount failed".to_string()
    } else {
        text
    }
}

struct FuseApi {
    mount: unsafe extern "C" fn(
        host: *const FuseHost,
        root: *const c_char,
        vault_id: *const c_char,
        mount_point: *const c_char,
        error_buf: *mut u8,
        error_cap: usize,
    ) -> *mut libc::c_void,
    unmount: unsafe extern "C" fn(*mut libc::c_void),
}

fn load_api() -> Result<FuseApi> {
    static API: Mutex<Option<FuseApi>> = Mutex::new(None);
    let mut slot = API.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(api) = slot.as_ref() {
        return Ok(FuseApi {
            mount: api.mount,
            unmount: api.unmount,
        });
    }
    let exe = std::env::current_exe().map_err(|error| {
        UprivError::VaultMountFailed(format!("FUSE mount helper failed to load: {error}"))
    })?;
    let path = library_beside(&exe);
    if !path.is_file() {
        return Err(UprivError::VaultMountFailed(
            "FUSE mount helper is missing; use the in-app file manager".into(),
        ));
    }
    let c_path = CString::new(path.into_os_string().into_vec()).map_err(|_| {
        UprivError::VaultMountFailed("FUSE mount helper path contains a nul byte".into())
    })?;
    unsafe { libc::dlerror() };
    let handle = unsafe { libc::dlopen(c_path.as_ptr(), libc::RTLD_NOW | libc::RTLD_LOCAL) };
    if handle.is_null() {
        return Err(UprivError::VaultMountFailed(library_error(&dlerror_text())));
    }
    let mount = match unsafe { symbol(handle, b"upriv_fuse_mount\0") } {
        Ok(symbol) => symbol,
        Err(error) => {
            unsafe { libc::dlclose(handle) };
            return Err(error);
        }
    };
    let unmount = match unsafe { symbol(handle, b"upriv_fuse_unmount\0") } {
        Ok(symbol) => symbol,
        Err(error) => {
            unsafe { libc::dlclose(handle) };
            return Err(error);
        }
    };
    // Leave the mapping in place. A later mount reuses these symbols.
    let api = FuseApi { mount, unmount };
    *slot = Some(FuseApi {
        mount: api.mount,
        unmount: api.unmount,
    });
    Ok(api)
}

unsafe fn symbol<T>(handle: *mut libc::c_void, name: &[u8]) -> Result<T> {
    if std::mem::size_of::<T>() != std::mem::size_of::<*mut libc::c_void>() {
        return Err(UprivError::VaultMountFailed(
            "FUSE mount helper symbol has the wrong size".into(),
        ));
    }
    unsafe { libc::dlerror() };
    let ptr = unsafe { libc::dlsym(handle, name.as_ptr().cast()) };
    if ptr.is_null() {
        return Err(UprivError::VaultMountFailed(library_error(&dlerror_text())));
    }
    Ok(unsafe { std::mem::transmute_copy(&ptr) })
}

fn dlerror_text() -> String {
    let ptr = unsafe { libc::dlerror() };
    if ptr.is_null() {
        return "unknown dynamic loader error".to_string();
    }
    unsafe { CStr::from_ptr(ptr) }
        .to_string_lossy()
        .into_owned()
}

const HOST: FuseHost = FuseHost {
    stat: host_stat,
    list: host_list,
    read_range: host_read_range,
    free_buf: host_free_buf,
    write_range: host_write_range,
    mkdir: host_mkdir,
    create_file: host_create_file,
    truncate: host_truncate,
    delete: host_delete,
    rmdir: host_rmdir,
    relocate: host_relocate,
};

fn io_errno(error: &UprivError) -> i32 {
    match error {
        UprivError::VaultPathNotFound(_) | UprivError::VaultNotOpen(_) => libc::ENOENT,
        UprivError::VaultPathExists(_) => libc::EEXIST,
        UprivError::VaultFileTooLarge { .. } => libc::EFBIG,
        UprivError::VaultStoreInvalid { detail, .. } if detail.contains("not empty") => {
            libc::ENOTEMPTY
        }
        UprivError::VaultStoreInvalid { detail, .. } if detail.contains("not a directory") => {
            libc::ENOTDIR
        }
        UprivError::VaultStoreInvalid { detail, .. } if detail.contains("is a directory") => {
            libc::EISDIR
        }
        _ => libc::EIO,
    }
}

fn hidden_logical(logical: &str) -> bool {
    file_name(logical) == INTERNAL_WORKSPACE_FILE || logical == SEED_LOGICAL_PATH
}

/// The new name is a path under `new_parent`, the same check create uses.
fn relocate_refused(from: &str, new_parent: &str, new_name: &str) -> bool {
    hidden_logical(from) || hidden_logical(&child_logical(new_parent, new_name))
}

fn child_logical(parent: &str, name: &str) -> String {
    if parent.is_empty() {
        name.to_string()
    } else {
        format!("{parent}/{name}")
    }
}

fn cstr<'a>(ptr: *const c_char) -> std::result::Result<&'a CStr, i32> {
    if ptr.is_null() {
        return Err(libc::EINVAL);
    }
    Ok(unsafe { CStr::from_ptr(ptr) })
}

fn text<'a>(ptr: *const c_char) -> std::result::Result<&'a str, i32> {
    cstr(ptr)?.to_str().map_err(|_| libc::EINVAL)
}

fn vault_root(ptr: *const c_char) -> std::result::Result<VaultRoot, i32> {
    let bytes = cstr(ptr)?.to_bytes();
    Ok(VaultRoot::new(PathBuf::from(OsStr::from_bytes(bytes))))
}

unsafe extern "C" fn host_stat(
    root: *const c_char,
    vault_id: *const c_char,
    logical: *const c_char,
    out: *mut FuseStat,
) -> i32 {
    if out.is_null() {
        return libc::EINVAL;
    }
    let stat = unsafe { &mut *out };
    *stat = FuseStat {
        size: 0,
        modified_ms: 0,
        found: 0,
        is_dir: 0,
    };
    let (root, vault_id, logical) = match (vault_root(root), text(vault_id), text(logical)) {
        (Ok(root), Ok(vault_id), Ok(logical)) => (root, vault_id, logical),
        _ => return libc::EINVAL,
    };
    if hidden_logical(logical) {
        return 0;
    }
    let dir = match root.vault_dir(vault_id) {
        Ok(dir) => dir,
        Err(error) => return io_errno(&error),
    };
    match with_open_session(&dir, |session| {
        let Some(node) = session.index.find(logical) else {
            return Ok(());
        };
        stat.found = 1;
        stat.modified_ms = node.modified_at;
        if node.is_dir() {
            stat.is_dir = 1;
        } else {
            stat.size = node.as_file().map(|(_, size, _)| size).unwrap_or(0);
        }
        Ok(())
    }) {
        Ok(()) => 0,
        Err(error) => io_errno(&error),
    }
}

unsafe extern "C" fn host_list(
    root: *const c_char,
    vault_id: *const c_char,
    parent: *const c_char,
    visit: unsafe extern "C" fn(ctx: *mut libc::c_void, path: *const c_char, is_dir: u8),
    ctx: *mut libc::c_void,
) -> i32 {
    let (root, vault_id, parent) = match (vault_root(root), text(vault_id), text(parent)) {
        (Ok(root), Ok(vault_id), Ok(parent)) => (root, vault_id, parent),
        _ => return libc::EINVAL,
    };
    let dir = match root.vault_dir(vault_id) {
        Ok(dir) => dir,
        Err(error) => return io_errno(&error),
    };
    let children = match with_open_session(&dir, |session| {
        let mut out = Vec::new();
        for node in &session.index.nodes {
            if hidden_logical(&node.path) {
                continue;
            }
            let node_parent = parent_logical(&node.path).unwrap_or("");
            if node_parent == parent {
                out.push((node.path.clone(), node.is_dir()));
            }
        }
        Ok(out)
    }) {
        Ok(children) => children,
        Err(error) => return io_errno(&error),
    };
    for (path, is_dir) in children {
        let Ok(path) = CString::new(path) else {
            continue;
        };
        unsafe { visit(ctx, path.as_ptr(), u8::from(is_dir)) };
    }
    0
}

unsafe extern "C" fn host_read_range(
    root: *const c_char,
    vault_id: *const c_char,
    logical: *const c_char,
    offset: u64,
    size: u64,
    out_ptr: *mut *mut u8,
    out_len: *mut usize,
) -> i32 {
    if out_ptr.is_null() || out_len.is_null() {
        return libc::EINVAL;
    }
    unsafe {
        *out_ptr = std::ptr::null_mut();
        *out_len = 0;
    }
    let (root, vault_id, logical) = match (vault_root(root), text(vault_id), text(logical)) {
        (Ok(root), Ok(vault_id), Ok(logical)) => (root, vault_id, logical),
        _ => return libc::EINVAL,
    };
    if hidden_logical(logical) {
        return libc::ENOENT;
    }
    let mut bytes = match vfs::fs_read_range(&root, vault_id, &to_ui_path(logical), offset, size) {
        Ok(bytes) => bytes,
        Err(error) => return io_errno(&error),
    };
    if bytes.is_empty() {
        bytes.zeroize();
        return 0;
    }
    let len = bytes.len();
    let raw = unsafe { libc::malloc(len) };
    if raw.is_null() {
        bytes.zeroize();
        return libc::ENOMEM;
    }
    unsafe { std::ptr::copy_nonoverlapping(bytes.as_ptr(), raw.cast(), len) };
    bytes.zeroize();
    unsafe {
        *out_ptr = raw.cast();
        *out_len = len;
    }
    0
}

unsafe extern "C" fn host_free_buf(ptr: *mut u8, len: usize) {
    if ptr.is_null() {
        return;
    }
    if len > 0 {
        unsafe { std::slice::from_raw_parts_mut(ptr, len) }.zeroize();
    }
    unsafe { libc::free(ptr.cast()) };
}

unsafe extern "C" fn host_write_range(
    root: *const c_char,
    vault_id: *const c_char,
    logical: *const c_char,
    offset: u64,
    data: *const u8,
    len: usize,
) -> i32 {
    let (root, vault_id, logical) = match (vault_root(root), text(vault_id), text(logical)) {
        (Ok(root), Ok(vault_id), Ok(logical)) => (root, vault_id, logical),
        _ => return libc::EINVAL,
    };
    if hidden_logical(logical) {
        return libc::EPERM;
    }
    if data.is_null() && len > 0 {
        return libc::EINVAL;
    }
    let bytes = if len == 0 {
        &[][..]
    } else {
        unsafe { std::slice::from_raw_parts(data, len) }
    };
    match vfs::fs_write_range(&root, vault_id, &to_ui_path(logical), offset, bytes) {
        Ok(_) => 0,
        Err(error) => io_errno(&error),
    }
}

unsafe extern "C" fn host_mkdir(
    root: *const c_char,
    vault_id: *const c_char,
    logical: *const c_char,
) -> i32 {
    call_logical(root, vault_id, logical, |root, vault_id, logical| {
        vfs::fs_mkdir(root, vault_id, &to_ui_path(logical)).map(|_| ())
    })
}

unsafe extern "C" fn host_create_file(
    root: *const c_char,
    vault_id: *const c_char,
    parent: *const c_char,
    name: *const c_char,
) -> i32 {
    let (root, vault_id, parent, name) =
        match (vault_root(root), text(vault_id), text(parent), text(name)) {
            (Ok(root), Ok(vault_id), Ok(parent), Ok(name)) => (root, vault_id, parent, name),
            _ => return libc::EINVAL,
        };
    if hidden_logical(&child_logical(parent, name)) {
        return libc::EPERM;
    }
    match vfs::fs_create_named_file(&root, vault_id, &to_ui_path(parent), name) {
        Ok(_) => 0,
        Err(error) => io_errno(&error),
    }
}

unsafe extern "C" fn host_truncate(
    root: *const c_char,
    vault_id: *const c_char,
    logical: *const c_char,
    size: u64,
) -> i32 {
    call_logical(root, vault_id, logical, |root, vault_id, logical| {
        vfs::fs_truncate(root, vault_id, &to_ui_path(logical), size).map(|_| ())
    })
}

unsafe extern "C" fn host_delete(
    root: *const c_char,
    vault_id: *const c_char,
    logical: *const c_char,
) -> i32 {
    call_logical(root, vault_id, logical, |root, vault_id, logical| {
        vfs::fs_delete(root, vault_id, &to_ui_path(logical)).map(|_| ())
    })
}

unsafe extern "C" fn host_rmdir(
    root: *const c_char,
    vault_id: *const c_char,
    logical: *const c_char,
) -> i32 {
    call_logical(root, vault_id, logical, |root, vault_id, logical| {
        vfs::fs_rmdir(root, vault_id, &to_ui_path(logical)).map(|_| ())
    })
}

unsafe extern "C" fn host_relocate(
    root: *const c_char,
    vault_id: *const c_char,
    from: *const c_char,
    new_parent: *const c_char,
    new_name: *const c_char,
    replace: u8,
) -> i32 {
    let (root, vault_id, from, new_parent, new_name) = match (
        vault_root(root),
        text(vault_id),
        text(from),
        text(new_parent),
        text(new_name),
    ) {
        (Ok(root), Ok(vault_id), Ok(from), Ok(new_parent), Ok(new_name)) => {
            (root, vault_id, from, new_parent, new_name)
        }
        _ => return libc::EINVAL,
    };
    if relocate_refused(from, new_parent, new_name) {
        return libc::EPERM;
    }
    match vfs::fs_relocate(
        &root,
        vault_id,
        &to_ui_path(from),
        &to_ui_path(new_parent),
        new_name,
        replace != 0,
    ) {
        Ok(_) => 0,
        Err(error) => io_errno(&error),
    }
}

fn call_logical(
    root: *const c_char,
    vault_id: *const c_char,
    logical: *const c_char,
    op: impl FnOnce(&VaultRoot, &str, &str) -> Result<()>,
) -> i32 {
    let (root, vault_id, logical) = match (vault_root(root), text(vault_id), text(logical)) {
        (Ok(root), Ok(vault_id), Ok(logical)) => (root, vault_id, logical),
        _ => return libc::EINVAL,
    };
    if hidden_logical(logical) {
        return libc::EPERM;
    }
    match op(&root, vault_id, logical) {
        Ok(()) => 0,
        Err(error) => io_errno(&error),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        child_logical, hidden_logical, io_errno, library_beside, library_error, relocate_refused,
        FUSE_NOT_INSTALLED,
    };
    use crate::error::UprivError;
    use std::path::Path;

    #[test]
    fn library_sits_beside_the_daemon() {
        assert_eq!(
            library_beside(Path::new("/opt/upriv/upriv-daemon")),
            Path::new("/opt/upriv/libupriv_fuse.so")
        );
    }

    #[test]
    fn a_missing_libfuse_is_the_install_message() {
        assert_eq!(
            library_error("libfuse3.so.3: cannot open shared object file"),
            FUSE_NOT_INSTALLED
        );
        assert!(library_error("libupriv_fuse.so: undefined symbol").contains("failed to load"));
    }

    #[test]
    fn hidden_layout_files_stay_out_of_the_folder() {
        assert!(hidden_logical(".upriv-workspace.json"));
        assert!(hidden_logical("notes/.upriv-workspace.json"));
        assert!(hidden_logical("upriv-seed.txt"));
        assert!(hidden_logical(&child_logical("", "upriv-seed.txt")));
        assert!(!hidden_logical("notes/upriv-seed.txt"));
        assert!(!hidden_logical(&child_logical("notes", "upriv-seed.txt")));
        assert!(hidden_logical(&child_logical(
            "notes",
            ".upriv-workspace.json"
        )));
        assert!(!hidden_logical("notes.txt"));
    }

    #[test]
    fn a_rename_uses_the_full_destination_path() {
        assert!(relocate_refused("notes/a.txt", "", "upriv-seed.txt"));
        assert!(relocate_refused("upriv-seed.txt", "notes", "a.txt"));
        assert!(relocate_refused(
            "notes/a.txt",
            "docs",
            ".upriv-workspace.json"
        ));
        assert!(!relocate_refused("notes/a.txt", "notes", "upriv-seed.txt"));
        assert!(!relocate_refused("notes/upriv-seed.txt", "docs", "a.txt"));
    }

    #[test]
    fn store_errors_keep_their_errno() {
        assert_eq!(
            io_errno(&UprivError::VaultPathExists("a".into())),
            libc::EEXIST
        );
        assert_eq!(
            io_errno(&UprivError::VaultStoreInvalid {
                path: Path::new("dir").into(),
                detail: "directory not empty".into(),
            }),
            libc::ENOTEMPTY
        );
        assert_eq!(
            io_errno(&UprivError::VaultStoreInvalid {
                path: Path::new("notes").into(),
                detail: "logical path is a directory".into(),
            }),
            libc::EISDIR
        );
        assert_eq!(
            io_errno(&UprivError::VaultStoreInvalid {
                path: Path::new("notes").into(),
                detail: "destination is a directory".into(),
            }),
            libc::EISDIR
        );
        assert_eq!(
            io_errno(&UprivError::VaultStoreInvalid {
                path: Path::new("notes.txt").into(),
                detail: "not a directory".into(),
            }),
            libc::ENOTDIR
        );
        assert_eq!(
            io_errno(&UprivError::VaultStoreInvalid {
                path: Path::new("store").into(),
                detail: "store directory is missing".into(),
            }),
            libc::EIO
        );
    }
}
