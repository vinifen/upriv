//! Sealed logical tree (`store/index/root.idx.enc`). Empty vault = no files.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::aead::{open_index, seal_index, INDEX_KEY_LEN};
use super::header::{index_aad, VaultHeader};
use crate::error::{Result, UprivError};
use crate::paths;

pub const INDEX_DIR_NAME: &str = "index";
pub const INDEX_FILE_NAME: &str = "root.idx.enc";
pub const DATA_DIR_NAME: &str = "data";

/// The sealed logical tree. This is the **only** place a logical name exists:
/// names never reach `store/data/` filenames and never enter a chunk AAD, so
/// rename and move are index-only edits that rewrite no ciphertext.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VaultIndex {
    pub format_version: u32,
    #[serde(default)]
    pub nodes: Vec<VaultNode>,
}

/// One logical entry — a file or a directory. Directories are stored explicitly
/// so an empty folder is representable and a mount can `stat` it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VaultNode {
    pub path: String,
    pub kind: VaultNodeKind,
    /// Unix epoch milliseconds (see `crate::time::unix_millis`).
    pub created_at: u64,
    pub modified_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum VaultNodeKind {
    Dir,
    File {
        file_id: String,
        size: u64,
        /// One entry per chunk, aligned with `chunk_index`. Regenerated whenever
        /// that chunk is rewritten and bound into its AAD, so a stale blob
        /// cannot be replayed without the index key.
        chunk_versions: Vec<String>,
    },
}

impl VaultNode {
    pub fn file(path: &str, file_id: String, size: u64, chunk_versions: Vec<String>) -> Self {
        let now = crate::time::unix_millis();
        Self {
            path: path.to_string(),
            kind: VaultNodeKind::File {
                file_id,
                size,
                chunk_versions,
            },
            created_at: now,
            modified_at: now,
        }
    }

    pub fn dir(path: &str) -> Self {
        let now = crate::time::unix_millis();
        Self {
            path: path.to_string(),
            kind: VaultNodeKind::Dir,
            created_at: now,
            modified_at: now,
        }
    }

    pub fn is_dir(&self) -> bool {
        matches!(self.kind, VaultNodeKind::Dir)
    }

    /// `(file_id, size, chunk_versions)` for a file node; `None` for a directory.
    pub fn as_file(&self) -> Option<(&str, u64, &[String])> {
        match &self.kind {
            VaultNodeKind::Dir => None,
            VaultNodeKind::File {
                file_id,
                size,
                chunk_versions,
            } => Some((file_id.as_str(), *size, chunk_versions.as_slice())),
        }
    }
}

impl VaultIndex {
    pub fn empty() -> Self {
        Self {
            format_version: super::header::FORMAT_VERSION,
            nodes: Vec::new(),
        }
    }

    pub fn find(&self, path: &str) -> Option<&VaultNode> {
        self.nodes.iter().find(|node| node.path == path)
    }

    pub fn find_mut(&mut self, path: &str) -> Option<&mut VaultNode> {
        self.nodes.iter_mut().find(|node| node.path == path)
    }

    /// Remove one node by exact path and report whether it existed.
    pub fn remove(&mut self, path: &str) -> bool {
        let before = self.nodes.len();
        self.nodes.retain(|node| node.path != path);
        self.nodes.len() != before
    }

    pub fn logical_paths(&self) -> Vec<String> {
        let mut paths: Vec<String> = self.nodes.iter().map(|node| node.path.clone()).collect();
        paths.sort();
        paths
    }
}

pub fn index_path(store_dir: impl AsRef<Path>) -> PathBuf {
    store_dir
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
    store_dir: impl AsRef<Path>,
    header: &VaultHeader,
    index_key: &[u8; INDEX_KEY_LEN],
    index: &VaultIndex,
) -> Result<()> {
    let path = index_path(&store_dir);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let aad = index_aad(header)?;
    let plain = encode_index(index)?;
    let sealed = seal_index(index_key, &plain, &aad)?;
    paths::write_bytes_atomic(&path, &sealed)
}

pub fn load_sealed_index(
    store_dir: impl AsRef<Path>,
    header: &VaultHeader,
    index_key: &[u8; INDEX_KEY_LEN],
) -> Result<VaultIndex> {
    let path = index_path(&store_dir);
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
