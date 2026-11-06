//! Exclusive `runtime/<id>.lock` for one open vault (RF-54).

#[allow(unused_imports)]
use crate::host_fs::HostFsQuery;
use crate::host_fs::{self as fs, File, OpenOptions};
use std::io::{Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

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

/// This computer's host name. Vault locks and plaintext folder records name
/// the computer that wrote them with it.
pub(crate) fn hostname() -> Result<String> {
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

/// Tries an acquire makes while the flock reads as held, [`BUSY_PAUSE`] apart.
const BUSY_TRIES: u32 = 10;
/// Tries an acquire makes while the lock file is replaced under it.
const REPLACED_TRIES: u32 = 8;
/// Far longer than a probe ([`probe_lock`]) keeps the flock to test it.
const BUSY_PAUSE: Duration = Duration::from_millis(5);

/// Acquire `runtime/<id>.lock`. The holder keeps an exclusive flock. A lock is
/// taken over only when that flock is free (the previous process is gone). A
/// flock that reads as held is tried again for a moment first: a probe of
/// this process takes it for a few microseconds to test it, and a live holder
/// keeps it far longer.
pub fn acquire_vault_lock(path: PathBuf) -> Result<VaultLock> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut busy = 0;
    let mut replaced = 0;
    loop {
        let mut file = open_lock_file(&path, true)?;
        if !try_exclusive_lock(&file)? {
            busy += 1;
            if busy == BUSY_TRIES {
                return Err(UprivError::VaultLocked(path));
            }
            drop(file);
            std::thread::sleep(BUSY_PAUSE);
            continue;
        }
        let identity = identity_of_file(&file)?;
        match identity_of_path(&path) {
            Ok(on_disk) if on_disk == identity => {}
            // The holder unlinked the file after we opened it: open it anew.
            Ok(_) | Err(_) => {
                replaced += 1;
                if replaced == REPLACED_TRIES {
                    return Err(UprivError::VaultLocked(path));
                }
                continue;
            }
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
        // Shared storage (Android storage-access) has no kernel file lock.
        // The lock body still records the holder; a missing flock is not a
        // live holder.
        if crate::host_fs::unsupported_fs_op(&err) {
            return Ok(true);
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
                file.as_raw_handle(),
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
        Err(err.into())
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
    windows_file_identity(file).map_err(Into::into)
}

#[cfg(windows)]
fn identity_of_path(path: &Path) -> std::io::Result<FileIdentity> {
    windows_file_identity(&File::open(path)?)
}

#[cfg(windows)]
fn windows_file_identity(file: &File) -> std::io::Result<FileIdentity> {
    let info = crate::host_fs::windows_file_info(file)?;
    Ok(FileIdentity {
        dev: u64::from(info.volume_serial),
        ino: info.index,
    })
}

#[cfg(not(any(unix, windows)))]
fn identity_of_file(file: &File) -> Result<FileIdentity> {
    let _ = file;
    Ok(FileIdentity { dev: 0, ino: 0 })
}

#[cfg(not(any(unix, windows)))]
fn identity_of_path(path: &Path) -> std::io::Result<FileIdentity> {
    if path.host_is_file() {
        Ok(FileIdentity { dev: 0, ino: 0 })
    } else {
        Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "lock file missing",
        ))
    }
}

const LOCK_HOLDER_POLL: Duration = Duration::from_millis(100);

/// Wait for another process to let go of the lock at `path`, with no time
/// limit: an app that went away leaves its core running until it has closed
/// its vaults, backup zips included, however long that takes. The wait ends
/// early once `give_up` says so, such as on a stop of the work that waits.
pub(crate) fn wait_for_lock_holder(path: &Path, give_up: impl Fn() -> bool) {
    while lock_held_elsewhere(path) && !give_up() {
        std::thread::sleep(LOCK_HOLDER_POLL);
    }
}

/// Test the exclusive lock at `path` without keeping it: `Ok(true)` while
/// another handle holds it (a lock this process holds reads as held too),
/// `Ok(false)` when it is free or there is no lock file to test, `Err` when
/// the system cannot say, such as a network share with no lock service.
fn probe_lock(path: &Path) -> Result<bool> {
    let Ok(file) = open_lock_file(path, false) else {
        return Ok(false);
    };
    #[cfg(test)]
    if FAILED_PROBES.with(|left| left.replace(left.get().saturating_sub(1)) > 0) {
        return Err(std::io::Error::other("test: the lock cannot be tested").into());
    }
    try_exclusive_lock(&file).map(|free| !free)
}

#[cfg(test)]
thread_local! {
    /// Lock tests left to fail on this thread, as on a share with no lock service.
    static FAILED_PROBES: std::cell::Cell<u32> = const { std::cell::Cell::new(0) };
}

/// Make the next `count` lock tests on this thread fail.
#[cfg(test)]
pub(crate) fn fail_lock_probes(count: u32) {
    FAILED_PROBES.with(|left| left.set(count));
}

/// True when another process holds the exclusive flock on `path`.
/// A free flock is not live, including when the body names another host. A
/// lock the system cannot test counts as live: recovery must not take over
/// what a running session may still use.
pub fn lock_held_by_live_process(path: &Path) -> bool {
    probe_lock(path).unwrap_or(true)
}

/// True while another handle holds the lock at `path`. A lock the system
/// cannot test counts as free: taking it fails the same way, so no session
/// can hold it, and work that only waits or refuses for a holder goes on.
pub(crate) fn lock_held_elsewhere(path: &Path) -> bool {
    probe_lock(path).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[allow(unused_imports)]
    use crate::host_fs::HostFsQuery;

    #[test]
    fn wait_ends_when_the_holder_lets_go() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("notes.lock");
        let held = acquire_vault_lock(path.clone()).unwrap();
        let holder = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(150));
            drop(held);
        });

        wait_for_lock_holder(&path, || false);

        holder.join().unwrap();
        assert!(acquire_vault_lock(path).is_ok());
    }

    #[test]
    fn wait_ends_when_it_gives_up_on_a_holder_that_stays() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("notes.lock");
        let _held = acquire_vault_lock(path.clone()).unwrap();
        let asked = std::cell::Cell::new(0);

        wait_for_lock_holder(&path, || {
            asked.set(asked.get() + 1);
            asked.get() == 3
        });

        assert_eq!(asked.get(), 3, "asked between polls until it gave up");
        assert!(matches!(
            acquire_vault_lock(path),
            Err(UprivError::VaultLocked(_))
        ));
    }

    #[test]
    fn wait_returns_at_once_without_a_lock_file() {
        let tmp = tempfile::tempdir().unwrap();
        let started = std::time::Instant::now();
        wait_for_lock_holder(&tmp.path().join("notes.lock"), || false);
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn a_held_lock_reads_as_held_and_a_free_or_missing_one_does_not() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("notes.lock");
        assert!(!lock_held_elsewhere(&path));
        assert!(!lock_held_by_live_process(&path));

        let held = acquire_vault_lock(path.clone()).unwrap();
        assert!(lock_held_elsewhere(&path));
        assert!(lock_held_by_live_process(&path));

        drop(held);
        assert!(!lock_held_elsewhere(&path));
        assert!(!lock_held_by_live_process(&path));
    }

    /// A lock the system cannot test: the open's wait and the refusals go on,
    /// as no session can take it either, and recovery treats it as live.
    #[test]
    fn a_lock_that_cannot_be_tested_is_free_to_wait_on_and_live_for_recovery() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("notes.lock");
        drop(open_lock_file(&path, true).unwrap());

        fail_lock_probes(3);
        assert!(!lock_held_elsewhere(&path));
        assert!(lock_held_by_live_process(&path));
        let started = std::time::Instant::now();
        wait_for_lock_holder(&path, || false);
        assert!(started.elapsed() < Duration::from_secs(5));
        fail_lock_probes(0);
        assert!(!lock_held_by_live_process(&path));
    }

    /// A probe takes the flock for a moment to test it; an acquire that meets
    /// it then waits it out rather than report a holder.
    #[test]
    fn an_acquire_rides_out_a_probe_that_holds_the_flock_for_a_moment() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("notes.lock");
        let probe = open_lock_file(&path, true).unwrap();
        assert!(try_exclusive_lock(&probe).unwrap());
        let (probing, started) = std::sync::mpsc::channel();
        let releases = std::thread::spawn(move || {
            probing.send(()).unwrap();
            std::thread::sleep(Duration::from_millis(15));
            drop(probe);
        });
        started.recv().unwrap();

        let _lock = acquire_vault_lock(path.clone()).expect("taken once the probe lets go");
        releases.join().unwrap();
        assert!(lock_held_elsewhere(&path));
    }

    #[test]
    fn acquire_and_drop_releases() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("notes.lock");
        {
            let _lock = acquire_vault_lock(path.clone()).unwrap();
            assert!(path.host_is_file());
            let err = acquire_vault_lock(path.clone()).unwrap_err();
            assert!(matches!(err, UprivError::VaultLocked(_)));
        }
        assert!(!path.host_exists());
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
        crate::host_fs::write(&path, serde_json::to_vec_pretty(&body).unwrap()).unwrap();
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
        crate::host_fs::write(&path, serde_json::to_vec_pretty(&body).unwrap()).unwrap();
        let _lock = acquire_vault_lock(path.clone()).unwrap();
        assert!(path.host_is_file());
    }
}
