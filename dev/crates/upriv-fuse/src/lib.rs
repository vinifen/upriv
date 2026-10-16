//! Linux FUSE helper. The daemon `dlopen`s this library when a vault folder
//! is mounted. `libfuse3` is a dependency of this file, not of `upriv-daemon`.

#[cfg(target_os = "linux")]
mod session;

#[cfg(target_os = "linux")]
pub use session::{upriv_fuse_mount, upriv_fuse_unmount};

#[cfg(not(target_os = "linux"))]
#[no_mangle]
pub extern "C" fn upriv_fuse_unused() -> i32 {
    0
}
