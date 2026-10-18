//! The filesystem a plaintext folder lives on: which names it treats as one,
//! how much room it has, and whether it is removable, on a network, or synced
//! to a cloud service. The last one is only a warning for the user: a file
//! there may leave the computer while the vault is open.

use std::path::{Component, Path, PathBuf};

use serde::Serialize;

#[allow(unused_imports)]
use crate::host_fs::HostFsQuery;

/// Where the folder physically is, as far as this computer can tell.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PlainFolderClass {
    Local,
    Removable,
    Network,
    Cloud,
}

/// Name rules of the filesystem family.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum FsFamily {
    /// ext4, btrfs, xfs, …: any byte but `/` and NUL; case matters.
    #[cfg_attr(any(target_os = "macos", windows), allow(dead_code))]
    Posix,
    /// APFS and HFS+: case-insensitive and normalization-insensitive.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    Apple,
    /// Windows, FAT, exFAT, NTFS, and Android shared storage: the Windows
    /// character rules; case-insensitive.
    Windows,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct Volume {
    pub family: FsFamily,
    pub class: PlainFolderClass,
}

/// Facts for `folder`, or for its nearest parent that exists.
pub(super) fn inspect(folder: &Path) -> Volume {
    if crate::host_fs::is_bridge_path(folder) {
        // Shared storage on Android keeps FAT names and folds case.
        return Volume {
            family: FsFamily::Windows,
            class: PlainFolderClass::Local,
        };
    }
    let mut volume = inspect_local(&nearest_existing(folder));
    if volume.class == PlainFolderClass::Local && in_cloud_folder(folder) {
        volume.class = PlainFolderClass::Cloud;
    }
    volume
}

/// Bytes the current user may still write on the folder's filesystem.
/// `None` when the system does not say.
pub(super) fn free_bytes(folder: &Path) -> Option<u64> {
    if crate::host_fs::is_bridge_path(folder) {
        return None;
    }
    free_bytes_local(&nearest_existing(folder))
}

fn nearest_existing(path: &Path) -> PathBuf {
    let mut current = path.to_path_buf();
    while !current.host_exists() {
        if !current.pop() {
            break;
        }
    }
    current
}

/// Folders cloud clients sync by default, compared without case.
fn in_cloud_folder(path: &Path) -> bool {
    path.components().any(|component| {
        let Component::Normal(name) = component else {
            return false;
        };
        let name = name.to_string_lossy().to_lowercase();
        let name = name.as_str();
        name.starts_with("dropbox")
            || name.starts_with("onedrive")
            || name.starts_with("googledrive")
            || name.starts_with("pcloud")
            || name.starts_with("megasync")
            || name.starts_with("tresorit")
            || name.starts_with("seafile")
            || matches!(
                name,
                "google drive"
                    | "my drive"
                    | "icloud drive"
                    | "iclouddrive"
                    | "mobile documents"
                    | "cloudstorage"
                    | "mega"
                    | "nextcloud"
                    | "owncloud"
                    | "box"
                    | "box sync"
                    | "yandex.disk"
                    | "proton drive"
            )
    })
}

#[cfg(target_os = "linux")]
fn inspect_local(path: &Path) -> Volume {
    let Some(mount) = linux_mount(path) else {
        return Volume {
            family: FsFamily::Posix,
            class: PlainFolderClass::Local,
        };
    };
    let fstype = mount.fstype.as_str();
    let family = match fstype {
        "vfat" | "msdos" | "exfat" | "ntfs" | "ntfs3" | "fuseblk" => FsFamily::Windows,
        _ => FsFamily::Posix,
    };
    let class = linux_network_class(fstype).unwrap_or_else(|| {
        let point = mount.point.to_string_lossy();
        if point.starts_with("/media/") || point.starts_with("/run/media/") {
            PlainFolderClass::Removable
        } else {
            PlainFolderClass::Local
        }
    });
    Volume { family, class }
}

#[cfg(target_os = "linux")]
fn linux_network_class(fstype: &str) -> Option<PlainFolderClass> {
    if let Some(helper) = fstype.strip_prefix("fuse.") {
        return match helper {
            "rclone" | "s3fs" | "gcsfuse" | "goofys" | "onedriver" | "google-drive-ocamlfuse" => {
                Some(PlainFolderClass::Cloud)
            }
            "sshfs" | "gvfsd-fuse" | "davfs2" | "juicefs" => Some(PlainFolderClass::Network),
            _ => None,
        };
    }
    matches!(
        fstype,
        "nfs"
            | "nfs4"
            | "cifs"
            | "smb3"
            | "smbfs"
            | "9p"
            | "afs"
            | "ceph"
            | "glusterfs"
            | "davfs"
            | "lustre"
            | "sshfs"
    )
    .then_some(PlainFolderClass::Network)
}

/// The top of the filesystem `path` is on, where shared Trash folders live.
#[cfg(target_os = "linux")]
pub(super) fn mount_root(path: &Path) -> Option<PathBuf> {
    linux_mount(&nearest_existing(path)).map(|mount| mount.point)
}

#[cfg(target_os = "linux")]
struct MountEntry {
    point: PathBuf,
    fstype: String,
}

/// The mount `path` is on: the longest mount point that holds it. A later
/// line for the same point wins, as the kernel stacks it on top.
#[cfg(target_os = "linux")]
fn linux_mount(path: &Path) -> Option<MountEntry> {
    let target = std::fs::canonicalize(path).ok()?;
    let text = std::fs::read_to_string("/proc/self/mountinfo").ok()?;
    let mut best: Option<MountEntry> = None;
    for line in text.lines() {
        let Some((head, tail)) = line.split_once(" - ") else {
            continue;
        };
        let (Some(point), Some(fstype)) = (head.split(' ').nth(4), tail.split(' ').next()) else {
            continue;
        };
        let point = PathBuf::from(unescape_mount_field(point));
        if !target.starts_with(&point) {
            continue;
        }
        let longer = best
            .as_ref()
            .is_none_or(|current| point.as_os_str().len() >= current.point.as_os_str().len());
        if longer {
            best = Some(MountEntry {
                point,
                fstype: fstype.to_string(),
            });
        }
    }
    best
}

/// `mountinfo` writes a space as `\040` (octal), and the same for tab,
/// newline, and backslash.
#[cfg(target_os = "linux")]
fn unescape_mount_field(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'\\' && index + 4 <= bytes.len() {
            if let Ok(value) = u8::from_str_radix(&raw[index + 1..index + 4], 8) {
                out.push(value);
                index += 4;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(target_os = "macos")]
fn inspect_local(path: &Path) -> Volume {
    use std::ffi::CStr;
    use std::os::unix::ffi::OsStrExt;
    let fallback = Volume {
        family: FsFamily::Apple,
        class: PlainFolderClass::Local,
    };
    let Ok(c_path) = std::ffi::CString::new(path.as_os_str().as_bytes()) else {
        return fallback;
    };
    let mut st: libc::statfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statfs(c_path.as_ptr(), &mut st) } != 0 {
        return fallback;
    }
    let fstype = unsafe { CStr::from_ptr(st.f_fstypename.as_ptr()) }
        .to_string_lossy()
        .into_owned();
    let point = unsafe { CStr::from_ptr(st.f_mntonname.as_ptr()) }
        .to_string_lossy()
        .into_owned();
    let family = match fstype.as_str() {
        "msdos" | "exfat" | "ntfs" => FsFamily::Windows,
        _ => FsFamily::Apple,
    };
    let local = st.f_flags & (libc::MNT_LOCAL as u32) != 0;
    let class = if !local || matches!(fstype.as_str(), "smbfs" | "nfs" | "afpfs" | "webdav") {
        PlainFolderClass::Network
    } else if point.starts_with("/Volumes/") {
        PlainFolderClass::Removable
    } else {
        PlainFolderClass::Local
    };
    Volume { family, class }
}

#[cfg(windows)]
fn inspect_local(path: &Path) -> Volume {
    #[link(name = "kernel32")]
    extern "system" {
        fn GetVolumePathNameW(file: *const u16, volume: *mut u16, len: u32) -> i32;
        fn GetDriveTypeW(root: *const u16) -> u32;
    }
    const DRIVE_REMOVABLE: u32 = 2;
    const DRIVE_REMOTE: u32 = 4;
    let wide = crate::host_fs::windows_verbatim_wide(path);
    let mut root = vec![0u16; 1024];
    let found =
        unsafe { GetVolumePathNameW(wide.as_ptr(), root.as_mut_ptr(), root.len() as u32) } != 0;
    let class = if !found {
        PlainFolderClass::Local
    } else {
        match unsafe { GetDriveTypeW(root.as_ptr()) } {
            DRIVE_REMOTE => PlainFolderClass::Network,
            DRIVE_REMOVABLE => PlainFolderClass::Removable,
            _ => PlainFolderClass::Local,
        }
    };
    Volume {
        family: FsFamily::Windows,
        class,
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
fn inspect_local(_path: &Path) -> Volume {
    Volume {
        family: if cfg!(target_os = "ios") {
            FsFamily::Apple
        } else {
            FsFamily::Posix
        },
        class: PlainFolderClass::Local,
    }
}

#[cfg(unix)]
fn free_bytes_local(path: &Path) -> Option<u64> {
    use std::os::unix::ffi::OsStrExt;
    let c_path = std::ffi::CString::new(path.as_os_str().as_bytes()).ok()?;
    let mut st: libc::statvfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statvfs(c_path.as_ptr(), &mut st) } != 0 {
        return None;
    }
    #[allow(clippy::unnecessary_cast)]
    let (available, fragment) = (st.f_bavail as u64, st.f_frsize as u64);
    Some(available.saturating_mul(fragment))
}

#[cfg(windows)]
fn free_bytes_local(path: &Path) -> Option<u64> {
    #[link(name = "kernel32")]
    extern "system" {
        fn GetDiskFreeSpaceExW(
            dir: *const u16,
            free_to_caller: *mut u64,
            total: *mut u64,
            total_free: *mut u64,
        ) -> i32;
    }
    let wide = crate::host_fs::windows_verbatim_wide(path);
    let mut available = 0u64;
    let ok = unsafe {
        GetDiskFreeSpaceExW(
            wide.as_ptr(),
            &mut available,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    (ok != 0).then_some(available)
}

#[cfg(not(any(unix, windows)))]
fn free_bytes_local(_path: &Path) -> Option<u64> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cloud_client_folders_are_recognized_without_case() {
        assert!(in_cloud_folder(Path::new("/home/a/Dropbox/vaults/Notes")));
        assert!(in_cloud_folder(Path::new("/home/a/OneDrive - Work/Notes")));
        assert!(in_cloud_folder(Path::new(
            "/Users/a/Library/Mobile Documents/com~apple~CloudDocs/Notes"
        )));
        assert!(!in_cloud_folder(Path::new("/home/a/Documents/Notes")));
        assert!(!in_cloud_folder(Path::new("/home/a/toolbox/Notes")));
    }

    #[test]
    fn free_bytes_reports_a_number_for_a_temp_folder() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(free_bytes(&tmp.path().join("missing/leaf")).is_some_and(|bytes| bytes > 0));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn mount_fields_unescape_octal() {
        assert_eq!(unescape_mount_field(r"/media/a\040b"), "/media/a b");
        assert_eq!(unescape_mount_field(r"/x\134y"), r"/x\y");
        assert_eq!(unescape_mount_field(r"/trailing\04"), r"/trailing\04");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn network_and_cloud_mount_types() {
        assert_eq!(linux_network_class("nfs4"), Some(PlainFolderClass::Network));
        assert_eq!(
            linux_network_class("fuse.sshfs"),
            Some(PlainFolderClass::Network)
        );
        assert_eq!(
            linux_network_class("fuse.rclone"),
            Some(PlainFolderClass::Cloud)
        );
        assert_eq!(linux_network_class("ext4"), None);
        assert_eq!(linux_network_class("fuse.upriv"), None);
    }
}
