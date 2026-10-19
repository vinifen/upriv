//! Layout of the FUSE helper ABI. The daemon and `libupriv_fuse.so` both
//! compile this crate, so the struct layout cannot drift.

use libc::c_char;

/// One index node, as the helper needs it for `getattr`.
///
/// `found == 0` is a missing path, including files the explorer hides.
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FuseStat {
    pub size: u64,
    pub modified_ms: u64,
    pub found: u8,
    pub is_dir: u8,
}

/// Callbacks into the daemon process. The helper has no copy of the session.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct FuseHost {
    pub stat: unsafe extern "C" fn(
        root: *const c_char,
        vault_id: *const c_char,
        logical: *const c_char,
        out: *mut FuseStat,
    ) -> i32,
    pub list: unsafe extern "C" fn(
        root: *const c_char,
        vault_id: *const c_char,
        parent: *const c_char,
        visit: unsafe extern "C" fn(ctx: *mut libc::c_void, path: *const c_char, is_dir: u8),
        ctx: *mut libc::c_void,
    ) -> i32,
    pub read_range: unsafe extern "C" fn(
        root: *const c_char,
        vault_id: *const c_char,
        logical: *const c_char,
        offset: u64,
        size: u64,
        out_ptr: *mut *mut u8,
        out_len: *mut usize,
    ) -> i32,
    /// Zero then free a buffer from [`Self::read_range`].
    pub free_buf: unsafe extern "C" fn(ptr: *mut u8, len: usize),
    pub write_range: unsafe extern "C" fn(
        root: *const c_char,
        vault_id: *const c_char,
        logical: *const c_char,
        offset: u64,
        data: *const u8,
        len: usize,
    ) -> i32,
    pub mkdir: unsafe extern "C" fn(
        root: *const c_char,
        vault_id: *const c_char,
        logical: *const c_char,
    ) -> i32,
    pub create_file: unsafe extern "C" fn(
        root: *const c_char,
        vault_id: *const c_char,
        parent: *const c_char,
        name: *const c_char,
    ) -> i32,
    pub truncate: unsafe extern "C" fn(
        root: *const c_char,
        vault_id: *const c_char,
        logical: *const c_char,
        size: u64,
    ) -> i32,
    pub delete: unsafe extern "C" fn(
        root: *const c_char,
        vault_id: *const c_char,
        logical: *const c_char,
    ) -> i32,
    pub rmdir: unsafe extern "C" fn(
        root: *const c_char,
        vault_id: *const c_char,
        logical: *const c_char,
    ) -> i32,
    pub relocate: unsafe extern "C" fn(
        root: *const c_char,
        vault_id: *const c_char,
        from: *const c_char,
        new_parent: *const c_char,
        new_name: *const c_char,
        replace: u8,
    ) -> i32,
    /// Seal writes that [`Self::write_range`] left for the next index seal.
    /// Called on `flush` (each `close` of a descriptor), `release`, and `fsync`.
    pub flush: unsafe extern "C" fn(root: *const c_char, vault_id: *const c_char) -> i32,
}
