//! Virtual workspace mount (FUSE / WinFsp). The in-app file manager does not
//! depend on a successful mount — mount failure is a degraded desktop mode.

use std::path::{Path, PathBuf};

use crate::error::{Result, UprivError};

#[cfg(target_os = "linux")]
mod fuse_linux;

/// Held while a vault is mounted. Unmounts and removes the leaf on drop.
pub struct MountedVault {
    pub(crate) mount_point: PathBuf,
    #[cfg(target_os = "linux")]
    pub(crate) session: Option<fuser::BackgroundSession>,
}

impl std::fmt::Debug for MountedVault {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MountedVault")
            .field("mount_point", &self.mount_point)
            .finish_non_exhaustive()
    }
}

impl MountedVault {
    pub fn mount_point(&self) -> &Path {
        &self.mount_point
    }
}

impl Drop for MountedVault {
    fn drop(&mut self) {
        #[cfg(target_os = "linux")]
        {
            self.session.take();
        }
        if force_unmount(&self.mount_point).is_ok() {
            let _ = std::fs::remove_dir(&self.mount_point);
        }
    }
}

/// Force-unmount a leftover mountpoint after a dirty exit.
///
/// Linux detaches a dead Upriv FUSE leaf (`fusermount -uz`, then `umount2`).
/// Do not gate that on `path.exists()`: a killed FUSE daemon makes `stat`
/// return ENOTCONN, and `exists()` is then false. A path that is not an Upriv
/// mount is left alone. Windows and Android have no OS mount, so this is a
/// no-op there. Missing paths succeed so the launch sweep is idempotent.
pub fn force_unmount(path: &Path) -> Result<()> {
    #[cfg(target_os = "linux")]
    {
        linux_umount(path)
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = path;
        Ok(())
    }
}

/// Mount `encrypted_dir` at `mount_point` backed by the open session.
pub fn mount_encrypted_dir(
    root: crate::paths::VaultRoot,
    vault_id: String,
    mount_point: PathBuf,
) -> Result<MountedVault> {
    // Only Linux attaches an OS folder. Creating the leaf first on Windows or
    // Android would leave a real empty directory after the mount is refused.
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (root, vault_id, mount_point);
        return Err(UprivError::VaultMountFailed(
            "OS mount is not enabled on this platform; use the in-app file manager".into(),
        ));
    }
    #[cfg(target_os = "linux")]
    {
        if let Some(parent) = mount_point.parent() {
            std::fs::create_dir_all(parent)?;
        }
        // Detach a leftover or disconnected FUSE leaf before creating the directory.
        // `create_dir` on that path returns ENOTCONN, which is not `AlreadyExists`.
        if force_unmount(&mount_point).is_ok() {
            let _ = std::fs::remove_dir(&mount_point);
        }
        match std::fs::create_dir(&mount_point) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                if force_unmount(&mount_point).is_ok() {
                    let _ = std::fs::remove_dir(&mount_point);
                }
                if std::fs::create_dir(&mount_point).is_err() {
                    return Err(UprivError::VaultMountFailed(format!(
                        "mount point busy: {}",
                        mount_point.display()
                    )));
                }
            }
            Err(error) => return Err(error.into()),
        }
        fuse_linux::spawn(root, vault_id, mount_point)
    }
}

#[cfg(target_os = "linux")]
fn linux_umount(path: &Path) -> Result<()> {
    let Some(text) = path.to_str() else {
        return Err(UprivError::VaultMountFailed(
            "mount path is not valid UTF-8".into(),
        ));
    };
    let Some(c_path) = std::ffi::CString::new(text).ok() else {
        return Err(UprivError::VaultMountFailed(
            "mount path is not valid UTF-8".into(),
        ));
    };
    // Another filesystem at this exact path (sshfs, a disk, a different FUSE
    // mount) must stay. Only an `upriv` FUSE leaf is detached. A path that is
    // not in the mount table is already clear.
    match upriv_mount_kind(path) {
        MountKind::Other => {
            return Err(UprivError::VaultMountFailed(
                "path is mounted, but not as an Upriv vault".into(),
            ));
        }
        // Not a mount. `umount2` on that path returns EPERM here, which is not
        // "not a mount", so do not call it. The empty leaf can still be removed.
        MountKind::NotListed => return Ok(()),
        MountKind::Upriv | MountKind::Unknown => {}
    }
    // `fusermount -uz` detaches a FUSE mount whose daemon is gone. `umount2`
    // on that path can itself fail with ENOTCONN, which is the dialog the
    // desktop shows when anything stats the leaf.
    for bin in ["fusermount3", "fusermount"] {
        let status = std::process::Command::new(bin)
            .args(["-uz", text])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
        if matches!(status, Ok(code) if code.success()) {
            return Ok(());
        }
    }
    const MNT_FORCE: libc::c_int = 1;
    const MNT_DETACH: libc::c_int = 2;
    let rc = unsafe { libc::umount2(c_path.as_ptr(), MNT_DETACH) };
    if rc == 0 {
        return Ok(());
    }
    let err = std::io::Error::last_os_error();
    // Not a mount. A missing path is the same outcome the launch sweep wants.
    if matches!(err.raw_os_error(), Some(libc::EINVAL) | Some(libc::ENOENT)) {
        return Ok(());
    }
    let forced = unsafe { libc::umount2(c_path.as_ptr(), MNT_FORCE | MNT_DETACH) };
    if forced == 0 {
        return Ok(());
    }
    let forced_err = std::io::Error::last_os_error();
    if matches!(
        forced_err.raw_os_error(),
        Some(libc::EINVAL) | Some(libc::ENOENT)
    ) {
        return Ok(());
    }
    Err(UprivError::VaultMountFailed(forced_err.to_string()))
}

#[cfg(target_os = "linux")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MountKind {
    /// This path is an Upriv FUSE mount (`fuse.upriv` / source `upriv`).
    Upriv,
    /// This path is some other mount. Do not detach it.
    Other,
    /// Not present in the mount table.
    NotListed,
    /// Mount table could not be read. Detach is still attempted.
    Unknown,
}

#[cfg(target_os = "linux")]
fn upriv_mount_kind(path: &Path) -> MountKind {
    let Ok(text) = std::fs::read_to_string("/proc/self/mountinfo") else {
        return MountKind::Unknown;
    };
    classify_mount_point(path, &text)
}

/// `mountinfo` mount-point field, compared without stating the path.
#[cfg(target_os = "linux")]
fn classify_mount_point(path: &Path, mountinfo: &str) -> MountKind {
    let Some(want) = path.to_str() else {
        return MountKind::NotListed;
    };
    let want = want.trim_end_matches('/');
    if want.is_empty() {
        return MountKind::Other;
    }
    for line in mountinfo.lines() {
        let Some((point, fstype, source)) = mountinfo_fields(line) else {
            continue;
        };
        if point.trim_end_matches('/') != want {
            continue;
        }
        if is_upriv_fuse(fstype, source) {
            return MountKind::Upriv;
        }
        return MountKind::Other;
    }
    MountKind::NotListed
}

#[cfg(target_os = "linux")]
fn is_upriv_fuse(fstype: &str, source: &str) -> bool {
    fstype == "fuse.upriv" || (fstype == "fuse" && source == "upriv")
}

/// Fields 5 (mount point), 9 (fstype), and 10 (source) of one mountinfo line.
#[cfg(target_os = "linux")]
fn mountinfo_fields(line: &str) -> Option<(String, &str, &str)> {
    let (before, after) = line.split_once(" - ")?;
    let mut head = before.split_whitespace();
    let point = unescape_mount_field(head.nth(4)?);
    let mut tail = after.split_whitespace();
    let fstype = tail.next()?;
    let source = tail.next()?;
    Some((point, fstype, source))
}

#[cfg(target_os = "linux")]
fn unescape_mount_field(field: &str) -> String {
    let mut out = String::with_capacity(field.len());
    let mut chars = field.chars();
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            out.push(ch);
            continue;
        }
        let octal: String = chars.by_ref().take(3).collect();
        let Ok(code) = u8::from_str_radix(&octal, 8) else {
            out.push('\\');
            out.push_str(&octal);
            continue;
        };
        out.push(char::from(code));
    }
    out
}

#[cfg(all(test, target_os = "linux"))]
mod mountinfo_tests {
    use super::{classify_mount_point, MountKind};
    use std::path::Path;

    const SAMPLE: &str = "\
36 25 0:32 / /home/vini/workspace/test rw,nosuid,nodev - fuse.upriv upriv rw,user_id=1000\n\
40 25 0:40 / /home/vini/ssh rw,nosuid,nodev - fuse.sshfs user@host rw\n\
41 25 8:1 / /home/vini/disk rw - ext4 /dev/sda1 rw\n\
42 25 0:41 / /home/vini/My\\040Vault rw - fuse.upriv upriv rw\n\
43 25 8:2 / /home/vini/upriv-disk rw - ext4 upriv rw\n\
44 25 0:42 / /home/vini/plain-fuse rw - fuse upriv rw\n";

    #[test]
    fn classifies_only_upriv_leaves() {
        assert_eq!(
            classify_mount_point(Path::new("/home/vini/workspace/test"), SAMPLE),
            MountKind::Upriv
        );
        assert_eq!(
            classify_mount_point(Path::new("/home/vini/My Vault"), SAMPLE),
            MountKind::Upriv
        );
        assert_eq!(
            classify_mount_point(Path::new("/home/vini/ssh"), SAMPLE),
            MountKind::Other
        );
        assert_eq!(
            classify_mount_point(Path::new("/home/vini/disk"), SAMPLE),
            MountKind::Other
        );
        assert_eq!(
            classify_mount_point(Path::new("/home/vini/workspace"), SAMPLE),
            MountKind::NotListed
        );
        assert_eq!(
            classify_mount_point(Path::new("/home/vini/upriv-disk"), SAMPLE),
            MountKind::Other
        );
        assert_eq!(
            classify_mount_point(Path::new("/home/vini/plain-fuse"), SAMPLE),
            MountKind::Upriv
        );
        assert_eq!(
            classify_mount_point(Path::new("/"), SAMPLE),
            MountKind::Other
        );
    }
}
