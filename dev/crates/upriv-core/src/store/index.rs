//! Sealed logical tree (`store/index/root.idx.enc` and a byte-identical `.copy`).
//! Empty vault = no files. The primary file is the commit; the copy is written
//! first so a crash still leaves the previous primary in place.

#[allow(unused_imports)]
use crate::host_fs::HostFsQuery;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::aead::{open_index, seal_index, INDEX_KEY_LEN};
use super::chunk::validate_logical_path;
use super::header::{index_aad, VaultHeader};
use super::tree::parent_logical;
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
///
/// Reading one checks the tree rules ([`VaultIndex::check_tree`]): a sealed
/// tree that breaks them does not open, like one whose tag fails.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(try_from = "IndexFile")]
pub struct VaultIndex {
    pub format_version: u32,
    /// How many times this tree was sealed to the store: each seal counts one
    /// more ([`save_sealed_index`]). A recovery record carries the number of
    /// the seal it was written for, so a rebuild can tell the newer of two
    /// records for one path without trusting any clock.
    pub saves: u64,
    /// Every file and folder, in the order they joined the tree. Changed only
    /// through the methods below, which keep `lookup` in step with it.
    nodes: Vec<VaultNode>,
    /// Blobs an unlock found in `data/` with no file naming them, moved to the
    /// vault's `held/` folder. Not part of the tree.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub held: Vec<HeldBlob>,
    /// Blobs (by file id) the tree stopped naming in a seal whose folder could
    /// not be flushed: a power cut may bring back the index that names them,
    /// so they stay in `data/` until a seal that flushes, which deletes them.
    /// Sealed, so a session that ends first hands them to the next one, whose
    /// unlock leaves them in `data/` rather than set them aside.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub released: Vec<String>,
    /// Not sealed. Cleared after the index that abandoned these spans is flushed.
    #[serde(skip)]
    pub dead_until_seal: Vec<DeadBlobSpan>,
    /// Not sealed. What this session's writes left for close to look at.
    #[serde(skip)]
    pub writes: SessionWrites,
    /// Not sealed. Where each path sits in `nodes`.
    #[serde(skip)]
    lookup: PathLookup,
}

/// The sealed fields of [`VaultIndex`], as the index file holds them.
#[derive(Deserialize)]
struct IndexFile {
    format_version: u32,
    #[serde(default)]
    saves: u64,
    #[serde(default)]
    nodes: Vec<VaultNode>,
    #[serde(default)]
    held: Vec<HeldBlob>,
    #[serde(default)]
    released: Vec<String>,
}

impl TryFrom<IndexFile> for VaultIndex {
    type Error = String;

    fn try_from(file: IndexFile) -> std::result::Result<Self, String> {
        let lookup = PathLookup::of(&file.nodes);
        let index = Self {
            format_version: file.format_version,
            saves: file.saves,
            nodes: file.nodes,
            held: file.held,
            released: file.released,
            dead_until_seal: Vec::new(),
            writes: SessionWrites::default(),
            lookup,
        };
        index.check_tree()?;
        Ok(index)
    }
}

/// The lookup is derived from the nodes, so it takes no part in equality.
impl PartialEq for VaultIndex {
    fn eq(&self, other: &Self) -> bool {
        self.format_version == other.format_version
            && self.saves == other.saves
            && self.nodes == other.nodes
            && self.held == other.held
            && self.released == other.released
            && self.dead_until_seal == other.dead_until_seal
            && self.writes == other.writes
    }
}

impl Eq for VaultIndex {}

/// Where each node sits in [`VaultIndex`]'s list, so finding a path is one
/// probe, not a scan of every node. It is keyed by a hash of the path and
/// holds no second copy of any name. A hash two paths share is marked
/// [`Slot::Shared`], and a lookup that meets it scans the list, so a lookup
/// always answers what the list holds.
#[derive(Clone, Default)]
struct PathLookup {
    hasher: std::collections::hash_map::RandomState,
    slots: std::collections::HashMap<u64, Slot>,
}

#[derive(Clone, Copy)]
enum Slot {
    /// The one node whose path has this hash, by its place in the list.
    At(usize),
    /// More than one node has a path with this hash.
    Shared,
}

impl PathLookup {
    fn of(nodes: &[VaultNode]) -> Self {
        let mut lookup = Self::default();
        lookup.slots.reserve(nodes.len());
        for (at, node) in nodes.iter().enumerate() {
            lookup.insert(&node.path, at);
        }
        lookup
    }

    fn key(&self, path: &str) -> u64 {
        use std::hash::BuildHasher;
        self.hasher.hash_one(path)
    }

    fn insert(&mut self, path: &str, at: usize) {
        let key = self.key(path);
        self.slots
            .entry(key)
            .and_modify(|slot| *slot = Slot::Shared)
            .or_insert(Slot::At(at));
    }

    /// Drop the key of `path`, the node at `at`. A key two paths share stays
    /// shared, so its lookups keep scanning.
    fn forget(&mut self, at: usize, path: &str) {
        let key = self.key(path);
        if matches!(self.slots.get(&key), Some(Slot::At(place)) if *place == at) {
            self.slots.remove(&key);
        }
    }

    /// The nodes in `removed` left the list: each one's place before the
    /// removal, ascending, with its path. Their keys go, and every later node
    /// moves down one place for each removed node before it. Nothing is
    /// hashed but the removed paths.
    fn remove(&mut self, removed: &[(usize, &str)]) {
        for (at, path) in removed {
            self.forget(*at, path);
        }
        for slot in self.slots.values_mut() {
            if let Slot::At(at) = slot {
                let before = removed.partition_point(|(gone, _)| *gone < *at);
                *at -= before;
            }
        }
    }

    fn find(&self, nodes: &[VaultNode], path: &str) -> Option<usize> {
        match self.slots.get(&self.key(path))? {
            Slot::At(at) => nodes
                .get(*at)
                .is_some_and(|node| node.path == path)
                .then_some(*at),
            Slot::Shared => nodes.iter().position(|node| node.path == path),
        }
    }
}

impl std::fmt::Debug for PathLookup {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PathLookup")
            .field("slots", &self.slots.len())
            .finish()
    }
}

/// Most files appended from byte 0 at the same time that keep a running digest.
/// Past this the oldest stream is bound to its file as it is; a later append
/// to that file counts by its storage.
const MAX_DIGEST_STREAMS: usize = 16;

/// RAM-only bookkeeping of one open session, so close needs no extra disk reads.
#[derive(Clone)]
pub struct SessionWrites {
    /// Writers hash plaintext they already hold. Off when no close compares it.
    pub track_digests: bool,
    /// Blobs a range write or truncate left dead bytes in. Close packs only these.
    pub rewritten_blobs: std::collections::BTreeSet<String>,
    /// The newest recovery record of each blob this session opened for a
    /// write, `(start, length)` with its footer, by `file_id`. Found from the
    /// blob's last bytes, and kept here once chunks are written after it, so
    /// chunk placement still keeps off it ([`super::record`]).
    pub(crate) records: std::collections::HashMap<String, (u64, u64)>,
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
            records: Default::default(),
            streams: Vec::new(),
        }
    }
}

impl std::fmt::Debug for SessionWrites {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SessionWrites")
            .field("track_digests", &self.track_digests)
            .field("rewritten_blobs", &self.rewritten_blobs)
            .field("records", &self.records.len())
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
            && self.records == other.records
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
        self.records.remove(from);
    }
}

/// What keeps a file from being read in full. The file stays in the tree with
/// this mark until the person deletes it, it is written again, or a read of
/// the whole file succeeds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FileProblem {
    /// Its blob is gone, or ends before data the index names.
    Missing,
    /// Part of its data does not pass the chunk tag.
    Damaged,
}

impl FileProblem {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Missing => "missing",
            Self::Damaged => "damaged",
        }
    }
}

/// A blob kept in the vault's `held/` folder because no file of the tree
/// names it. Only the person deletes it or puts it back.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HeldBlob {
    /// Its file name in `held/`.
    pub name: String,
    /// Its length in bytes.
    pub size: u64,
    /// When the unlock moved it there, in Unix epoch milliseconds.
    pub held_at: u64,
    /// The file it holds, as something else of this vault named it: the other
    /// index file, the record the blob carries, or the index in a backup zip.
    /// `None` when none does, so it cannot be read.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file: Option<VaultNode>,
}

/// Bytes in a [`ChunkVersion`].
pub(crate) const CHUNK_VERSION_LEN: usize = 8;

/// The random value one write of a chunk is sealed under. Each write draws a
/// new one and [`super::header::chunk_aad`] binds it, so a stale copy of that
/// chunk does not open. Held as its 8 bytes; the index and the AAD carry it as
/// 16 lowercase hex digits.
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct ChunkVersion([u8; CHUNK_VERSION_LEN]);

impl ChunkVersion {
    pub(crate) const fn from_bytes(bytes: [u8; CHUNK_VERSION_LEN]) -> Self {
        Self(bytes)
    }

    pub(crate) const fn as_bytes(&self) -> &[u8; CHUNK_VERSION_LEN] {
        &self.0
    }

    /// The 16 lowercase hex digits the index and the AAD carry.
    pub fn hex(self) -> [u8; CHUNK_VERSION_LEN * 2] {
        const DIGITS: &[u8; 16] = b"0123456789abcdef";
        let mut out = [0u8; CHUNK_VERSION_LEN * 2];
        for (pair, byte) in out.chunks_exact_mut(2).zip(self.0) {
            pair[0] = DIGITS[usize::from(byte >> 4)];
            pair[1] = DIGITS[usize::from(byte & 0x0f)];
        }
        out
    }

    /// Read 16 lowercase hex digits; anything else is not a version. An index
    /// holds one per chunk, so this runs millions of times on a large vault.
    fn parse(hex: &str) -> Option<Self> {
        /// Each byte's value as a lowercase hex digit; 0xff where it is none.
        const VALUES: [u8; 256] = {
            let mut values = [0xff; 256];
            let mut digit = 0;
            while digit < 16 {
                values[b"0123456789abcdef"[digit] as usize] = digit as u8;
                digit += 1;
            }
            values
        };
        let hex = hex.as_bytes();
        if hex.len() != CHUNK_VERSION_LEN * 2 {
            return None;
        }
        let mut bytes = [0u8; CHUNK_VERSION_LEN];
        for (byte, pair) in bytes.iter_mut().zip(hex.chunks_exact(2)) {
            let (high, low) = (VALUES[usize::from(pair[0])], VALUES[usize::from(pair[1])]);
            if (high | low) > 0x0f {
                return None;
            }
            *byte = (high << 4) | low;
        }
        Some(Self(bytes))
    }
}

impl std::fmt::Display for ChunkVersion {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let hex = self.hex();
        f.write_str(std::str::from_utf8(&hex).map_err(|_| std::fmt::Error)?)
    }
}

impl std::fmt::Debug for ChunkVersion {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        std::fmt::Display::fmt(self, f)
    }
}

impl Serialize for ChunkVersion {
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        serializer.collect_str(self)
    }
}

impl<'de> Deserialize<'de> for ChunkVersion {
    fn deserialize<D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> std::result::Result<Self, D::Error> {
        struct HexVisitor;
        impl serde::de::Visitor<'_> for HexVisitor {
            type Value = ChunkVersion;

            fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str("16 lowercase hex digits")
            }

            fn visit_str<E: serde::de::Error>(
                self,
                hex: &str,
            ) -> std::result::Result<ChunkVersion, E> {
                ChunkVersion::parse(hex)
                    .ok_or_else(|| E::invalid_value(serde::de::Unexpected::Str(hex), &self))
            }
        }
        deserializer.deserialize_str(HexVisitor)
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
    /// Set when a read found this file's data missing or damaged. Sealed with
    /// the index so the mark stays across sessions; not vault content.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub problem: Option<FileProblem>,
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
        chunk_versions: Vec<ChunkVersion>,
        /// Byte offset of that chunk inside `store/data/<hh>/<file_id>.blob`.
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
        chunk_versions: Vec<ChunkVersion>,
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
            problem: None,
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
            problem: None,
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
            hasher.update(version.hex());
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
    pub fn as_file(&self) -> Option<(&str, u64, &[ChunkVersion])> {
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

    /// Byte offset of each chunk inside `store/data/<hh>/<file_id>.blob`.
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
            saves: 0,
            nodes: Vec::new(),
            held: Vec::new(),
            released: Vec::new(),
            dead_until_seal: Vec::new(),
            writes: SessionWrites::default(),
            lookup: PathLookup::default(),
        }
    }

    /// Every file and folder of the tree.
    pub fn nodes(&self) -> &[VaultNode] {
        &self.nodes
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
        self.position(path).map(|at| &self.nodes[at])
    }

    /// The node at `path`, to change anything but its path: only
    /// [`Self::move_tree`] moves a node, so the lookup stays in step.
    pub(crate) fn find_mut(&mut self, path: &str) -> Option<&mut VaultNode> {
        self.position(path).map(|at| &mut self.nodes[at])
    }

    fn position(&self, path: &str) -> Option<usize> {
        let at = self.lookup.find(&self.nodes, path);
        #[cfg(all(test, debug_assertions))]
        assert_eq!(
            at,
            self.nodes.iter().position(|node| node.path == path),
            "the lookup answers what the list holds for {path:?}"
        );
        at
    }

    /// Add `node` at a path no node has.
    pub(crate) fn push(&mut self, node: VaultNode) {
        debug_assert!(self.find(&node.path).is_none(), "{} is taken", node.path);
        self.lookup.insert(&node.path, self.nodes.len());
        self.nodes.push(node);
    }

    /// Add `node`, or put it in the place of the node that has its path.
    pub(crate) fn put(&mut self, node: VaultNode) {
        match self.position(&node.path) {
            Some(at) => self.nodes[at] = node,
            None => self.push(node),
        }
    }

    /// Take `path` and everything under it out of the tree. Returns what was
    /// taken, in tree order.
    pub(crate) fn remove_tree(&mut self, path: &str) -> Vec<VaultNode> {
        let prefix = format!("{path}/");
        let mut places = Vec::new();
        let mut removed = Vec::new();
        let mut kept = Vec::with_capacity(self.nodes.len());
        for (at, node) in std::mem::take(&mut self.nodes).into_iter().enumerate() {
            if node.path == path || node.path.starts_with(&prefix) {
                places.push(at);
                removed.push(node);
            } else {
                kept.push(node);
            }
        }
        self.nodes = kept;
        let gone: Vec<(usize, &str)> = places
            .into_iter()
            .zip(removed.iter().map(|node| node.path.as_str()))
            .collect();
        self.lookup.remove(&gone);
        removed
    }

    /// Move `from` and everything under it to `to`, marking each one modified
    /// at `now`. The caller checked that `to` is free. Each moved node keeps
    /// its place; only the moved paths are hashed again.
    pub(crate) fn move_tree(&mut self, from: &str, to: &str, now: u64) {
        let prefix = format!("{from}/");
        let mut moved: Vec<(usize, String)> = Vec::new();
        for (at, node) in self.nodes.iter_mut().enumerate() {
            let path = if node.path == from {
                to.to_string()
            } else if let Some(rest) = node.path.strip_prefix(&prefix) {
                format!("{to}/{rest}")
            } else {
                continue;
            };
            moved.push((at, std::mem::replace(&mut node.path, path)));
            node.modified_at = now;
        }
        // Every old key goes before any new one comes, so none is mistaken
        // for the other.
        for (at, old) in &moved {
            self.lookup.forget(*at, old);
        }
        for (at, _) in &moved {
            self.lookup.insert(&self.nodes[*at].path, *at);
        }
    }

    /// Each file's problem mark becomes what `mark` returns for it; returning
    /// the file's own mark keeps it.
    pub(crate) fn mark_files(&mut self, mut mark: impl FnMut(&VaultNode) -> Option<FileProblem>) {
        for node in &mut self.nodes {
            if node.as_file().is_some() {
                node.problem = mark(node);
            }
        }
    }

    /// Record what keeps the file at `path` from being read in full, or clear
    /// it with `None`. True when the mark changed. A folder or a missing path
    /// keeps no mark.
    pub fn mark_problem(&mut self, path: &str, problem: Option<FileProblem>) -> bool {
        match self.find_mut(path) {
            Some(node) if node.as_file().is_some() && node.problem != problem => {
                node.problem = problem;
                true
            }
            _ => false,
        }
    }

    /// The rules every tree Upriv seals keeps: each path is a valid store path
    /// ([`validate_logical_path`]: no `.` or `..` part, nothing absolute) that
    /// one node holds, the folder above each node is a folder node, and no two
    /// files name the same blob. Every edit keeps them, so a sealed tree that
    /// breaks one was not made by these edits: reading it fails, and no path
    /// in it reaches a plaintext folder or an export. The error names the node
    /// by its place in the list, never by its path, which may reach a log.
    pub(crate) fn check_tree(&self) -> std::result::Result<(), String> {
        let is_folder = |path: &str| {
            self.lookup
                .find(&self.nodes, path)
                .is_some_and(|at| self.nodes[at].is_dir())
        };
        let mut blobs: HashSet<&str> = HashSet::with_capacity(self.nodes.len());
        for (at, node) in self.nodes.iter().enumerate() {
            let problem = if validate_logical_path(&node.path).is_err() {
                "not a valid store path"
            } else if self.lookup.find(&self.nodes, &node.path) != Some(at) {
                "a path another node holds"
            } else if parent_logical(&node.path).is_some_and(|parent| !is_folder(parent)) {
                "no folder above it"
            } else if node
                .as_file()
                .is_some_and(|(file_id, _, _)| !blobs.insert(file_id))
            {
                "a blob another file names"
            } else {
                continue;
            };
            return Err(format!("node {at}: {problem}"));
        }
        Ok(())
    }

    /// Every path of the tree is where the lookup says. Each save runs this
    /// in debug test builds, and each lookup checks itself against a scan.
    #[cfg(test)]
    pub(crate) fn assert_lookup(&self) {
        for (at, node) in self.nodes.iter().enumerate() {
            assert_eq!(
                self.lookup.find(&self.nodes, &node.path),
                Some(at),
                "the lookup holds {:?} where the list does",
                node.path
            );
        }
    }

    /// Remove the node at `path`, and only it, reporting whether it existed.
    pub(crate) fn remove(&mut self, path: &str) -> bool {
        let Some(at) = self.position(path) else {
            return false;
        };
        let node = self.nodes.remove(at);
        self.lookup.remove(&[(at, node.path.as_str())]);
        true
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
    // Each save in debug test builds proves the edits kept the tree rules, so
    // the next read does not refuse a tree they made.
    #[cfg(all(test, debug_assertions))]
    {
        index.assert_lookup();
        if let Err(problem) = index.check_tree() {
            panic!("the tree keeps its rules: {problem}");
        }
    }
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

/// How a seal reached the disk.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Sealed {
    /// The new index is in place and flushed.
    Flushed,
    /// The new primary index is in place, but its folder could not be
    /// flushed, so a power cut may still bring the previous index back. Keep
    /// every byte the previous index names until a later seal flushes.
    Unflushed,
}

/// Seal `index` into both index files and return the bytes written. The seal
/// counts one more save first ([`VaultIndex::saves`]); a seal that fails keeps
/// that count, so every later seal has a higher number than the records any
/// earlier attempt wrote. An error means the primary file is still the
/// previous index, so nothing changed for the next open. A primary in place
/// but not flushed is [`Sealed::Unflushed`]; the caller logs it
/// ([`log_index_unflushed`]), since only it knows whether this is a save or
/// the index written again right after one.
pub fn save_sealed_index(
    store_dir: impl AsRef<Path>,
    header: &VaultHeader,
    index_key: &[u8; INDEX_KEY_LEN],
    index: &mut VaultIndex,
) -> Result<(Vec<u8>, Sealed)> {
    let store_dir = store_dir.as_ref();
    let path = index_path(store_dir);
    if let Some(parent) = path.parent() {
        crate::host_fs::create_dir_all(parent)?;
    }
    index.saves = index.saves.saturating_add(1);
    let sealed = sealed_index_bytes(header, index_key, index)?;
    // Copy first. The primary file is the commit, so a crash before that write
    // still opens the previous tree. Both live in one folder: once its flush
    // failed for the copy, a later flush that succeeds proves nothing, so the
    // whole seal is unflushed.
    let copy_flushed =
        match paths::write_bytes_atomic_reporting(&index_copy_path(store_dir), &sealed) {
            Ok(()) => true,
            Err(paths::AtomicWriteError::Unflushed(_)) => false,
            Err(paths::AtomicWriteError::NotWritten(error)) => return Err(error),
        };
    let primary_flushed = match paths::write_bytes_atomic_reporting(&path, &sealed) {
        Ok(()) => true,
        Err(paths::AtomicWriteError::Unflushed(_)) => false,
        Err(paths::AtomicWriteError::NotWritten(error)) => return Err(error),
    };
    if copy_flushed && primary_flushed {
        return Ok((sealed, Sealed::Flushed));
    }
    Ok((sealed, Sealed::Unflushed))
}

/// [`save_sealed_index`] for a store being made: an index that may not
/// survive a power cut fails the creation.
pub(crate) fn save_new_sealed_index(
    store_dir: &Path,
    header: &VaultHeader,
    index_key: &[u8; INDEX_KEY_LEN],
    index: &mut VaultIndex,
) -> Result<()> {
    match save_sealed_index(store_dir, header, index_key, index)? {
        (_, Sealed::Flushed) => Ok(()),
        (_, Sealed::Unflushed) => {
            Err(std::io::Error::other("the index folder could not be flushed").into())
        }
    }
}

/// The tree a store opens with, and the tree in the copy file when that file
/// opens too but holds another one: a seal that stopped after writing its
/// copy, so its blobs may be the newest bytes of some files.
pub struct LoadedIndex {
    pub index: VaultIndex,
    pub other_copy: Option<VaultIndex>,
}

/// Open the primary index, or the copy when the primary does not open, and
/// write a file that does not open back from the one that does. A copy that
/// opens but holds another tree stays as it is and is handed back: the unlock
/// that keeps its blobs ([`super::held`]) reads it, and the next seal
/// replaces it.
///
/// When neither file opens, the error is [`UprivError::VaultIndexUnreadable`]
/// with why the primary was refused (the copy's when there is no primary): a
/// tag that fails, or a tree that breaks its rules. "Missing" only when
/// neither file is there. The header opened, so the blobs can still rebuild
/// the tree (`vault::rebuild`).
pub fn load_index_files(
    store_dir: impl AsRef<Path>,
    header: &VaultHeader,
    index_key: &[u8; INDEX_KEY_LEN],
) -> Result<LoadedIndex> {
    let store_dir = store_dir.as_ref();
    let primary_path = index_path(store_dir);
    let copy_path = index_copy_path(store_dir);
    let primary_raw = crate::host_fs::read(&primary_path).ok();
    let copy_raw = crate::host_fs::read(&copy_path).ok();
    let aad = index_aad(header)?;
    let mut refused = None;
    if let Some(raw) = primary_raw.as_deref() {
        match unseal_index(&primary_path, index_key, raw, &aad) {
            Ok(index) => {
                if copy_raw.as_deref() == Some(raw) {
                    return Ok(LoadedIndex {
                        index,
                        other_copy: None,
                    });
                }
                let other_copy = copy_raw
                    .as_deref()
                    .and_then(|copy| unseal_index(&copy_path, index_key, copy, &aad).ok());
                if other_copy.is_none() {
                    paths::write_bytes_atomic(&copy_path, raw)?;
                    log_index_restored(store_dir, INDEX_COPY_FILE_NAME);
                }
                return Ok(LoadedIndex { index, other_copy });
            }
            Err(error) => refused = Some(error),
        }
    }
    if let Some(raw) = copy_raw.as_deref() {
        match unseal_index(&copy_path, index_key, raw, &aad) {
            Ok(index) => {
                paths::write_bytes_atomic(&primary_path, raw)?;
                log_index_restored(store_dir, INDEX_FILE_NAME);
                return Ok(LoadedIndex {
                    index,
                    other_copy: None,
                });
            }
            Err(error) => {
                refused.get_or_insert(error);
            }
        }
    }
    let detail = match refused {
        None => "missing index".to_string(),
        Some(UprivError::VaultStoreInvalid { detail, .. }) => detail,
        Some(other) => other.to_string(),
    };
    Err(UprivError::VaultIndexUnreadable { detail })
}

/// Open `sealed` as an index of the store `header` describes. Another copy of
/// this vault, such as a backup zip, may carry another header.
pub(crate) fn open_sealed_index(
    header: &VaultHeader,
    index_key: &[u8; INDEX_KEY_LEN],
    sealed: &[u8],
) -> Result<VaultIndex> {
    let aad = index_aad(header)?;
    unseal_index(Path::new(INDEX_FILE_NAME), index_key, sealed, &aad)
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
    log_store_event(store_dir, "vault_index_restored", Some(file_name));
}

/// A save put its index in place, but the folder that names it did not flush.
pub(super) fn log_index_unflushed(store_dir: &Path) {
    log_store_event(store_dir, "vault_index_unflushed", None);
}

/// A warning about this store's index files, with the vault folder id and,
/// when it matters, which index file.
fn log_store_event(store_dir: &Path, event: &str, file_name: Option<&str>) {
    let id = store_dir
        .parent()
        .and_then(|parent| parent.file_name())
        .and_then(|name| name.to_str())
        .unwrap_or("");
    let mut fields = vec![("id", id)];
    fields.extend(file_name.map(|name| ("file", name)));
    crate::logging::log_event(crate::logging::LogLevel::Warn, event, &fields);
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
                    "chunk_versions": ["0123456789abcdef"]
                },
                "created_at": 1,
                "modified_at": 1
            }]
        }"#;
        let err = decode_index(json).unwrap_err();
        assert!(matches!(err, UprivError::VaultStoreInvalid { .. }));
    }

    #[test]
    fn a_primary_in_place_but_not_flushed_is_reported_as_such() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("store");
        super::super::create_empty_store(&dir, b"unflushed-ok", super::super::KdfUnlockPreset::M32)
            .unwrap();
        let opened = super::super::open_store(&dir, b"unflushed-ok").unwrap();
        let mut index = opened.index.clone();
        index.push(VaultNode::dir("docs"));

        // The copy and the primary are put in place; neither folder flush lands.
        crate::paths::fail_folder_flushes(2);
        let (sealed, flushed) =
            save_sealed_index(&dir, &opened.header, &opened.index_key, &mut index).unwrap();
        crate::paths::fail_folder_flushes(0);
        assert_eq!(flushed, Sealed::Unflushed);
        assert_eq!(crate::host_fs::read(index_path(&dir)).unwrap(), sealed);
        assert_eq!(crate::host_fs::read(index_copy_path(&dir)).unwrap(), sealed);

        // Only the copy's flush fails: the primary's flush of the same folder
        // that follows proves nothing.
        crate::paths::fail_folder_flushes(1);
        let (_, flushed) =
            save_sealed_index(&dir, &opened.header, &opened.index_key, &mut index).unwrap();
        crate::paths::fail_folder_flushes(0);
        assert_eq!(flushed, Sealed::Unflushed);

        // Creating a store needs an index that survives a power cut.
        crate::paths::fail_folder_flushes(2);
        let refused = save_new_sealed_index(&dir, &opened.header, &opened.index_key, &mut index);
        crate::paths::fail_folder_flushes(0);
        assert!(refused.is_err());
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
    fn a_copy_that_opens_with_another_tree_is_kept_and_handed_back() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("store");
        super::super::create_empty_store(
            &dir,
            b"other-copy-ok",
            super::super::KdfUnlockPreset::M32,
        )
        .unwrap();
        let opened = super::super::open_store(&dir, b"other-copy-ok").unwrap();
        let mut newer = opened.index.clone();
        newer.push(VaultNode::dir("docs"));
        // A seal that stopped after its copy.
        let sealed = sealed_index_bytes(&opened.header, &opened.index_key, &newer).unwrap();
        crate::host_fs::write(index_copy_path(&dir), &sealed).unwrap();

        let loaded = load_index_files(&dir, &opened.header, &opened.index_key).unwrap();
        assert_eq!(loaded.index, opened.index);
        assert_eq!(loaded.other_copy.unwrap().nodes, newer.nodes);
        assert_eq!(crate::host_fs::read(index_copy_path(&dir)).unwrap(), sealed);

        // A copy that does not open is written back from the primary.
        crate::host_fs::write(index_copy_path(&dir), b"torn").unwrap();
        let loaded = load_index_files(&dir, &opened.header, &opened.index_key).unwrap();
        assert!(loaded.other_copy.is_none());
        assert_eq!(
            crate::host_fs::read(index_copy_path(&dir)).unwrap(),
            crate::host_fs::read(index_path(&dir)).unwrap()
        );
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
        assert!(matches!(err, Err(UprivError::VaultIndexUnreadable { .. })));
        assert_eq!(crate::host_fs::read(&primary).unwrap(), b"torn");
        assert!(!copy.host_exists());
    }

    /// An index file of `nodes`: each a folder (`None`) or an empty file
    /// naming that blob.
    fn index_file(nodes: &[(&str, Option<&str>)]) -> String {
        let nodes: Vec<String> = nodes
            .iter()
            .map(|(path, blob)| {
                let kind = match blob {
                    None => r#"{"type":"dir"}"#.to_string(),
                    Some(id) => format!(
                        r#"{{"type":"file","file_id":"{id}","size":0,"chunk_versions":[],"chunk_offsets":[]}}"#
                    ),
                };
                let path = serde_json::to_string(path).unwrap();
                format!(r#"{{"path":{path},"kind":{kind},"created_at":1,"modified_at":1}}"#)
            })
            .collect();
        format!(r#"{{"format_version":1,"nodes":[{}]}}"#, nodes.join(","))
    }

    #[test]
    fn a_tree_that_breaks_its_rules_does_not_read() {
        let tree = [
            ("docs", None),
            ("docs/a.txt", Some("a")),
            ("b.txt", Some("b")),
        ];
        assert_eq!(
            decode_index(index_file(&tree).as_bytes())
                .unwrap()
                .nodes()
                .len(),
            3
        );

        let refused: [&[(&str, Option<&str>)]; 11] = [
            &[("../escape.txt", Some("a"))],
            &[("docs", None), ("docs/../../escape.txt", Some("a"))],
            &[("docs", None), ("docs/./escape.txt", Some("a"))],
            &[("/escape.txt", Some("a"))],
            &[("docs\\escape.txt", Some("a"))],
            &[("", None)],
            &[("a.txt", Some("a")), ("a.txt", Some("b"))],
            &[("docs", None), ("docs", Some("a"))],
            &[("docs/a.txt", Some("a"))],
            &[("docs", Some("a")), ("docs/a.txt", Some("b"))],
            &[("a.txt", Some("shared")), ("b.txt", Some("shared"))],
        ];
        for nodes in refused {
            let error = decode_index(index_file(nodes).as_bytes()).unwrap_err();
            let UprivError::VaultStoreInvalid { detail, .. } = error else {
                panic!("{nodes:?} is refused as an invalid index");
            };
            // A path of the tree never reaches the error, which may be logged.
            assert!(
                !detail.contains("escape") && !detail.contains("docs"),
                "{detail}"
            );
        }
    }

    #[test]
    fn a_sealed_tree_that_breaks_its_rules_is_read_from_the_copy() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("store");
        super::super::create_empty_store(
            &dir,
            b"tree-rules-ok",
            super::super::KdfUnlockPreset::M32,
        )
        .unwrap();
        let opened = super::super::open_store(&dir, b"tree-rules-ok").unwrap();
        let primary = index_path(&dir);
        let copy = index_copy_path(&dir);
        let original = crate::host_fs::read(&primary).unwrap();
        // Sealed with the vault's own key: only the tree is wrong.
        let escaping = seal_index(
            &opened.index_key,
            index_file(&[("../outside.txt", Some("a"))]).as_bytes(),
            &index_aad(&opened.header).unwrap(),
        )
        .unwrap();

        crate::host_fs::write(&primary, &escaping).unwrap();
        super::super::open_store(&dir, b"tree-rules-ok").unwrap();
        assert_eq!(crate::host_fs::read(&primary).unwrap(), original);

        // Both refused: the error says why, not that the index is missing.
        crate::host_fs::write(&primary, &escaping).unwrap();
        crate::host_fs::write(&copy, &escaping).unwrap();
        let Err(UprivError::VaultIndexUnreadable { detail }) =
            super::super::open_store(&dir, b"tree-rules-ok")
        else {
            panic!("both index files are refused");
        };
        assert!(detail.contains("not a valid store path"), "{detail}");

        crate::host_fs::remove_file(&primary).unwrap();
        crate::host_fs::remove_file(&copy).unwrap();
        let Err(UprivError::VaultIndexUnreadable { detail }) =
            super::super::open_store(&dir, b"tree-rules-ok")
        else {
            panic!("no index file is there");
        };
        assert_eq!(detail, "missing index");
    }

    const VERSION: ChunkVersion =
        ChunkVersion::from_bytes([0xa1, 0xb2, 0xc3, 0xd4, 0xe5, 0xf6, 0x07, 0x18]);

    #[test]
    fn an_index_file_reads_back_and_seals_to_the_same_bytes() {
        let file = concat!(
            r#"{"format_version":1,"saves":12,"nodes":["#,
            r#"{"path":"docs","kind":{"type":"dir"},"created_at":1,"modified_at":2},"#,
            r#"{"path":"docs/a.txt","kind":{"type":"file","#,
            r#""file_id":"00000000-0000-4000-8000-000000000001","size":5,"#,
            r#""chunk_versions":["a1b2c3d4e5f60718"],"chunk_offsets":[0]},"#,
            r#""created_at":3,"modified_at":4,"#,
            r#""content_digest":{"sha256":"sha256:aa","storage":"sha256:bb"},"#,
            r#""problem":"damaged"}],"#,
            r#""held":[{"name":"00000000-0000-4000-8000-000000000002.blob","size":64,"held_at":7}]}"#,
        );
        let index = decode_index(file.as_bytes()).unwrap();
        let (_, _, versions) = index.find("docs/a.txt").unwrap().as_file().unwrap();
        assert_eq!(versions, [VERSION]);
        assert!(index.find("docs").unwrap().is_dir());
        assert_eq!(index.saves, 12);
        assert_eq!(encode_index(&index).unwrap(), file.as_bytes());
    }

    #[test]
    fn a_chunk_version_is_exactly_16_lowercase_hex_digits() {
        assert_eq!(ChunkVersion::parse("a1b2c3d4e5f60718"), Some(VERSION));
        assert_eq!(VERSION.to_string(), "a1b2c3d4e5f60718");
        assert_eq!(
            serde_json::to_string(&VERSION).unwrap(),
            "\"a1b2c3d4e5f60718\""
        );
        let every_digit =
            ChunkVersion::from_bytes([0x00, 0x0f, 0x10, 0x7f, 0x80, 0x9a, 0xf0, 0xff]);
        assert_eq!(
            ChunkVersion::parse(&every_digit.to_string()),
            Some(every_digit)
        );
        for refused in [
            "",
            "a1b2",
            "A1B2C3D4E5F60718",
            "a1b2c3d4e5f6071g",
            "a1b2c3d4e5f607180",
            " 1b2c3d4e5f60718",
        ] {
            assert_eq!(ChunkVersion::parse(refused), None, "{refused:?}");
            let json = format!("\"{refused}\"");
            assert!(
                serde_json::from_str::<ChunkVersion>(&json).is_err(),
                "{refused:?}"
            );
        }
    }

    /// Sealed digests name their storage by this tag, so it hashes each
    /// version as the 16 hex digits the index file holds.
    #[test]
    fn the_storage_tag_hashes_each_version_as_its_hex_digits() {
        use sha2::{Digest, Sha256};
        let node = VaultNode::file("a.txt", "id".into(), 5, vec![VERSION], vec![40]);
        let mut hasher = Sha256::new();
        hasher.update(b"id");
        hasher.update(5u64.to_le_bytes());
        hasher.update([0]);
        hasher.update(b"a1b2c3d4e5f60718");
        hasher.update(40u64.to_le_bytes());
        assert_eq!(
            node.storage_tag(),
            Some(format!("sha256:{:x}", hasher.finalize()))
        );
    }

    #[test]
    fn a_rewritten_file_keeps_its_place_in_the_tree() {
        let mut index = VaultIndex::empty();
        index.push(VaultNode::dir("a"));
        index.push(VaultNode::file(
            "b",
            "one".into(),
            1,
            vec![VERSION],
            vec![0],
        ));
        index.push(VaultNode::dir("c"));
        index.put(VaultNode::file(
            "b",
            "two".into(),
            1,
            vec![VERSION],
            vec![0],
        ));
        let paths: Vec<&str> = index
            .nodes()
            .iter()
            .map(|node| node.path.as_str())
            .collect();
        assert_eq!(paths, ["a", "b", "c"]);
        assert_eq!(index.find("b").unwrap().as_file().unwrap().0, "two");
    }

    #[test]
    fn a_slot_two_nodes_share_is_answered_by_a_scan() {
        let nodes = [
            VaultNode::dir("a"),
            VaultNode::dir("b"),
            VaultNode::dir("a"),
        ];
        let lookup = PathLookup::of(&nodes);
        assert_eq!(lookup.find(&nodes, "a"), Some(0));
        assert_eq!(lookup.find(&nodes, "b"), Some(1));
        assert_eq!(lookup.find(&nodes, "c"), None);
    }

    #[test]
    fn a_removal_moves_each_later_place_down_past_the_removed_ones() {
        let mut nodes: Vec<VaultNode> = ["a", "b", "c", "d", "a", "e"]
            .into_iter()
            .map(VaultNode::dir)
            .collect();
        let mut lookup = PathLookup::of(&nodes);
        // Take out `b` and `d`, by their places before the removal.
        nodes.remove(3);
        nodes.remove(1);
        lookup.remove(&[(1, "b"), (3, "d")]);
        assert_eq!(lookup.find(&nodes, "c"), Some(1));
        assert_eq!(lookup.find(&nodes, "e"), Some(3));
        // The key the two `a` nodes share still scans, and finds the first.
        assert_eq!(lookup.find(&nodes, "a"), Some(0));
        assert_eq!(lookup.find(&nodes, "b"), None);
        assert_eq!(lookup.find(&nodes, "d"), None);
    }

    /// Thousands of random changes; after each one every path in the list,
    /// and one that may not be, answers as a scan of the list does.
    #[test]
    fn the_lookup_answers_what_the_list_holds_through_any_change() {
        use rand::rngs::StdRng;
        use rand::{Rng, SeedableRng};
        fn random_path(rng: &mut StdRng) -> String {
            let depth = rng.gen_range(1..=3);
            (0..depth)
                .map(|_| format!("n{}", rng.gen_range(0..10)))
                .collect::<Vec<_>>()
                .join("/")
        }
        // The checks the tree edits make before they call the index, so the
        // walk keeps a tree that reads back.
        fn in_a_folder(index: &VaultIndex, path: &str) -> bool {
            super::super::tree::require_parent_dir(index, path).is_ok()
        }
        fn has_children(index: &VaultIndex, path: &str) -> bool {
            let inside = format!("{path}/");
            index
                .nodes()
                .iter()
                .any(|node| node.path.starts_with(&inside))
        }
        let mut rng = StdRng::seed_from_u64(0x5eed);
        let mut index = VaultIndex::empty();
        let mut blobs = 0u32;
        for _ in 0..4_000 {
            let path = random_path(&mut rng);
            // Mostly additions, so the tree grows large between removals.
            match rng.gen_range(0..12) {
                0..=3 if index.find(&path).is_none() && in_a_folder(&index, &path) => {
                    index.push(VaultNode::dir(&path));
                }
                4..=7
                    if in_a_folder(&index, &path)
                        && index.find(&path).is_none_or(|node| !node.is_dir()) =>
                {
                    blobs += 1;
                    index.put(VaultNode::file(
                        &path,
                        format!("blob-{blobs}"),
                        1,
                        vec![VERSION],
                        vec![0],
                    ));
                }
                8 if !has_children(&index, &path) => {
                    index.remove(&path);
                }
                9 => {
                    index.remove_tree(&path);
                }
                10 => {
                    let to = random_path(&mut rng);
                    let taken = index.find(&to).is_some() || has_children(&index, &to);
                    let into_itself = to == path || to.starts_with(&format!("{path}/"));
                    if index.find(&path).is_some()
                        && in_a_folder(&index, &to)
                        && !taken
                        && !into_itself
                    {
                        index.move_tree(&path, &to, 0);
                    }
                }
                _ => index.mark_files(|node| match node.problem {
                    Some(_) => None,
                    None => Some(FileProblem::Damaged),
                }),
            }
            index.assert_lookup();
            let probe = random_path(&mut rng);
            let scanned = index.nodes().iter().find(|node| node.path == probe);
            assert_eq!(index.find(&probe), scanned);
        }
        assert!(index.nodes().len() > 50, "the walk built a real tree");

        // Sealed and read back, every path is where the lookup says.
        let loaded = decode_index(&encode_index(&index).unwrap()).unwrap();
        loaded.assert_lookup();
        assert_eq!(loaded, index);
    }
}
