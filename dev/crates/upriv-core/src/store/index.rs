//! Sealed logical tree (`store/index/root.idx.enc` and a byte-identical `.copy`).
//! Empty vault = no files. The primary file is the commit; the copy is written
//! first so a crash still leaves the previous primary in place.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::aead::{open_index, seal_index, INDEX_KEY_LEN};
use super::header::{index_aad, VaultHeader};
use crate::error::{Result, UprivError};
use crate::paths;

pub const INDEX_DIR_NAME: &str = "index";
pub const INDEX_FILE_NAME: &str = "root.idx.enc";
pub const INDEX_COPY_FILE_NAME: &str = "root.idx.enc.copy";
pub const DATA_DIR_NAME: &str = "data";

/// Ciphertext the in-memory index no longer names, but the sealed index might.
/// Kept until the next successful seal so a rewrite cannot overwrite it early.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeadBlobSpan {
    pub file_id: String,
    pub offset: u64,
    pub len: u64,
}

/// The sealed logical tree. This is the **only** place a logical name exists:
/// names never reach `store/data/` filenames and never enter a chunk AAD, so
/// rename and move are index-only edits that rewrite no ciphertext.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VaultIndex {
    pub format_version: u32,
    #[serde(default)]
    pub nodes: Vec<VaultNode>,
    /// Not sealed. Cleared after the index that abandoned these spans is flushed.
    #[serde(skip)]
    pub dead_until_seal: Vec<DeadBlobSpan>,
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
        /// Byte offset of that chunk inside `store/data/<file_id>.blob`.
        /// A rewrite stores the new ciphertext in a free span, or appends one.
        /// Bytes the index no longer names stay until that index is sealed,
        /// then they are packed when the waste is large enough to copy.
        chunk_offsets: Vec<u64>,
    },
}

impl VaultNode {
    pub fn file(
        path: &str,
        file_id: String,
        size: u64,
        chunk_versions: Vec<String>,
        chunk_offsets: Vec<u64>,
    ) -> Self {
        let now = crate::time::unix_millis();
        Self {
            path: path.to_string(),
            kind: VaultNodeKind::File {
                file_id,
                size,
                chunk_versions,
                chunk_offsets,
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
                ..
            } => Some((file_id.as_str(), *size, chunk_versions.as_slice())),
        }
    }

    /// Byte offset of each chunk inside `store/data/<file_id>.blob`.
    pub fn chunk_offsets(&self) -> Option<&[u64]> {
        match &self.kind {
            VaultNodeKind::Dir => None,
            VaultNodeKind::File { chunk_offsets, .. } => Some(chunk_offsets.as_slice()),
        }
    }
}

impl VaultIndex {
    pub fn empty() -> Self {
        Self {
            format_version: super::header::FORMAT_VERSION,
            nodes: Vec::new(),
            dead_until_seal: Vec::new(),
        }
    }

    pub fn clear_unsealed_holes(&mut self) {
        self.dead_until_seal.clear();
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

pub fn index_copy_path(store_dir: impl AsRef<Path>) -> PathBuf {
    store_dir
        .as_ref()
        .join(INDEX_DIR_NAME)
        .join(INDEX_COPY_FILE_NAME)
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
    let store_dir = store_dir.as_ref();
    let path = index_path(store_dir);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let aad = index_aad(header)?;
    let plain = encode_index(index)?;
    let sealed = seal_index(index_key, &plain, &aad)?;
    // Copy first. The primary file is the commit, so a crash before that write
    // still opens the previous tree.
    paths::write_bytes_atomic(&index_copy_path(store_dir), &sealed)?;
    paths::write_bytes_atomic(&path, &sealed)
}

pub fn load_sealed_index(
    store_dir: impl AsRef<Path>,
    header: &VaultHeader,
    index_key: &[u8; INDEX_KEY_LEN],
) -> Result<VaultIndex> {
    let store_dir = store_dir.as_ref();
    let primary_path = index_path(store_dir);
    let copy_path = index_copy_path(store_dir);
    let primary_raw = std::fs::read(&primary_path).ok();
    let copy_raw = std::fs::read(&copy_path).ok();
    let aad = index_aad(header)?;
    if let Some(raw) = primary_raw.as_deref() {
        if let Ok(index) = unseal_index(&primary_path, index_key, raw, &aad) {
            if copy_raw.as_deref() != Some(raw) {
                paths::write_bytes_atomic(&copy_path, raw)?;
                log_index_restored(store_dir, INDEX_COPY_FILE_NAME);
            }
            return Ok(index);
        }
    }
    if let Some(raw) = copy_raw.as_deref() {
        if let Ok(index) = unseal_index(&copy_path, index_key, raw, &aad) {
            paths::write_bytes_atomic(&primary_path, raw)?;
            log_index_restored(store_dir, INDEX_FILE_NAME);
            return Ok(index);
        }
    }
    Err(UprivError::VaultStoreInvalid {
        path: primary_path,
        detail: "missing index".into(),
    })
}

fn unseal_index(
    path: &Path,
    index_key: &[u8; INDEX_KEY_LEN],
    sealed: &[u8],
    aad: &[u8],
) -> Result<VaultIndex> {
    let plain = open_index(index_key, sealed, aad)?;
    let index = decode_index(&plain)?;
    if index.format_version != super::header::FORMAT_VERSION {
        return Err(UprivError::VaultStoreInvalid {
            path: path.to_path_buf(),
            detail: format!("unsupported index format_version {}", index.format_version),
        });
    }
    Ok(index)
}

fn log_index_restored(store_dir: &Path, file_name: &str) {
    let id = store_dir
        .parent()
        .and_then(|parent| parent.file_name())
        .and_then(|name| name.to_str())
        .unwrap_or("");
    crate::logging::log_event(
        crate::logging::LogLevel::Warn,
        "vault_index_restored",
        &[("id", id), ("file", file_name)],
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_node_without_chunk_offsets_does_not_decode() {
        let json = br#"{
            "format_version": 1,
            "nodes": [{
                "path": "note.txt",
                "kind": {
                    "type": "file",
                    "file_id": "00000000-0000-0000-0000-000000000001",
                    "size": 1,
                    "chunk_versions": ["v1"]
                },
                "created_at": 1,
                "modified_at": 1
            }]
        }"#;
        let err = decode_index(json).unwrap_err();
        assert!(matches!(err, UprivError::VaultStoreInvalid { .. }));
    }

    #[test]
    fn a_damaged_primary_index_is_restored_from_the_copy() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("store");
        super::super::create_empty_store(
            &dir,
            b"index-copy-ok",
            super::super::KdfUnlockPreset::M32,
        )
        .unwrap();
        let primary = index_path(&dir);
        let copy = index_copy_path(&dir);
        let original = std::fs::read(&primary).unwrap();
        assert_eq!(std::fs::read(&copy).unwrap(), original);

        std::fs::write(&primary, b"torn").unwrap();
        super::super::open_store(&dir, b"index-copy-ok").unwrap();
        assert_eq!(std::fs::read(&primary).unwrap(), original);
        assert_eq!(std::fs::read(&copy).unwrap(), original);

        std::fs::remove_file(&primary).unwrap();
        super::super::open_store(&dir, b"index-copy-ok").unwrap();
        assert_eq!(std::fs::read(&primary).unwrap(), original);

        std::fs::write(&primary, b"torn").unwrap();
        std::fs::write(&copy, b"torn").unwrap();
        assert!(super::super::open_store(&dir, b"index-copy-ok").is_err());
    }

    #[test]
    fn a_missing_copy_does_not_repair_a_broken_primary() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("store");
        super::super::create_empty_store(
            &dir,
            b"index-copy-ok",
            super::super::KdfUnlockPreset::M32,
        )
        .unwrap();
        let primary = index_path(&dir);
        let copy = index_copy_path(&dir);
        std::fs::remove_file(&copy).unwrap();
        std::fs::write(&primary, b"torn").unwrap();

        let err = super::super::open_store(&dir, b"index-copy-ok");
        assert!(matches!(err, Err(UprivError::VaultStoreInvalid { .. })));
        assert_eq!(std::fs::read(&primary).unwrap(), b"torn");
        assert!(!copy.exists());
    }
}
