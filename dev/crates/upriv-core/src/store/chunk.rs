//! Logical files as XChaCha20-Poly1305 chunks under `store/data/`.
//!
//! One operating-system file per logical file: `store/data/<file_id>.blob`.
//! Chunks are concatenated inside it. The sealed index stores each chunk's
//! byte offset. A rewrite writes the new ciphertext into a free span when one
//! fits, otherwise it appends. The previous generation stays until the index
//! that names the new offset is sealed. Dead spans are packed after that seal
//! when they are large, and again on close when the waste is worth a copy.
//! Logical paths live only in the sealed index.

use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use uuid::Uuid;

use super::aead::{
    decrypt_xchacha, encrypt_xchacha, random_bytes, CONTENT_KEY_LEN, XCHACHA_NONCE_LEN,
};
use super::header::{chunk_aad, VaultHeader};
use super::index::{DeadBlobSpan, VaultIndex, VaultNode, DATA_DIR_NAME};
use crate::error::{Result, UprivError};

/// Poly1305 tag appended by XChaCha20-Poly1305. Blob length is nonce + plaintext + tag.
const XCHACHA_TAG_LEN: usize = 16;

pub const BLOB_FILE_SUFFIX: &str = ".blob";

pub const SEED_LOGICAL_PATH: &str = "upriv-seed.txt";

/// Max plaintext for a single full-file RPC (`vault_fs_read` / `vault_fs_write`).
/// Larger files use range RPCs. Sized for NDJSON + base64 under the 8 MiB envelope.
pub const VAULT_FS_MAX_INLINE_BYTES: u64 = 4 * 1024 * 1024;

/// Bytes of CSPRNG behind each chunk's replay guard (hex-encoded in the index).
const CHUNK_VERSION_LEN: usize = 8;

/// Fresh identifier for one chunk write. Recorded in the index and bound into
/// that chunk's AAD, so rewriting a chunk invalidates the blob it replaced.
fn new_chunk_version() -> String {
    use std::fmt::Write;
    let bytes = random_bytes::<CHUNK_VERSION_LEN>();
    let mut out = String::with_capacity(CHUNK_VERSION_LEN * 2);
    for byte in bytes {
        let _ = write!(out, "{byte:02x}");
    }
    out
}

pub fn seed_plaintext(content_identity: Uuid) -> Vec<u8> {
    format!(
        "Upriv seed v1\ncontent_identity={content_identity}\nThis file is written at vault create to prove chunk AEAD round-trip.\nIt is not a secret.\n"
    )
    .into_bytes()
}

fn parse_file_id(file_id: &str) -> Result<Uuid> {
    Uuid::parse_str(file_id).map_err(|_| UprivError::VaultStoreInvalid {
        path: PathBuf::from(DATA_DIR_NAME),
        detail: "file_id is not a UUID".into(),
    })
}

fn cipher_len(plain_len: u32) -> usize {
    plain_len as usize + XCHACHA_NONCE_LEN + XCHACHA_TAG_LEN
}

/// `store/data/<file_id>.blob` — every chunk of that logical file.
pub fn blob_path(store_dir: impl AsRef<Path>, file_id: &str) -> Result<PathBuf> {
    let parsed = parse_file_id(file_id)?;
    Ok(store_dir
        .as_ref()
        .join(DATA_DIR_NAME)
        .join(format!("{parsed}{BLOB_FILE_SUFFIX}")))
}

pub fn chunk_count(file_size: u64, chunk_size: u32) -> u32 {
    if file_size == 0 {
        return 0;
    }
    let size = u64::from(chunk_size.max(1));
    file_size.div_ceil(size) as u32
}

fn require_chunk_lists(
    logical_path: &str,
    count: u32,
    versions: &[String],
    offsets: &[u64],
) -> Result<()> {
    if versions.len() == count as usize && offsets.len() == count as usize {
        return Ok(());
    }
    Err(UprivError::VaultStoreInvalid {
        path: PathBuf::from(logical_path),
        detail: "chunk version count does not match file size".into(),
    })
}

pub fn chunk_plain_len(file_size: u64, chunk_index: u32, chunk_size: u32) -> u32 {
    let start = u64::from(chunk_index) * u64::from(chunk_size);
    if start >= file_size {
        return 0;
    }
    (file_size - start).min(u64::from(chunk_size)) as u32
}

pub(crate) fn validate_logical_path(path: &str) -> Result<()> {
    let invalid = path.is_empty()
        || path.starts_with('/')
        || path.contains('\0')
        || path.contains('\\')
        || path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..");
    if invalid {
        return Err(UprivError::VaultStoreInvalid {
            path: PathBuf::from(path),
            detail: "invalid logical path".into(),
        });
    }
    Ok(())
}

pub(crate) fn remove_file_chunks(store_dir: &Path, file_id: &str, _count: u32) -> Result<()> {
    remove_all_chunks_for_file_id(store_dir, file_id)
}

fn remove_all_chunks_for_file_id(store_dir: &Path, file_id: &str) -> Result<()> {
    let path = blob_path(store_dir, file_id)?;
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

/// One logical file, held open so every chunk is written once and the caller
/// flushes it once.
struct OpenBlob {
    file: std::fs::File,
    path: PathBuf,
    position: u64,
    created: bool,
    rollback_len: u64,
}

fn blob_io(path: &Path, error: std::io::Error) -> UprivError {
    if error.kind() == std::io::ErrorKind::NotFound {
        return UprivError::VaultStoreInvalid {
            path: path.to_path_buf(),
            detail: "missing chunk".into(),
        };
    }
    if error.kind() == std::io::ErrorKind::InvalidInput {
        return UprivError::VaultStoreInvalid {
            path: path.to_path_buf(),
            detail: "refusing a symlink".into(),
        };
    }
    error.into()
}

impl OpenBlob {
    fn create(path: PathBuf) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let file = crate::paths::open_nofollow(&path, crate::paths::NofollowMode::CreateNew)
            .map_err(|error| blob_io(&path, error))?;
        Ok(Self {
            file,
            path,
            position: 0,
            created: true,
            rollback_len: 0,
        })
    }

    fn append(path: PathBuf) -> Result<Self> {
        let file = crate::paths::open_nofollow(&path, crate::paths::NofollowMode::ReadWrite)
            .map_err(|error| blob_io(&path, error))?;
        let position = file.metadata()?.len();
        Ok(Self {
            file,
            path,
            position,
            created: false,
            rollback_len: position,
        })
    }

    fn append_bytes(&mut self, bytes: &[u8]) -> Result<u64> {
        self.file.seek(SeekFrom::Start(self.position))?;
        self.file.write_all(bytes)?;
        let offset = self.position;
        self.position += bytes.len() as u64;
        Ok(offset)
    }

    /// Write `bytes` into a free span of `slot` bytes, or append one.
    ///
    /// The span currently named by the sealed index is passed in `occupied`
    /// and is not overwritten. A crash before the index flush still decrypts
    /// that generation. `slot` is one full chunk of ciphertext so the next
    /// rewrite of the same size can reuse the span this call abandons.
    fn place_reserved(&mut self, bytes: &[u8], slot: u64, occupied: &[(u64, u64)]) -> Result<u64> {
        let need = bytes.len() as u64;
        if need == 0 || need > slot {
            return Err(UprivError::VaultStoreInvalid {
                path: self.path.clone(),
                detail: "chunk ciphertext does not fit its slot".into(),
            });
        }
        let offset = first_fit(self.position, slot, occupied);
        self.file.seek(SeekFrom::Start(offset))?;
        self.file.write_all(bytes)?;
        let reserve_end = offset.saturating_add(slot);
        if reserve_end > self.position && !overlaps_occupied(offset, slot, occupied) {
            self.file.set_len(reserve_end)?;
            self.position = reserve_end;
        } else if offset.saturating_add(need) > self.position {
            self.position = offset + need;
        }
        Ok(offset)
    }

    fn mutation(&self) -> ChunkBlobMutation {
        if self.created {
            ChunkBlobMutation {
                created: vec![self.path.clone()],
                ..ChunkBlobMutation::default()
            }
        } else {
            ChunkBlobMutation {
                truncate_to: vec![(self.path.clone(), self.rollback_len)],
                ..ChunkBlobMutation::default()
            }
        }
    }
}

fn open_blob(store_dir: &Path, file_id: &str, allow_create: bool) -> Result<OpenBlob> {
    let path = blob_path(store_dir, file_id)?;
    match std::fs::symlink_metadata(&path) {
        Ok(meta) if meta.file_type().is_symlink() => Err(UprivError::VaultStoreInvalid {
            path,
            detail: "refusing a symlink".into(),
        }),
        Ok(meta) if meta.is_file() => OpenBlob::append(path),
        Ok(_) => Err(UprivError::VaultStoreInvalid {
            path,
            detail: "refusing a non-file".into(),
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound && allow_create => {
            OpenBlob::create(path)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Err(UprivError::VaultStoreInvalid {
                path,
                detail: "missing chunk".into(),
            })
        }
        Err(error) => Err(error.into()),
    }
}

fn first_fit(file_len: u64, need: u64, occupied: &[(u64, u64)]) -> u64 {
    let mut spans: Vec<(u64, u64)> = occupied
        .iter()
        .copied()
        .filter(|(_, len)| *len > 0)
        .collect();
    spans.sort_unstable_by_key(|(off, _)| *off);
    let mut cursor = 0u64;
    for (off, len) in spans {
        if off > cursor && off - cursor >= need {
            return cursor;
        }
        let end = off.saturating_add(len);
        if end > cursor {
            cursor = end;
        }
    }
    if file_len > cursor && file_len - cursor >= need {
        return cursor;
    }
    file_len.max(cursor)
}

/// Spans abandoned by an earlier write in this process that the sealed index
/// might still name. A later write in the same unsealed sequence must not
/// reuse them.
fn protect_unsealed(index: &VaultIndex, file_id: &str, occupied: &mut Vec<(u64, u64)>) {
    for dead in &index.dead_until_seal {
        if dead.file_id == file_id && dead.len > 0 {
            occupied.push((dead.offset, dead.len));
        }
    }
}

fn overlaps_occupied(offset: u64, len: u64, occupied: &[(u64, u64)]) -> bool {
    let end = offset.saturating_add(len);
    occupied.iter().any(|(off, span)| {
        let span_end = off.saturating_add(*span);
        offset < span_end && end > *off
    })
}

/// Live ciphertext, extended to one full-chunk slot when the following bytes
/// are padding this chunk reserved rather than the next chunk.
fn occupied_spans(
    offsets: &[u64],
    versions: &[String],
    plain_lens: &[u32],
    file_len: u64,
    slot: u64,
) -> Vec<(u64, u64)> {
    let mut items: Vec<(u64, u64)> = Vec::new();
    for (index, version) in versions.iter().enumerate() {
        if version.is_empty() {
            continue;
        }
        let off = offsets.get(index).copied().unwrap_or(0);
        let plain = plain_lens.get(index).copied().unwrap_or(0);
        items.push((off, cipher_len(plain) as u64));
    }
    items.sort_unstable_by_key(|(off, _)| *off);
    let mut spans = Vec::with_capacity(items.len());
    for index in 0..items.len() {
        let (off, cipher) = items[index];
        let next = items
            .get(index + 1)
            .map(|(next_off, _)| *next_off)
            .unwrap_or(file_len);
        let room = next.saturating_sub(off);
        let len = if room >= slot { slot } else { cipher };
        spans.push((off, len));
    }
    spans
}

/// Previous generation left on disk until the sealed index names the new `file_id`.
#[derive(Debug, Clone)]
pub struct RetiredFileChunks {
    pub file_id: String,
    pub chunk_count: u32,
}

/// One logical file put back when a pack seal does not land.
#[derive(Debug, Clone)]
struct PackNodeRollback {
    logical_path: String,
    file_id: String,
    chunk_offsets: Vec<u64>,
    chunk_versions: Vec<String>,
}

/// Blobs created by a mutation, plus objects the sealed index no longer names.
/// Delete `created` if the index flush fails; delete `superseded` only after it succeeds.
#[derive(Debug, Default, Clone)]
pub struct ChunkBlobMutation {
    pub created: Vec<PathBuf>,
    /// Appends to roll back when the index is not sealed. `(path, length before this write)`.
    pub truncate_to: Vec<(PathBuf, u64)>,
    pub superseded: Vec<PathBuf>,
    /// Nodes a pack rewrote. Restored without cloning the rest of the index.
    pack_rollback: Vec<PackNodeRollback>,
}

impl ChunkBlobMutation {
    pub fn merge(&mut self, other: Self) {
        self.created.extend(other.created);
        self.truncate_to.extend(other.truncate_to);
        self.superseded.extend(other.superseded);
        self.pack_rollback.extend(other.pack_rollback);
    }

    /// Put packed nodes back to the file id and offsets from before the pack.
    pub(crate) fn restore_packed_nodes(&self, index: &mut VaultIndex) {
        for item in &self.pack_rollback {
            let Some(node) = index.find_mut(&item.logical_path) else {
                continue;
            };
            if let crate::store::index::VaultNodeKind::File {
                file_id,
                chunk_offsets,
                chunk_versions,
                ..
            } = &mut node.kind
            {
                *file_id = item.file_id.clone();
                *chunk_offsets = item.chunk_offsets.clone();
                *chunk_versions = item.chunk_versions.clone();
            }
        }
    }

    pub fn discard_created(&self) {
        for path in &self.created {
            let _ = std::fs::remove_file(path);
        }
        let mut shortest: Vec<(&Path, u64)> = Vec::new();
        for (path, len) in &self.truncate_to {
            if self.created.iter().any(|created| created == path) {
                continue;
            }
            if let Some((_, best)) = shortest.iter_mut().find(|(seen, _)| *seen == path) {
                if *len < *best {
                    *best = *len;
                }
            } else {
                shortest.push((path, *len));
            }
        }
        for (path, len) in shortest {
            if let Ok(file) =
                crate::paths::open_nofollow(path, crate::paths::NofollowMode::ReadWrite)
            {
                let _ = file.set_len(len);
            }
        }
    }

    pub fn delete_superseded(&self) {
        for path in &self.superseded {
            let _ = std::fs::remove_file(path);
        }
    }

    /// Flush each logical file once, then the directory that names a new file.
    /// Call this before the index that records those bytes is sealed.
    pub fn sync_before_index(&self) -> Result<()> {
        let mut synced: Vec<&Path> = Vec::new();
        for path in &self.created {
            sync_unique(path, &mut synced)?;
        }
        for (path, _) in &self.truncate_to {
            sync_unique(path, &mut synced)?;
        }
        #[cfg(unix)]
        if let Some(path) = self.created.first() {
            if let Some(parent) = path.parent() {
                if parent.is_dir() {
                    crate::paths::sync_dir_durable(parent)?;
                }
            }
        }
        Ok(())
    }
}

fn sync_unique<'a>(path: &'a Path, synced: &mut Vec<&'a Path>) -> Result<()> {
    if synced.contains(&path) {
        return Ok(());
    }
    crate::paths::sync_file_durable(path)?;
    synced.push(path);
    Ok(())
}

/// Encrypt `plaintext` into `store/data/` and record it in `index` (caller seals the index).
///
/// Does **not** delete the previous `file_id` blobs. Call [`remove_file_chunks`] after
/// a successful index flush so a crash still decrypts the old generation.
pub fn write_logical_file(
    store_dir: impl AsRef<Path>,
    header: &VaultHeader,
    content_key: &[u8; CONTENT_KEY_LEN],
    index: &mut VaultIndex,
    logical_path: &str,
    plaintext: &[u8],
) -> Result<(Option<RetiredFileChunks>, ChunkBlobMutation)> {
    validate_logical_path(logical_path)?;
    let store_dir = store_dir.as_ref();
    let chunk_size = header.chunk_size;
    if chunk_size == 0 {
        return Err(UprivError::VaultStoreInvalid {
            path: PathBuf::from(DATA_DIR_NAME),
            detail: "chunk_size is zero".into(),
        });
    }
    if let Some(node) = index.find(logical_path) {
        if node.as_file().is_none() {
            return Err(UprivError::VaultStoreInvalid {
                path: PathBuf::from(logical_path),
                detail: "logical path is a directory".into(),
            });
        }
    }
    let previous = index.find(logical_path).and_then(|node| {
        node.as_file().map(|(file_id, _, versions)| {
            (
                RetiredFileChunks {
                    file_id: file_id.to_string(),
                    chunk_count: versions.len() as u32,
                },
                node.created_at,
            )
        })
    });
    let created_at = previous.as_ref().map(|(_, created_at)| *created_at);

    let file_id = Uuid::new_v4().to_string();
    let file_size = plaintext.len() as u64;
    let count = chunk_count(file_size, chunk_size);
    let chunk_size_usize = chunk_size as usize;
    let mut chunk_versions = Vec::with_capacity(count as usize);
    let mut chunk_offsets = Vec::with_capacity(count as usize);
    let mutation = if count == 0 {
        ChunkBlobMutation::default()
    } else {
        let mut blob = open_blob(store_dir, &file_id, true)?;
        let written = (|| {
            for (chunk_index, slice) in plaintext.chunks(chunk_size_usize).enumerate() {
                let (version, offset) = append_chunk(
                    &mut blob,
                    header,
                    content_key,
                    &file_id,
                    chunk_index as u32,
                    slice,
                )?;
                chunk_versions.push(version);
                chunk_offsets.push(offset);
            }
            Ok(())
        })();
        let mutation = blob.mutation();
        if let Err(error) = written {
            mutation.discard_created();
            return Err(error);
        }
        mutation
    };

    if previous.is_some() {
        index.remove(logical_path);
    }
    let mut node = VaultNode::file(
        logical_path,
        file_id,
        file_size,
        chunk_versions,
        chunk_offsets,
    );
    if let Some(created_at) = created_at {
        node.created_at = created_at;
    }
    index.nodes.push(node);
    Ok((previous.map(|(retired, _)| retired), mutation))
}

/// Decrypt one logical file into RAM. Tag / AAD failure returns no plaintext.
pub fn read_logical_file(
    store_dir: impl AsRef<Path>,
    header: &VaultHeader,
    content_key: &[u8; CONTENT_KEY_LEN],
    index: &VaultIndex,
    logical_path: &str,
) -> Result<Vec<u8>> {
    let store_dir = store_dir.as_ref();
    let node = index
        .find(logical_path)
        .ok_or_else(|| UprivError::VaultPathNotFound(logical_path.into()))?;
    let (file_id, size, chunk_versions) =
        node.as_file()
            .ok_or_else(|| UprivError::VaultStoreInvalid {
                path: PathBuf::from(logical_path),
                detail: "logical path is a directory".into(),
            })?;
    let chunk_offsets = node
        .chunk_offsets()
        .ok_or_else(|| UprivError::VaultStoreInvalid {
            path: PathBuf::from(logical_path),
            detail: "logical path is a directory".into(),
        })?;
    let _ = Uuid::parse_str(file_id).map_err(|_| UprivError::VaultStoreInvalid {
        path: PathBuf::from(DATA_DIR_NAME),
        detail: "file_id is not a UUID".into(),
    })?;
    let chunk_size = header.chunk_size;
    let count = chunk_count(size, chunk_size);
    // The sealed index is the authority on length. A list that disagrees with
    // the recorded size fails before any blob is opened.
    require_chunk_lists(logical_path, count, chunk_versions, chunk_offsets)?;
    let mut out = Vec::with_capacity(size as usize);
    let mut blob = if count == 0 {
        None
    } else {
        Some(open_blob_read(store_dir, file_id)?)
    };
    for chunk_index in 0..count {
        let expected_len = chunk_plain_len(size, chunk_index, chunk_size);
        let plain = decrypt_one_chunk(
            blob.as_mut().expect("opened for a non-empty file"),
            header,
            content_key,
            SealedChunk {
                file_id,
                index: chunk_index,
                plain_len: expected_len,
                version: &chunk_versions[chunk_index as usize],
                offset: chunk_offsets[chunk_index as usize],
            },
        )?;
        out.extend_from_slice(&plain);
    }
    if out.len() as u64 != size {
        return Err(UprivError::VaultStoreInvalid {
            path: PathBuf::from(logical_path),
            detail: "reassembled file size mismatch".into(),
        });
    }
    Ok(out)
}

struct BlobRead {
    file: std::fs::File,
    path: PathBuf,
}

fn open_blob_read(store_dir: &Path, file_id: &str) -> Result<BlobRead> {
    let path = blob_path(store_dir, file_id)?;
    let file = crate::paths::open_nofollow(&path, crate::paths::NofollowMode::Read)
        .map_err(|error| blob_io(&path, error))?;
    Ok(BlobRead { file, path })
}

struct SealedChunk<'a> {
    file_id: &'a str,
    index: u32,
    plain_len: u32,
    version: &'a str,
    offset: u64,
}

fn decrypt_one_chunk(
    blob: &mut BlobRead,
    header: &VaultHeader,
    content_key: &[u8; CONTENT_KEY_LEN],
    chunk: SealedChunk<'_>,
) -> Result<Vec<u8>> {
    let cipher_len = cipher_len(chunk.plain_len);
    blob.file
        .seek(SeekFrom::Start(chunk.offset))
        .map_err(|error| UprivError::VaultStoreInvalid {
            path: blob.path.clone(),
            detail: format!("chunk seek: {error}"),
        })?;
    let mut bytes = vec![0u8; cipher_len];
    blob.file
        .read_exact(&mut bytes)
        .map_err(|error| UprivError::VaultStoreInvalid {
            path: blob.path.clone(),
            detail: if error.kind() == std::io::ErrorKind::UnexpectedEof {
                "missing chunk".into()
            } else {
                format!("chunk read: {error}")
            },
        })?;
    let aad = chunk_aad(
        header,
        chunk.file_id,
        chunk.index,
        chunk.plain_len,
        chunk.version,
    )?;
    let plain = match decrypt_xchacha(content_key, &bytes, &aad) {
        Ok(plain) => plain,
        Err(UprivError::WrongPassword) => {
            return Err(UprivError::VaultStoreInvalid {
                path: blob.path.clone(),
                detail: "chunk tag failed".into(),
            });
        }
        Err(error) => return Err(error),
    };
    if plain.len() != chunk.plain_len as usize {
        return Err(UprivError::VaultStoreInvalid {
            path: blob.path.clone(),
            detail: "chunk length mismatch".into(),
        });
    }
    Ok(plain)
}

fn decrypt_from_open(
    blob: &mut OpenBlob,
    header: &VaultHeader,
    content_key: &[u8; CONTENT_KEY_LEN],
    chunk: SealedChunk<'_>,
) -> Result<Vec<u8>> {
    let mut read = BlobRead {
        file: blob.file.try_clone()?,
        path: blob.path.clone(),
    };
    decrypt_one_chunk(&mut read, header, content_key, chunk)
}

fn seal_chunk(
    header: &VaultHeader,
    content_key: &[u8; CONTENT_KEY_LEN],
    file_id: &str,
    chunk_index: u32,
    plaintext: &[u8],
) -> Result<(String, Vec<u8>)> {
    let version = new_chunk_version();
    let aad = chunk_aad(
        header,
        file_id,
        chunk_index,
        plaintext.len() as u32,
        &version,
    )?;
    let bytes = encrypt_xchacha(content_key, plaintext, &aad)?;
    Ok((version, bytes))
}

fn append_chunk(
    blob: &mut OpenBlob,
    header: &VaultHeader,
    content_key: &[u8; CONTENT_KEY_LEN],
    file_id: &str,
    chunk_index: u32,
    plaintext: &[u8],
) -> Result<(String, u64)> {
    let (version, bytes) = seal_chunk(header, content_key, file_id, chunk_index, plaintext)?;
    let offset = blob.append_bytes(&bytes)?;
    Ok((version, offset))
}

fn place_chunk(
    blob: &mut OpenBlob,
    header: &VaultHeader,
    content_key: &[u8; CONTENT_KEY_LEN],
    file_id: &str,
    chunk_index: u32,
    plaintext: &[u8],
    occupied: &[(u64, u64)],
) -> Result<(String, u64)> {
    let (version, bytes) = seal_chunk(header, content_key, file_id, chunk_index, plaintext)?;
    let slot = cipher_len(header.chunk_size) as u64;
    let offset = blob.place_reserved(&bytes, slot, occupied)?;
    Ok((version, offset))
}

/// Decrypt `[offset, offset+len)` of a logical file. `len == 0` is an empty read.
pub fn read_logical_range(
    store_dir: impl AsRef<Path>,
    header: &VaultHeader,
    content_key: &[u8; CONTENT_KEY_LEN],
    index: &VaultIndex,
    logical_path: &str,
    offset: u64,
    len: u64,
) -> Result<Vec<u8>> {
    validate_logical_path(logical_path)?;
    let store_dir = store_dir.as_ref();
    let node = index
        .find(logical_path)
        .ok_or_else(|| UprivError::VaultPathNotFound(logical_path.into()))?;
    let (file_id, size, versions) =
        node.as_file()
            .ok_or_else(|| UprivError::VaultStoreInvalid {
                path: PathBuf::from(logical_path),
                detail: "logical path is a directory".into(),
            })?;
    let chunk_offsets = node
        .chunk_offsets()
        .ok_or_else(|| UprivError::VaultStoreInvalid {
            path: PathBuf::from(logical_path),
            detail: "logical path is a directory".into(),
        })?;
    if len == 0 || offset >= size {
        return Ok(Vec::new());
    }
    let count = chunk_count(size, header.chunk_size);
    require_chunk_lists(logical_path, count, versions, chunk_offsets)?;
    let end = size.min(offset.saturating_add(len));
    let chunk_size = header.chunk_size;
    let first = (offset / u64::from(chunk_size)) as u32;
    let last = ((end - 1) / u64::from(chunk_size)) as u32;
    let mut out = Vec::with_capacity((end - offset) as usize);
    let mut blob = open_blob_read(store_dir, file_id)?;
    for chunk_index in first..=last {
        let expected_len = chunk_plain_len(size, chunk_index, chunk_size);
        let version = &versions[chunk_index as usize];
        let chunk_offset = chunk_offsets[chunk_index as usize];
        let plain = decrypt_one_chunk(
            &mut blob,
            header,
            content_key,
            SealedChunk {
                file_id,
                index: chunk_index,
                plain_len: expected_len,
                version,
                offset: chunk_offset,
            },
        )?;
        let chunk_start = u64::from(chunk_index) * u64::from(chunk_size);
        let from = offset.saturating_sub(chunk_start).min(plain.len() as u64) as usize;
        let to = (end.saturating_sub(chunk_start) as usize).min(plain.len());
        if from < to {
            out.extend_from_slice(&plain[from..to]);
        }
    }
    Ok(out)
}

/// Overwrite `[offset, offset+data.len)` keeping unchanged chunks (O(touched chunks)).
/// A hole past EOF is filled with zeros (POSIX `pwrite` shape).
pub fn write_logical_range(
    store_dir: impl AsRef<Path>,
    header: &VaultHeader,
    content_key: &[u8; CONTENT_KEY_LEN],
    index: &mut VaultIndex,
    logical_path: &str,
    offset: u64,
    data: &[u8],
) -> Result<ChunkBlobMutation> {
    validate_logical_path(logical_path)?;
    if index.find(logical_path).is_none() {
        if offset != 0 {
            return Err(UprivError::VaultPathNotFound(logical_path.into()));
        }
        let (_retired, mutation) =
            write_logical_file(store_dir, header, content_key, index, logical_path, data)?;
        return Ok(mutation);
    }
    let store_dir = store_dir.as_ref();
    let chunk_size = header.chunk_size;
    if chunk_size == 0 {
        return Err(UprivError::VaultStoreInvalid {
            path: PathBuf::from(DATA_DIR_NAME),
            detail: "chunk_size is zero".into(),
        });
    }
    let (file_id, old_size, old_versions, old_offsets, created_at) = {
        let node = index.find(logical_path).expect("checked");
        let Some((file_id, size, versions)) = node.as_file() else {
            return Err(UprivError::VaultStoreInvalid {
                path: PathBuf::from(logical_path),
                detail: "logical path is a directory".into(),
            });
        };
        let offsets = node
            .chunk_offsets()
            .expect("file node stores chunk offsets")
            .to_vec();
        (
            file_id.to_string(),
            size,
            versions.to_vec(),
            offsets,
            node.created_at,
        )
    };
    let write_end = offset.saturating_add(data.len() as u64);
    let new_size = old_size.max(write_end);
    let new_count = chunk_count(new_size, chunk_size);
    let old_count = chunk_count(old_size, chunk_size);
    require_chunk_lists(logical_path, old_count, &old_versions, &old_offsets)?;
    let mut versions = old_versions;
    let mut offsets = old_offsets;
    versions.resize(new_count as usize, String::new());
    offsets.resize(new_count as usize, 0);
    let mut plain_lens = vec![0u32; new_count as usize];
    for index in 0..old_count {
        if !versions[index as usize].is_empty() {
            plain_lens[index as usize] = chunk_plain_len(old_size, index, chunk_size);
        }
    }
    let slot = cipher_len(chunk_size) as u64;
    let mut mutation = ChunkBlobMutation::default();

    let union_start = if offset > old_size { old_size } else { offset };
    let union_end = write_end;
    let written = (|| {
        if union_end > union_start {
            let mut blob = open_blob(store_dir, &file_id, old_count == 0)?;
            let first = (union_start / u64::from(chunk_size)) as u32;
            let last = ((union_end - 1) / u64::from(chunk_size)) as u32;
            let mut abandoned: Vec<(u64, u64)> = Vec::new();
            let appended = (|| -> Result<()> {
                for chunk_index in first..=last {
                    let this_len = chunk_plain_len(new_size, chunk_index, chunk_size) as usize;
                    let mut buf = vec![0u8; this_len];
                    let old_len = chunk_plain_len(old_size, chunk_index, chunk_size) as usize;
                    let previous_version = versions[chunk_index as usize].clone();
                    let previous_offset = offsets[chunk_index as usize];
                    if old_len > 0 && !previous_version.is_empty() {
                        let old = decrypt_from_open(
                            &mut blob,
                            header,
                            content_key,
                            SealedChunk {
                                file_id: &file_id,
                                index: chunk_index,
                                plain_len: old_len as u32,
                                version: &previous_version,
                                offset: previous_offset,
                            },
                        )?;
                        let n = old.len().min(buf.len());
                        buf[..n].copy_from_slice(&old[..n]);
                    }
                    let chunk_start = u64::from(chunk_index) * u64::from(chunk_size);
                    let patch_from = offset.max(chunk_start);
                    let patch_to = write_end.min(chunk_start + this_len as u64);
                    if patch_from < patch_to {
                        let src = (patch_from - offset) as usize;
                        let dst = (patch_from - chunk_start) as usize;
                        let n = (patch_to - patch_from) as usize;
                        buf[dst..dst + n].copy_from_slice(&data[src..src + n]);
                    }
                    let replacing = !previous_version.is_empty();
                    let (version, chunk_offset) = if replacing {
                        if old_len > 0 {
                            abandoned.push((previous_offset, cipher_len(old_len as u32) as u64));
                        }
                        let mut occupied =
                            occupied_spans(&offsets, &versions, &plain_lens, blob.position, slot);
                        occupied.extend(abandoned.iter().copied());
                        protect_unsealed(index, &file_id, &mut occupied);
                        place_chunk(
                            &mut blob,
                            header,
                            content_key,
                            &file_id,
                            chunk_index,
                            &buf,
                            &occupied,
                        )?
                    } else {
                        append_chunk(&mut blob, header, content_key, &file_id, chunk_index, &buf)?
                    };
                    versions[chunk_index as usize] = version;
                    offsets[chunk_index as usize] = chunk_offset;
                    plain_lens[chunk_index as usize] = this_len as u32;
                }
                Ok(())
            })();
            mutation = blob.mutation();
            appended?;
            for (offset, len) in abandoned {
                index.dead_until_seal.push(DeadBlobSpan {
                    file_id: file_id.clone(),
                    offset,
                    len,
                });
            }
        }
        Ok(())
    })();
    if let Err(error) = written {
        mutation.discard_created();
        return Err(error);
    }

    if let Some(node) = index.find_mut(logical_path) {
        node.modified_at = crate::time::unix_millis();
        node.created_at = created_at;
        node.kind = crate::store::index::VaultNodeKind::File {
            file_id,
            size: new_size,
            chunk_versions: versions,
            chunk_offsets: offsets,
        };
    }
    Ok(mutation)
}

/// Grow by writing zero-filled chunks one at a time (never one huge allocation).
fn grow_logical_file(
    store_dir: impl AsRef<Path>,
    header: &VaultHeader,
    content_key: &[u8; CONTENT_KEY_LEN],
    index: &mut VaultIndex,
    logical_path: &str,
    old_size: u64,
    new_size: u64,
) -> Result<ChunkBlobMutation> {
    if new_size <= old_size {
        return Ok(ChunkBlobMutation::default());
    }
    let chunk = u64::from(header.chunk_size.max(1));
    let mut pos = old_size;
    let zeros = vec![0u8; chunk as usize];
    let mut mutation = ChunkBlobMutation::default();
    let before = index.clone();
    while pos < new_size {
        let remain = new_size - pos;
        let n = remain.min(chunk) as usize;
        let piece = write_logical_range(
            store_dir.as_ref(),
            header,
            content_key,
            index,
            logical_path,
            pos,
            &zeros[..n],
        );
        match piece {
            Ok(piece) => mutation.merge(piece),
            Err(error) => {
                mutation.discard_created();
                *index = before;
                return Err(error);
            }
        }
        pos += n as u64;
    }
    Ok(mutation)
}

/// Shrink or grow a file. Growth is zero-filled.
pub fn truncate_logical_file(
    store_dir: impl AsRef<Path>,
    header: &VaultHeader,
    content_key: &[u8; CONTENT_KEY_LEN],
    index: &mut VaultIndex,
    logical_path: &str,
    new_size: u64,
) -> Result<ChunkBlobMutation> {
    let store_dir = store_dir.as_ref();
    validate_logical_path(logical_path)?;
    if index.find(logical_path).is_none() {
        if new_size == 0 {
            let (_retired, mutation) =
                write_logical_file(store_dir, header, content_key, index, logical_path, b"")?;
            return Ok(mutation);
        }
        let before = index.clone();
        let (_retired, mut mutation) =
            write_logical_file(store_dir, header, content_key, index, logical_path, b"")?;
        return match grow_logical_file(
            store_dir,
            header,
            content_key,
            index,
            logical_path,
            0,
            new_size,
        ) {
            Ok(piece) => {
                mutation.merge(piece);
                Ok(mutation)
            }
            Err(error) => {
                mutation.discard_created();
                *index = before;
                Err(error)
            }
        };
    }
    let old_size = index
        .find(logical_path)
        .and_then(|n| n.as_file())
        .map(|(_, size, _)| size)
        .unwrap_or(0);
    if new_size == old_size {
        return Ok(ChunkBlobMutation::default());
    }
    if new_size > old_size {
        return grow_logical_file(
            store_dir,
            header,
            content_key,
            index,
            logical_path,
            old_size,
            new_size,
        );
    }
    let before = index.clone();
    let mut mutation = write_logical_range(
        store_dir,
        header,
        content_key,
        index,
        logical_path,
        new_size,
        b"",
    )?;
    // Range write does not shrink; trim the node and extra chunks explicitly.
    let chunk_size = header.chunk_size;
    let (file_id, versions, offsets, created_at) = {
        let node = index.find(logical_path).expect("exists");
        let (file_id, _, versions) = node.as_file().expect("file");
        let offsets = node
            .chunk_offsets()
            .expect("file node stores chunk offsets")
            .to_vec();
        (
            file_id.to_string(),
            versions.to_vec(),
            offsets,
            node.created_at,
        )
    };
    let new_count = chunk_count(new_size, chunk_size);
    let mut versions = versions;
    let mut offsets = offsets;
    let trimmed = (|| {
        if new_size > 0 && new_count > 0 {
            let last = new_count - 1;
            let last_len = chunk_plain_len(new_size, last, chunk_size);
            let old_last_len = chunk_plain_len(old_size, last, chunk_size);
            if last_len < old_last_len {
                let previous_version = versions[last as usize].clone();
                let previous_offset = offsets[last as usize];
                let mut blob = open_blob(store_dir, &file_id, false)?;
                let appended = (|| -> Result<()> {
                    let mut buf = decrypt_from_open(
                        &mut blob,
                        header,
                        content_key,
                        SealedChunk {
                            file_id: &file_id,
                            index: last,
                            plain_len: old_last_len,
                            version: &previous_version,
                            offset: previous_offset,
                        },
                    )?;
                    buf.truncate(last_len as usize);
                    let slot = cipher_len(chunk_size) as u64;
                    let plain_lens: Vec<u32> = (0..versions.len())
                        .map(|index| {
                            if versions[index].is_empty() {
                                0
                            } else if index == last as usize {
                                old_last_len
                            } else {
                                chunk_plain_len(old_size, index as u32, chunk_size)
                            }
                        })
                        .collect();
                    let mut occupied =
                        occupied_spans(&offsets, &versions, &plain_lens, blob.position, slot);
                    protect_unsealed(index, &file_id, &mut occupied);
                    let (version, chunk_offset) = place_chunk(
                        &mut blob,
                        header,
                        content_key,
                        &file_id,
                        last,
                        &buf,
                        &occupied,
                    )?;
                    versions[last as usize] = version;
                    offsets[last as usize] = chunk_offset;
                    Ok(())
                })();
                mutation.merge(blob.mutation());
                appended?;
                index.dead_until_seal.push(DeadBlobSpan {
                    file_id: file_id.clone(),
                    offset: previous_offset,
                    len: cipher_len(old_last_len) as u64,
                });
            }
        } else if new_count == 0 {
            if let Ok(path) = blob_path(store_dir, &file_id) {
                if let Ok(meta) = std::fs::symlink_metadata(&path) {
                    if meta.is_file() || meta.file_type().is_symlink() {
                        mutation.superseded.push(path);
                    }
                }
            }
        }
        Ok(())
    })();
    if let Err(error) = trimmed {
        mutation.discard_created();
        *index = before;
        return Err(error);
    }
    versions.truncate(new_count as usize);
    offsets.truncate(new_count as usize);
    if let Some(node) = index.find_mut(logical_path) {
        node.modified_at = crate::time::unix_millis();
        node.created_at = created_at;
        node.kind = crate::store::index::VaultNodeKind::File {
            file_id,
            size: new_size,
            chunk_versions: versions,
            chunk_offsets: offsets,
        };
    }
    Ok(mutation)
}

/// Pack a blob during a session only after dead ciphertext reaches this size.
const SESSION_PACK_DEAD_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Clone, Copy)]
pub(crate) enum BlobPackMode {
    /// After a sealed write: pack when dead ciphertext is at least 8 MiB.
    SessionWaste,
    /// On close: pack large waste, and any waste in a small file.
    Close,
}

fn should_pack(mode: BlobPackMode, dead: u64, live: u64) -> bool {
    if dead == 0 {
        return false;
    }
    match mode {
        BlobPackMode::SessionWaste => dead >= SESSION_PACK_DEAD_BYTES,
        BlobPackMode::Close => dead >= SESSION_PACK_DEAD_BYTES || live <= SESSION_PACK_DEAD_BYTES,
    }
}

struct BlobMeasure {
    dead: u64,
    live: u64,
}

fn measure_blob(
    store_dir: &Path,
    header: &VaultHeader,
    node: &VaultNode,
) -> Result<Option<BlobMeasure>> {
    let Some((file_id, size, versions)) = node.as_file() else {
        return Ok(None);
    };
    if size == 0 {
        return Ok(None);
    }
    let offsets = node
        .chunk_offsets()
        .ok_or_else(|| UprivError::VaultStoreInvalid {
            path: PathBuf::from(&node.path),
            detail: "logical path is a directory".into(),
        })?;
    let count = chunk_count(size, header.chunk_size);
    require_chunk_lists(&node.path, count, versions, offsets)?;
    let path = blob_path(store_dir, file_id)?;
    let meta = std::fs::symlink_metadata(&path).map_err(|error| blob_io(&path, error))?;
    if meta.file_type().is_symlink() || !meta.is_file() {
        return Err(UprivError::VaultStoreInvalid {
            path,
            detail: "refusing a symlink".into(),
        });
    }
    let mut live = 0u64;
    for index in 0..count {
        live =
            live.saturating_add(cipher_len(chunk_plain_len(size, index, header.chunk_size)) as u64);
    }
    Ok(Some(BlobMeasure {
        dead: meta.len().saturating_sub(live),
        live,
    }))
}

pub(crate) fn blobs_need_pack(
    store_dir: &Path,
    header: &VaultHeader,
    index: &VaultIndex,
    mode: BlobPackMode,
    only: Option<&[String]>,
) -> bool {
    if matches!(only, Some(ids) if ids.is_empty()) {
        return false;
    }
    index.nodes.iter().any(|node| {
        let Some((file_id, _, _)) = node.as_file() else {
            return false;
        };
        if let Some(ids) = only {
            if !ids.iter().any(|id| id == file_id) {
                return false;
            }
        }
        match measure_blob(store_dir, header, node) {
            Ok(Some(measure)) => should_pack(mode, measure.dead, measure.live),
            Ok(None) => false,
            Err(_) => true,
        }
    })
}

struct PackedBlob {
    logical_path: String,
    new_file_id: String,
    new_offsets: Vec<u64>,
    new_versions: Vec<String>,
    new_path: PathBuf,
    old_path: PathBuf,
}

/// Re-encrypt live chunks into a new blob and point the in-memory index at it.
///
/// Chunk AAD binds `file_id`, so a raw copy under a new id would not decrypt.
/// The caller syncs `created`, seals the index, then deletes `superseded`.
/// A crash before that seal leaves the previous index and the previous blob.
pub(crate) fn pack_blob_waste(
    store_dir: &Path,
    header: &VaultHeader,
    content_key: &[u8; CONTENT_KEY_LEN],
    index: &mut VaultIndex,
    mode: BlobPackMode,
    only: Option<&[String]>,
) -> Result<ChunkBlobMutation> {
    if matches!(only, Some(ids) if ids.is_empty()) {
        return Ok(ChunkBlobMutation::default());
    }
    let mut shared: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
    for node in &index.nodes {
        if let Some((file_id, _, _)) = node.as_file() {
            *shared.entry(file_id.to_string()).or_default() += 1;
        }
    }
    let mut planned: Vec<PackedBlob> = Vec::new();
    let packed = (|| -> Result<()> {
        for node in &index.nodes {
            let Some((file_id, size, _)) = node.as_file() else {
                continue;
            };
            if shared.get(file_id).copied().unwrap_or(0) != 1 {
                continue;
            }
            if let Some(ids) = only {
                if !ids.iter().any(|id| id == file_id) {
                    continue;
                }
            }
            let Some(measure) = measure_blob(store_dir, header, node)? else {
                continue;
            };
            if !should_pack(mode, measure.dead, measure.live) {
                continue;
            }
            planned.push(repack_live_blob(
                store_dir,
                header,
                content_key,
                node,
                file_id,
                size,
            )?);
        }
        Ok(())
    })();
    if let Err(error) = packed {
        for item in &planned {
            let _ = std::fs::remove_file(&item.new_path);
        }
        return Err(error);
    }
    let mut mutation = ChunkBlobMutation::default();
    for item in planned {
        if let Some(node) = index.find_mut(&item.logical_path) {
            if let crate::store::index::VaultNodeKind::File {
                file_id,
                chunk_offsets,
                chunk_versions,
                ..
            } = &mut node.kind
            {
                mutation.pack_rollback.push(PackNodeRollback {
                    logical_path: item.logical_path.clone(),
                    file_id: file_id.clone(),
                    chunk_offsets: chunk_offsets.clone(),
                    chunk_versions: chunk_versions.clone(),
                });
                *file_id = item.new_file_id;
                *chunk_offsets = item.new_offsets;
                *chunk_versions = item.new_versions;
            }
        }
        mutation.created.push(item.new_path);
        mutation.superseded.push(item.old_path);
    }
    Ok(mutation)
}

fn repack_live_blob(
    store_dir: &Path,
    header: &VaultHeader,
    content_key: &[u8; CONTENT_KEY_LEN],
    node: &VaultNode,
    file_id: &str,
    size: u64,
) -> Result<PackedBlob> {
    use zeroize::Zeroize;
    let Some((_, _, versions)) = node.as_file() else {
        return Err(UprivError::VaultStoreInvalid {
            path: PathBuf::from(&node.path),
            detail: "logical path is a directory".into(),
        });
    };
    let offsets = node
        .chunk_offsets()
        .ok_or_else(|| UprivError::VaultStoreInvalid {
            path: PathBuf::from(&node.path),
            detail: "logical path is a directory".into(),
        })?;
    let count = chunk_count(size, header.chunk_size);
    let old_path = blob_path(store_dir, file_id)?;
    let mut src = open_blob_read(store_dir, file_id)?;
    let new_file_id = Uuid::new_v4().to_string();
    let mut dst = open_blob(store_dir, &new_file_id, true)?;
    let new_path = dst.path.clone();
    let mut new_offsets = Vec::with_capacity(count as usize);
    let mut new_versions = Vec::with_capacity(count as usize);
    let rewritten = (|| -> Result<()> {
        for index in 0..count {
            let plain_len = chunk_plain_len(size, index, header.chunk_size);
            let mut plain = decrypt_one_chunk(
                &mut src,
                header,
                content_key,
                SealedChunk {
                    file_id,
                    index,
                    plain_len,
                    version: &versions[index as usize],
                    offset: offsets[index as usize],
                },
            )?;
            let (version, offset) =
                append_chunk(&mut dst, header, content_key, &new_file_id, index, &plain)?;
            plain.zeroize();
            new_versions.push(version);
            new_offsets.push(offset);
        }
        Ok(())
    })();
    if let Err(error) = rewritten {
        let _ = std::fs::remove_file(&new_path);
        return Err(error);
    }
    Ok(PackedBlob {
        logical_path: node.path.clone(),
        new_file_id,
        new_offsets,
        new_versions,
        new_path,
        old_path,
    })
}

pub(crate) fn mutation_blob_ids(mutation: &ChunkBlobMutation) -> Vec<String> {
    let mut ids = Vec::new();
    for path in mutation
        .created
        .iter()
        .chain(mutation.truncate_to.iter().map(|(path, _)| path))
    {
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        let Some(id) = name.strip_suffix(BLOB_FILE_SUFFIX) else {
            continue;
        };
        if Uuid::parse_str(id).is_err() {
            continue;
        }
        if !ids.iter().any(|seen| seen == id) {
            ids.push(id.to_string());
        }
    }
    ids
}

/// Delete `store/data/*.blob` the sealed index does not name.
///
/// `remove_file` on a symlink removes the link, not the target. A blob the
/// index still names is left in place, even if it is a symlink — the next
/// read refuses it.
pub(crate) fn remove_unreferenced_blobs(store_dir: &Path, index: &VaultIndex) {
    let dir = store_dir.join(DATA_DIR_NAME);
    let entries = match std::fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };
    let mut referenced = std::collections::HashSet::new();
    for node in &index.nodes {
        if let Some((file_id, _, _)) = node.as_file() {
            referenced.insert(file_id.to_string());
        }
    }
    for entry in entries.flatten() {
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        let Some(id) = name.strip_suffix(BLOB_FILE_SUFFIX) else {
            continue;
        };
        if Uuid::parse_str(id).is_err() || referenced.contains(id) {
            continue;
        }
        let _ = std::fs::remove_file(entry.path());
    }
}

#[cfg(test)]
mod tests {
    use super::super::header::chunk_aad;
    use super::*;
    use crate::store::{create_empty_store, flush_index, open_store, KdfUnlockPreset, CHUNK_SIZE};

    const PW: &[u8] = b"chunk-round-trip-ok";

    fn file_chunk_meta(
        opened: &crate::store::OpenedStore,
        path: &str,
        chunk_index: usize,
    ) -> (String, String, u64) {
        let node = opened.index.find(path).unwrap();
        let (file_id, _, versions) = node.as_file().unwrap();
        let offset = node.chunk_offsets().unwrap()[chunk_index];
        (file_id.to_string(), versions[chunk_index].clone(), offset)
    }

    fn read_chunk_bytes(
        dir: &std::path::Path,
        file_id: &str,
        offset: u64,
        plain_len: u32,
    ) -> Vec<u8> {
        use std::io::{Read, Seek, SeekFrom};
        let path = blob_path(dir, file_id).unwrap();
        let mut file = std::fs::File::open(path).unwrap();
        file.seek(SeekFrom::Start(offset)).unwrap();
        let mut buf = vec![0u8; cipher_len(plain_len)];
        file.read_exact(&mut buf).unwrap();
        buf
    }

    fn seeded_two_chunk() -> (tempfile::TempDir, std::path::PathBuf, Vec<u8>, String) {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(crate::paths::STORE_DIR_NAME);
        create_empty_store(&dir, PW, KdfUnlockPreset::M32).unwrap();
        let mut opened = open_store(&dir, PW).unwrap();
        let mut data = vec![0u8; CHUNK_SIZE as usize + 13];
        for (i, byte) in data.iter_mut().enumerate() {
            *byte = (i % 251) as u8;
        }
        write_logical_file(
            &dir,
            &opened.header,
            &opened.content_key,
            &mut opened.index,
            "wide.bin",
            &data,
        )
        .unwrap();
        flush_index(&dir, &mut opened).unwrap();
        let file_id = opened.index.find("wide.bin").unwrap().as_file().unwrap().0;
        (tmp, dir, data, file_id.to_string())
    }

    #[test]
    fn empty_file_writes_no_blob() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(crate::paths::STORE_DIR_NAME);
        create_empty_store(&dir, PW, KdfUnlockPreset::M32).unwrap();
        let mut opened = open_store(&dir, PW).unwrap();
        write_logical_file(
            &dir,
            &opened.header,
            &opened.content_key,
            &mut opened.index,
            "empty.txt",
            b"",
        )
        .unwrap();
        flush_index(&dir, &mut opened).unwrap();
        let data = dir.join(DATA_DIR_NAME);
        assert_eq!(std::fs::read_dir(&data).unwrap().count(), 0);
        let got = read_logical_file(
            &dir,
            &opened.header,
            &opened.content_key,
            &opened.index,
            "empty.txt",
        )
        .unwrap();
        assert!(got.is_empty());
    }

    #[test]
    fn two_chunks_round_trip_and_unique_nonces() {
        let (_tmp, dir, data, _file_id) = seeded_two_chunk();
        let opened = open_store(&dir, PW).unwrap();
        let got = read_logical_file(
            &dir,
            &opened.header,
            &opened.content_key,
            &opened.index,
            "wide.bin",
        )
        .unwrap();
        assert_eq!(got, data);
        let (file_id, _, off0) = file_chunk_meta(&opened, "wide.bin", 0);
        let (_, _, off1) = file_chunk_meta(&opened, "wide.bin", 1);
        let blobs: Vec<_> = std::fs::read_dir(dir.join(DATA_DIR_NAME))
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(
            blobs.len(),
            1,
            "every chunk of one document shares one file"
        );
        let a = read_chunk_bytes(&dir, &file_id, off0, CHUNK_SIZE);
        let b = read_chunk_bytes(&dir, &file_id, off1, 13);
        assert_ne!(
            &a[..24],
            &b[..24],
            "each chunk must have its own CSPRNG nonce"
        );
        assert!(
            !std::fs::read(dir.join("index/root.idx.enc"))
                .unwrap()
                .windows(b"wide.bin".len())
                .any(|w| w == b"wide.bin"),
            "logical name must not appear in the sealed index blob"
        );
    }

    #[test]
    fn swap_chunks_fails_closed() {
        let (_tmp, dir, _data, _file_id) = seeded_two_chunk();
        let opened = open_store(&dir, PW).unwrap();
        let (file_id, _, off0) = file_chunk_meta(&opened, "wide.bin", 0);
        let (_, _, off1) = file_chunk_meta(&opened, "wide.bin", 1);
        let path = blob_path(&dir, &file_id).unwrap();
        let mut raw = std::fs::read(&path).unwrap();
        let c0 = cipher_len(CHUNK_SIZE);
        let c1 = cipher_len(13);
        let first = raw[off0 as usize..off0 as usize + c0].to_vec();
        let second = raw[off1 as usize..off1 as usize + c1].to_vec();
        raw.splice(off0 as usize..off0 as usize + c0, second);
        raw.splice(off0 as usize + c1..off0 as usize + c1, first);
        std::fs::write(&path, &raw).unwrap();
        let opened = open_store(&dir, PW).expect("vault still opens; one file is torn");
        let err = read_logical_file(
            &dir,
            &opened.header,
            &opened.content_key,
            &opened.index,
            "wide.bin",
        )
        .unwrap_err();
        assert!(
            matches!(err, UprivError::VaultStoreInvalid { .. }),
            "swapped chunk_index AAD must fail: {err:?}"
        );
    }

    #[test]
    fn flip_or_truncate_chunk_fails_closed() {
        let (_tmp, dir, _data, _file_id) = seeded_two_chunk();
        let opened = open_store(&dir, PW).unwrap();
        let (file_id, _, off0) = file_chunk_meta(&opened, "wide.bin", 0);
        let path = blob_path(&dir, &file_id).unwrap();
        let mut raw = std::fs::read(&path).unwrap();
        raw[off0 as usize + 24] ^= 0x01;
        std::fs::write(&path, &raw).unwrap();
        let opened = open_store(&dir, PW).unwrap();
        assert!(matches!(
            read_logical_file(
                &dir,
                &opened.header,
                &opened.content_key,
                &opened.index,
                "wide.bin",
            ),
            Err(UprivError::VaultStoreInvalid { .. })
        ));
        raw[24] ^= 0x01;
        raw.truncate(raw.len() - 4);
        std::fs::write(&path, &raw).unwrap();
        assert!(matches!(
            read_logical_file(
                &dir,
                &opened.header,
                &opened.content_key,
                &opened.index,
                "wide.bin",
            ),
            Err(UprivError::VaultStoreInvalid { .. })
        ));
    }

    #[test]
    fn chunk_rejects_wrap_aad() {
        use super::super::aead::decrypt_xchacha;
        use super::super::header::chunk_aad;

        let (_tmp, dir, _data, _file_id) = seeded_two_chunk();
        let opened = open_store(&dir, PW).unwrap();
        let (file_id, v0, off0) = file_chunk_meta(&opened, "wide.bin", 0);
        let blob = read_chunk_bytes(&dir, &file_id, off0, CHUNK_SIZE);
        let wrap = opened.header.wrap_aad().unwrap();
        assert!(decrypt_xchacha(&opened.content_key, &blob, &wrap).is_err());
        let aad = chunk_aad(&opened.header, &file_id, 0, CHUNK_SIZE, &v0).unwrap();
        decrypt_xchacha(&opened.content_key, &blob, &aad).expect("correct chunk AAD");
    }

    /// The replay guard: a chunk blob that was valid under its old version id
    /// must not decrypt once the index records a new one.
    #[test]
    fn stale_chunk_blob_fails_after_rewrite() {
        let (_tmp, dir, _data, _file_id) = seeded_two_chunk();
        let opened = open_store(&dir, PW).unwrap();
        let (file_id, _, off0) = file_chunk_meta(&opened, "wide.bin", 0);
        let stale = read_chunk_bytes(&dir, &file_id, off0, CHUNK_SIZE);

        let mut opened = open_store(&dir, PW).unwrap();
        write_logical_file(
            &dir,
            &opened.header,
            &opened.content_key,
            &mut opened.index,
            "wide.bin",
            b"rewritten",
        )
        .unwrap();
        flush_index(&dir, &mut opened).unwrap();

        // Put the old ciphertext back under the new file's chunk 0 path.
        let reopened = open_store(&dir, PW).unwrap();
        let (new_id, _, new_off) = file_chunk_meta(&reopened, "wide.bin", 0);
        let path = blob_path(&dir, &new_id).unwrap();
        let mut raw = std::fs::read(&path).unwrap();
        let end = new_off as usize + stale.len();
        if raw.len() < end {
            raw.resize(end, 0);
        }
        raw[new_off as usize..end].copy_from_slice(&stale);
        std::fs::write(&path, &raw).unwrap();

        let err = read_logical_file(
            &dir,
            &reopened.header,
            &reopened.content_key,
            &reopened.index,
            "wide.bin",
        )
        .unwrap_err();
        assert!(
            matches!(err, UprivError::VaultStoreInvalid { .. }),
            "replayed chunk must fail closed: {err:?}"
        );
    }

    /// Appending must not disturb chunks that were already written — this is the
    /// property that dropping `file_size` from chunk AAD buys, and the reason
    /// mount range-writes are viable.
    #[test]
    fn growing_a_file_leaves_earlier_chunk_blobs_readable() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(crate::paths::STORE_DIR_NAME);
        create_empty_store(&dir, PW, KdfUnlockPreset::M32).unwrap();
        let mut opened = open_store(&dir, PW).unwrap();

        let first = vec![7u8; CHUNK_SIZE as usize];
        write_logical_file(
            &dir,
            &opened.header,
            &opened.content_key,
            &mut opened.index,
            "grow.bin",
            &first,
        )
        .unwrap();
        let (_, _, versions) = opened.index.find("grow.bin").unwrap().as_file().unwrap();
        let version_before = versions[0].clone();
        let aad_before = chunk_aad(
            &opened.header,
            "00000000-0000-4000-8000-000000000001",
            0,
            CHUNK_SIZE,
            &version_before,
        )
        .unwrap();

        let mut grown = first.clone();
        grown.extend_from_slice(b"tail");
        write_logical_file(
            &dir,
            &opened.header,
            &opened.content_key,
            &mut opened.index,
            "grow.bin",
            &grown,
        )
        .unwrap();
        flush_index(&dir, &mut opened).unwrap();

        let aad_after = chunk_aad(
            &opened.header,
            "00000000-0000-4000-8000-000000000001",
            0,
            CHUNK_SIZE,
            &version_before,
        )
        .unwrap();
        assert_eq!(
            aad_before, aad_after,
            "chunk 0 AAD must not depend on the file's total size"
        );

        let reopened = open_store(&dir, PW).unwrap();
        let got = read_logical_file(
            &dir,
            &reopened.header,
            &reopened.content_key,
            &reopened.index,
            "grow.bin",
        )
        .unwrap();
        assert_eq!(got, grown);
    }

    #[test]
    fn overwrite_keeps_old_chunks_until_index_flush() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(crate::paths::STORE_DIR_NAME);
        create_empty_store(&dir, PW, KdfUnlockPreset::M32).unwrap();
        let mut opened = open_store(&dir, PW).unwrap();
        write_logical_file(
            &dir,
            &opened.header,
            &opened.content_key,
            &mut opened.index,
            "notes.txt",
            b"generation-one",
        )
        .unwrap();
        flush_index(&dir, &mut opened).unwrap();
        let old_id = opened.index.find("notes.txt").unwrap().as_file().unwrap().0;
        let old_blob = blob_path(&dir, old_id).unwrap();
        assert!(old_blob.is_file());

        write_logical_file(
            &dir,
            &opened.header,
            &opened.content_key,
            &mut opened.index,
            "notes.txt",
            b"generation-two",
        )
        .unwrap();
        assert!(
            old_blob.is_file(),
            "previous ciphertext must survive until the sealed index is flushed"
        );

        let reopened = open_store(&dir, PW).unwrap();
        let got = read_logical_file(
            &dir,
            &reopened.header,
            &reopened.content_key,
            &reopened.index,
            "notes.txt",
        )
        .unwrap();
        assert_eq!(got, b"generation-one");
    }

    #[test]
    fn range_write_keeps_old_blob_until_index_flush() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(crate::paths::STORE_DIR_NAME);
        create_empty_store(&dir, PW, KdfUnlockPreset::M32).unwrap();
        let mut opened = open_store(&dir, PW).unwrap();
        write_logical_file(
            &dir,
            &opened.header,
            &opened.content_key,
            &mut opened.index,
            "notes.txt",
            b"generation-one",
        )
        .unwrap();
        flush_index(&dir, &mut opened).unwrap();
        let old_id = opened.index.find("notes.txt").unwrap().as_file().unwrap().0;
        let old_blob = blob_path(&dir, old_id).unwrap();
        assert!(old_blob.is_file());

        write_logical_range(
            &dir,
            &opened.header,
            &opened.content_key,
            &mut opened.index,
            "notes.txt",
            0,
            b"generation-two",
        )
        .unwrap();
        assert!(
            old_blob.is_file(),
            "previous ciphertext must survive until the sealed index is flushed"
        );

        let reopened = open_store(&dir, PW).unwrap();
        let got = read_logical_file(
            &dir,
            &reopened.header,
            &reopened.content_key,
            &reopened.index,
            "notes.txt",
        )
        .unwrap();
        assert_eq!(got, b"generation-one");
    }

    #[test]
    fn range_rewrite_reuses_a_free_span() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(crate::paths::STORE_DIR_NAME);
        create_empty_store(&dir, PW, KdfUnlockPreset::M32).unwrap();
        let mut opened = open_store(&dir, PW).unwrap();
        let payload = vec![7u8; CHUNK_SIZE as usize];
        let next = vec![8u8; CHUNK_SIZE as usize];
        let third = vec![9u8; CHUNK_SIZE as usize];
        write_logical_file(
            &dir,
            &opened.header,
            &opened.content_key,
            &mut opened.index,
            "wide.bin",
            &payload,
        )
        .unwrap();
        flush_index(&dir, &mut opened).unwrap();
        write_logical_range(
            &dir,
            &opened.header,
            &opened.content_key,
            &mut opened.index,
            "wide.bin",
            0,
            &next,
        )
        .unwrap();
        flush_index(&dir, &mut opened).unwrap();
        let file_id = opened
            .index
            .find("wide.bin")
            .unwrap()
            .as_file()
            .unwrap()
            .0
            .to_string();
        let len_after_seal = std::fs::metadata(blob_path(&dir, &file_id).unwrap())
            .unwrap()
            .len();
        write_logical_range(
            &dir,
            &opened.header,
            &opened.content_key,
            &mut opened.index,
            "wide.bin",
            0,
            &third,
        )
        .unwrap();
        let len_after_reuse = std::fs::metadata(blob_path(&dir, &file_id).unwrap())
            .unwrap()
            .len();
        assert_eq!(
            len_after_reuse, len_after_seal,
            "a same-size rewrite must reuse the abandoned span"
        );

        let sealed = open_store(&dir, PW).unwrap();
        let got = read_logical_file(
            &dir,
            &sealed.header,
            &sealed.content_key,
            &sealed.index,
            "wide.bin",
        )
        .unwrap();
        assert_eq!(
            got, next,
            "the sealed generation must survive the next rewrite"
        );
    }

    #[test]
    fn a_second_unsealed_range_write_leaves_the_sealed_span() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(crate::paths::STORE_DIR_NAME);
        create_empty_store(&dir, PW, KdfUnlockPreset::M32).unwrap();
        let mut opened = open_store(&dir, PW).unwrap();
        let mut payload = vec![1u8; CHUNK_SIZE as usize];
        payload.extend(std::iter::repeat_n(2u8, CHUNK_SIZE as usize));
        write_logical_file(
            &dir,
            &opened.header,
            &opened.content_key,
            &mut opened.index,
            "wide.bin",
            &payload,
        )
        .unwrap();
        flush_index(&dir, &mut opened).unwrap();
        let (file_id, _, offset) = file_chunk_meta(&opened, "wide.bin", 0);
        assert_eq!(offset, 0);
        let sealed_bytes = read_chunk_bytes(&dir, &file_id, 0, CHUNK_SIZE);

        let replacement = vec![3u8; CHUNK_SIZE as usize];
        write_logical_range(
            &dir,
            &opened.header,
            &opened.content_key,
            &mut opened.index,
            "wide.bin",
            0,
            &replacement,
        )
        .unwrap();
        let other = vec![4u8; CHUNK_SIZE as usize];
        write_logical_range(
            &dir,
            &opened.header,
            &opened.content_key,
            &mut opened.index,
            "wide.bin",
            u64::from(CHUNK_SIZE),
            &other,
        )
        .unwrap();

        assert!(
            read_chunk_bytes(&dir, &file_id, 0, CHUNK_SIZE) == sealed_bytes,
            "the second rewrite must not overwrite the sealed span"
        );
        let reopened = open_store(&dir, PW).unwrap();
        let got = read_logical_file(
            &dir,
            &reopened.header,
            &reopened.content_key,
            &reopened.index,
            "wide.bin",
        )
        .unwrap();
        assert_eq!(got, payload);
    }

    #[test]
    fn pack_drops_dead_ciphertext() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(crate::paths::STORE_DIR_NAME);
        create_empty_store(&dir, PW, KdfUnlockPreset::M32).unwrap();
        let mut opened = open_store(&dir, PW).unwrap();
        write_logical_file(
            &dir,
            &opened.header,
            &opened.content_key,
            &mut opened.index,
            "notes.txt",
            b"generation-one",
        )
        .unwrap();
        flush_index(&dir, &mut opened).unwrap();
        write_logical_range(
            &dir,
            &opened.header,
            &opened.content_key,
            &mut opened.index,
            "notes.txt",
            0,
            b"generation-two",
        )
        .unwrap();
        let packed = pack_blob_waste(
            &dir,
            &opened.header,
            &opened.content_key,
            &mut opened.index,
            BlobPackMode::Close,
            None,
        )
        .unwrap();
        assert!(!packed.created.is_empty(), "dead ciphertext must be packed");
        packed.sync_before_index().unwrap();
        flush_index(&dir, &mut opened).unwrap();
        packed.delete_superseded();
        let file_id = opened.index.find("notes.txt").unwrap().as_file().unwrap().0;
        let len = std::fs::metadata(blob_path(&dir, file_id).unwrap())
            .unwrap()
            .len();
        assert_eq!(len, cipher_len(b"generation-two".len() as u32) as u64);
        let reopened = open_store(&dir, PW).unwrap();
        let got = read_logical_file(
            &dir,
            &reopened.header,
            &reopened.content_key,
            &reopened.index,
            "notes.txt",
        )
        .unwrap();
        assert_eq!(got, b"generation-two");
    }

    #[test]
    fn open_drops_unreferenced_blobs() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(crate::paths::STORE_DIR_NAME);
        create_empty_store(&dir, PW, KdfUnlockPreset::M32).unwrap();
        let mut opened = open_store(&dir, PW).unwrap();
        write_logical_file(
            &dir,
            &opened.header,
            &opened.content_key,
            &mut opened.index,
            "notes.txt",
            b"keep",
        )
        .unwrap();
        flush_index(&dir, &mut opened).unwrap();
        let orphan = dir.join(DATA_DIR_NAME).join(format!(
            "00000000-0000-4000-8000-000000000099{BLOB_FILE_SUFFIX}"
        ));
        std::fs::write(&orphan, b"orphan").unwrap();
        let _ = open_store(&dir, PW).unwrap();
        assert!(
            !orphan.exists(),
            "an unreferenced blob must be removed on open"
        );
        let reopened = open_store(&dir, PW).unwrap();
        let got = read_logical_file(
            &dir,
            &reopened.header,
            &reopened.content_key,
            &reopened.index,
            "notes.txt",
        )
        .unwrap();
        assert_eq!(got, b"keep");
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_blob_is_refused_and_the_target_stays() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(crate::paths::STORE_DIR_NAME);
        create_empty_store(&dir, PW, KdfUnlockPreset::M32).unwrap();
        let mut opened = open_store(&dir, PW).unwrap();
        write_logical_file(
            &dir,
            &opened.header,
            &opened.content_key,
            &mut opened.index,
            "notes.txt",
            b"generation-one",
        )
        .unwrap();
        flush_index(&dir, &mut opened).unwrap();
        let file_id = opened.index.find("notes.txt").unwrap().as_file().unwrap().0;
        let blob = blob_path(&dir, file_id).unwrap();
        std::fs::remove_file(&blob).unwrap();
        let target = tmp.path().join("outside.txt");
        std::fs::write(&target, b"do-not-touch").unwrap();
        std::os::unix::fs::symlink(&target, &blob).unwrap();
        let err = write_logical_range(
            &dir,
            &opened.header,
            &opened.content_key,
            &mut opened.index,
            "notes.txt",
            0,
            b"generation-two",
        )
        .unwrap_err();
        assert!(matches!(err, UprivError::VaultStoreInvalid { .. }), "{err}");
        assert_eq!(std::fs::read(&target).unwrap(), b"do-not-touch");
    }
}
