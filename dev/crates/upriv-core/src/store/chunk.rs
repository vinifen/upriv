//! Logical files as XChaCha20-Poly1305 chunks under `store/data/`.
//!
//! One operating-system file per logical file:
//! `store/data/<hh>/<file_id>.blob`. It starts with the key copy
//! ([`super::key_copy`]), then holds the file's chunks, each
//! `nonce(24) || ciphertext || tag(16)`, then its recovery records
//! ([`super::record`]). The sealed index stores each chunk's byte offset,
//! version, and key. A rewrite writes the new ciphertext into a free span when
//! one fits, otherwise it appends. The previous generation stays until the
//! index that names the new offset is sealed. Dead spans are packed after that
//! seal when they are large, and again on close when the waste is worth a
//! copy. Logical paths live only in the sealed index.
//!
//! A read opens each chunk with the key its index entry names; a write seals
//! with the keyring's write key.

#[allow(unused_imports)]
use crate::host_fs::HostFsQuery;
use std::collections::HashSet;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use uuid::Uuid;
use zeroize::Zeroizing;

use super::aead::{
    decrypt_xchacha, encrypt_xchacha_with_nonce, random_bytes, XCHACHA_NONCE_LEN, XCHACHA_TAG_LEN,
};
use super::header::{chunk_aad, CHUNK_SIZE};
use super::index::{
    sha256_hex, ChunkList, ChunkVersion, DeadBlobSpan, FileProblem, SessionWrites, VaultIndex,
    VaultNode, DATA_DIR_NAME,
};
use super::key_copy::{write_key_copy, KEY_COPY_LEN};
use super::keys::{KeyId, Keyring};
use super::record::Records;
use crate::error::{Result, UprivError};

pub const BLOB_FILE_SUFFIX: &str = ".blob";

pub const SEED_LOGICAL_PATH: &str = "upriv-seed.txt";

/// Max plaintext for a single full-file RPC (`vault_fs_read` / `vault_fs_write`).
/// Larger files use range RPCs. Sized for NDJSON + base64 under the 8 MiB envelope.
pub const VAULT_FS_MAX_INLINE_BYTES: u64 = 4 * 1024 * 1024;

/// The zero bytes a write past the end fills in.
fn hash_zeros(hasher: &mut Sha256, mut len: u64) {
    const ZEROS: [u8; 4096] = [0; 4096];
    while len > 0 {
        let n = len.min(ZEROS.len() as u64) as usize;
        hasher.update(&ZEROS[..n]);
        len -= n as u64;
    }
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

pub(super) fn cipher_len(plain_len: u32) -> usize {
    plain_len as usize + XCHACHA_NONCE_LEN + XCHACHA_TAG_LEN
}

fn blob_file_name(file_id: &Uuid) -> String {
    format!("{file_id}{BLOB_FILE_SUFFIX}")
}

/// Path of this file's blob: `store/data/<hh>/<file_id>.blob`, where `<hh>`
/// is the first two hex digits of the id, so blobs spread across 256 directories.
pub fn blob_path(store_dir: impl AsRef<Path>, file_id: &str) -> Result<PathBuf> {
    let file_id = parse_file_id(file_id)?;
    let simple = file_id.simple().to_string();
    Ok(store_dir
        .as_ref()
        .join(DATA_DIR_NAME)
        .join(&simple[..2])
        .join(blob_file_name(&file_id)))
}

pub fn chunk_count(file_size: u64, chunk_size: u32) -> u32 {
    if file_size == 0 {
        return 0;
    }
    let size = u64::from(chunk_size.max(1));
    file_size.div_ceil(size) as u32
}

/// The file at `logical_path` cannot be read in full.
fn unreadable(logical_path: &str, problem: FileProblem) -> UprivError {
    UprivError::VaultFileUnreadable {
        path: logical_path.to_string(),
        problem,
    }
}

/// A chunk list that does not match the recorded size cannot be read: the
/// sealed index is the authority on length.
fn require_chunk_lists(logical_path: &str, count: u32, chunks: &ChunkList) -> Result<()> {
    let count = count as usize;
    if chunks.versions.len() == count && chunks.keys.len() == count && chunks.offsets.len() == count
    {
        return Ok(());
    }
    Err(unreadable(logical_path, FileProblem::Damaged))
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

/// One logical file, held open so every chunk is written once and the caller
/// flushes it once.
struct OpenBlob {
    file: crate::host_fs::File,
    path: PathBuf,
    position: u64,
    created: bool,
    rollback_len: u64,
    /// The blob's newest recovery record, `(start, length)` ([`open_blob`]):
    /// chunk placement keeps off it, so it stays readable until a later one
    /// replaces it.
    record: Option<(u64, u64)>,
}

/// Opening the blob of the file at `logical_path` failed. A blob that is gone
/// means its data is missing; a link or a special file in its place (refused
/// as `InvalidInput`) is damaged data. Anything else is an I/O failure that
/// says nothing about the file.
fn blob_open_error(logical_path: &str, error: std::io::Error) -> UprivError {
    match error.kind() {
        std::io::ErrorKind::NotFound => unreadable(logical_path, FileProblem::Missing),
        std::io::ErrorKind::InvalidInput => unreadable(logical_path, FileProblem::Damaged),
        _ => error.into(),
    }
}

impl OpenBlob {
    /// Make the blob of `file_id`, its key copy written first from the block
    /// `keys` came from. Its first chunk goes right after it.
    fn create(store_dir: &Path, file_id: &str, keys: &Keyring) -> Result<Self> {
        Self::create_at(blob_path(store_dir, file_id)?, file_id, keys)
    }

    /// [`Self::create`] at `path`, which need not be in `data/`: a held blob
    /// a password change copies stays in `held/`.
    fn create_at(path: PathBuf, file_id: &str, keys: &Keyring) -> Result<Self> {
        if let Some(shard) = path.parent() {
            crate::host_fs::create_dir_all(shard)?;
        }
        let mut file = crate::paths::open_nofollow(&path, crate::paths::NofollowMode::CreateNew)?;
        let written = write_key_copy(&mut file, keys, parse_file_id(file_id)?);
        if let Err(error) = written {
            drop(file);
            let _ = crate::host_fs::remove_file(&path);
            return Err(error);
        }
        Ok(Self {
            file,
            path,
            position: KEY_COPY_LEN,
            created: true,
            rollback_len: 0,
            record: None,
        })
    }

    fn append(path: PathBuf, logical_path: &str) -> Result<Self> {
        let mut file = crate::paths::open_nofollow(&path, crate::paths::NofollowMode::ReadWrite)
            .map_err(|error| blob_open_error(logical_path, error))?;
        let position = file.metadata()?.len();
        let record = super::record::newest_record_span(&mut file, position);
        Ok(Self {
            file,
            path,
            position,
            created: false,
            rollback_len: position,
            record,
        })
    }

    /// Keep chunk placement off the newest record.
    fn protect_record(&self, occupied: &mut Vec<(u64, u64)>) {
        occupied.extend(self.record);
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
            // A storage-access fd often rejects the preallocation and still
            // keeps the bytes just written. Do not treat that as a longer file.
            let grown = self
                .file
                .metadata()
                .is_ok_and(|meta| meta.len() >= reserve_end);
            self.position = if grown {
                reserve_end
            } else {
                self.position.max(offset.saturating_add(need))
            };
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

/// The blob of the file at `logical_path`, open for writing. `allow_create`
/// makes a missing blob for a file that has no chunks yet.
///
/// Its newest record is the one its last bytes end with. Once this session
/// writes chunks after it, the blob no longer ends with it, so `writes` keeps
/// where it is for every later write of the session.
fn open_blob(
    store_dir: &Path,
    file_id: &str,
    allow_create: bool,
    logical_path: &str,
    writes: &mut SessionWrites,
    keys: &Keyring,
) -> Result<OpenBlob> {
    let path = blob_path(store_dir, file_id)?;
    match crate::host_fs::entry_kind(&path) {
        Ok(crate::host_fs::EntryKind::File) => {
            let mut blob = OpenBlob::append(path, logical_path)?;
            match blob.record {
                Some(span) => {
                    writes.records.insert(file_id.to_string(), span);
                }
                None => blob.record = writes.records.get(file_id).copied(),
            }
            Ok(blob)
        }
        Ok(_) => Err(unreadable(logical_path, FileProblem::Damaged)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound && allow_create => {
            OpenBlob::create(store_dir, file_id, keys)
        }
        Err(error) => Err(blob_open_error(logical_path, error)),
    }
}

/// The first offset at or after the key copy where `need` bytes fit between
/// the `occupied` spans, or the end of the file.
fn first_fit(file_len: u64, need: u64, occupied: &[(u64, u64)]) -> u64 {
    let mut spans: Vec<(u64, u64)> = occupied
        .iter()
        .copied()
        .filter(|(_, len)| *len > 0)
        .collect();
    spans.sort_unstable_by_key(|(off, _)| *off);
    let mut cursor = KEY_COPY_LEN;
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

/// Live ciphertext of the chunks at `offsets`, each `plain_lens` long, extended
/// to one full-chunk slot when the following bytes are padding this chunk
/// reserved rather than the next chunk.
fn occupied_spans(
    offsets: &[u64],
    plain_lens: &[u32],
    file_len: u64,
    slot: u64,
) -> Vec<(u64, u64)> {
    let mut items: Vec<(u64, u64)> = offsets
        .iter()
        .zip(plain_lens)
        .map(|(off, plain)| (*off, cipher_len(*plain) as u64))
        .collect();
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
}

/// One logical file put back when a pack seal does not land.
#[derive(Debug, Clone)]
struct PackNodeRollback {
    logical_path: String,
    file_id: String,
    chunks: ChunkList,
    content_digest: Option<super::index::ContentDigest>,
}

/// Blobs created by a mutation, plus objects the sealed index no longer names.
/// Delete `created` if the seal fails with the previous index still in place;
/// let `superseded` go only after a seal that flushed.
#[derive(Debug, Default, Clone)]
pub struct ChunkBlobMutation {
    pub created: Vec<PathBuf>,
    /// Appends to roll back when the index is not sealed. `(path, length before this write)`.
    pub truncate_to: Vec<(PathBuf, u64)>,
    pub superseded: Vec<PathBuf>,
    /// Blobs whose file lost chunks with none written: nothing to flush, but
    /// their newest record no longer matches, so the close writes one
    /// ([`StagedBlobs`]).
    trimmed: Vec<PathBuf>,
    /// Blobs of `created` that already carry their first record, written by
    /// the import that made them ([`super::record::record_made_blob`]).
    recorded: Vec<PathBuf>,
    /// Nodes a pack rewrote. Restored without cloning the rest of the index.
    pack_rollback: Vec<PackNodeRollback>,
}

/// Flush the blob at `path`, made whole with its record, and the folders that
/// name it, before an index names it: a held blob a password change rewrote.
pub(crate) fn flush_made_blob(path: &Path) -> Result<()> {
    ChunkBlobMutation {
        created: vec![path.to_path_buf()],
        ..ChunkBlobMutation::default()
    }
    .flush_unnamed()
}

impl ChunkBlobMutation {
    pub fn merge(&mut self, other: Self) {
        self.created.extend(other.created);
        self.truncate_to.extend(other.truncate_to);
        self.superseded.extend(other.superseded);
        self.trimmed.extend(other.trimmed);
        self.recorded.extend(other.recorded);
        self.pack_rollback.extend(other.pack_rollback);
    }

    /// Put packed nodes back to the file id and offsets from before the pack.
    pub(crate) fn restore_packed_nodes(&self, index: &mut VaultIndex) {
        for item in &self.pack_rollback {
            let Some(node) = index.find_mut(&item.logical_path) else {
                continue;
            };
            let packed_id = node.as_file().map(|(file_id, _, _)| file_id.to_string());
            node.set_storage(item.file_id.clone(), item.chunks.clone());
            node.content_digest = item.content_digest.clone();
            if let Some(packed_id) = packed_id {
                index.writes.moved_blob(&packed_id, &item.file_id);
                // The old blob still holds its dead bytes.
                index.writes.rewritten_blobs.insert(item.file_id.clone());
            }
        }
    }

    pub fn discard_created(&self) {
        for path in &self.created {
            let _ = crate::host_fs::remove_file(path);
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

    /// The file ids of the blobs the new index no longer names. The caller lets
    /// them go once that index is sealed.
    pub(crate) fn superseded_ids(&self) -> Vec<String> {
        self.superseded
            .iter()
            .filter_map(|path| blob_file_id(path))
            .map(str::to_string)
            .collect()
    }

    /// Record and flush what this write put on disk ([`StagedBlobs::sync`]).
    /// Call it before the index that names those bytes is sealed, with that
    /// index in `records`. Only for a write that made all its blobs: a flush
    /// that fails here is not remembered, so the caller deletes them. A write
    /// that grew a blob is flushed with the session's staged blobs instead.
    pub(crate) fn sync_before_index(&self, records: &Records<'_>) -> Result<()> {
        debug_assert!(
            self.truncate_to.is_empty() && self.trimmed.is_empty(),
            "a grown blob is staged"
        );
        let mut staged = StagedBlobs::default();
        staged.add(self);
        staged.sync(records, RecordsDue::Made)
    }

    /// The blobs this write made carry their first record already: a seal
    /// that stages them writes none.
    pub(crate) fn mark_recorded(&mut self) {
        self.recorded.clone_from(&self.created);
    }

    /// A blob this write made has no record yet.
    pub(crate) fn owes_record(&self) -> bool {
        self.created
            .iter()
            .any(|path| !self.recorded.contains(path))
    }

    /// Flush the blobs this write made while no index can name them yet, so
    /// the long flush runs before the caller takes the session. Their record,
    /// appended before ([`Self::mark_recorded`]), goes with that flush.
    pub(crate) fn flush_unnamed(&self) -> Result<()> {
        debug_assert!(
            self.truncate_to.is_empty() && self.trimmed.is_empty(),
            "a grown blob is staged"
        );
        let mut staged = StagedBlobs::default();
        staged.add(self);
        staged.flush()
    }
}

/// Which blobs a seal writes recovery records to ([`super::record`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RecordsDue {
    /// The blobs made since the last seal.
    Made,
    /// Also every blob written since its last record: the seal of a close.
    All,
}

/// Blobs written since the last seal, and the folders that name them.
///
/// [`StagedBlobs::sync`] puts all of it on disk before an index names those
/// bytes: each blob, each folder that holds a new blob, then the folder above
/// it (`data/`, which names the shard folders). Whoever made a shard folder,
/// its name is flushed with every seal that names a new blob in it.
///
/// Before that flush it appends the recovery records the seal owes
/// ([`super::record`]): one to each blob made since the last seal that its
/// import did not record already, and, at a close, one to each blob written
/// or trimmed since its last record. While a pass is due
/// ([`VaultIndex::key_copies_due`]), it also writes the header's key copy
/// into each existing blob it flushes, with that flush; a blob made since
/// the last seal has it already. It reads none.
///
/// A blob whose flush failed is never flushed again, since a second `fsync`
/// can report success for bytes the first one lost. Its files are copied to a
/// new blob before the next seal ([`Self::failed_ids`]). When a folder's flush
/// fails, every blob staged under it counts as failed the same way: its name
/// may not be on disk, and only a copy under a new name, flushed with its own
/// folder, is trusted.
#[derive(Debug, Default)]
pub(crate) struct StagedBlobs {
    /// Every blob written, made or grown, still to flush.
    written: HashSet<PathBuf>,
    /// Blobs made since the last seal: their key copy is the one they were
    /// made with.
    created: HashSet<PathBuf>,
    /// Blobs made since the last seal, which records them.
    made: HashSet<PathBuf>,
    /// Blobs written or trimmed after their last record. Kept from seal to
    /// seal until the close records them ([`RecordsDue::All`]).
    behind: HashSet<PathBuf>,
    /// Folders that hold a blob made or moved in since the last seal.
    holders: HashSet<PathBuf>,
    /// Blobs whose flush failed.
    failed: HashSet<PathBuf>,
    /// A copy of the failed blobs could not be flushed either.
    copy_failed: bool,
}

impl StagedBlobs {
    pub(crate) fn add(&mut self, mutation: &ChunkBlobMutation) {
        for path in &mutation.created {
            self.add_holder_of(path);
            self.written.insert(path.clone());
            self.created.insert(path.clone());
            if !mutation.recorded.contains(path) {
                self.made.insert(path.clone());
            }
        }
        for (path, _) in &mutation.truncate_to {
            if self.failed.contains(path) {
                continue;
            }
            if !self.written.contains(path) {
                self.written.insert(path.clone());
            }
            self.note_behind(path);
        }
        for path in &mutation.trimmed {
            if !self.failed.contains(path) {
                self.note_behind(path);
            }
        }
    }

    /// A blob that changed after its last record. One made since the last
    /// seal gets its record at that seal anyway.
    fn note_behind(&mut self, path: &Path) {
        if !self.made.contains(path) && !self.behind.contains(path) {
            self.behind.insert(path.to_path_buf());
        }
    }

    /// A blob moved in whole, into `data/` or `held/`: its bytes are on disk
    /// already, so only its folder and the one above are flushed.
    pub(crate) fn add_moved(&mut self, blob: &Path) {
        self.add_holder_of(blob);
    }

    fn add_holder_of(&mut self, blob: &Path) {
        if let Some(folder) = blob.parent() {
            if !self.holders.contains(folder) {
                self.holders.insert(folder.to_path_buf());
            }
        }
    }

    /// The file ids of the blobs whose flush failed since the last seal.
    pub(crate) fn failed_ids(&self) -> Vec<String> {
        self.failed
            .iter()
            .filter_map(|path| blob_file_id(path))
            .map(str::to_string)
            .collect()
    }

    /// A copy of the failed blobs could not be flushed either: on a disk
    /// whose flushes keep failing, the timed retry of the seal waits for the
    /// next change or close rather than copy the same files again.
    pub(crate) fn note_copy_failed(&mut self) {
        self.copy_failed = true;
    }

    pub(crate) fn copy_failed(&self) -> bool {
        self.copy_failed
    }

    /// After a seal: everything staged is on disk or was copied. The blobs
    /// behind their records stay for the close, except the failed ones, whose
    /// files the seal moved to copies.
    pub(crate) fn clear(&mut self) {
        let failed = std::mem::take(&mut self.failed);
        self.behind.retain(|path| !failed.contains(path));
        self.written.clear();
        self.created.clear();
        self.made.clear();
        self.holders.clear();
        self.copy_failed = false;
    }

    /// The pass wrote the key copy of the blob at `path`
    /// ([`super::pass`]): flush it now, through this set, so a failed flush
    /// marks it like any other ([`Self::failed_ids`]). The flush also covers
    /// any chunk a write staged in that blob.
    pub(crate) fn flush_key_copy(&mut self, path: &Path) -> Result<()> {
        if self.failed.contains(path) {
            return Ok(());
        }
        match flush_present(crate::paths::sync_file_durable(path)) {
            Ok(()) => {
                self.written.remove(path);
                Ok(())
            }
            Err(error) => {
                self.written.remove(path);
                self.failed.insert(path.to_path_buf());
                Err(error)
            }
        }
    }

    /// Append the records `due` ([`super::record::append_records`]), from the
    /// tree in `records`, which the caller seals next, and the key copies a
    /// due pass owes; then [`Self::flush`].
    pub(crate) fn sync(&mut self, records: &Records<'_>, due: RecordsDue) -> Result<()> {
        let mut owed: Vec<PathBuf> = self
            .made
            .drain()
            .filter(|path| !self.failed.contains(path))
            .collect();
        if due == RecordsDue::All {
            owed.extend(
                self.behind
                    .drain()
                    .filter(|path| !self.failed.contains(path)),
            );
        }
        for path in super::record::append_records(records, &owed) {
            if !self.written.contains(&path) {
                self.written.insert(path);
            }
        }
        if records.index.key_copies_due {
            self.write_key_copies(records.keys);
        }
        self.flush()
    }

    /// Write the header's key copy into each grown blob this sync flushes. A
    /// blob it cannot be written to counts as failed: its files are copied.
    fn write_key_copies(&mut self, keys: &Keyring) {
        let grown: Vec<PathBuf> = self
            .written
            .iter()
            .filter(|path| !self.created.contains(*path))
            .cloned()
            .collect();
        for path in grown {
            let written = blob_file_id(&path)
                .and_then(|id| Uuid::parse_str(id).ok())
                .ok_or(())
                .and_then(|file_id| {
                    let mut file =
                        crate::paths::open_nofollow(&path, crate::paths::NofollowMode::ReadWrite)
                            .map_err(|_| ())?;
                    write_key_copy(&mut file, keys, file_id).map_err(|_| ())
                });
            if written.is_err() {
                self.written.remove(&path);
                self.failed.insert(path);
            }
        }
    }

    /// Flush the folders of blobs moved in whole ([`Self::add_moved`]). Such
    /// moves write nothing to a blob, so they owe no record.
    pub(crate) fn sync_moves(&mut self) -> Result<()> {
        debug_assert!(self.written.is_empty(), "a written blob is recorded");
        self.flush()
    }

    /// Flush every staged blob, then [`Self::folders`]. A blob or folder that
    /// went away meanwhile holds nothing to flush: the file that names it reads
    /// as missing, and every other change still seals. A blob whose flush
    /// fails moves to the failed set, and the error is returned once every
    /// other blob is flushed. A folder whose flush fails moves every blob
    /// staged under it to the failed set.
    fn flush(&mut self) -> Result<()> {
        let mut first_error = None;
        for path in &self.written {
            if let Err(error) = flush_present(crate::paths::sync_file_durable(path)) {
                self.failed.insert(path.clone());
                first_error.get_or_insert(error);
            }
        }
        self.written.retain(|path| !self.failed.contains(path));
        if let Some(error) = first_error {
            return Err(error);
        }
        #[cfg(unix)]
        {
            let failed_folder = self.folders().into_iter().find_map(|folder| {
                flush_present(flush_folder(folder))
                    .err()
                    .map(|error| (folder.to_path_buf(), error))
            });
            if let Some((folder, error)) = failed_folder {
                self.fail_under(&folder);
                return Err(error);
            }
        }
        Ok(())
    }

    /// Every blob staged under `folder` counts as failed, and `folder` is not
    /// flushed again for them.
    #[cfg(unix)]
    fn fail_under(&mut self, folder: &Path) {
        let under: Vec<PathBuf> = self
            .written
            .iter()
            .filter(|path| path.starts_with(folder))
            .cloned()
            .collect();
        for path in under {
            self.written.remove(&path);
            self.failed.insert(path);
        }
        self.holders.retain(|holder| !holder.starts_with(folder));
    }

    /// The folders a sync flushes, each once: the folders that hold a new
    /// blob, then the folder above each (`data/` above a shard folder).
    #[cfg_attr(not(any(unix, test)), allow(dead_code))]
    fn folders(&self) -> Vec<&Path> {
        let mut folders: Vec<&Path> = self.holders.iter().map(PathBuf::as_path).collect();
        for holder in &self.holders {
            if let Some(above) = holder.parent() {
                if !folders.contains(&above) {
                    folders.push(above);
                }
            }
        }
        folders
    }
}

/// Flush one folder that names staged blobs.
#[cfg(unix)]
fn flush_folder(folder: &Path) -> Result<()> {
    #[cfg(test)]
    if crate::paths::take_failed_blob_folder_flush() {
        return Err(std::io::Error::other("test: blob folder flush failed").into());
    }
    crate::paths::sync_dir_durable(folder)
}

/// A path that went away holds nothing to flush.
fn flush_present(flushed: Result<()>) -> Result<()> {
    match flushed {
        Err(UprivError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        other => other,
    }
}

/// Encrypt `plaintext` into `store/data/` and record it in `index` (caller seals the index).
///
/// Does **not** delete the previous `file_id` blobs. Call [`remove_file_chunks`] after
/// a successful index flush so a crash still decrypts the old generation.
pub fn write_logical_file(
    store_dir: impl AsRef<Path>,
    keys: &Keyring,
    index: &mut VaultIndex,
    logical_path: &str,
    plaintext: &[u8],
) -> Result<(Option<RetiredFileChunks>, ChunkBlobMutation)> {
    validate_logical_path(logical_path)?;
    let store_dir = store_dir.as_ref();
    if let Some(node) = index.find(logical_path) {
        if node.as_file().is_none() {
            return Err(UprivError::VaultStoreInvalid {
                path: PathBuf::from(logical_path),
                detail: "logical path is a directory".into(),
            });
        }
    }
    let previous = index.find(logical_path).and_then(|node| {
        node.as_file().map(|(file_id, _, _)| {
            (
                RetiredFileChunks {
                    file_id: file_id.to_string(),
                },
                node.created_at,
            )
        })
    });
    let created_at = previous.as_ref().map(|(_, created_at)| *created_at);

    let file_id = Uuid::new_v4().to_string();
    let file_size = plaintext.len() as u64;
    let count = chunk_count(file_size, CHUNK_SIZE);
    let mut chunks = ChunkList::with_capacity(count as usize);
    let mutation = if count == 0 {
        ChunkBlobMutation::default()
    } else {
        let mut blob = OpenBlob::create(store_dir, &file_id, keys)?;
        let written = (|| {
            for (chunk_index, slice) in plaintext.chunks(CHUNK_SIZE as usize).enumerate() {
                let (version, key, offset) =
                    append_chunk(&mut blob, keys, &file_id, chunk_index as u32, slice)?;
                chunks.push(version, key, offset);
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

    if let Some((retired, _)) = &previous {
        index.writes.forget_stream(&retired.file_id);
    }
    let mut node = VaultNode::file(logical_path, file_id.clone(), file_size, chunks);
    if let Some(created_at) = created_at {
        node.created_at = created_at;
    }
    let hasher = index.writes.track_digests.then(|| {
        let mut hasher = Sha256::new();
        hasher.update(plaintext);
        node.bind_digest(sha256_hex(hasher.clone()));
        hasher
    });
    index.put(node);
    if let Some(hasher) = hasher {
        // A later write at the end keeps extending this digest.
        index.put_digest_stream(&file_id, hasher, file_size);
    }
    Ok((previous.map(|(retired, _)| retired), mutation))
}

/// What a read does with a chunk whose data is missing or damaged.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Unreadable {
    /// Fail with [`UprivError::VaultFileUnreadable`].
    Fail,
    /// Note the problem and carry on, so the file keeps its size and every
    /// readable part stays where it was.
    Keep,
}

/// The chunks of one file, read in order. With [`Unreadable::Keep`] a blob
/// that cannot be opened leaves every chunk unread, and each chunk that fails
/// is unread on its own: [`Self::chunk`] hands on zeros of its length,
/// [`Self::try_chunk`] hands on nothing.
struct ChunkReader<'a> {
    keys: &'a Keyring,
    logical_path: &'a str,
    file_id: &'a str,
    size: u64,
    chunks: ChunkList,
    /// `None` once the blob could not be opened, or its chunk lists do not
    /// match the size (keep mode only).
    blob: Option<BlobRead>,
    mode: Unreadable,
    /// The first problem met; keep mode only.
    problem: Option<FileProblem>,
}

impl<'a> ChunkReader<'a> {
    /// The chunks of `node` from its blob in `data/`. `None` for a file with
    /// no chunks.
    fn open(
        store_dir: &Path,
        keys: &'a Keyring,
        node: &'a VaultNode,
        mode: Unreadable,
    ) -> Result<Option<Self>> {
        let file_id = node.as_file().map_or("", |(file_id, _, _)| file_id);
        let path = blob_path(store_dir, file_id);
        Self::open_at(path, keys, node, mode)
    }

    /// [`Self::open`] from the blob at `path`, which a held blob's file names
    /// in `held/`.
    fn open_at(
        path: Result<PathBuf>,
        keys: &'a Keyring,
        node: &'a VaultNode,
        mode: Unreadable,
    ) -> Result<Option<Self>> {
        let directory = || UprivError::VaultStoreInvalid {
            path: PathBuf::from(&node.path),
            detail: "logical path is a directory".into(),
        };
        let (file_id, size, _) = node.as_file().ok_or_else(directory)?;
        let chunks = node.chunks().ok_or_else(directory)?;
        parse_file_id(file_id)?;
        let path = path?;
        if chunk_count(size, CHUNK_SIZE) == 0 {
            return Ok(None);
        }
        let mut reader = Self {
            keys,
            logical_path: &node.path,
            file_id,
            size,
            chunks,
            blob: None,
            mode,
            problem: None,
        };
        // The sealed index is the authority on length. A list that disagrees
        // with the recorded size fails before any blob is opened.
        let opened = require_chunk_lists(&node.path, reader.count(), &reader.chunks)
            .and_then(|()| open_blob_read(path, &node.path));
        match opened {
            Ok(blob) => reader.blob = Some(blob),
            Err(error) => reader.absorb(error)?,
        }
        Ok(Some(reader))
    }

    fn count(&self) -> u32 {
        chunk_count(self.size, CHUNK_SIZE)
    }

    /// Keep a missing or damaged part in keep mode; fail with anything else.
    fn absorb(&mut self, error: UprivError) -> Result<()> {
        match error {
            UprivError::VaultFileUnreadable { problem, .. } if self.mode == Unreadable::Keep => {
                self.problem.get_or_insert(problem);
                Ok(())
            }
            other => Err(other),
        }
    }

    fn plain_len(&self, index: u32) -> u32 {
        chunk_plain_len(self.size, index, CHUNK_SIZE)
    }

    fn sealed(&self, index: u32) -> SealedChunk<'a> {
        let at = index as usize;
        SealedChunk {
            logical_path: self.logical_path,
            file_id: self.file_id,
            index,
            plain_len: self.plain_len(index),
            version: self.chunks.versions[at],
            key: self.chunks.keys[at],
            offset: self.chunks.offsets[at],
        }
    }

    /// Plaintext of chunk `index`, or `None` in keep mode when its data is
    /// missing or damaged.
    fn try_chunk(&mut self, index: u32) -> Result<Option<Zeroizing<Vec<u8>>>> {
        let chunk = self.sealed(index);
        let Some(blob) = self.blob.as_mut() else {
            return Ok(None);
        };
        match decrypt_one_chunk(blob, self.keys, chunk) {
            Ok(plain) => Ok(Some(Zeroizing::new(plain))),
            Err(error) => self.absorb(error).map(|()| None),
        }
    }

    /// The sealed bytes of chunk `index` as its blob holds them, with zeros
    /// where the blob holds none: what a copy carries for a chunk it cannot
    /// read ([`carry_unreadable`]).
    fn raw_chunk(&mut self, index: u32) -> Result<Vec<u8>> {
        let chunk = self.sealed(index);
        let mut bytes = vec![0u8; cipher_len(chunk.plain_len)];
        let Some(blob) = self.blob.as_mut() else {
            return Ok(bytes);
        };
        blob.file.seek(SeekFrom::Start(chunk.offset))?;
        let mut filled = 0;
        while filled < bytes.len() {
            match blob.file.read(&mut bytes[filled..]) {
                Ok(0) => break,
                Ok(read) => filled += read,
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
                Err(error) => return Err(error.into()),
            }
        }
        Ok(bytes)
    }

    /// Plaintext of chunk `index`, or zeros of its length in keep mode when
    /// its data is missing or damaged.
    fn chunk(&mut self, index: u32) -> Result<Zeroizing<Vec<u8>>> {
        let plain_len = self.plain_len(index);
        Ok(self
            .try_chunk(index)?
            .unwrap_or_else(|| Zeroizing::new(vec![0u8; plain_len as usize])))
    }
}

/// Decrypt the file `node` one chunk at a time, in order, and hand each chunk
/// to `sink`, for work that keeps every file, such as an export. A chunk
/// reaches `sink` only after its tag and AAD check out, and its buffer is
/// wiped when `sink` drops it. A chunk whose data is missing or damaged
/// reaches `sink` as zeros of its length, so the file keeps its size and every
/// readable part stays where it was. Returns what kept the file from being
/// read in full. Any other failure ends the read.
pub(crate) fn read_file_chunks_keeping(
    store_dir: &Path,
    keys: &Keyring,
    node: &VaultNode,
    sink: impl FnMut(Zeroizing<Vec<u8>>) -> Result<()>,
) -> Result<Option<FileProblem>> {
    read_chunks(store_dir, keys, node, Unreadable::Keep, sink)
}

/// Each chunk of `node` in order, as its length in the index says, so the
/// chunks add up to the file size.
fn read_chunks(
    store_dir: &Path,
    keys: &Keyring,
    node: &VaultNode,
    mode: Unreadable,
    mut sink: impl FnMut(Zeroizing<Vec<u8>>) -> Result<()>,
) -> Result<Option<FileProblem>> {
    let Some(mut reader) = ChunkReader::open(store_dir, keys, node, mode)? else {
        return Ok(None);
    };
    for index in 0..reader.count() {
        sink(reader.chunk(index)?)?;
    }
    Ok(reader.problem)
}

/// Decrypt one logical file into RAM. Tag / AAD failure returns no plaintext:
/// missing or damaged data fails with [`UprivError::VaultFileUnreadable`].
pub fn read_logical_file(
    store_dir: impl AsRef<Path>,
    keys: &Keyring,
    index: &VaultIndex,
    logical_path: &str,
) -> Result<Vec<u8>> {
    let node = index
        .find(logical_path)
        .ok_or_else(|| UprivError::VaultPathNotFound(logical_path.into()))?;
    let size = node.as_file().map_or(0, |(_, size, _)| size);
    let mut out = Vec::with_capacity(usize::try_from(size).unwrap_or(0));
    let sink = |chunk: Zeroizing<Vec<u8>>| {
        out.extend_from_slice(&chunk);
        Ok(())
    };
    read_chunks(store_dir.as_ref(), keys, node, Unreadable::Fail, sink)?;
    Ok(out)
}

struct BlobRead {
    file: crate::host_fs::File,
    path: PathBuf,
}

fn open_blob_read(path: PathBuf, logical_path: &str) -> Result<BlobRead> {
    let file = crate::paths::open_nofollow(&path, crate::paths::NofollowMode::Read)
        .map_err(|error| blob_open_error(logical_path, error))?;
    Ok(BlobRead { file, path })
}

struct SealedChunk<'a> {
    /// The file this chunk belongs to, named by a read that cannot finish.
    logical_path: &'a str,
    file_id: &'a str,
    index: u32,
    plain_len: u32,
    version: ChunkVersion,
    /// The key it is sealed with.
    key: KeyId,
    offset: u64,
}

/// Read and open one chunk with the key its index entry names. A blob that
/// ends before the chunk means its data is missing; a tag that fails, or a
/// chunk with no key or on a key the keyring does not hold, means it is
/// damaged. Both name the file in [`UprivError::VaultFileUnreadable`]. Any
/// other read error is the disk's.
fn decrypt_one_chunk(
    blob: &mut BlobRead,
    keys: &Keyring,
    chunk: SealedChunk<'_>,
) -> Result<Vec<u8>> {
    let Some(content_key) = keys.content(chunk.key) else {
        return Err(unreadable(chunk.logical_path, FileProblem::Damaged));
    };
    let cipher_len = cipher_len(chunk.plain_len);
    blob.file
        .seek(SeekFrom::Start(chunk.offset))
        .map_err(|error| UprivError::VaultStoreInvalid {
            path: blob.path.clone(),
            detail: format!("chunk seek: {error}"),
        })?;
    let mut bytes = vec![0u8; cipher_len];
    blob.file.read_exact(&mut bytes).map_err(|error| {
        if error.kind() == std::io::ErrorKind::UnexpectedEof {
            unreadable(chunk.logical_path, FileProblem::Missing)
        } else {
            UprivError::VaultStoreInvalid {
                path: blob.path.clone(),
                detail: format!("chunk read: {error}"),
            }
        }
    })?;
    let aad = chunk_aad(
        keys.identity(),
        chunk.file_id,
        chunk.index,
        chunk.plain_len,
        chunk.version,
    )?;
    let plain = match decrypt_xchacha(content_key, &bytes, &aad) {
        Ok(plain) => plain,
        Err(UprivError::WrongPassword) => {
            return Err(unreadable(chunk.logical_path, FileProblem::Damaged));
        }
        Err(error) => return Err(error),
    };
    if plain.len() != chunk.plain_len as usize {
        return Err(unreadable(chunk.logical_path, FileProblem::Damaged));
    }
    Ok(plain)
}

fn decrypt_from_open(
    blob: &mut OpenBlob,
    keys: &Keyring,
    chunk: SealedChunk<'_>,
) -> Result<Vec<u8>> {
    let mut read = BlobRead {
        file: blob.file.try_clone()?,
        path: blob.path.clone(),
    };
    decrypt_one_chunk(&mut read, keys, chunk)
}

/// Seal one chunk with the write key under a fresh random nonce, whose
/// version the AAD binds ([`ChunkVersion::of_nonce`]).
fn seal_chunk(
    keys: &Keyring,
    file_id: &str,
    chunk_index: u32,
    plaintext: &[u8],
) -> Result<(ChunkVersion, Vec<u8>)> {
    let nonce = random_bytes::<XCHACHA_NONCE_LEN>();
    let version = ChunkVersion::of_nonce(&nonce);
    let aad = chunk_aad(
        keys.identity(),
        file_id,
        chunk_index,
        plaintext.len() as u32,
        version,
    )?;
    let bytes = encrypt_xchacha_with_nonce(keys.write_content(), &nonce, plaintext, &aad)?;
    Ok((version, bytes))
}

/// Ciphertext for one chunk, sealed before it is appended to the blob.
pub(crate) struct SealedPiece {
    pub version: ChunkVersion,
    /// The key it is sealed with: the keyring's write key.
    pub key: KeyId,
    pub plaintext_len: u32,
    pub bytes: Vec<u8>,
}

pub(crate) fn seal_import_chunk(
    keys: &Keyring,
    file_id: &str,
    chunk_index: u32,
    plaintext: &[u8],
) -> Result<SealedPiece> {
    let (version, bytes) = seal_chunk(keys, file_id, chunk_index, plaintext)?;
    Ok(SealedPiece {
        version,
        key: keys.write_id(),
        plaintext_len: plaintext.len() as u32,
        bytes,
    })
}

/// A new blob that receives chunks already sealed on another thread.
pub(crate) struct ImportBlob {
    inner: OpenBlob,
}

impl ImportBlob {
    pub(crate) fn create(store_dir: &Path, file_id: &str, keys: &Keyring) -> Result<Self> {
        Ok(Self {
            inner: OpenBlob::create(store_dir, file_id, keys)?,
        })
    }

    pub(crate) fn append(&mut self, bytes: &[u8]) -> Result<u64> {
        self.inner.append_bytes(bytes)
    }

    pub(crate) fn mutation(&self) -> ChunkBlobMutation {
        self.inner.mutation()
    }
}

/// Record a file whose chunks are already in its blob. `content_sha256` is the
/// digest of the plaintext the sealer read, when it hashed it.
pub(crate) fn record_imported_file(
    index: &mut VaultIndex,
    logical_path: &str,
    file_id: String,
    file_size: u64,
    chunks: ChunkList,
    content_sha256: Option<String>,
) -> Result<Option<RetiredFileChunks>> {
    validate_logical_path(logical_path)?;
    // A folder deleted while an import ran must not leave its files without it.
    super::tree::require_parent_dir(index, logical_path)?;
    let previous = match index.find(logical_path) {
        None => None,
        Some(node) => {
            let Some((old_id, _, _)) = node.as_file() else {
                return Err(UprivError::VaultStoreInvalid {
                    path: PathBuf::from(logical_path),
                    detail: "logical path is a directory".into(),
                });
            };
            Some((
                RetiredFileChunks {
                    file_id: old_id.to_string(),
                },
                node.created_at,
            ))
        }
    };
    let created_at = previous.as_ref().map(|(_, created_at)| *created_at);
    if let Some((retired, _)) = &previous {
        index.writes.forget_stream(&retired.file_id);
    }
    let mut node = imported_node(logical_path, file_id, file_size, chunks, content_sha256);
    if let Some(created_at) = created_at {
        node.created_at = created_at;
    }
    index.put(node);
    Ok(previous.map(|(retired, _)| retired))
}

/// The entry of a file whose chunks an import sealed into its blob, as
/// [`record_imported_file`] names it: made now, with the plaintext digest when
/// the sealer took one. A file it replaces keeps its creation time.
pub(crate) fn imported_node(
    logical_path: &str,
    file_id: String,
    file_size: u64,
    chunks: ChunkList,
    content_sha256: Option<String>,
) -> VaultNode {
    let mut node = VaultNode::file(logical_path, file_id, file_size, chunks);
    if let Some(sha256) = content_sha256 {
        node.bind_digest(sha256);
    }
    node
}

/// Seal one chunk with the write key and append it: its version, key, and
/// offset.
fn append_chunk(
    blob: &mut OpenBlob,
    keys: &Keyring,
    file_id: &str,
    chunk_index: u32,
    plaintext: &[u8],
) -> Result<(ChunkVersion, KeyId, u64)> {
    let (version, bytes) = seal_chunk(keys, file_id, chunk_index, plaintext)?;
    let offset = blob.append_bytes(&bytes)?;
    Ok((version, keys.write_id(), offset))
}

/// Seal one chunk with the write key and place it in a free span: its
/// version, key, and offset.
fn place_chunk(
    blob: &mut OpenBlob,
    keys: &Keyring,
    file_id: &str,
    chunk_index: u32,
    plaintext: &[u8],
    occupied: &[(u64, u64)],
) -> Result<(ChunkVersion, KeyId, u64)> {
    let (version, bytes) = seal_chunk(keys, file_id, chunk_index, plaintext)?;
    let slot = cipher_len(CHUNK_SIZE) as u64;
    let offset = blob.place_reserved(&bytes, slot, occupied)?;
    Ok((version, keys.write_id(), offset))
}

/// Decrypt `[offset, offset+len)` of a logical file. `len == 0` is an empty
/// read. Missing or damaged data fails with [`UprivError::VaultFileUnreadable`].
pub fn read_logical_range(
    store_dir: impl AsRef<Path>,
    keys: &Keyring,
    index: &VaultIndex,
    logical_path: &str,
    offset: u64,
    len: u64,
) -> Result<Vec<u8>> {
    let read = LogicalRange {
        logical_path,
        offset,
        len,
    };
    read_range(store_dir.as_ref(), keys, index, read, Unreadable::Fail).map(|(bytes, _)| bytes)
}

/// [`read_logical_range`] for the plaintext folder, which keeps every file:
/// missing or damaged parts read as zeros. Returns what kept the range from
/// being read in full.
pub(crate) fn read_logical_range_keeping(
    store_dir: &Path,
    keys: &Keyring,
    index: &VaultIndex,
    logical_path: &str,
    offset: u64,
    len: u64,
) -> Result<(Vec<u8>, Option<FileProblem>)> {
    let read = LogicalRange {
        logical_path,
        offset,
        len,
    };
    read_range(store_dir, keys, index, read, Unreadable::Keep)
}

#[derive(Clone, Copy)]
struct LogicalRange<'a> {
    logical_path: &'a str,
    offset: u64,
    len: u64,
}

fn read_range(
    store_dir: &Path,
    keys: &Keyring,
    index: &VaultIndex,
    read: LogicalRange<'_>,
    mode: Unreadable,
) -> Result<(Vec<u8>, Option<FileProblem>)> {
    let LogicalRange {
        logical_path,
        offset,
        len,
    } = read;
    validate_logical_path(logical_path)?;
    let node = index
        .find(logical_path)
        .ok_or_else(|| UprivError::VaultPathNotFound(logical_path.into()))?;
    let size =
        node.as_file()
            .map(|(_, size, _)| size)
            .ok_or_else(|| UprivError::VaultStoreInvalid {
                path: PathBuf::from(logical_path),
                detail: "logical path is a directory".into(),
            })?;
    if len == 0 || offset >= size {
        return Ok((Vec::new(), None));
    }
    let Some(mut reader) = ChunkReader::open(store_dir, keys, node, mode)? else {
        return Ok((Vec::new(), None));
    };
    let end = size.min(offset.saturating_add(len));
    let chunk_size = u64::from(CHUNK_SIZE);
    let first = (offset / chunk_size) as u32;
    let last = ((end - 1) / chunk_size) as u32;
    let mut out = Vec::with_capacity((end - offset) as usize);
    for chunk_index in first..=last {
        let plain = reader.chunk(chunk_index)?;
        let chunk_start = u64::from(chunk_index) * chunk_size;
        let from = offset.saturating_sub(chunk_start).min(plain.len() as u64) as usize;
        let to = (end.saturating_sub(chunk_start) as usize).min(plain.len());
        if from < to {
            out.extend_from_slice(&plain[from..to]);
        }
    }
    Ok((out, reader.problem))
}

/// Overwrite `[offset, offset+data.len)` keeping unchanged chunks (O(touched chunks)).
/// A hole past EOF is filled with zeros (POSIX `pwrite` shape).
pub fn write_logical_range(
    store_dir: impl AsRef<Path>,
    keys: &Keyring,
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
        let (_retired, mutation) = write_logical_file(store_dir, keys, index, logical_path, data)?;
        return Ok(mutation);
    }
    let store_dir = store_dir.as_ref();
    let chunk_size = CHUNK_SIZE;
    let (file_id, old_size, old_chunks, created_at) = {
        let node = index.find(logical_path).expect("checked");
        let (Some((file_id, size, _)), Some(chunks)) = (node.as_file(), node.chunks()) else {
            return Err(UprivError::VaultStoreInvalid {
                path: PathBuf::from(logical_path),
                detail: "logical path is a directory".into(),
            });
        };
        (file_id.to_string(), size, chunks, node.created_at)
    };
    let write_end = offset.saturating_add(data.len() as u64);
    let new_size = old_size.max(write_end);
    if offset > old_size {
        require_room_for_zeros(store_dir, chunk_size, old_size, write_end)?;
    }
    let old_count = chunk_count(old_size, chunk_size);
    require_chunk_lists(logical_path, old_count, &old_chunks)?;
    // The chunks the blob holds: the file's own, then each new one once it is
    // written. A write past the end fills every chunk up to it, in order.
    let mut chunks = old_chunks;
    let mut plain_lens: Vec<u32> = (0..old_count)
        .map(|index| chunk_plain_len(old_size, index, chunk_size))
        .collect();
    let slot = cipher_len(chunk_size) as u64;
    let mut mutation = ChunkBlobMutation::default();

    let union_start = if offset > old_size { old_size } else { offset };
    let union_end = write_end;
    let written = (|| {
        if union_end > union_start {
            let mut blob = open_blob(
                store_dir,
                &file_id,
                old_count == 0,
                logical_path,
                &mut index.writes,
                keys,
            )?;
            let first = (union_start / u64::from(chunk_size)) as u32;
            let last = ((union_end - 1) / u64::from(chunk_size)) as u32;
            let mut abandoned: Vec<(u64, u64)> = Vec::new();
            let appended = (|| -> Result<()> {
                for chunk_index in first..=last {
                    let at = chunk_index as usize;
                    let existing = chunk_index < old_count;
                    let this_len = chunk_plain_len(new_size, chunk_index, chunk_size) as usize;
                    let mut buf = Zeroizing::new(vec![0u8; this_len]);
                    if existing {
                        let old = Zeroizing::new(decrypt_from_open(
                            &mut blob,
                            keys,
                            SealedChunk {
                                logical_path,
                                file_id: &file_id,
                                index: chunk_index,
                                plain_len: plain_lens[at],
                                version: chunks.versions[at],
                                key: chunks.keys[at],
                                offset: chunks.offsets[at],
                            },
                        )?);
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
                    if existing {
                        // Placed beside the bytes the sealed index still names.
                        abandoned.push((chunks.offsets[at], cipher_len(plain_lens[at]) as u64));
                        let mut occupied =
                            occupied_spans(&chunks.offsets, &plain_lens, blob.position, slot);
                        occupied.extend(abandoned.iter().copied());
                        protect_unsealed(index, &file_id, &mut occupied);
                        blob.protect_record(&mut occupied);
                        let (version, key, chunk_offset) =
                            place_chunk(&mut blob, keys, &file_id, chunk_index, &buf, &occupied)?;
                        chunks.versions[at] = version;
                        chunks.keys[at] = key;
                        chunks.offsets[at] = chunk_offset;
                        plain_lens[at] = this_len as u32;
                    } else {
                        debug_assert_eq!(chunks.len(), at, "new chunks are written in order");
                        let (version, key, chunk_offset) =
                            append_chunk(&mut blob, keys, &file_id, chunk_index, &buf)?;
                        chunks.push(version, key, chunk_offset);
                        plain_lens.push(this_len as u32);
                    }
                }
                Ok(())
            })();
            mutation = blob.mutation();
            appended?;
            if !abandoned.is_empty() {
                index.writes.rewritten_blobs.insert(file_id.clone());
            }
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

    // A write at or past the end extends the running digest with the bytes in
    // hand; close binds it to the file. Any other change drops it, and the
    // file counts by its storage.
    let changed = !(data.is_empty() && offset <= old_size);
    let digest = if changed && offset >= old_size && index.writes.track_digests {
        let hasher = if old_size == 0 {
            Some(Sha256::new())
        } else {
            index.writes.take_stream(&file_id, old_size)
        };
        hasher.map(|mut hasher| {
            hash_zeros(&mut hasher, offset - old_size);
            hasher.update(data);
            hasher
        })
    } else {
        None
    };
    if changed && digest.is_none() {
        index.writes.forget_stream(&file_id);
    }
    let stream_id = file_id.clone();
    if let Some(node) = index.find_mut(logical_path) {
        node.modified_at = crate::time::unix_millis();
        node.created_at = created_at;
        node.kind = crate::store::index::VaultNodeKind::File {
            file_id,
            size: new_size,
            chunk_versions: chunks.versions,
            chunk_keys: chunks.keys,
            chunk_offsets: chunks.offsets,
        };
        if changed {
            node.content_digest = None;
        }
    }
    if let Some(hasher) = digest {
        index.put_digest_stream(&stream_id, hasher, new_size);
    }
    Ok(mutation)
}

/// Grow by writing zero-filled chunks one at a time (never one huge allocation).
fn grow_logical_file(
    store_dir: impl AsRef<Path>,
    keys: &Keyring,
    index: &mut VaultIndex,
    logical_path: &str,
    old_size: u64,
    new_size: u64,
) -> Result<ChunkBlobMutation> {
    if new_size <= old_size {
        return Ok(ChunkBlobMutation::default());
    }
    require_room_for_zeros(store_dir.as_ref(), CHUNK_SIZE, old_size, new_size)?;
    let chunk = u64::from(CHUNK_SIZE);
    let mut pos = old_size;
    let zeros = vec![0u8; chunk as usize];
    let mut mutation = ChunkBlobMutation::default();
    let before = index.clone();
    while pos < new_size {
        let remain = new_size - pos;
        let n = remain.min(chunk) as usize;
        let piece = write_logical_range(
            store_dir.as_ref(),
            keys,
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

/// Refuse to fill a file with zeros from `old_size` to `new_size` when the
/// drive that holds `store_dir` has no room for them. Every zero is written as
/// ciphertext, so one small request (`truncate -s 1T`, a write far past the
/// end) would otherwise fill the drive before it fails. Counts the chunk that
/// holds the old end, which is written again, through the new end. A drive
/// that does not say how much room it has (a storage-access folder) is not
/// refused; the writes fail there when it fills.
fn require_room_for_zeros(
    store_dir: &Path,
    chunk_size: u32,
    old_size: u64,
    new_size: u64,
) -> Result<()> {
    let chunk = u64::from(chunk_size.max(1));
    let chunks = new_size.div_ceil(chunk).saturating_sub(old_size / chunk);
    let needed = chunks.saturating_mul(cipher_len(chunk_size) as u64);
    match crate::host_fs::free_bytes(store_dir) {
        Some(available) if available < needed => Err(std::io::Error::new(
            std::io::ErrorKind::StorageFull,
            "no room on the drive for the zeros",
        )
        .into()),
        _ => Ok(()),
    }
}

/// Shrink or grow a file. Growth is zero-filled.
pub fn truncate_logical_file(
    store_dir: impl AsRef<Path>,
    keys: &Keyring,
    index: &mut VaultIndex,
    logical_path: &str,
    new_size: u64,
) -> Result<ChunkBlobMutation> {
    let store_dir = store_dir.as_ref();
    validate_logical_path(logical_path)?;
    if index.find(logical_path).is_none() {
        if new_size == 0 {
            let (_retired, mutation) =
                write_logical_file(store_dir, keys, index, logical_path, b"")?;
            return Ok(mutation);
        }
        let before = index.clone();
        let (_retired, mut mutation) =
            write_logical_file(store_dir, keys, index, logical_path, b"")?;
        return match grow_logical_file(store_dir, keys, index, logical_path, 0, new_size) {
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
        return grow_logical_file(store_dir, keys, index, logical_path, old_size, new_size);
    }
    let before = index.clone();
    let mut mutation = write_logical_range(store_dir, keys, index, logical_path, new_size, b"")?;
    // Range write does not shrink; trim the node and extra chunks explicitly.
    let chunk_size = CHUNK_SIZE;
    let (file_id, chunks, created_at) = {
        let node = index.find(logical_path).expect("exists");
        let (file_id, _, _) = node.as_file().expect("file");
        (
            file_id.to_string(),
            node.chunks().expect("file"),
            node.created_at,
        )
    };
    let new_count = chunk_count(new_size, chunk_size);
    let mut chunks = chunks;
    let trimmed = (|| {
        if new_size > 0 && new_count > 0 {
            let last = new_count - 1;
            let last_len = chunk_plain_len(new_size, last, chunk_size);
            let old_last_len = chunk_plain_len(old_size, last, chunk_size);
            if last_len < old_last_len {
                let at = last as usize;
                let previous_offset = chunks.offsets[at];
                let mut blob = open_blob(
                    store_dir,
                    &file_id,
                    false,
                    logical_path,
                    &mut index.writes,
                    keys,
                )?;
                let appended = (|| -> Result<()> {
                    let mut buf = Zeroizing::new(decrypt_from_open(
                        &mut blob,
                        keys,
                        SealedChunk {
                            logical_path,
                            file_id: &file_id,
                            index: last,
                            plain_len: old_last_len,
                            version: chunks.versions[at],
                            key: chunks.keys[at],
                            offset: previous_offset,
                        },
                    )?);
                    buf.truncate(last_len as usize);
                    let slot = cipher_len(chunk_size) as u64;
                    let plain_lens: Vec<u32> = (0..chunks.len() as u32)
                        .map(|index| {
                            if index == last {
                                old_last_len
                            } else {
                                chunk_plain_len(old_size, index, chunk_size)
                            }
                        })
                        .collect();
                    let mut occupied =
                        occupied_spans(&chunks.offsets, &plain_lens, blob.position, slot);
                    protect_unsealed(index, &file_id, &mut occupied);
                    blob.protect_record(&mut occupied);
                    let (version, key, chunk_offset) =
                        place_chunk(&mut blob, keys, &file_id, last, &buf, &occupied)?;
                    chunks.versions[at] = version;
                    chunks.keys[at] = key;
                    chunks.offsets[at] = chunk_offset;
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
                if let Ok(meta) = crate::host_fs::symlink_metadata(&path) {
                    if meta.host_is_file() || meta.file_type().is_symlink() {
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
    chunks.versions.truncate(new_count as usize);
    chunks.keys.truncate(new_count as usize);
    chunks.offsets.truncate(new_count as usize);
    // The dropped chunks stay in the blob until a pack. Empty, it is superseded.
    if new_count > 0 {
        index.writes.rewritten_blobs.insert(file_id.clone());
        if let Ok(path) = blob_path(store_dir, &file_id) {
            mutation.trimmed.push(path);
        }
    }
    // Emptied, the file has a known digest and appends start a new one.
    let empty = (new_size == 0 && index.writes.track_digests).then(Sha256::new);
    if empty.is_none() {
        index.writes.forget_stream(&file_id);
    }
    let stream_id = file_id.clone();
    if let Some(node) = index.find_mut(logical_path) {
        node.modified_at = crate::time::unix_millis();
        node.created_at = created_at;
        node.kind = crate::store::index::VaultNodeKind::File {
            file_id,
            size: new_size,
            chunk_versions: chunks.versions,
            chunk_keys: chunks.keys,
            chunk_offsets: chunks.offsets,
        };
        node.content_digest = None;
        if new_size == 0 {
            // No data left to be missing or damaged.
            node.problem = None;
        }
        if let Some(hasher) = &empty {
            node.bind_digest(sha256_hex(hasher.clone()));
        }
    }
    if let Some(hasher) = empty {
        index.put_digest_stream(&stream_id, hasher, 0);
    }
    Ok(mutation)
}

/// Pack a blob during a session only after dead ciphertext reaches this size.
const SESSION_PACK_DEAD_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum BlobPackMode {
    /// After a sealed write: pack when dead ciphertext is at least 8 MiB.
    SessionWaste,
    /// On close: pack large waste, and any waste in a small file.
    Close,
    /// A blob whose flush failed: copy every file in it, waste or not, so the
    /// seal names bytes a flush of their own covers ([`StagedBlobs`]). A
    /// chunk the copy cannot read keeps its key.
    Rewrite,
    /// A password change: copy each file it is given onto the write key. A
    /// chunk the copy cannot read takes no key ([`KeyId::NONE`]): the key it
    /// was written with leaves the vault when the change finishes.
    Convert,
}

impl BlobPackMode {
    /// Copies every file it is given, marked or not, and carries a chunk it
    /// cannot read byte for byte ([`carry_unreadable`]).
    fn copies_all(self) -> bool {
        matches!(self, Self::Rewrite | Self::Convert)
    }
}

fn should_pack(mode: BlobPackMode, dead: u64, live: u64) -> bool {
    match mode {
        BlobPackMode::Rewrite | BlobPackMode::Convert => true,
        _ if dead == 0 => false,
        BlobPackMode::SessionWaste => dead >= SESSION_PACK_DEAD_BYTES,
        BlobPackMode::Close => dead >= SESSION_PACK_DEAD_BYTES || live <= SESSION_PACK_DEAD_BYTES,
    }
}

struct BlobMeasure {
    dead: u64,
    live: u64,
}

/// The live part of `node`'s blob, its key copy and its chunks, and the rest
/// of its bytes. Its newest recovery record is neither: every blob carries
/// one, so it never counts as waste, and the older records do.
fn measure_blob(
    store_dir: &Path,
    node: &VaultNode,
    writes: &SessionWrites,
) -> Result<Option<BlobMeasure>> {
    let Some((file_id, size, _)) = node.as_file() else {
        return Ok(None);
    };
    if size == 0 {
        return Ok(None);
    }
    let chunks = node.chunks().ok_or_else(|| UprivError::VaultStoreInvalid {
        path: PathBuf::from(&node.path),
        detail: "logical path is a directory".into(),
    })?;
    let count = chunk_count(size, CHUNK_SIZE);
    require_chunk_lists(&node.path, count, &chunks)?;
    let path = blob_path(store_dir, file_id)?;
    let mut file = crate::paths::open_nofollow(&path, crate::paths::NofollowMode::Read)
        .map_err(|error| blob_open_error(&node.path, error))?;
    let len = file.metadata()?.len();
    let record = super::record::newest_record_span(&mut file, len)
        .or_else(|| writes.records.get(file_id).copied())
        .map_or(0, |(_, record_len)| record_len);
    let mut live = KEY_COPY_LEN;
    for index in 0..count {
        live = live.saturating_add(cipher_len(chunk_plain_len(size, index, CHUNK_SIZE)) as u64);
    }
    Ok(Some(BlobMeasure {
        dead: len.saturating_sub(live).saturating_sub(record),
        live,
    }))
}

pub(crate) fn blobs_need_pack(
    store_dir: &Path,
    index: &VaultIndex,
    mode: BlobPackMode,
    only: Option<&[String]>,
) -> bool {
    if matches!(only, Some(ids) if ids.is_empty()) {
        return false;
    }
    let only = only_set(only);
    index.nodes().iter().any(|node| {
        let Some((file_id, _, _)) = node.as_file() else {
            return false;
        };
        if node.problem.is_some() || !wanted(&only, file_id) {
            return false;
        }
        // A blob that cannot be measured cannot be packed either.
        matches!(
            measure_blob(store_dir, node, &index.writes),
            Ok(Some(measure)) if should_pack(mode, measure.dead, measure.live)
        )
    })
}

/// What [`pack_blob_waste`] did.
pub(crate) struct PackedWaste {
    /// The new blobs and the ones they replace.
    pub mutation: ChunkBlobMutation,
    /// A file whose data turned out missing or damaged was marked and left as
    /// it is, so the tree changed.
    pub marked: bool,
}

struct PackedBlob {
    logical_path: String,
    new_file_id: String,
    new_chunks: ChunkList,
    new_path: PathBuf,
    old_path: PathBuf,
    /// What kept the copy from reading every chunk
    /// ([`BlobPackMode::copies_all`]).
    problem: Option<FileProblem>,
}

/// Re-encrypt live chunks into a new blob and point the in-memory index at it.
///
/// Chunk AAD binds `file_id`, so a raw copy under a new id would not decrypt.
/// The caller syncs `created`, seals the index, then deletes `superseded`.
/// A crash before that seal leaves the previous index and the previous blob.
///
/// Packing for waste leaves a file already marked with a problem as it is, and
/// one whose data turns out missing or damaged here is marked and left too;
/// the other blobs are still packed. [`BlobPackMode::Rewrite`] and
/// [`BlobPackMode::Convert`] copy every file they are given, marked or not: a
/// chunk they cannot read is carried byte for byte and stays unreadable, and
/// the file is marked. A file whose blob does not open at all is marked and
/// left as it is.
pub(crate) fn pack_blob_waste(
    store_dir: &Path,
    keys: &Keyring,
    index: &mut VaultIndex,
    mode: BlobPackMode,
    only: Option<&[String]>,
) -> Result<PackedWaste> {
    debug_assert!(
        mode != BlobPackMode::Convert,
        "a convert names its new blobs"
    );
    let new_id = |_: &str| Uuid::new_v4().to_string();
    pack_blobs(store_dir, keys, index, mode, only, &new_id, &|_| Ok(()))
}

/// Copy each file of `plan`, `(file id, new file id)`, onto the write key of
/// `keys` into a blob under its new id ([`BlobPackMode::Convert`]): a
/// password change names a batch's new blobs before it makes them, so a crash
/// leaves them released ([`VaultIndex::released`]). `on_chunk` is told the
/// plaintext length of each chunk before it is copied, and its error ends the
/// copy with nothing left of it.
pub(crate) fn convert_files(
    store_dir: &Path,
    keys: &Keyring,
    index: &mut VaultIndex,
    plan: &[(String, String)],
    on_chunk: &dyn Fn(u64) -> Result<()>,
) -> Result<PackedWaste> {
    let only: Vec<String> = plan.iter().map(|(file_id, _)| file_id.clone()).collect();
    let new_id = |file_id: &str| {
        plan.iter()
            .find(|(old, _)| old == file_id)
            .map_or_else(|| Uuid::new_v4().to_string(), |(_, new)| new.clone())
    };
    pack_blobs(
        store_dir,
        keys,
        index,
        BlobPackMode::Convert,
        Some(&only),
        &new_id,
        on_chunk,
    )
}

/// [`pack_blob_waste`], each new blob taking the id `new_id` gives the file
/// id it replaces, and `on_chunk` told of each chunk before it is copied.
fn pack_blobs(
    store_dir: &Path,
    keys: &Keyring,
    index: &mut VaultIndex,
    mode: BlobPackMode,
    only: Option<&[String]>,
    new_id: &dyn Fn(&str) -> String,
    on_chunk: &dyn Fn(u64) -> Result<()>,
) -> Result<PackedWaste> {
    if matches!(only, Some(ids) if ids.is_empty()) {
        return Ok(PackedWaste {
            mutation: ChunkBlobMutation::default(),
            marked: false,
        });
    }
    let only = only_set(only);
    let mut planned: Vec<PackedBlob> = Vec::new();
    let mut found: Vec<(String, FileProblem)> = Vec::new();
    let packed = (|| -> Result<()> {
        for node in index.nodes() {
            let Some((file_id, _, _)) = node.as_file() else {
                continue;
            };
            // One file per blob (the tree rules), so a blob is the file's own.
            if !wanted(&only, file_id) || (node.problem.is_some() && !mode.copies_all()) {
                continue;
            }
            let repacked =
                measure_blob(store_dir, node, &index.writes).and_then(|measure| match measure {
                    Some(measure) if should_pack(mode, measure.dead, measure.live) => {
                        let target = new_id(file_id);
                        let to = blob_path(store_dir, &target)?;
                        let from = blob_path(store_dir, file_id)?;
                        let to = (target.as_str(), to);
                        repack_live_blob(from, to, keys, node, mode, on_chunk).map(Some)
                    }
                    _ => Ok(None),
                });
            match repacked {
                Ok(Some(item)) => {
                    if let Some(problem) = item.problem {
                        found.push((item.logical_path.clone(), problem));
                    }
                    planned.push(item);
                }
                Ok(None) => {}
                Err(UprivError::VaultFileUnreadable { path, problem }) => {
                    found.push((path, problem));
                }
                Err(error) => return Err(error),
            }
        }
        Ok(())
    })();
    let mut marked = false;
    for (path, problem) in found {
        marked |= index.mark_problem(&path, Some(problem));
    }
    if let Err(error) = packed {
        for item in &planned {
            let _ = crate::host_fs::remove_file(&item.new_path);
        }
        return Err(error);
    }
    let mut mutation = ChunkBlobMutation::default();
    for item in planned {
        let mut moved = None;
        if let Some(node) = index.find_mut(&item.logical_path) {
            // Same bytes in a new blob: the digest carries over.
            let carried = node.current_digest().map(str::to_owned);
            if let (Some((file_id, _, _)), Some(chunks)) = (node.as_file(), node.chunks()) {
                mutation.pack_rollback.push(PackNodeRollback {
                    logical_path: item.logical_path.clone(),
                    file_id: file_id.to_string(),
                    chunks,
                    content_digest: node.content_digest.clone(),
                });
                moved = Some((file_id.to_string(), item.new_file_id.clone()));
            }
            node.set_storage(item.new_file_id, item.new_chunks);
            if let Some(sha256) = carried {
                node.bind_digest(sha256);
            }
        }
        if let Some((from, to)) = moved {
            index.writes.moved_blob(&from, &to);
        }
        mutation.created.push(item.new_path);
        mutation.superseded.push(item.old_path);
    }
    Ok(PackedWaste { mutation, marked })
}

fn only_set(only: Option<&[String]>) -> Option<std::collections::HashSet<&str>> {
    only.map(|ids| ids.iter().map(String::as_str).collect())
}

fn wanted(only: &Option<std::collections::HashSet<&str>>, file_id: &str) -> bool {
    only.as_ref().is_none_or(|ids| ids.contains(file_id))
}

/// Copy the live chunks of `node`, from its blob at `from`, into a new blob
/// `to` (its id, its path), each chunk sealed with the write key. Packing for
/// waste fails on a chunk it cannot read. [`BlobPackMode::Rewrite`] and
/// [`BlobPackMode::Convert`] copy the file anyway: such a chunk is carried
/// byte for byte ([`carry_unreadable`]), so the copy keeps every readable part
/// where it was and the problem stays visible.
fn repack_live_blob(
    from: PathBuf,
    to: (&str, PathBuf),
    keys: &Keyring,
    node: &VaultNode,
    mode: BlobPackMode,
    on_chunk: &dyn Fn(u64) -> Result<()>,
) -> Result<PackedBlob> {
    let size = node.as_file().map_or(0, |(_, size, _)| size);
    let count = chunk_count(size, CHUNK_SIZE);
    let reading = if mode.copies_all() {
        Unreadable::Keep
    } else {
        Unreadable::Fail
    };
    let Some(mut src) = ChunkReader::open_at(Ok(from.clone()), keys, node, reading)? else {
        return Err(UprivError::VaultStoreInvalid {
            path: PathBuf::from(&node.path),
            detail: "an empty file has no blob to pack".into(),
        });
    };
    if src.blob.is_none() {
        // Nothing of it opens, so nothing can be copied: the file is marked as
        // it is, and a blob of carried chunks would read as present.
        let problem = src.problem.unwrap_or(FileProblem::Missing);
        return Err(unreadable(&node.path, problem));
    }
    let (new_file_id, new_path) = (to.0.to_string(), to.1);
    let mut dst = OpenBlob::create_at(new_path.clone(), &new_file_id, keys)?;
    let mut new_chunks = ChunkList::with_capacity(count as usize);
    let rewritten = (|| -> Result<()> {
        for index in 0..count {
            on_chunk(u64::from(chunk_plain_len(size, index, CHUNK_SIZE)))?;
            let (version, key, offset) = match src.try_chunk(index)? {
                Some(plain) => append_chunk(&mut dst, keys, &new_file_id, index, &plain)?,
                None => {
                    let key = match mode {
                        BlobPackMode::Convert => KeyId::NONE,
                        _ => src.chunks.keys[index as usize],
                    };
                    let version = src.chunks.versions[index as usize];
                    let offset = carry_unreadable(&mut dst, &src.raw_chunk(index)?)?;
                    (version, key, offset)
                }
            };
            new_chunks.push(version, key, offset);
        }
        Ok(())
    })();
    if let Err(error) = rewritten {
        let _ = crate::host_fs::remove_file(&new_path);
        return Err(error);
    }
    Ok(PackedBlob {
        logical_path: node.path.clone(),
        new_file_id,
        new_chunks,
        new_path,
        old_path: from,
        problem: src.problem,
    })
}

/// A held blob's file, copied by [`convert_held_blob`].
pub(crate) struct HeldCopy {
    /// The new blob, in `held/`.
    pub path: PathBuf,
    /// The file it holds now: its new id, chunks, and key.
    pub node: VaultNode,
    /// What kept the copy from reading every chunk.
    pub problem: Option<FileProblem>,
}

/// Copy the file `node` of a held blob, from `from` in `held/` to `to` beside
/// it, onto the write key of `keys`, as a password change copies a file of
/// the tree ([`BlobPackMode::Convert`]). The file id of `node` is the old
/// blob's; `new_id` is the new one's. The caller flushes the copy before an
/// index names it.
pub(crate) fn convert_held_blob(
    from: PathBuf,
    to: PathBuf,
    new_id: &str,
    keys: &Keyring,
    node: &VaultNode,
    on_chunk: &dyn Fn(u64) -> Result<()>,
) -> Result<HeldCopy> {
    let packed = repack_live_blob(
        from,
        (new_id, to),
        keys,
        node,
        BlobPackMode::Convert,
        on_chunk,
    )?;
    let mut copied = node.clone();
    copied.set_storage(packed.new_file_id, packed.new_chunks);
    Ok(HeldCopy {
        path: packed.new_path,
        node: copied,
        problem: packed.problem,
    })
}

/// Append the sealed bytes of a chunk a copy could not read, byte for byte,
/// and return where they went. The chunk keeps its version and stays
/// unreadable: its AAD binds the blob it was sealed in, so it opens in no
/// other. A recovery tool can still work on its bytes, and the chunks after
/// it keep their places.
fn carry_unreadable(blob: &mut OpenBlob, sealed: &[u8]) -> Result<u64> {
    blob.append_bytes(sealed)
}

pub(crate) fn mutation_blob_ids(mutation: &ChunkBlobMutation) -> Vec<String> {
    let mut ids: Vec<String> = Vec::new();
    for path in mutation
        .created
        .iter()
        .chain(mutation.truncate_to.iter().map(|(path, _)| path))
    {
        let Some(id) = blob_file_id(path) else {
            continue;
        };
        if !ids.iter().any(|seen| seen == id) {
            ids.push(id.to_string());
        }
    }
    ids
}

/// The file id a blob path names (`<file_id>.blob`).
pub(super) fn blob_file_id(path: &Path) -> Option<&str> {
    let id = path.file_name()?.to_str()?.strip_suffix(BLOB_FILE_SUFFIX)?;
    Uuid::parse_str(id).is_ok().then_some(id)
}

/// True when the first chunk of `node` opens from the blob at `path`: that
/// blob holds this file as `node` records it. Only that chunk is read, and its
/// plaintext is wiped at once.
pub(super) fn first_chunk_opens(path: &Path, keys: &Keyring, node: &VaultNode) -> bool {
    let (Some((file_id, size, _)), Some(chunks)) = (node.as_file(), node.chunks()) else {
        return false;
    };
    let (Some(&version), Some(&key), Some(&offset)) = (
        chunks.versions.first(),
        chunks.keys.first(),
        chunks.offsets.first(),
    ) else {
        return false;
    };
    let Ok(file) = crate::paths::open_nofollow(path, crate::paths::NofollowMode::Read) else {
        return false;
    };
    let mut blob = BlobRead {
        file,
        path: path.to_path_buf(),
    };
    let chunk = SealedChunk {
        logical_path: &node.path,
        file_id,
        index: 0,
        plain_len: chunk_plain_len(size, 0, CHUNK_SIZE),
        version,
        key,
        offset,
    };
    decrypt_one_chunk(&mut blob, keys, chunk)
        .map(Zeroizing::new)
        .is_ok()
}

#[cfg(test)]
mod tests {
    use super::super::header::chunk_aad;
    use super::*;
    #[allow(unused_imports)]
    use crate::host_fs::HostFsQuery;
    use crate::store::{create_empty_store, flush_index, open_store, KdfUnlockPreset, CHUNK_SIZE};

    const PW: &[u8] = b"chunk-round-trip-ok";

    #[test]
    fn blobs_live_in_a_two_hex_digit_bucket() {
        let tmp = std::env::temp_dir().join(format!("upriv-blob-{}", Uuid::new_v4().simple()));
        let id = "1a111111-1111-4111-8111-111111111111";
        assert_eq!(
            blob_path(&tmp, id).unwrap(),
            tmp.join(DATA_DIR_NAME)
                .join("1a")
                .join(format!("{id}{BLOB_FILE_SUFFIX}"))
        );
        assert!(blob_path(&tmp, "not-a-uuid").is_err());
    }

    const IN_AA: &str = "aa000000-0000-4000-8000-000000000001";
    const BESIDE_IN_AA: &str = "aa000000-0000-4000-8000-000000000002";
    const IN_BB: &str = "bb000000-0000-4000-8000-000000000001";

    fn new_blob(store: &Path, id: &str, keys: &Keyring) -> ChunkBlobMutation {
        let mut blob = ImportBlob::create(store, id, keys).unwrap();
        blob.append(b"sealed bytes").unwrap();
        blob.mutation()
    }

    #[test]
    fn a_seal_flushes_each_shard_of_a_new_blob_once_then_data() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(crate::paths::STORE_DIR_NAME);
        create_empty_store(&dir, PW, KdfUnlockPreset::M32).unwrap();
        let opened = crate::store::open_store(&dir, PW).unwrap();
        let data = dir.join(DATA_DIR_NAME);
        let (aa, bb) = (data.join("aa"), data.join("bb"));

        let mut staged = StagedBlobs::default();
        for id in [IN_AA, BESIDE_IN_AA, IN_BB] {
            staged.add(&new_blob(&dir, id, &opened.keys));
        }
        let mut folders = staged.folders();
        folders.sort();
        assert_eq!(folders, vec![data.as_path(), aa.as_path(), bb.as_path()]);
        staged.sync(&opened.records(), RecordsDue::Made).unwrap();

        // Whoever made the shard folder, `data/` is flushed with it again.
        staged.clear();
        staged.add(&new_blob(
            &dir,
            "aa000000-0000-4000-8000-000000000003",
            &opened.keys,
        ));
        let mut folders = staged.folders();
        folders.sort();
        assert_eq!(folders, vec![data.as_path(), aa.as_path()]);
        staged.sync(&opened.records(), RecordsDue::Made).unwrap();
    }

    #[test]
    fn a_grown_blob_is_flushed_without_its_folders_and_a_gone_one_is_skipped() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(crate::paths::STORE_DIR_NAME);
        create_empty_store(&dir, PW, KdfUnlockPreset::M32).unwrap();
        let opened = crate::store::open_store(&dir, PW).unwrap();
        let grown = blob_path(&dir, IN_AA).unwrap();
        new_blob(&dir, IN_AA, &opened.keys);
        let gone = new_blob(&dir, IN_BB, &opened.keys);

        let mut staged = StagedBlobs::default();
        staged.add(&ChunkBlobMutation {
            truncate_to: vec![(grown, 0)],
            ..ChunkBlobMutation::default()
        });
        assert!(staged.folders().is_empty());
        staged.add(&gone);
        crate::host_fs::remove_file(&gone.created[0]).unwrap();
        staged.sync(&opened.records(), RecordsDue::All).unwrap();
    }

    fn file_chunk_meta(
        opened: &crate::store::OpenedStore,
        path: &str,
        chunk_index: usize,
    ) -> (String, ChunkVersion, u64) {
        let node = opened.index.find(path).unwrap();
        let (file_id, _, versions) = node.as_file().unwrap();
        let offset = node.chunk_offsets().unwrap()[chunk_index];
        (file_id.to_string(), versions[chunk_index], offset)
    }

    fn read_chunk_bytes(
        dir: &std::path::Path,
        file_id: &str,
        offset: u64,
        plain_len: u32,
    ) -> Vec<u8> {
        use std::io::{Read, Seek, SeekFrom};
        let path = blob_path(dir, file_id).unwrap();
        let mut file = crate::host_fs::File::open(path).unwrap();
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
        write_logical_file(&dir, &opened.keys, &mut opened.index, "wide.bin", &data).unwrap();
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
        write_logical_file(&dir, &opened.keys, &mut opened.index, "empty.txt", b"").unwrap();
        flush_index(&dir, &mut opened).unwrap();
        let data = dir.join(DATA_DIR_NAME);
        assert_eq!(crate::host_fs::read_dir(&data).unwrap().count(), 0);
        let got = read_logical_file(&dir, &opened.keys, &opened.index, "empty.txt").unwrap();
        assert!(got.is_empty());
    }

    #[test]
    fn two_chunks_round_trip_and_unique_nonces() {
        let (_tmp, dir, data, _file_id) = seeded_two_chunk();
        let opened = open_store(&dir, PW).unwrap();
        let got = read_logical_file(&dir, &opened.keys, &opened.index, "wide.bin").unwrap();
        assert_eq!(got, data);
        let (file_id, _, off0) = file_chunk_meta(&opened, "wide.bin", 0);
        let (_, _, off1) = file_chunk_meta(&opened, "wide.bin", 1);
        let blobs: Vec<_> = crate::host_fs::read_dir(dir.join(DATA_DIR_NAME))
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
            !crate::host_fs::read(dir.join("index/root.idx.enc"))
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
        let mut raw = crate::host_fs::read(&path).unwrap();
        let c0 = cipher_len(CHUNK_SIZE);
        let c1 = cipher_len(13);
        let first = raw[off0 as usize..off0 as usize + c0].to_vec();
        let second = raw[off1 as usize..off1 as usize + c1].to_vec();
        raw.splice(off0 as usize..off0 as usize + c0, second);
        raw.splice(off0 as usize + c1..off0 as usize + c1, first);
        crate::host_fs::write(&path, &raw).unwrap();
        let opened = open_store(&dir, PW).expect("vault still opens; one file is torn");
        let err = read_logical_file(&dir, &opened.keys, &opened.index, "wide.bin").unwrap_err();
        assert!(
            matches!(
                err,
                UprivError::VaultFileUnreadable {
                    problem: FileProblem::Damaged,
                    ..
                }
            ),
            "swapped chunk_index AAD must fail: {err:?}"
        );
    }

    #[test]
    fn flip_or_truncate_chunk_fails_closed() {
        let (_tmp, dir, _data, _file_id) = seeded_two_chunk();
        let opened = open_store(&dir, PW).unwrap();
        let (file_id, _, off0) = file_chunk_meta(&opened, "wide.bin", 0);
        let path = blob_path(&dir, &file_id).unwrap();
        let mut raw = crate::host_fs::read(&path).unwrap();
        raw[off0 as usize + 24] ^= 0x01;
        crate::host_fs::write(&path, &raw).unwrap();
        let opened = open_store(&dir, PW).unwrap();
        let read = || read_logical_file(&dir, &opened.keys, &opened.index, "wide.bin");
        assert!(matches!(
            read(),
            Err(UprivError::VaultFileUnreadable { ref path, problem: FileProblem::Damaged })
                if path == "wide.bin"
        ));
        raw[off0 as usize + 24] ^= 0x01;
        raw.truncate(raw.len() - 4);
        crate::host_fs::write(&path, &raw).unwrap();
        assert!(matches!(
            read(),
            Err(UprivError::VaultFileUnreadable {
                problem: FileProblem::Missing,
                ..
            })
        ));
    }

    #[test]
    fn chunk_rejects_wrap_aad() {
        use super::super::aead::decrypt_xchacha;
        use super::super::header::wrap_aad;

        let (_tmp, dir, _data, _file_id) = seeded_two_chunk();
        let opened = open_store(&dir, PW).unwrap();
        let (file_id, v0, off0) = file_chunk_meta(&opened, "wide.bin", 0);
        let blob = read_chunk_bytes(&dir, &file_id, off0, CHUNK_SIZE);
        let identity = opened.header.content_identity;
        let wrap = wrap_aad(identity, &opened.header.top.kdf).unwrap();
        let content = opened.keys.write_content();
        assert!(decrypt_xchacha(content, &blob, &wrap).is_err());
        let aad = chunk_aad(identity, &file_id, 0, CHUNK_SIZE, v0).unwrap();
        decrypt_xchacha(content, &blob, &aad).expect("correct chunk AAD");
    }

    /// A chunk's version is the one its own nonce gives, so with the key a
    /// chunk opens from its own bytes, and its key id is the one it was
    /// sealed with.
    #[test]
    fn a_chunk_opens_with_its_key_and_its_own_bytes() {
        use super::super::aead::decrypt_xchacha;

        let (_tmp, dir, data, _file_id) = seeded_two_chunk();
        let opened = open_store(&dir, PW).unwrap();
        let node = opened.index.find("wide.bin").unwrap();
        assert!(node
            .chunk_keys()
            .unwrap()
            .iter()
            .all(|key| *key == opened.keys.write_id()));
        let (file_id, version, offset) = file_chunk_meta(&opened, "wide.bin", 0);
        let bytes = read_chunk_bytes(&dir, &file_id, offset, CHUNK_SIZE);
        let nonce: [u8; 24] = bytes[..24].try_into().unwrap();
        assert_eq!(ChunkVersion::of_nonce(&nonce), version);
        let aad = chunk_aad(
            opened.keys.identity(),
            &file_id,
            0,
            CHUNK_SIZE,
            ChunkVersion::of_nonce(&nonce),
        )
        .unwrap();
        let plain = decrypt_xchacha(opened.keys.write_content(), &bytes, &aad).unwrap();
        assert_eq!(plain, data[..CHUNK_SIZE as usize]);
    }

    /// Every blob starts with the key copy of the header it was written
    /// under, 4096 bytes, and its first chunk starts right after it.
    #[test]
    fn a_blob_starts_with_the_headers_key_copy_and_chunks_at_4096() {
        let (_tmp, dir, _data, file_id) = seeded_two_chunk();
        let opened = open_store(&dir, PW).unwrap();
        let (_, _, first) = file_chunk_meta(&opened, "wide.bin", 0);
        assert_eq!(first, KEY_COPY_LEN);
        let blob = blob_path(&dir, &file_id).unwrap();
        let prefix = super::super::key_copy::read_prefix(&blob).unwrap();
        assert_eq!(prefix.generation, opened.header.top.generation);
        assert_eq!(prefix.identity, opened.header.content_identity);
        assert_eq!(prefix.file_id.to_string(), file_id);
        let copy = super::super::key_copy::read_key_copy(&blob).unwrap();
        let kek = opened.header.top.kdf.derive_kek(PW).unwrap();
        let alone = copy.open(&kek).unwrap();
        assert_eq!(alone.write_content(), opened.keys.write_content());
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
            &opened.keys,
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
        let mut raw = crate::host_fs::read(&path).unwrap();
        let end = new_off as usize + stale.len();
        if raw.len() < end {
            raw.resize(end, 0);
        }
        raw[new_off as usize..end].copy_from_slice(&stale);
        crate::host_fs::write(&path, &raw).unwrap();

        let err = read_logical_file(&dir, &reopened.keys, &reopened.index, "wide.bin").unwrap_err();
        assert!(
            matches!(
                err,
                UprivError::VaultFileUnreadable {
                    problem: FileProblem::Damaged,
                    ..
                }
            ),
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
        write_logical_file(&dir, &opened.keys, &mut opened.index, "grow.bin", &first).unwrap();
        let (_, _, versions) = opened.index.find("grow.bin").unwrap().as_file().unwrap();
        let version_before = versions[0];
        let aad_before = chunk_aad(
            opened.header.content_identity,
            "00000000-0000-4000-8000-000000000001",
            0,
            CHUNK_SIZE,
            version_before,
        )
        .unwrap();

        let mut grown = first.clone();
        grown.extend_from_slice(b"tail");
        write_logical_file(&dir, &opened.keys, &mut opened.index, "grow.bin", &grown).unwrap();
        flush_index(&dir, &mut opened).unwrap();

        let aad_after = chunk_aad(
            opened.header.content_identity,
            "00000000-0000-4000-8000-000000000001",
            0,
            CHUNK_SIZE,
            version_before,
        )
        .unwrap();
        assert_eq!(
            aad_before, aad_after,
            "chunk 0 AAD must not depend on the file's total size"
        );

        let reopened = open_store(&dir, PW).unwrap();
        let got = read_logical_file(&dir, &reopened.keys, &reopened.index, "grow.bin").unwrap();
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
            &opened.keys,
            &mut opened.index,
            "notes.txt",
            b"generation-one",
        )
        .unwrap();
        flush_index(&dir, &mut opened).unwrap();
        let old_id = opened.index.find("notes.txt").unwrap().as_file().unwrap().0;
        let old_blob = blob_path(&dir, old_id).unwrap();
        assert!(old_blob.host_is_file());

        write_logical_file(
            &dir,
            &opened.keys,
            &mut opened.index,
            "notes.txt",
            b"generation-two",
        )
        .unwrap();
        assert!(
            old_blob.host_is_file(),
            "previous ciphertext must survive until the sealed index is flushed"
        );

        let reopened = open_store(&dir, PW).unwrap();
        let got = read_logical_file(&dir, &reopened.keys, &reopened.index, "notes.txt").unwrap();
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
            &opened.keys,
            &mut opened.index,
            "notes.txt",
            b"generation-one",
        )
        .unwrap();
        flush_index(&dir, &mut opened).unwrap();
        let old_id = opened.index.find("notes.txt").unwrap().as_file().unwrap().0;
        let old_blob = blob_path(&dir, old_id).unwrap();
        assert!(old_blob.host_is_file());

        write_logical_range(
            &dir,
            &opened.keys,
            &mut opened.index,
            "notes.txt",
            0,
            b"generation-two",
        )
        .unwrap();
        assert!(
            old_blob.host_is_file(),
            "previous ciphertext must survive until the sealed index is flushed"
        );

        let reopened = open_store(&dir, PW).unwrap();
        let got = read_logical_file(&dir, &reopened.keys, &reopened.index, "notes.txt").unwrap();
        assert_eq!(got, b"generation-one");
    }

    #[test]
    fn a_range_write_past_the_end_fills_each_new_chunk_in_order() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(crate::paths::STORE_DIR_NAME);
        create_empty_store(&dir, PW, KdfUnlockPreset::M32).unwrap();
        let mut opened = open_store(&dir, PW).unwrap();
        let chunk = CHUNK_SIZE as usize;
        let head = vec![3u8; chunk + 10];
        write_logical_file(&dir, &opened.keys, &mut opened.index, "grow.bin", &head).unwrap();

        // Starts inside the last chunk and ends three chunks later, past a gap.
        let at = 3 * chunk + 100;
        let tail = vec![9u8; chunk];
        write_logical_range(
            &dir,
            &opened.keys,
            &mut opened.index,
            "grow.bin",
            at as u64,
            &tail,
        )
        .unwrap();
        let mut want = head.clone();
        want.resize(at, 0);
        want.extend_from_slice(&tail);
        let node = opened.index.find("grow.bin").unwrap();
        let (_, size, versions) = node.as_file().unwrap();
        assert_eq!(size, want.len() as u64);
        assert_eq!(versions.len(), want.len().div_ceil(chunk));
        assert_eq!(node.chunk_offsets().unwrap().len(), versions.len());

        flush_index(&dir, &mut opened).unwrap();
        let reopened = open_store(&dir, PW).unwrap();
        let got = read_logical_file(&dir, &reopened.keys, &reopened.index, "grow.bin").unwrap();
        assert_eq!(got, want);
    }

    /// Where the newest record of the blob at `path` sits, and its bytes.
    fn newest_record(path: &Path) -> ((u64, u64), Vec<u8>) {
        let mut file = crate::paths::open_nofollow(path, crate::paths::NofollowMode::Read).unwrap();
        let len = file.metadata().unwrap().len();
        let (start, record_len) =
            super::super::record::newest_record_span(&mut file, len).expect("a record");
        let bytes = crate::host_fs::read(path).unwrap();
        let record = bytes[start as usize..(start + record_len) as usize].to_vec();
        ((start, record_len), record)
    }

    /// `path` written whole and recorded, as the seal that names it does,
    /// then sealed. Returns its blob and id.
    fn write_recorded(
        dir: &Path,
        opened: &mut crate::store::OpenedStore,
        path: &str,
        body: &[u8],
    ) -> (PathBuf, String) {
        let (_, made) =
            write_logical_file(dir, &opened.keys, &mut opened.index, path, body).unwrap();
        made.sync_before_index(&opened.records()).unwrap();
        flush_index(dir, opened).unwrap();
        let file_id = opened.index.find(path).unwrap().as_file().unwrap().0;
        (blob_path(dir, file_id).unwrap(), file_id.to_string())
    }

    /// A slot goes in the first gap that holds it, from the end of the key
    /// copy on, and never over a span placement keeps off: with the newest
    /// record among them, a record as large as a slot is never overwritten.
    #[test]
    fn chunk_placement_keeps_off_the_key_copy_and_the_newest_record() {
        let slot = 500;
        let chunk = (KEY_COPY_LEN, 100);
        let record = (KEY_COPY_LEN + 100, 1000);
        let end = KEY_COPY_LEN + 1100;
        // The record's bytes are a gap that holds the slot.
        assert_eq!(first_fit(end, slot, &[chunk]), KEY_COPY_LEN + 100);
        // Kept off, the slot goes after them.
        assert_eq!(first_fit(end, slot, &[chunk, record]), end);
        // Nothing before the key copy's end is a gap.
        assert_eq!(first_fit(KEY_COPY_LEN, slot, &[]), KEY_COPY_LEN);
        assert_eq!(first_fit(0, slot, &[]), KEY_COPY_LEN);
    }

    /// A blob grown after its newest record keeps that record where it is,
    /// and it still reads.
    #[test]
    fn chunks_written_after_a_record_leave_it_readable() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(crate::paths::STORE_DIR_NAME);
        create_empty_store(&dir, PW, KdfUnlockPreset::M32).unwrap();
        let mut opened = open_store(&dir, PW).unwrap();
        let body = vec![5u8; CHUNK_SIZE as usize];
        let (blob, file_id) = write_recorded(&dir, &mut opened, "f.bin", &body);
        let (span, before) = newest_record(&blob);
        write_logical_range(
            &dir,
            &opened.keys,
            &mut opened.index,
            "f.bin",
            u64::from(CHUNK_SIZE),
            &[7u8; 64],
        )
        .unwrap();
        flush_index(&dir, &mut opened).unwrap();
        write_logical_range(&dir, &opened.keys, &mut opened.index, "f.bin", 0, &body).unwrap();
        let bytes = crate::host_fs::read(&blob).unwrap();
        assert_eq!(&bytes[span.0 as usize..(span.0 + span.1) as usize], before);
        let record =
            super::super::record::read_record(&blob, &file_id, &opened.keys, true).unwrap();
        assert_eq!(record.node.as_file().unwrap().1, u64::from(CHUNK_SIZE));
    }

    #[test]
    fn the_newest_record_is_not_waste_and_an_older_one_is() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(crate::paths::STORE_DIR_NAME);
        create_empty_store(&dir, PW, KdfUnlockPreset::M32).unwrap();
        let mut opened = open_store(&dir, PW).unwrap();
        let (blob, _) = write_recorded(&dir, &mut opened, "note.txt", b"a short note");
        let need_pack = |opened: &crate::store::OpenedStore| {
            blobs_need_pack(&dir, &opened.index, BlobPackMode::Close, None)
        };
        assert!(!need_pack(&opened), "a small file with only its record");

        // The record a close writes leaves the first one as waste.
        let node = opened.index.find("note.txt").unwrap().clone();
        super::super::record::append_record(&blob, &opened.keys, &node, 9, None).unwrap();
        assert!(need_pack(&opened));

        // Packing copies the chunks to a new blob, which gets one record.
        let packed = pack_blob_waste(
            &dir,
            &opened.keys,
            &mut opened.index,
            BlobPackMode::Close,
            None,
        )
        .unwrap()
        .mutation;
        packed.sync_before_index(&opened.records()).unwrap();
        opened.index.list_released(packed.superseded_ids());
        flush_index(&dir, &mut opened).unwrap();
        crate::store::delete_released(&dir, &mut opened.index);
        assert!(!need_pack(&opened));
        let file_id = opened.index.find("note.txt").unwrap().as_file().unwrap().0;
        let (span, _) = newest_record(&blob_path(&dir, file_id).unwrap());
        assert_eq!(span.0, KEY_COPY_LEN + cipher_len(12) as u64);
    }

    /// No drive has an exbibyte free, so each way of asking for one is
    /// refused before a byte of it is written.
    #[test]
    fn zeros_the_drive_has_no_room_for_are_refused_before_any_write() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(crate::paths::STORE_DIR_NAME);
        create_empty_store(&dir, PW, KdfUnlockPreset::M32).unwrap();
        let mut opened = open_store(&dir, PW).unwrap();
        write_logical_file(&dir, &opened.keys, &mut opened.index, "sparse.bin", b"head").unwrap();
        let before = opened.index.nodes().to_vec();
        let (file_id, _, _) = opened.index.find("sparse.bin").unwrap().as_file().unwrap();
        let blob = blob_path(&dir, file_id).unwrap();
        let blob_len = std::fs::metadata(&blob).unwrap().len();
        let exbibyte = 1u64 << 60;
        let refused = |result: Result<ChunkBlobMutation>| matches!(result, Err(UprivError::Io(error)) if error.kind() == std::io::ErrorKind::StorageFull);

        let keys = &opened.keys;
        let index = &mut opened.index;
        assert!(refused(truncate_logical_file(
            &dir,
            keys,
            index,
            "sparse.bin",
            exbibyte
        )));
        assert!(refused(write_logical_range(
            &dir,
            keys,
            index,
            "sparse.bin",
            exbibyte,
            b"tail"
        )));
        assert!(refused(truncate_logical_file(
            &dir, keys, index, "new.bin", exbibyte
        )));
        assert_eq!(opened.index.nodes(), before.as_slice());
        assert_eq!(std::fs::metadata(&blob).unwrap().len(), blob_len);
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
        write_logical_file(&dir, &opened.keys, &mut opened.index, "wide.bin", &payload).unwrap();
        flush_index(&dir, &mut opened).unwrap();
        write_logical_range(&dir, &opened.keys, &mut opened.index, "wide.bin", 0, &next).unwrap();
        flush_index(&dir, &mut opened).unwrap();
        let file_id = opened
            .index
            .find("wide.bin")
            .unwrap()
            .as_file()
            .unwrap()
            .0
            .to_string();
        let len_after_seal = crate::host_fs::metadata(blob_path(&dir, &file_id).unwrap())
            .unwrap()
            .len();
        write_logical_range(&dir, &opened.keys, &mut opened.index, "wide.bin", 0, &third).unwrap();
        let len_after_reuse = crate::host_fs::metadata(blob_path(&dir, &file_id).unwrap())
            .unwrap()
            .len();
        assert_eq!(
            len_after_reuse, len_after_seal,
            "a same-size rewrite must reuse the abandoned span"
        );

        let sealed = open_store(&dir, PW).unwrap();
        let got = read_logical_file(&dir, &sealed.keys, &sealed.index, "wide.bin").unwrap();
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
        write_logical_file(&dir, &opened.keys, &mut opened.index, "wide.bin", &payload).unwrap();
        flush_index(&dir, &mut opened).unwrap();
        let (file_id, _, offset) = file_chunk_meta(&opened, "wide.bin", 0);
        assert_eq!(offset, KEY_COPY_LEN);
        let sealed_bytes = read_chunk_bytes(&dir, &file_id, offset, CHUNK_SIZE);

        let replacement = vec![3u8; CHUNK_SIZE as usize];
        write_logical_range(
            &dir,
            &opened.keys,
            &mut opened.index,
            "wide.bin",
            0,
            &replacement,
        )
        .unwrap();
        let other = vec![4u8; CHUNK_SIZE as usize];
        write_logical_range(
            &dir,
            &opened.keys,
            &mut opened.index,
            "wide.bin",
            u64::from(CHUNK_SIZE),
            &other,
        )
        .unwrap();

        assert!(
            read_chunk_bytes(&dir, &file_id, offset, CHUNK_SIZE) == sealed_bytes,
            "the second rewrite must not overwrite the sealed span"
        );
        let reopened = open_store(&dir, PW).unwrap();
        let got = read_logical_file(&dir, &reopened.keys, &reopened.index, "wide.bin").unwrap();
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
            &opened.keys,
            &mut opened.index,
            "notes.txt",
            b"generation-one",
        )
        .unwrap();
        flush_index(&dir, &mut opened).unwrap();
        write_logical_range(
            &dir,
            &opened.keys,
            &mut opened.index,
            "notes.txt",
            0,
            b"generation-two",
        )
        .unwrap();
        let packed = pack_blob_waste(
            &dir,
            &opened.keys,
            &mut opened.index,
            BlobPackMode::Close,
            None,
        )
        .unwrap()
        .mutation;
        assert!(!packed.created.is_empty(), "dead ciphertext must be packed");
        packed.sync_before_index(&opened.records()).unwrap();
        opened.index.list_released(packed.superseded_ids());
        flush_index(&dir, &mut opened).unwrap();
        crate::store::delete_released(&dir, &mut opened.index);
        let file_id = opened.index.find("notes.txt").unwrap().as_file().unwrap().0;
        let path = blob_path(&dir, file_id).unwrap();
        let mut blob =
            crate::paths::open_nofollow(&path, crate::paths::NofollowMode::Read).unwrap();
        let len = blob.metadata().unwrap().len();
        let (record_start, record_len) =
            super::super::record::newest_record_span(&mut blob, len).expect("its record");
        // The key copy, the live chunk, then its record: no dead ciphertext.
        assert_eq!(
            record_start,
            KEY_COPY_LEN + cipher_len(b"generation-two".len() as u32) as u64
        );
        assert_eq!(record_start + record_len, len);
        let reopened = open_store(&dir, PW).unwrap();
        let got = read_logical_file(&dir, &reopened.keys, &reopened.index, "notes.txt").unwrap();
        assert_eq!(got, b"generation-two");
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
            &opened.keys,
            &mut opened.index,
            "notes.txt",
            b"generation-one",
        )
        .unwrap();
        flush_index(&dir, &mut opened).unwrap();
        let file_id = opened.index.find("notes.txt").unwrap().as_file().unwrap().0;
        let blob = blob_path(&dir, file_id).unwrap();
        crate::host_fs::remove_file(&blob).unwrap();
        let target = tmp.path().join("outside.txt");
        crate::host_fs::write(&target, b"do-not-touch").unwrap();
        std::os::unix::fs::symlink(&target, &blob).unwrap();
        let err = write_logical_range(
            &dir,
            &opened.keys,
            &mut opened.index,
            "notes.txt",
            0,
            b"generation-two",
        )
        .unwrap_err();
        assert!(
            matches!(
                err,
                UprivError::VaultFileUnreadable {
                    problem: FileProblem::Damaged,
                    ..
                }
            ),
            "{err}"
        );
        assert_eq!(crate::host_fs::read(&target).unwrap(), b"do-not-touch");
    }
}
