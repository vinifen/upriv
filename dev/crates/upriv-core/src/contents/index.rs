//! Sealed logical tree (`contents/index/root.idx.enc`). Empty vault = no files.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::aead::{open_index, seal_index, INDEX_KEY_LEN};
use super::header::{index_aad, VaultHeader};
use crate::error::{Result, UprivError};
use crate::paths;

pub const INDEX_DIR_NAME: &str = "index";
pub const INDEX_FILE_NAME: &str = "root.idx.enc";
pub const DATA_DIR_NAME: &str = "data";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VaultIndex {
    pub format_version: u32,
    #[serde(default)]
    pub entries: Vec<VaultIndexEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VaultIndexEntry {
    pub file_id: String,
    pub path: String,
    pub size: u64,
}

impl VaultIndex {
    pub fn empty() -> Self {
        Self {
            format_version: super::header::FORMAT_VERSION,
            entries: Vec::new(),
        }
    }

    pub fn logical_paths(&self) -> Vec<String> {
        let mut paths: Vec<String> = self.entries.iter().map(|e| e.path.clone()).collect();
        paths.sort();
        paths
    }
}

pub fn index_path(contents_dir: impl AsRef<Path>) -> PathBuf {
    contents_dir
        .as_ref()
        .join(INDEX_DIR_NAME)
        .join(INDEX_FILE_NAME)
}

pub fn encode_index(index: &VaultIndex) -> Result<Vec<u8>> {
    serde_json::to_vec(index).map_err(|error| UprivError::VaultStoreInvalid {
        path: PathBuf::from(INDEX_FILE_NAME),
        detail: format!("serialize index: {error}"),
    })
}

pub fn decode_index(bytes: &[u8]) -> Result<VaultIndex> {
    serde_json::from_slice(bytes).map_err(|error| UprivError::VaultStoreInvalid {
        path: PathBuf::from(INDEX_FILE_NAME),
        detail: format!("invalid index: {error}"),
    })
}

pub fn save_sealed_index(
    contents_dir: impl AsRef<Path>,
    header: &VaultHeader,
    index_key: &[u8; INDEX_KEY_LEN],
    index: &VaultIndex,
) -> Result<()> {
    let path = index_path(&contents_dir);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let aad = index_aad(header)?;
    let plain = encode_index(index)?;
    let sealed = seal_index(index_key, &plain, &aad)?;
    paths::write_bytes_atomic(&path, &sealed)
}

pub fn load_sealed_index(
    contents_dir: impl AsRef<Path>,
    header: &VaultHeader,
    index_key: &[u8; INDEX_KEY_LEN],
) -> Result<VaultIndex> {
    let path = index_path(&contents_dir);
    if !path.is_file() {
        return Err(UprivError::VaultStoreInvalid {
            path: path.clone(),
            detail: "missing index".into(),
        });
    }
    let blob = std::fs::read(&path)?;
    let aad = index_aad(header)?;
    let plain = open_index(index_key, &blob, &aad)?;
    let index = decode_index(&plain)?;
    if index.format_version != super::header::FORMAT_VERSION {
        return Err(UprivError::VaultStoreInvalid {
            path,
            detail: format!("unsupported index format_version {}", index.format_version),
        });
    }
    Ok(index)
}
