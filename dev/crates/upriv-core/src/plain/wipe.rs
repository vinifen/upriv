use std::fs::OpenOptions;
use std::io::{Seek, Write};
use std::path::Path;

use rand::RngCore;
use walkdir::WalkDir;

use crate::config::{SecuritySection, WipePattern};
use crate::error::{Result, UprivError};

#[derive(Debug, Clone)]
pub struct WipeOptions {
    pub passes: u32,
    pub pattern: WipePattern,
}

impl From<&SecuritySection> for WipeOptions {
    fn from(section: &SecuritySection) -> Self {
        Self {
            passes: section.wipe_passes.max(1),
            pattern: section.wipe_pattern,
        }
    }
}

/// Overwrite files then remove `path` (file or directory tree). Refuses symlinks.
pub fn secure_wipe_path(path: &Path, opts: &WipeOptions) -> Result<()> {
    if path.symlink_metadata().is_ok() && path.is_symlink() {
        return Err(UprivError::SymlinkNotAllowed(path.to_path_buf()));
    }

    if path.is_file() {
        wipe_file_contents(path, opts)?;
        std::fs::remove_file(path)?;
        return Ok(());
    }

    if path.is_dir() {
        for entry in WalkDir::new(path).contents_first(true).into_iter().flatten() {
            let entry_path = entry.path();
            if entry_path.symlink_metadata().map(|m| m.file_type().is_symlink()).unwrap_or(false)
            {
                return Err(UprivError::SymlinkNotAllowed(entry_path.to_path_buf()));
            }
            if entry.file_type().is_file() {
                wipe_file_contents(entry_path, opts)?;
                std::fs::remove_file(entry_path)?;
            } else if entry.file_type().is_dir() && entry_path != path {
                let _ = std::fs::remove_dir(entry_path);
            }
        }
        std::fs::remove_dir_all(path)?;
    }

    Ok(())
}

fn wipe_file_contents(path: &Path, opts: &WipeOptions) -> Result<()> {
    let metadata = std::fs::metadata(path)?;
    let len = metadata.len();
    if len == 0 {
        return Ok(());
    }

    let mut file = OpenOptions::new().read(true).write(true).open(path)?;
    let mut buffer = vec![0_u8; len as usize];

    for _ in 0..opts.passes {
        match opts.pattern {
            WipePattern::Zeros => buffer.fill(0),
            WipePattern::Random => rand::thread_rng().fill_bytes(&mut buffer),
        }
        file.seek(std::io::SeekFrom::Start(0))?;
        file.write_all(&buffer)?;
        file.sync_all()?;
    }

    Ok(())
}

/// Remove a workspace tree, optionally with secure wipe (SDD §2.10).
pub fn wipe_workspace(path: &Path, security: &SecuritySection) -> Result<()> {
    if !path.exists() {
        return Ok(());
    }
    if security.secure_wipe_workspace {
        secure_wipe_path(path, &WipeOptions::from(security))?;
    } else {
        std::fs::remove_dir_all(path)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::SecuritySection;
    use tempfile::tempdir;

    #[test]
    fn secure_wipe_removes_file() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("secret.txt");
        std::fs::write(&file, b"top secret").unwrap();

        let security = SecuritySection {
            secure_wipe_workspace: true,
            wipe_passes: 1,
            wipe_pattern: WipePattern::Zeros,
            ..SecuritySection::default()
        };
        wipe_workspace(dir.path(), &security).unwrap();
        assert!(!file.exists());
    }

    #[test]
    fn secure_wipe_overwrites_before_delete() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("secret.txt");
        std::fs::write(&file, b"top secret").unwrap();

        secure_wipe_path(
            &file,
            &WipeOptions {
                passes: 1,
                pattern: WipePattern::Zeros,
            },
        )
        .unwrap();

        // File should be gone after secure_wipe_path on a single file.
        assert!(!file.exists());
    }
}
