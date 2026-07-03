use std::path::{Path, PathBuf};

use crate::error::{Result, UprivError};

/// Platform-neutral vault I/O (desktop: `std::fs`; Android: SAF later).
pub trait VaultStorage: Send + Sync {
    fn read_file(&self, relative: &str) -> Result<Vec<u8>>;
    fn write_file(&self, relative: &str, data: &[u8]) -> Result<()>;
    fn list_dir(&self, relative: &str) -> Result<Vec<String>>;
    fn delete_tree(&self, relative: &str) -> Result<()>;
    fn exists(&self, relative: &str) -> bool;
    fn absolute_path(&self, relative: &str) -> PathBuf;
}

/// Desktop implementation rooted at `<vault-root>`.
#[derive(Debug, Clone)]
pub struct FsVaultStorage {
    root: PathBuf,
}

impl FsVaultStorage {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    fn resolve(&self, relative: &str) -> PathBuf {
        self.root.join(relative)
    }
}

impl VaultStorage for FsVaultStorage {
    fn read_file(&self, relative: &str) -> Result<Vec<u8>> {
        Ok(std::fs::read(self.resolve(relative))?)
    }

    fn write_file(&self, relative: &str, data: &[u8]) -> Result<()> {
        let path = self.resolve(relative);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, data)?;
        Ok(())
    }

    fn list_dir(&self, relative: &str) -> Result<Vec<String>> {
        let path = self.resolve(relative);
        if !path.is_dir() {
            return Ok(Vec::new());
        }
        let mut names = Vec::new();
        for entry in std::fs::read_dir(path)? {
            let entry = entry?;
            names.push(entry.file_name().to_string_lossy().into_owned());
        }
        names.sort();
        Ok(names)
    }

    fn delete_tree(&self, relative: &str) -> Result<()> {
        let path = self.resolve(relative);
        if path.is_dir() {
            std::fs::remove_dir_all(path)?;
        } else if path.is_file() {
            std::fs::remove_file(path)?;
        }
        Ok(())
    }

    fn exists(&self, relative: &str) -> bool {
        self.resolve(relative).exists()
    }

    fn absolute_path(&self, relative: &str) -> PathBuf {
        self.resolve(relative)
    }
}

/// Refuse paths that escape the vault root.
pub fn ensure_child_path(root: &Path, path: &Path) -> Result<PathBuf> {
    let canonical_root = root
        .canonicalize()
        .unwrap_or_else(|_| root.to_path_buf());
    let full = if path.is_absolute() {
        path.to_path_buf()
    } else {
        root.join(path)
    };
    let canonical = full.canonicalize().unwrap_or(full);
    if !canonical.starts_with(&canonical_root) {
        return Err(UprivError::Io(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "path escapes vault root",
        )));
    }
    Ok(canonical)
}
