//! Overwrite + fsync + unlink (SDD §2.10). SSD/flash is best-effort.

use std::fs::{self, File, OpenOptions};
use std::io::{Seek, SeekFrom, Write};
use std::path::Path;

use rand::RngCore;

use crate::config::vault_config::VaultWipePattern;
use crate::error::{Result, UprivError};

pub struct WipeOptions {
    pub passes: u32,
    pub pattern: VaultWipePattern,
}

impl WipeOptions {
    pub fn from_vault_config(config: &crate::config::VaultConfig) -> Self {
        Self {
            passes: config.security.wipe_passes.max(1),
            pattern: config.security.wipe_pattern,
        }
    }
}

/// Depth-first overwrite of a file or directory. Refuses to follow symlinks.
pub fn secure_wipe_path(path: &Path, opts: &WipeOptions) -> Result<()> {
    let meta = match fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    if meta.file_type().is_symlink() {
        fs::remove_file(path)?;
        return Ok(());
    }
    if meta.is_file() {
        wipe_file_contents(path, opts)?;
        fs::remove_file(path)?;
        return Ok(());
    }
    if meta.is_dir() {
        let mut children: Vec<_> = fs::read_dir(path)?.filter_map(|e| e.ok()).collect();
        children.sort_by_key(|e| std::cmp::Reverse(e.path().as_os_str().to_os_string()));
        for child in children {
            secure_wipe_path(&child.path(), opts)?;
        }
        fs::remove_dir(path)?;
        if let Some(parent) = path.parent() {
            let _ = File::open(parent).and_then(|f| f.sync_all());
        }
        return Ok(());
    }
    Err(UprivError::VaultStoreInvalid {
        path: path.to_path_buf(),
        detail: "refusing to wipe special file".into(),
    })
}

fn wipe_file_contents(path: &Path, opts: &WipeOptions) -> Result<()> {
    let len = fs::metadata(path)?.len();
    if len == 0 {
        return Ok(());
    }
    let mut file = OpenOptions::new().write(true).open(path)?;
    let passes = opts.passes.max(1);
    let mut buf = vec![0u8; 64 * 1024];
    for _ in 0..passes {
        file.seek(SeekFrom::Start(0))?;
        let mut remaining = len;
        while remaining > 0 {
            let n = remaining.min(buf.len() as u64) as usize;
            fill_pattern(&mut buf[..n], opts.pattern);
            file.write_all(&buf[..n])?;
            remaining -= n as u64;
        }
        file.flush()?;
        file.sync_all()?;
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

    #[test]
    fn wipe_removes_file_after_overwrite() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("secret.bin");
        std::fs::write(&path, b"plaintext-secret").unwrap();
        secure_wipe_path(
            &path,
            &WipeOptions {
                passes: 1,
                pattern: VaultWipePattern::Zeros,
            },
        )
        .unwrap();
        assert!(!path.exists());
    }
}
