//! Exclusive `runtime/<id>.lock` for one open vault (RF-54).

use std::fs::{self, File, OpenOptions};
use std::io::{Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{Result, UprivError};
use crate::time::utc_timestamp_iso_millis;

#[derive(Debug, Serialize, Deserialize)]
struct LockBody {
    pid: u32,
    hostname: String,
    started_at: String,
}

/// Held while a vault session is open. The fd keeps an exclusive flock.
/// Drop unlinks the path only when it still names this inode.
#[derive(Debug)]
pub struct VaultLock {
    path: PathBuf,
    file: File,
    identity: FileIdentity,
}

impl VaultLock {
    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for VaultLock {
    fn drop(&mut self) {
        // Keep the fd (and its flock) alive until after the inode check.
        let _held = &self.file;
        if identity_of_path(&self.path).ok().as_ref() == Some(&self.identity) {
            let _ = fs::remove_file(&self.path);
        }
    }
}

fn hostname() -> Result<String> {
    let name = os_hostname().map_err(|error| UprivError::VaultStoreInvalid {
        path: PathBuf::from("runtime"),
        detail: format!("could not read OS hostname for vault lock: {error}"),
    })?;
    let name = name.trim();
    if name.is_empty() {
        return Err(UprivError::VaultStoreInvalid {
            path: PathBuf::from("runtime"),
            detail: "OS hostname is empty; refusing vault lock".into(),
        });
    }
    Ok(name.to_string())
}

#[cfg(unix)]
fn os_hostname() -> std::io::Result<String> {
    let mut buf = [0u8; 256];
    let rc = unsafe { libc::gethostname(buf.as_mut_ptr() as *mut libc::c_char, buf.len()) };
    if rc != 0 {
        return Err(std::io::Error::last_os_error());
    }
    let end = buf
        .iter()
        .position(|&b| b == 0)
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "hostname too long"))?;
    String::from_utf8(buf[..end].to_vec())
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))
}

#[cfg(windows)]
fn os_hostname() -> std::io::Result<String> {
    #[link(name = "kernel32")]
    extern "system" {
        fn GetComputerNameW(buffer: *mut u16, size: *mut u32) -> i32;
    }
    let mut buf = [0u16; 256];
    let mut size = buf.len() as u32;
    let ok = unsafe { GetComputerNameW(buf.as_mut_ptr(), &mut size) };
    if ok == 0 {
        return Err(std::io::Error::last_os_error());
    }
    let n = (size as usize).min(buf.len());
    Ok(String::from_utf16_lossy(&buf[..n]))
}

#[cfg(not(any(unix, windows)))]
fn os_hostname() -> std::io::Result<String> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "no OS hostname API on this platform",
    ))
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct FileIdentity {
    dev: u64,
    ino: u64,
}

/// Acquire `runtime/<id>.lock`. The holder keeps an exclusive flock. A lock is
/// taken over only when that flock is free (the previous process is gone).
pub fn acquire_vault_lock(path: PathBuf) -> Result<VaultLock> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    for _ in 0..8 {
        let mut file = open_lock_file(&path, true)?;
        if !try_exclusive_lock(&file)? {
            return Err(UprivError::VaultLocked(path));
        }
        let identity = identity_of_file(&file)?;
        match identity_of_path(&path) {
            Ok(on_disk) if on_disk == identity => {}
            Ok(_) | Err(_) => continue,
        }
        // The exclusive flock is ours, so the previous holder is gone. Rewrite
        // the body even when it names another host (copied vault root, renamed
        // machine). A lock still held by a live process never reaches here.
        write_lock_body(&mut file)?;
        return Ok(VaultLock {
            path,
            file,
            identity,
        });
    }
    Err(UprivError::VaultLocked(path))
}

fn write_lock_body(file: &mut File) -> Result<()> {
    let body = LockBody {
        pid: std::process::id(),
        hostname: hostname()?,
        started_at: utc_timestamp_iso_millis(),
    };
    let bytes =
        serde_json::to_vec_pretty(&body).map_err(|error| UprivError::VaultStoreInvalid {
            path: PathBuf::from("runtime"),
            detail: format!("serialize lock: {error}"),
        })?;
    file.seek(SeekFrom::Start(0))?;
    file.write_all(&bytes)?;
    file.set_len(bytes.len() as u64)?;
    file.sync_all()?;
    Ok(())
}

fn open_lock_file(path: &Path, create: bool) -> Result<File> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        OpenOptions::new()
            .read(true)
            .write(true)
            .create(create)
            .custom_flags(libc::O_NOFOLLOW)
            .open(path)
            .map_err(Into::into)
    }
    #[cfg(not(unix))]
    {
        OpenOptions::new()
            .read(true)
            .write(true)
            .create(create)
            .open(path)
            .map_err(Into::into)
    }
}

fn try_exclusive_lock(file: &File) -> Result<bool> {
    #[cfg(unix)]
    {
        use std::os::unix::io::AsRawFd;
        let rc = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
        if rc == 0 {
            return Ok(true);
        }
        let err = std::io::Error::last_os_error();
        if err.raw_os_error() == Some(libc::EWOULDBLOCK) || err.raw_os_error() == Some(libc::EAGAIN)
        {
            return Ok(false);
        }
        Err(err.into())
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        #[link(name = "kernel32")]
        extern "system" {
            fn LockFileEx(
                file: *mut core::ffi::c_void,
                flags: u32,
                reserved: u32,
                bytes_low: u32,
                bytes_high: u32,
                overlapped: *mut core::ffi::c_void,
            ) -> i32;
        }
        const LOCKFILE_FAIL_IMMEDIATELY: u32 = 0x1;
        const LOCKFILE_EXCLUSIVE_LOCK: u32 = 0x2;
        #[repr(C)]
        struct Overlapped {
            internal: usize,
            internal_high: usize,
            offset: u64,
            event: *mut core::ffi::c_void,
        }
        let mut overlapped = Overlapped {
            internal: 0,
            internal_high: 0,
            offset: 0,
            event: std::ptr::null_mut(),
        };
        let ok = unsafe {
            LockFileEx(
                file.as_raw_handle() as *mut core::ffi::c_void,
                LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY,
                0,
                1,
                0,
                &mut overlapped as *mut Overlapped as *mut core::ffi::c_void,
            )
        };
        if ok != 0 {
            return Ok(true);
        }
        let err = std::io::Error::last_os_error();
        if err.raw_os_error() == Some(33) {
            return Ok(false);
        }
        return Err(err.into());
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = file;
        Ok(true)
    }
}

#[cfg(unix)]
fn identity_of_file(file: &File) -> Result<FileIdentity> {
    use std::os::unix::fs::MetadataExt;
    let meta = file.metadata()?;
    Ok(FileIdentity {
        dev: meta.dev(),
        ino: meta.ino(),
    })
}

#[cfg(unix)]
fn identity_of_path(path: &Path) -> std::io::Result<FileIdentity> {
    use std::os::unix::fs::MetadataExt;
    let meta = fs::symlink_metadata(path)?;
    Ok(FileIdentity {
        dev: meta.dev(),
        ino: meta.ino(),
    })
}

#[cfg(windows)]
fn identity_of_file(file: &File) -> Result<FileIdentity> {
    use std::os::windows::io::AsRawHandle;
    windows_file_identity(file.as_raw_handle() as *mut core::ffi::c_void).map_err(Into::into)
}

#[cfg(windows)]
fn identity_of_path(path: &Path) -> std::io::Result<FileIdentity> {
    use std::os::windows::io::AsRawHandle;
    let file = File::open(path)?;
    windows_file_identity(file.as_raw_handle() as *mut core::ffi::c_void)
}

#[cfg(windows)]
fn windows_file_identity(handle: *mut core::ffi::c_void) -> std::io::Result<FileIdentity> {
    #[repr(C)]
    struct ByHandleFileInformation {
        file_attributes: u32,
        creation_time: u64,
        last_access_time: u64,
        last_write_time: u64,
        volume_serial: u32,
        size_high: u32,
        size_low: u32,
        number_of_links: u32,
        index_high: u32,
        index_low: u32,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetFileInformationByHandle(
            file: *mut core::ffi::c_void,
            info: *mut ByHandleFileInformation,
        ) -> i32;
    }
    let mut info = ByHandleFileInformation {
        file_attributes: 0,
        creation_time: 0,
        last_access_time: 0,
        last_write_time: 0,
        volume_serial: 0,
        size_high: 0,
        size_low: 0,
        number_of_links: 0,
        index_high: 0,
        index_low: 0,
    };
    let ok = unsafe { GetFileInformationByHandle(handle, &mut info) };
    if ok == 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(FileIdentity {
        dev: u64::from(info.volume_serial),
        ino: (u64::from(info.index_high) << 32) | u64::from(info.index_low),
    })
}

#[cfg(not(any(unix, windows)))]
fn identity_of_file(file: &File) -> Result<FileIdentity> {
    let _ = file;
    Ok(FileIdentity { dev: 0, ino: 0 })
}

#[cfg(not(any(unix, windows)))]
fn identity_of_path(path: &Path) -> std::io::Result<FileIdentity> {
    if path.is_file() {
        Ok(FileIdentity { dev: 0, ino: 0 })
    } else {
        Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "lock file missing",
        ))
    }
}

/// True when another process holds the exclusive flock on `path`.
/// A free flock is not live, including when the body names another host.
pub fn lock_held_by_live_process(path: &Path) -> bool {
    let Ok(file) = open_lock_file(path, false) else {
        return false;
    };
    match try_exclusive_lock(&file) {
        Ok(true) => false,
        Ok(false) | Err(_) => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn acquire_and_drop_releases() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("notes.lock");
        {
            let _lock = acquire_vault_lock(path.clone()).unwrap();
            assert!(path.is_file());
            let err = acquire_vault_lock(path.clone()).unwrap_err();
            assert!(matches!(err, UprivError::VaultLocked(_)));
        }
        assert!(!path.exists());
        acquire_vault_lock(path).unwrap();
    }

    #[test]
    fn takes_over_free_lock_recorded_for_another_host() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("notes.lock");
        let body = LockBody {
            pid: 1,
            hostname: "other-machine.example".into(),
            started_at: utc_timestamp_iso_millis(),
        };
        std::fs::write(&path, serde_json::to_vec_pretty(&body).unwrap()).unwrap();
        assert!(!lock_held_by_live_process(&path));
        let _lock = acquire_vault_lock(path.clone()).unwrap();
        assert!(lock_held_by_live_process(&path));
    }

    #[test]
    fn steals_lock_from_dead_pid_on_this_host() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("notes.lock");
        let body = LockBody {
            pid: u32::MAX,
            hostname: hostname().unwrap(),
            started_at: utc_timestamp_iso_millis(),
        };
        std::fs::write(&path, serde_json::to_vec_pretty(&body).unwrap()).unwrap();
        let _lock = acquire_vault_lock(path.clone()).unwrap();
        assert!(path.is_file());
    }
}
