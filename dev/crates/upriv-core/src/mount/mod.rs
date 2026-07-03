#[cfg(all(target_os = "linux", feature = "fuse"))]
mod fuse_linux;

use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use crate::error::Result;
use crate::store::EncryptedStore;

#[cfg(all(target_os = "linux", feature = "fuse"))]
pub use fuse_linux::FuseMount;

#[cfg(not(all(target_os = "linux", feature = "fuse")))]
pub struct FuseMount;

#[cfg(not(all(target_os = "linux", feature = "fuse")))]
impl FuseMount {
    pub fn mount(
        _store: Arc<RwLock<EncryptedStore>>,
        _mountpoint: &std::path::Path,
    ) -> Result<Self> {
        Err(crate::error::UprivError::Mount(fuse_unavailable_message()))
    }
}

pub fn mount_workspace(
    store: Arc<RwLock<EncryptedStore>>,
    mountpoint: PathBuf,
    disallow_copy_outside_mount: bool,
) -> Result<FuseMount> {
    #[cfg(all(target_os = "linux", feature = "fuse"))]
    {
        return fuse_linux::FuseMount::mount(store, &mountpoint, disallow_copy_outside_mount);
    }
    #[cfg(not(all(target_os = "linux", feature = "fuse")))]
    {
        let _ = (store, mountpoint, disallow_copy_outside_mount);
        Err(crate::error::UprivError::Mount(fuse_unavailable_message()))
    }
}

fn fuse_unavailable_message() -> String {
    if cfg!(all(target_os = "linux", not(feature = "fuse"))) {
        "FUSE disabled in this build (enable the `fuse` feature and install libfuse3-dev)".into()
    } else {
        "FUSE mount is only supported on Linux with libfuse3".into()
    }
}

/// True when `path` (or a parent) is backed by a FUSE filesystem (Linux only).
pub fn path_is_fuse_mount(path: &std::path::Path) -> bool {
    #[cfg(target_os = "linux")]
    {
        let Ok(canonical) = path.canonicalize() else {
            return false;
        };
        let target = canonical.to_string_lossy();
        let Ok(mounts) = std::fs::read_to_string("/proc/self/mountinfo") else {
            return false;
        };
        for line in mounts.lines() {
            let Some((left, right)) = line.split_once(" - ") else {
                continue;
            };
            let fstype = right.split_whitespace().next().unwrap_or("");
            if !fstype.starts_with("fuse") {
                continue;
            }
            let Some(mountpoint) = left.split_whitespace().nth(4) else {
                continue;
            };
            if target == mountpoint || target.starts_with(&format!("{mountpoint}/")) {
                return true;
            }
        }
        false
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = path;
        false
    }
}
