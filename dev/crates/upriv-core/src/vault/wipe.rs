//! Overwrite + fsync + unlink (SDD §2.10). SSD/flash is best-effort.
//!
//! [`secure_wipe_path`] removes a path the app owns (a vault file, a cached
//! preview). A file there is overwritten even when it has a second name, so a
//! preview with a hard link loses its bytes too. A plaintext folder other apps
//! can write uses `plain::sweep`, which does not overwrite through a link.

use crate::host_fs as fs;
#[allow(unused_imports)]
use crate::host_fs::HostFsQuery;
use std::io::{self, Seek, SeekFrom, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use rand::RngCore;

use crate::config::vault_config::VaultWipePattern;
use crate::error::{Result, UprivError};
use crate::paths::{open_nofollow, NofollowMode};

/// Bytes overwritten between flushes to disk. One flush at the end of a large
/// file would hold a stop for minutes.
const OVERWRITE_SYNC_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Debug, Clone, Copy)]
pub struct WipeOptions {
    pub passes: u32,
    pub pattern: VaultWipePattern,
}

impl WipeOptions {
    pub fn from_vault_config(config: &crate::config::VaultConfig) -> Self {
        Self::from_security(&config.security)
    }

    /// The vault's own settings, or the defaults when its config cannot be read.
    pub fn for_vault_dir(vault_dir: &Path) -> Self {
        match crate::config::load_vault_config(vault_dir) {
            Ok(config) => Self::from_vault_config(&config),
            Err(_) => Self::from_security(&Default::default()),
        }
    }

    fn from_security(security: &crate::config::vault_config::VaultSecuritySection) -> Self {
        Self {
            passes: security.wipe_passes.max(1),
            pattern: security.wipe_pattern,
        }
    }
}

/// Depth-first overwrite of a file or directory. Refuses to follow symlinks.
pub fn secure_wipe_path(path: &Path, opts: &WipeOptions) -> Result<()> {
    let meta = match fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    if meta.file_type().is_symlink() {
        fs::remove_file(path)?;
        return Ok(());
    }
    if meta.host_is_file() {
        wipe_file_then_unlink(path, opts)?;
        return Ok(());
    }
    if meta.host_is_dir() {
        let mut children: Vec<_> = fs::read_dir(path)?.filter_map(|e| e.ok()).collect();
        children.sort_by_key(|e| std::cmp::Reverse(e.path().as_os_str().to_os_string()));
        for child in children {
            secure_wipe_path(&child.path(), opts)?;
        }
        fs::remove_dir(path)?;
        if let Some(parent) = path.parent() {
            let _ = fs::File::open(parent).and_then(|f| f.sync_all());
        }
        return Ok(());
    }
    Err(UprivError::VaultStoreInvalid {
        path: path.to_path_buf(),
        detail: "refusing to wipe special file".into(),
    })
}

/// Overwrite one regular file, then remove its name. The open does not follow
/// a link swapped in after the caller looked at the path.
pub(crate) fn wipe_file_then_unlink(path: &Path, opts: &WipeOptions) -> io::Result<()> {
    wipe_file_then_unlink_until(path, opts, &AtomicBool::new(false))
}

/// [`wipe_file_then_unlink`]; once `stop` is set the rest of the file is left
/// as it is and its name still goes.
pub(crate) fn wipe_file_then_unlink_until(
    path: &Path,
    opts: &WipeOptions,
    stop: &AtomicBool,
) -> io::Result<()> {
    let mut file = open_nofollow(path, NofollowMode::ReadWrite)?;
    let len = file.metadata()?.len();
    overwrite_contents(&mut file, len, opts, stop)?;
    drop(file);
    match fs::remove_file(path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        other => other,
    }
}

/// A file the wipe can rewrite in place and flush.
pub(crate) trait Overwrite: Write + Seek {
    fn flush_to_disk(&self) -> io::Result<()>;
}

impl Overwrite for std::fs::File {
    fn flush_to_disk(&self) -> io::Result<()> {
        self.sync_all()
    }
}

impl Overwrite for fs::File {
    fn flush_to_disk(&self) -> io::Result<()> {
        self.sync_all()
    }
}

/// Write `opts.pattern` over the first `len` bytes, `opts.passes` times, and
/// flush after each pass and every [`OVERWRITE_SYNC_BYTES`]. Once `stop` is
/// set the rest of the file is left as it is.
pub(crate) fn overwrite_contents(
    file: &mut impl Overwrite,
    len: u64,
    opts: &WipeOptions,
    stop: &AtomicBool,
) -> io::Result<()> {
    if len == 0 {
        return Ok(());
    }
    let mut buf = vec![0u8; 64 * 1024];
    for _ in 0..opts.passes.max(1) {
        file.seek(SeekFrom::Start(0))?;
        let mut remaining = len;
        let mut unsynced = 0u64;
        while remaining > 0 {
            if stop.load(Ordering::Relaxed) {
                return Ok(());
            }
            let n = remaining.min(buf.len() as u64) as usize;
            fill_pattern(&mut buf[..n], opts.pattern);
            file.write_all(&buf[..n])?;
            remaining -= n as u64;
            unsynced += n as u64;
            if unsynced >= OVERWRITE_SYNC_BYTES {
                file.flush()?;
                file.flush_to_disk()?;
                unsynced = 0;
            }
        }
        file.flush()?;
        file.flush_to_disk()?;
    }
    Ok(())
}

fn fill_pattern(buf: &mut [u8], pattern: VaultWipePattern) {
    match pattern {
        VaultWipePattern::Zeros => buf.fill(0),
        VaultWipePattern::Random => rand::thread_rng().fill_bytes(buf),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[allow(unused_imports)]
    use crate::host_fs::HostFsQuery;

    fn zeros() -> WipeOptions {
        WipeOptions {
            passes: 1,
            pattern: VaultWipePattern::Zeros,
        }
    }

    #[test]
    fn a_stop_leaves_the_rest_of_the_file_and_still_removes_it() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("secret.bin");
        crate::host_fs::write(&path, b"plaintext-secret").unwrap();
        // An open descriptor still sees the bytes after the name is gone.
        let mut reader = std::fs::File::open(&path).unwrap();
        wipe_file_then_unlink_until(&path, &zeros(), &AtomicBool::new(true)).unwrap();
        assert!(!path.host_exists());
        let mut left = Vec::new();
        io::Read::read_to_end(&mut reader, &mut left).unwrap();
        assert_eq!(left, b"plaintext-secret");
    }

    #[test]
    fn wipe_removes_file_after_overwrite() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("secret.bin");
        crate::host_fs::write(&path, b"plaintext-secret").unwrap();
        secure_wipe_path(&path, &zeros()).unwrap();
        assert!(!path.host_exists());
    }

    #[cfg(unix)]
    #[test]
    fn wipe_unlinks_a_symlink_and_leaves_its_target() {
        let tmp = tempfile::tempdir().unwrap();
        let target = tmp.path().join("target.txt");
        std::fs::write(&target, b"keep").unwrap();
        let link = tmp.path().join("link.txt");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        secure_wipe_path(&link, &zeros()).unwrap();
        assert!(std::fs::symlink_metadata(&link).is_err());
        assert_eq!(std::fs::read(&target).unwrap(), b"keep");
    }
}
