use std::fs;
use std::path::{Path, PathBuf};

use walkdir::WalkDir;

use crate::error::{Result, UprivError};

pub fn compute_store_hash(store_dir: &Path) -> Result<String> {
    let mut paths = Vec::new();
    if !store_dir.is_dir() {
        return Ok("sha256:".to_string());
    }
    for entry in WalkDir::new(store_dir).into_iter().filter_map(|entry| entry.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }
        let rel = entry
            .path()
            .strip_prefix(store_dir)
            .unwrap_or(entry.path())
            .to_string_lossy()
            .replace('\\', "/");
        if rel == "vault.header" {
            continue;
        }
        paths.push((rel, entry.path().to_path_buf()));
    }
    paths.sort_by(|a, b| a.0.cmp(&b.0));

    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    for (rel, path) in paths {
        hasher.update(rel.as_bytes());
        hasher.update(&fs::read(path)?);
    }
    Ok(format!("sha256:{:x}", hasher.finalize()))
}

pub fn ensure_store_dirs(store_dir: &Path) -> Result<()> {
    fs::create_dir_all(store_dir.join("index"))?;
    fs::create_dir_all(store_dir.join("data"))?;
    Ok(())
}

pub fn chunk_path(store_dir: &Path, chunk_id: &str) -> PathBuf {
    super::header::chunk_path(store_dir, chunk_id)
}

pub fn index_path(store_dir: &Path) -> PathBuf {
    super::header::index_path(store_dir)
}

pub fn reject_demo_store(store_dir: &Path) -> Result<()> {
    let index = index_path(store_dir);
    if index.is_file() {
        let bytes = fs::read(&index)?;
        if super::header::is_demo_blob(&bytes) {
            return Err(UprivError::InvalidStore(
                "demo placeholder store (ENCv1:) — create a new encrypted_dir vault or regenerate store"
                    .into(),
            ));
        }
    }
    Ok(())
}
