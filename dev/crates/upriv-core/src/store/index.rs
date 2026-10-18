//! Sealed logical tree (`store/index/root.idx.enc` and a byte-identical `.copy`).
//! Empty vault = no files. The primary file is the commit; the copy is written
//! first so a crash still leaves the previous primary in place.

#[allow(unused_imports)]
use crate::host_fs::HostFsQuery;
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
    /// Not sealed. What this session's writes left for close to look at.
    #[serde(skip)]
    pub writes: SessionWrites,
}

/// Most files appended from byte 0 at the same time that keep a running digest.
/// Past this the oldest stream is dropped and that file counts by its storage.
const MAX_DIGEST_STREAMS: usize = 16;

/// RAM-only bookkeeping of one open session, so close needs no extra disk reads.
#[derive(Clone)]
pub struct SessionWrites {
    /// Writers hash plaintext they already hold. Off when no close compares it.
    pub track_digests: bool,
    /// Blobs a range write or truncate left dead bytes in. Close packs only these.
    pub rewritten_blobs: std::collections::BTreeSet<String>,
    /// Running digest of files written in order from byte 0, by `file_id`.
    streams: Vec<DigestStream>,
}

#[derive(Clone)]
struct DigestStream {
    file_id: String,
    hasher: sha2::Sha256,
    len: u64,
}

impl Default for SessionWrites {
    fn default() -> Self {
        Self {
            track_digests: true,
            rewritten_blobs: Default::default(),
            streams: Vec::new(),
        }
    }
}

impl std::fmt::Debug for SessionWrites {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SessionWrites")
            .field("track_digests", &self.track_digests)
            .field("rewritten_blobs", &self.rewritten_blobs)
            .field("streams", &self.streams.len())
            .finish()
    }
}

/// Hasher state is not compared: two trackers over the same files and lengths
/// are the same bookkeeping.
impl PartialEq for SessionWrites {
    fn eq(&self, other: &Self) -> bool {
        self.track_digests == other.track_digests
            && self.rewritten_blobs == other.rewritten_blobs
            && self.streams.len() == other.streams.len()
            && self
                .streams
                .iter()
                .zip(&other.streams)
                .all(|(a, b)| a.file_id == b.file_id && a.len == b.len)
    }
}

impl Eq for SessionWrites {}

pub(crate) fn sha256_hex(hasher: sha2::Sha256) -> String {
    use sha2::Digest;
    format!("sha256:{:x}", hasher.finalize())
}

impl SessionWrites {
    /// The running digest of `file_id` when it covers exactly `len` bytes.
    pub(crate) fn take_stream(&mut self, file_id: &str, len: u64) -> Option<sha2::Sha256> {
        let at = self.streams.iter().position(|s| s.file_id == file_id)?;
        let stream = self.streams.remove(at);
        (stream.len == len).then_some(stream.hasher)
    }

    pub(crate) fn forget_stream(&mut self, file_id: &str) {
        self.streams.retain(|s| s.file_id != file_id);
    }

    /// A pack moved this file to a new blob without changing its bytes.
    pub(crate) fn moved_blob(&mut self, from: &str, to: &str) {
        if let Some(stream) = self.streams.iter_mut().find(|s| s.file_id == from) {
            stream.file_id = to.to_string();
        }
        self.rewritten_blobs.remove(from);
    }
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
    /// Plaintext digest for the close backup check, set by the write that
    /// already held the bytes. A digest bound to older storage is ignored.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_digest: Option<ContentDigest>,
}

/// SHA-256 of a file's plaintext, bound to the storage it was written to.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContentDigest {
    /// `sha256:<hex>` of the plaintext bytes.
    pub sha256: String,
    /// [`VaultNode::storage_tag`] when it was computed. A rewrite, pack, or
    /// truncate moves the tag, so a stale digest is never reused.
    pub storage: String,
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
            content_digest: None,
        }
    }

    pub fn dir(path: &str) -> Self {
        let now = crate::time::unix_millis();
        Self {
            path: path.to_string(),
            kind: VaultNodeKind::Dir,
            created_at: now,
            modified_at: now,
            content_digest: None,
        }
    }

    /// Where a file's ciphertext lives: blob id, size, chunk versions and
    /// offsets. Chunk AAD binds the id and versions, so the same tag means the
    /// same plaintext. `None` for a directory.
    pub fn storage_tag(&self) -> Option<String> {
        use sha2::{Digest, Sha256};
        let VaultNodeKind::File {
            file_id,
            size,
            chunk_versions,
            chunk_offsets,
        } = &self.kind
        else {
            return None;
        };
        let mut hasher = Sha256::new();
        hasher.update(file_id.as_bytes());
        hasher.update(size.to_le_bytes());
        for version in chunk_versions {
            hasher.update([0]);
            hasher.update(version.as_bytes());
        }
        for offset in chunk_offsets {
            hasher.update(offset.to_le_bytes());
        }
        Some(format!("sha256:{:x}", hasher.finalize()))
    }

    /// The plaintext digest when it still matches this file's storage.
    pub fn current_digest(&self) -> Option<&str> {
        let digest = self.content_digest.as_ref()?;
        (Some(digest.storage.as_str()) == self.storage_tag().as_deref())
            .then_some(digest.sha256.as_str())
    }

    /// Record `sha256` as the digest of this file's current storage.
    pub(crate) fn bind_digest(&mut self, sha256: String) {
        self.content_digest = self
            .storage_tag()
            .map(|storage| ContentDigest { sha256, storage });
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
            writes: SessionWrites::default(),
        }
    }

    pub fn clear_unsealed_holes(&mut self) {
        self.dead_until_seal.clear();
    }

    /// Keep `hasher` as the running digest of `file_id`, which now holds `len`
    /// bytes. Past the cap, the oldest stream becomes its file's digest now.
    pub(crate) fn put_digest_stream(&mut self, file_id: &str, hasher: sha2::Sha256, len: u64) {
        self.writes.forget_stream(file_id);
        if self.writes.streams.len() >= MAX_DIGEST_STREAMS {
            let oldest = self.writes.streams.remove(0);
            self.bind_stream(oldest);
        }
        self.writes.streams.push(DigestStream {
            file_id: file_id.to_string(),
            hasher,
            len,
        });
    }

    /// Before close seals the index: each running digest becomes its file's
    /// digest. Binding once here keeps appends from re-hashing the chunk list.
    pub(crate) fn settle_digest_streams(&mut self) {
        for stream in std::mem::take(&mut self.writes.streams) {
            self.bind_stream(stream);
        }
    }

    fn bind_stream(&mut self, stream: DigestStream) {
        let sha256 = sha256_hex(stream.hasher);
        for node in &mut self.nodes {
            let covers = node
                .as_file()
                .is_some_and(|(id, size, _)| id == stream.file_id && size == stream.len);
            if covers {
                node.bind_digest(sha256.clone());
            }
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

pub fn sealed_index_bytes(
    header: &VaultHeader,
    index_key: &[u8; INDEX_KEY_LEN],
    index: &VaultIndex,
) -> Result<Vec<u8>> {
    let aad = index_aad(header)?;
    let plain = encode_index(index)?;
    seal_index(index_key, &plain, &aad)
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
        crate::host_fs::create_dir_all(parent)?;
    }
    let sealed = sealed_index_bytes(header, index_key, index)?;
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
    let primary_raw = crate::host_fs::read(&primary_path).ok();
    let copy_raw = crate::host_fs::read(&copy_path).ok();
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
    #[allow(unused_imports)]
    use crate::host_fs::HostFsQuery;

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
        let original = crate::host_fs::read(&primary).unwrap();
        assert_eq!(crate::host_fs::read(&copy).unwrap(), original);

        crate::host_fs::write(&primary, b"torn").unwrap();
        super::super::open_store(&dir, b"index-copy-ok").unwrap();
        assert_eq!(crate::host_fs::read(&primary).unwrap(), original);
        assert_eq!(crate::host_fs::read(&copy).unwrap(), original);

        crate::host_fs::remove_file(&primary).unwrap();
        super::super::open_store(&dir, b"index-copy-ok").unwrap();
        assert_eq!(crate::host_fs::read(&primary).unwrap(), original);

        crate::host_fs::write(&primary, b"torn").unwrap();
        crate::host_fs::write(&copy, b"torn").unwrap();
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
        crate::host_fs::remove_file(&copy).unwrap();
        crate::host_fs::write(&primary, b"torn").unwrap();

        let err = super::super::open_store(&dir, b"index-copy-ok");
        assert!(matches!(err, Err(UprivError::VaultStoreInvalid { .. })));
        assert_eq!(crate::host_fs::read(&primary).unwrap(), b"torn");
        assert!(!copy.host_exists());
    }
}
