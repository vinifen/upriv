//! Logical files as XChaCha20-Poly1305 chunks under `store/data/`.
//!
//! On-disk names are opaque `file_id`s. Logical paths live only in the sealed index.

use std::path::{Path, PathBuf};

use uuid::Uuid;

use super::aead::{decrypt_xchacha, encrypt_xchacha, random_bytes, CONTENT_KEY_LEN};
use super::header::{chunk_aad, VaultHeader};
use super::index::{VaultIndex, VaultNode, DATA_DIR_NAME};
use crate::error::{Result, UprivError};
use crate::paths;

pub const CHUNK_FILE_SUFFIX: &str = ".chunk.enc";

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

pub fn chunk_file_path(
    store_dir: impl AsRef<Path>,
    file_id: &str,
    chunk_index: u32,
) -> Result<PathBuf> {
    let parsed = parse_file_id(file_id)?;
    Ok(store_dir
        .as_ref()
        .join(DATA_DIR_NAME)
        .join(format!("{parsed}.{chunk_index}{CHUNK_FILE_SUFFIX}")))
}

/// `{uuid}.{index}.{version}.chunk.enc` — unique per write so the sealed index
/// can name the new blob before the previous object is deleted.
pub fn chunk_file_path_versioned(
    store_dir: impl AsRef<Path>,
    file_id: &str,
    chunk_index: u32,
    version: &str,
) -> Result<PathBuf> {
    let parsed = parse_file_id(file_id)?;
    if version.is_empty() || !version.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(UprivError::VaultStoreInvalid {
            path: PathBuf::from(DATA_DIR_NAME),
            detail: "chunk version is not hex".into(),
        });
    }
    Ok(store_dir.as_ref().join(DATA_DIR_NAME).join(format!(
        "{parsed}.{chunk_index}.{version}{CHUNK_FILE_SUFFIX}"
    )))
}

fn existing_chunk_path(
    store_dir: &Path,
    file_id: &str,
    chunk_index: u32,
    version: &str,
) -> Option<PathBuf> {
    if !version.is_empty() {
        if let Ok(path) = chunk_file_path_versioned(store_dir, file_id, chunk_index, version) {
            if path.is_file() {
                return Some(path);
            }
        }
    }
    if let Ok(path) = chunk_file_path(store_dir, file_id, chunk_index) {
        if path.is_file() {
            return Some(path);
        }
    }
    None
}

fn locate_chunk_path(
    store_dir: &Path,
    file_id: &str,
    chunk_index: u32,
    version: &str,
) -> Result<PathBuf> {
    existing_chunk_path(store_dir, file_id, chunk_index, version).ok_or_else(|| {
        UprivError::VaultStoreInvalid {
            path: chunk_file_path(store_dir, file_id, chunk_index)
                .unwrap_or_else(|_| PathBuf::from(DATA_DIR_NAME)),
            detail: "missing chunk".into(),
        }
    })
}

pub fn chunk_count(file_size: u64, chunk_size: u32) -> u32 {
    if file_size == 0 {
        return 0;
    }
    let size = u64::from(chunk_size.max(1));
    file_size.div_ceil(size) as u32
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
    let parsed = parse_file_id(file_id)?;
    let prefix = format!("{parsed}.");
    let data_dir = store_dir.join(DATA_DIR_NAME);
    let Ok(entries) = std::fs::read_dir(&data_dir) else {
        return Ok(());
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let text = name.to_string_lossy();
        if text.starts_with(&prefix) && text.ends_with(CHUNK_FILE_SUFFIX) {
            match std::fs::remove_file(entry.path()) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.into()),
            }
        }
    }
    Ok(())
}

/// Previous generation left on disk until the sealed index names the new `file_id`.
#[derive(Debug, Clone)]
pub struct RetiredFileChunks {
    pub file_id: String,
    pub chunk_count: u32,
}

/// Blobs created by a mutation, plus objects the sealed index no longer names.
/// Delete `created` if the index flush fails; delete `superseded` only after it succeeds.
#[derive(Debug, Default, Clone)]
pub struct ChunkBlobMutation {
    pub created: Vec<PathBuf>,
    pub superseded: Vec<PathBuf>,
}

impl ChunkBlobMutation {
    pub fn merge(&mut self, other: Self) {
        self.created.extend(other.created);
        self.superseded.extend(other.superseded);
    }

    pub fn discard_created(&self) {
        for path in &self.created {
            let _ = std::fs::remove_file(path);
        }
    }

    pub fn delete_superseded(&self) {
        for path in &self.superseded {
            let _ = std::fs::remove_file(path);
        }
    }
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
    let data_dir = store_dir.join(DATA_DIR_NAME);
    std::fs::create_dir_all(&data_dir)?;

    let chunk_size_usize = chunk_size as usize;
    let mut mutation = ChunkBlobMutation::default();
    let mut chunk_versions = Vec::with_capacity(chunk_count(file_size, chunk_size) as usize);
    let written = (|| {
        for (chunk_index, slice) in plaintext.chunks(chunk_size_usize).enumerate() {
            let chunk_index = chunk_index as u32;
            let (version, piece) = encrypt_one_chunk(
                store_dir,
                header,
                content_key,
                &file_id,
                chunk_index,
                slice,
                "",
            )?;
            mutation.merge(piece);
            chunk_versions.push(version);
        }
        Ok(())
    })();
    if let Err(error) = written {
        mutation.discard_created();
        return Err(error);
    }

    if previous.is_some() {
        index.remove(logical_path);
    }
    let mut node = VaultNode::file(logical_path, file_id, file_size, chunk_versions);
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
    let _ = Uuid::parse_str(file_id).map_err(|_| UprivError::VaultStoreInvalid {
        path: PathBuf::from(DATA_DIR_NAME),
        detail: "file_id is not a UUID".into(),
    })?;
    let chunk_size = header.chunk_size;
    let count = chunk_count(size, chunk_size);
    // The index is the authenticated authority on length now that chunk AAD no
    // longer binds `file_size`; a version list that disagrees with the recorded
    // size means a tampered or truncated index, so fail before touching blobs.
    if chunk_versions.len() != count as usize {
        return Err(UprivError::VaultStoreInvalid {
            path: PathBuf::from(logical_path),
            detail: "chunk version count does not match file size".into(),
        });
    }
    let mut out = Vec::with_capacity(size as usize);
    for chunk_index in 0..count {
        let expected_len = chunk_plain_len(size, chunk_index, chunk_size);
        let plain = decrypt_one_chunk(
            store_dir,
            header,
            content_key,
            file_id,
            chunk_index,
            expected_len,
            &chunk_versions[chunk_index as usize],
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

fn decrypt_one_chunk(
    store_dir: &Path,
    header: &VaultHeader,
    content_key: &[u8; CONTENT_KEY_LEN],
    file_id: &str,
    chunk_index: u32,
    expected_len: u32,
    version: &str,
) -> Result<Vec<u8>> {
    let path = locate_chunk_path(store_dir, file_id, chunk_index, version)?;
    let blob = std::fs::read(&path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            UprivError::VaultStoreInvalid {
                path: path.clone(),
                detail: "missing chunk".into(),
            }
        } else {
            error.into()
        }
    })?;
    let aad = chunk_aad(header, file_id, chunk_index, expected_len, version)?;
    let plain = match decrypt_xchacha(content_key, &blob, &aad) {
        Ok(plain) => plain,
        Err(UprivError::WrongPassword) => {
            return Err(UprivError::VaultStoreInvalid {
                path,
                detail: "chunk tag failed".into(),
            });
        }
        Err(error) => return Err(error),
    };
    if plain.len() != expected_len as usize {
        return Err(UprivError::VaultStoreInvalid {
            path,
            detail: "chunk length mismatch".into(),
        });
    }
    Ok(plain)
}

fn encrypt_one_chunk(
    store_dir: &Path,
    header: &VaultHeader,
    content_key: &[u8; CONTENT_KEY_LEN],
    file_id: &str,
    chunk_index: u32,
    plaintext: &[u8],
    previous_version: &str,
) -> Result<(String, ChunkBlobMutation)> {
    let version = new_chunk_version();
    let aad = chunk_aad(
        header,
        file_id,
        chunk_index,
        plaintext.len() as u32,
        &version,
    )?;
    let blob = encrypt_xchacha(content_key, plaintext, &aad)?;
    let path = chunk_file_path_versioned(store_dir, file_id, chunk_index, &version)?;
    paths::write_bytes_atomic(&path, &blob)?;
    let mut mutation = ChunkBlobMutation {
        created: vec![path.clone()],
        superseded: Vec::new(),
    };
    if let Some(old) = existing_chunk_path(store_dir, file_id, chunk_index, previous_version) {
        if old != path {
            mutation.superseded.push(old);
        }
    }
    Ok((version, mutation))
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
    if len == 0 || offset >= size {
        return Ok(Vec::new());
    }
    let end = size.min(offset.saturating_add(len));
    let chunk_size = header.chunk_size;
    let first = (offset / u64::from(chunk_size)) as u32;
    let last = ((end - 1) / u64::from(chunk_size)) as u32;
    let mut out = Vec::with_capacity((end - offset) as usize);
    for chunk_index in first..=last {
        let expected_len = chunk_plain_len(size, chunk_index, chunk_size);
        let version =
            versions
                .get(chunk_index as usize)
                .ok_or_else(|| UprivError::VaultStoreInvalid {
                    path: PathBuf::from(logical_path),
                    detail: "chunk version missing".into(),
                })?;
        let plain = decrypt_one_chunk(
            store_dir,
            header,
            content_key,
            file_id,
            chunk_index,
            expected_len,
            version,
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
    let (file_id, old_size, old_versions, created_at) = {
        let node = index.find(logical_path).expect("checked");
        let Some((file_id, size, versions)) = node.as_file() else {
            return Err(UprivError::VaultStoreInvalid {
                path: PathBuf::from(logical_path),
                detail: "logical path is a directory".into(),
            });
        };
        (
            file_id.to_string(),
            size,
            versions.to_vec(),
            node.created_at,
        )
    };
    let write_end = offset.saturating_add(data.len() as u64);
    let new_size = old_size.max(write_end);
    let new_count = chunk_count(new_size, chunk_size);
    let old_count = chunk_count(old_size, chunk_size);
    let mut versions = old_versions;
    versions.resize(new_count as usize, String::new());
    let mut mutation = ChunkBlobMutation::default();

    let union_start = if offset > old_size { old_size } else { offset };
    let union_end = write_end;
    let written = (|| {
        if union_end > union_start {
            let first = (union_start / u64::from(chunk_size)) as u32;
            let last = ((union_end - 1) / u64::from(chunk_size)) as u32;
            for chunk_index in first..=last {
                let this_len = chunk_plain_len(new_size, chunk_index, chunk_size) as usize;
                let mut buf = vec![0u8; this_len];
                let old_len = chunk_plain_len(old_size, chunk_index, chunk_size) as usize;
                let previous_version = versions
                    .get(chunk_index as usize)
                    .cloned()
                    .unwrap_or_default();
                if old_len > 0 && !previous_version.is_empty() {
                    let old = decrypt_one_chunk(
                        store_dir,
                        header,
                        content_key,
                        &file_id,
                        chunk_index,
                        old_len as u32,
                        &previous_version,
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
                let (version, piece) = encrypt_one_chunk(
                    store_dir,
                    header,
                    content_key,
                    &file_id,
                    chunk_index,
                    &buf,
                    &previous_version,
                )?;
                mutation.merge(piece);
                versions[chunk_index as usize] = version;
            }
        }
        for extra in new_count..old_count {
            let extra_version = versions.get(extra as usize).cloned().unwrap_or_default();
            if let Some(path) = existing_chunk_path(store_dir, &file_id, extra, &extra_version) {
                mutation.superseded.push(path);
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
    let (file_id, _, versions, created_at) = {
        let node = index.find(logical_path).expect("exists");
        let (file_id, _, versions) = node.as_file().expect("file");
        (
            file_id.to_string(),
            0u64,
            versions.to_vec(),
            node.created_at,
        )
    };
    let new_count = chunk_count(new_size, chunk_size);
    let old_count = versions.len() as u32;
    let mut versions = versions;
    let trimmed = (|| {
        if new_size > 0 && new_count > 0 {
            let last = new_count - 1;
            let last_len = chunk_plain_len(new_size, last, chunk_size);
            let old_last_len = chunk_plain_len(old_size, last, chunk_size);
            if last_len < old_last_len {
                let previous_version = versions[last as usize].clone();
                let mut buf = decrypt_one_chunk(
                    store_dir,
                    header,
                    content_key,
                    &file_id,
                    last,
                    old_last_len,
                    &previous_version,
                )?;
                buf.truncate(last_len as usize);
                let (version, piece) = encrypt_one_chunk(
                    store_dir,
                    header,
                    content_key,
                    &file_id,
                    last,
                    &buf,
                    &previous_version,
                )?;
                mutation.merge(piece);
                versions[last as usize] = version;
            }
        }
        for extra in new_count..old_count {
            let extra_version = versions.get(extra as usize).cloned().unwrap_or_default();
            if let Some(path) = existing_chunk_path(store_dir, &file_id, extra, &extra_version) {
                mutation.superseded.push(path);
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
    if let Some(node) = index.find_mut(logical_path) {
        node.modified_at = crate::time::unix_millis();
        node.created_at = created_at;
        node.kind = crate::store::index::VaultNodeKind::File {
            file_id,
            size: new_size,
            chunk_versions: versions,
        };
    }
    Ok(mutation)
}

#[cfg(test)]
mod tests {
    use super::super::header::chunk_aad;
    use super::*;
    use crate::store::{create_empty_store, flush_index, open_store, KdfUnlockPreset, CHUNK_SIZE};

    const PW: &[u8] = b"chunk-round-trip-ok";

    fn on_disk_chunk(
        dir: &std::path::Path,
        file_id: &str,
        chunk_index: u32,
        version: &str,
    ) -> PathBuf {
        if let Ok(path) = chunk_file_path_versioned(dir, file_id, chunk_index, version) {
            if path.is_file() {
                return path;
            }
        }
        chunk_file_path(dir, file_id, chunk_index).unwrap()
    }

    fn file_chunk_meta(
        opened: &crate::store::OpenedStore,
        path: &str,
        chunk_index: usize,
    ) -> (String, String) {
        let (file_id, _, versions) = opened.index.find(path).unwrap().as_file().unwrap();
        (file_id.to_string(), versions[chunk_index].clone())
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
        flush_index(&dir, &opened).unwrap();
        let file_id = opened.index.find("wide.bin").unwrap().as_file().unwrap().0;
        (tmp, dir, data, file_id.to_string())
    }

    #[test]
    fn empty_file_has_no_chunk_files() {
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
        flush_index(&dir, &opened).unwrap();
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
        let (file_id, v0) = file_chunk_meta(&opened, "wide.bin", 0);
        let (_, v1) = file_chunk_meta(&opened, "wide.bin", 1);
        let a = std::fs::read(on_disk_chunk(&dir, &file_id, 0, &v0)).unwrap();
        let b = std::fs::read(on_disk_chunk(&dir, &file_id, 1, &v1)).unwrap();
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
        let (file_id, v0) = file_chunk_meta(&opened, "wide.bin", 0);
        let (_, v1) = file_chunk_meta(&opened, "wide.bin", 1);
        let p0 = on_disk_chunk(&dir, &file_id, 0, &v0);
        let p1 = on_disk_chunk(&dir, &file_id, 1, &v1);
        let tmp = dir.join("data").join("swap.tmp");
        std::fs::rename(&p0, &tmp).unwrap();
        std::fs::rename(&p1, &p0).unwrap();
        std::fs::rename(&tmp, &p1).unwrap();
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
        let (file_id, v0) = file_chunk_meta(&opened, "wide.bin", 0);
        let path = on_disk_chunk(&dir, &file_id, 0, &v0);
        let mut raw = std::fs::read(&path).unwrap();
        raw[24] ^= 0x01;
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
        let (file_id, v0) = file_chunk_meta(&opened, "wide.bin", 0);
        let blob = std::fs::read(on_disk_chunk(&dir, &file_id, 0, &v0)).unwrap();
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
        let (file_id, v0) = file_chunk_meta(&opened, "wide.bin", 0);
        let stale = std::fs::read(on_disk_chunk(&dir, &file_id, 0, &v0)).unwrap();

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
        flush_index(&dir, &opened).unwrap();

        // Put the old ciphertext back under the new file's chunk 0 path.
        let reopened = open_store(&dir, PW).unwrap();
        let (new_id, v_new) = file_chunk_meta(&reopened, "wide.bin", 0);
        std::fs::write(on_disk_chunk(&dir, &new_id, 0, &v_new), &stale).unwrap();

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
        flush_index(&dir, &opened).unwrap();

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
        flush_index(&dir, &opened).unwrap();
        let (old_id, old_version) = {
            let (file_id, _, versions) = opened.index.find("notes.txt").unwrap().as_file().unwrap();
            (file_id.to_string(), versions[0].clone())
        };
        let old_blob = on_disk_chunk(&dir, &old_id, 0, &old_version);
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
        flush_index(&dir, &opened).unwrap();
        let (old_id, old_version) = {
            let (file_id, _, versions) = opened.index.find("notes.txt").unwrap().as_file().unwrap();
            (file_id.to_string(), versions[0].clone())
        };
        let old_blob = on_disk_chunk(&dir, &old_id, 0, &old_version);
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
}
