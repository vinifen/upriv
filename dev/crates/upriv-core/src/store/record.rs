//! Recovery records: each blob's own copy of its file's entry in the index.
//!
//! The index is the only authority on what a file holds, and nothing here is
//! read by an open, a read, a write, or an export. A record serves only the
//! person who holds the password, when the index cannot: a blob no index
//! names (set aside in `held/`) names itself, and a vault whose two index
//! files are both lost is rebuilt from its blobs (`vault::rebuild`).
//!
//! A record is the file's [`VaultNode`] as the seal that names it is about to
//! seal it, with the vault's identity, that seal's number, and when it was
//! written. It is appended to the blob after the chunks it describes, so each
//! chunk it names lies before it, and it is flushed with the blob before the
//! index that names that entry ([`super::chunk::StagedBlobs`]).
//!
//! A blob gets one at the seal that first names it (a whole-file write, an
//! import, a pack, a copy), and one at the close of each session that wrote to
//! it after that. A record lists every chunk, so writing one at every seal
//! would cost a large file copied through the mounted folder a new full list
//! per batch. Between those two moments the newest record describes the file
//! as its last close left it. Records are never rewritten: a rename or a move
//! writes nothing to the blob, so a record keeps the path its file had when
//! it was written. Packing drops the old records with the old blob.
//!
//! On disk a record is followed by a footer, the only part readable without
//! the key:
//!
//! ```text
//! magic "UPRR" | seq u32 LE | record length u32 LE | end of the previous footer u64 LE
//! ```
//!
//! The newest record ends at the blob's last byte; the previous one ends where
//! its footer says. Its key is its own HKDF layer of the master key
//! ([`super::aead::derive_record_key`]); its AAD binds the vault, the blob's
//! file id, and `seq` ([`super::header::record_aad`]), so a record copied into
//! another vault, blob, or place in the chain does not open. A record is
//! decrypted before any of it is parsed, then checked against the header and
//! its blob before recovery uses it.
//!
//! Recovery may get older data than the vault last held, since someone with
//! the disk can put back an older blob with its older record. That is why
//! records never serve a normal read, and why a rebuild runs only when the
//! person asks for it.

#[allow(unused_imports)]
use crate::host_fs::HostFsQuery;
use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use uuid::Uuid;
use zeroize::Zeroizing;

use super::aead::{
    decrypt_xchacha, encrypt_xchacha, CONTENT_KEY_LEN, INDEX_KEY_LEN, RECORD_KEY_LEN,
};
use super::chunk::{blob_file_id, chunk_count, chunk_plain_len, cipher_len, validate_logical_path};
use super::header::{record_aad, VaultHeader};
use super::index::{VaultIndex, VaultNode};
use crate::error::{Result, UprivError};
use crate::logging::{log_event, LogLevel};

/// Bytes of the footer after each record.
pub(crate) const FOOTER_LEN: u64 = 20;
const FOOTER_MAGIC: [u8; 4] = *b"UPRR";
/// Longest record written or read: the entry of a file of about 400 GiB.
/// Anything longer is not a record.
const MAX_RECORD_LEN: u64 = 64 * 1024 * 1024;
/// Bytes a scan for a record reads at a time ([`read_record`]).
const SCAN_WINDOW: u64 = 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Footer {
    seq: u32,
    /// Bytes of the record before this footer.
    len: u32,
    /// Where the previous record's footer ends; 0 when there is none.
    prev_end: u64,
}

impl Footer {
    fn encode(self) -> [u8; FOOTER_LEN as usize] {
        let mut out = [0u8; FOOTER_LEN as usize];
        out[0..4].copy_from_slice(&FOOTER_MAGIC);
        out[4..8].copy_from_slice(&self.seq.to_le_bytes());
        out[8..12].copy_from_slice(&self.len.to_le_bytes());
        out[12..20].copy_from_slice(&self.prev_end.to_le_bytes());
        out
    }

    /// A footer ending at `end`, when those bytes are one: the magic, a
    /// length that fits before it, and a previous end before its record.
    fn decode(bytes: &[u8; FOOTER_LEN as usize], end: u64) -> Option<Self> {
        if bytes[0..4] != FOOTER_MAGIC {
            return None;
        }
        let seq = u32::from_le_bytes(bytes[4..8].try_into().ok()?);
        let len = u32::from_le_bytes(bytes[8..12].try_into().ok()?);
        let prev_end = u64::from_le_bytes(bytes[12..20].try_into().ok()?);
        let start = end.checked_sub(FOOTER_LEN + u64::from(len))?;
        if seq == 0 || len == 0 || u64::from(len) > MAX_RECORD_LEN || prev_end > start {
            return None;
        }
        Some(Self { seq, len, prev_end })
    }

    /// Where the record before this footer starts, the footer ending at `end`.
    fn record_start(self, end: u64) -> u64 {
        end - FOOTER_LEN - u64::from(self.len)
    }
}

fn footer_at(file: &mut crate::host_fs::File, end: u64) -> Option<Footer> {
    if end < FOOTER_LEN {
        return None;
    }
    let mut bytes = [0u8; FOOTER_LEN as usize];
    file.seek(SeekFrom::Start(end - FOOTER_LEN)).ok()?;
    file.read_exact(&mut bytes).ok()?;
    Footer::decode(&bytes, end)
}

/// Where the newest record of a blob `len` bytes long sits, footer included:
/// `(start, len)`. Read from the footer alone, with no key: chunk placement
/// keeps off it and the waste measure leaves it out. `None` when the blob
/// does not end with a record.
pub(crate) fn newest_record_span(file: &mut crate::host_fs::File, len: u64) -> Option<(u64, u64)> {
    let footer = footer_at(file, len)?;
    let start = footer.record_start(len);
    Some((start, len - start))
}

/// What a record says about its blob.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct BlobRecord {
    /// The file's entry as its last save sealed it, with the path it had then.
    pub node: VaultNode,
    /// The number of the seal it was written for (`VaultIndex::saves`).
    pub save: u64,
    /// When it was written, UTC milliseconds. Breaks a tie of `save`.
    pub written_at: u64,
}

/// The sealed payload. Field order is free: this is encrypted, not AAD.
#[derive(Serialize, Deserialize)]
struct RecordPayload {
    vault: Uuid,
    save: u64,
    written_at: u64,
    node: VaultNode,
}

/// The tree a seal is about to write, and what its records are sealed with.
pub(crate) struct Records<'a> {
    pub header: &'a VaultHeader,
    pub key: &'a [u8; RECORD_KEY_LEN],
    pub index: &'a VaultIndex,
}

/// Append a record to each blob at `blobs` that a file of `records.index`
/// names, describing that file as the next seal writes it, and return the
/// blobs that got one. A blob no file names gets none. A record that cannot
/// be written is logged and skipped: it only adds a way back, so the seal
/// never fails for one.
pub(crate) fn append_records(records: &Records<'_>, blobs: &[PathBuf]) -> Vec<PathBuf> {
    if blobs.is_empty() {
        return Vec::new();
    }
    let by_id: HashMap<&str, &PathBuf> = blobs
        .iter()
        .filter_map(|path| Some((blob_file_id(path)?, path)))
        .collect();
    let save = records.index.saves.saturating_add(1);
    let mut recorded = Vec::with_capacity(by_id.len());
    let mut failed = 0usize;
    for node in records.index.nodes() {
        let Some((file_id, size, _)) = node.as_file() else {
            continue;
        };
        let Some(&path) = by_id.get(file_id) else {
            continue;
        };
        if size == 0 {
            continue;
        }
        let known = records.index.writes.records.get(file_id).copied();
        match append_record(path, records.header, records.key, node, save, known) {
            Ok(()) => {
                #[cfg(all(test, debug_assertions))]
                assert_eq!(
                    read_record(path, file_id, records.header, records.key, false)
                        .map(|record| record.node.kind),
                    Some(node.kind.clone()),
                    "a record reads back as the entry it was written from"
                );
                recorded.push(path.clone());
            }
            Err(_) => failed += 1,
        }
    }
    if failed > 0 {
        log_record_failed(&blobs[0], failed);
    }
    recorded
}

/// Append the first record of a blob an import made ahead of the session
/// lock, before the flush that makes its chunks durable, so that one flush
/// covers both. `node` is the entry the import is about to name and `save`
/// the number of the session's next seal. False, and logged, when the record
/// could not be written: the seal that names the blob then writes it.
pub(crate) fn record_made_blob(
    store_dir: &Path,
    header: &VaultHeader,
    key: &[u8; RECORD_KEY_LEN],
    node: &VaultNode,
    save: u64,
) -> bool {
    let Some((file_id, _, _)) = node.as_file() else {
        return false;
    };
    let Ok(path) = super::chunk::blob_path(store_dir, file_id) else {
        return false;
    };
    let appended = append_record(&path, header, key, node, save, None).is_ok();
    if !appended {
        log_record_failed(&path, 1);
    }
    appended
}

/// `count` records of the vault that holds the blob at `blob` were not written.
fn log_record_failed(blob: &Path, count: usize) {
    let id = blob
        .ancestors()
        .nth(4)
        .and_then(Path::file_name)
        .and_then(|name| name.to_str())
        .unwrap_or("");
    let count = count.to_string();
    log_event(
        LogLevel::Warn,
        "vault_blob_record_failed",
        &[("id", id), ("count", count.as_str())],
    );
}

/// Append a record of `node` to its blob at `path`, after everything in it.
/// The caller flushes the blob with the seal that names `node`. The file's
/// problem mark is the vault's state, not the file's, and is left out.
///
/// It links to the blob's newest record: the one its last bytes end with, or,
/// once the session wrote chunks after it, `known` (`(start, length)`, as
/// [`newest_record_span`] gave it), so a reader can fall back along the chain.
pub(crate) fn append_record(
    path: &Path,
    header: &VaultHeader,
    key: &[u8; RECORD_KEY_LEN],
    node: &VaultNode,
    save: u64,
    known: Option<(u64, u64)>,
) -> Result<()> {
    let Some((file_id, _, _)) = node.as_file() else {
        return Err(record_error("only a file has a record"));
    };
    let mut file = crate::paths::open_nofollow(path, crate::paths::NofollowMode::ReadWrite)?;
    let len = file.metadata()?.len();
    let known_end = known
        .and_then(|(start, record_len)| start.checked_add(record_len))
        .filter(|end| *end <= len);
    let previous = footer_at(&mut file, len)
        .map(|footer| (footer, len))
        .or_else(|| {
            known_end.and_then(|end| footer_at(&mut file, end).map(|footer| (footer, end)))
        });
    let (seq, prev_end) = match previous {
        Some((footer, end)) => (footer.seq.saturating_add(1), end),
        None => (1, 0),
    };
    let mut node = node.clone();
    node.problem = None;
    let payload = Zeroizing::new(
        serde_json::to_vec(&RecordPayload {
            vault: header.content_identity,
            save,
            written_at: crate::time::unix_millis(),
            node,
        })
        .map_err(|error| record_error(&format!("record serialize: {error}")))?,
    );
    let sealed = encrypt_xchacha(key, &payload, &record_aad(header, file_id, seq)?)?;
    let record_len = u32::try_from(sealed.len())
        .ok()
        .filter(|len| u64::from(*len) <= MAX_RECORD_LEN)
        .ok_or_else(|| record_error("record too large"))?;
    let footer = Footer {
        seq,
        len: record_len,
        prev_end,
    };
    let mut bytes = sealed;
    bytes.extend_from_slice(&footer.encode());
    file.seek(SeekFrom::Start(len))?;
    file.write_all(&bytes)?;
    Ok(())
}

/// The newest record of the blob `file_id` at `path` that opens and checks
/// out, walking back the chain past one that does not. The id is the blob's
/// name in `data/`; a blob set aside in `held/` may carry a number after it.
/// `scan` also searches the blob from its end when the chain gives none:
/// chunks written after the last record by a session that did not close, or
/// an append a crash cut short. That reads up to the whole blob, so only a
/// rebuild asks for it. `None` when no record of the blob is usable.
pub(crate) fn read_record(
    path: &Path,
    file_id: &str,
    header: &VaultHeader,
    key: &[u8; RECORD_KEY_LEN],
    scan: bool,
) -> Option<BlobRecord> {
    let mut file = crate::paths::open_nofollow(path, crate::paths::NofollowMode::Read).ok()?;
    let len = file.metadata().ok()?.len();
    let mut end = len;
    while let Some(footer) = footer_at(&mut file, end) {
        if let Some(record) = open_record(&mut file, end, footer, header, key, file_id) {
            return Some(record);
        }
        if footer.prev_end == 0 {
            break;
        }
        end = footer.prev_end;
    }
    if !scan {
        return None;
    }
    scan_back(&mut file, len, header, key, file_id)
}

/// Search the blob from its end for a footer whose record opens.
fn scan_back(
    file: &mut crate::host_fs::File,
    len: u64,
    header: &VaultHeader,
    key: &[u8; RECORD_KEY_LEN],
    file_id: &str,
) -> Option<BlobRecord> {
    let overlap = FOOTER_MAGIC.len() as u64 - 1;
    let mut window = Vec::new();
    let mut window_end = len;
    while window_end >= FOOTER_LEN {
        let window_start = window_end.saturating_sub(SCAN_WINDOW);
        window.resize((window_end - window_start) as usize, 0);
        file.seek(SeekFrom::Start(window_start)).ok()?;
        file.read_exact(&mut window).ok()?;
        for at in (0..window.len().saturating_sub(overlap as usize)).rev() {
            if window[at..].starts_with(&FOOTER_MAGIC) {
                let end = window_start + at as u64 + FOOTER_LEN;
                if end > len {
                    continue;
                }
                let Some(footer) = footer_at(file, end) else {
                    continue;
                };
                if let Some(record) = open_record(file, end, footer, header, key, file_id) {
                    return Some(record);
                }
            }
        }
        if window_start == 0 {
            break;
        }
        window_end = window_start + overlap;
    }
    None
}

/// Decrypt the record before the footer ending at `end`, then check it: it
/// belongs to this vault and this blob, its path is a valid store path, its
/// chunk lists match its size, and every chunk it names lies before it.
fn open_record(
    file: &mut crate::host_fs::File,
    end: u64,
    footer: Footer,
    header: &VaultHeader,
    key: &[u8; RECORD_KEY_LEN],
    file_id: &str,
) -> Option<BlobRecord> {
    let start = footer.record_start(end);
    let mut sealed = vec![0u8; footer.len as usize];
    file.seek(SeekFrom::Start(start)).ok()?;
    file.read_exact(&mut sealed).ok()?;
    let aad = record_aad(header, file_id, footer.seq).ok()?;
    let plain = Zeroizing::new(decrypt_xchacha(key, &sealed, &aad).ok()?);
    let payload: RecordPayload = serde_json::from_slice(&plain).ok()?;
    if payload.vault != header.content_identity {
        return None;
    }
    let node = payload.node;
    let (named_id, size, versions) = node.as_file()?;
    let offsets = node.chunk_offsets()?;
    if named_id != file_id || validate_logical_path(&node.path).is_err() {
        return None;
    }
    let count = chunk_count(size, header.chunk_size) as usize;
    if versions.len() != count || offsets.len() != count {
        return None;
    }
    let chunks_fit = offsets.iter().enumerate().all(|(index, offset)| {
        let sealed_len = cipher_len(chunk_plain_len(size, index as u32, header.chunk_size)) as u64;
        offset
            .checked_add(sealed_len)
            .is_some_and(|chunk_end| chunk_end <= start)
    });
    if !chunks_fit || node.problem.is_some() {
        return None;
    }
    Some(BlobRecord {
        node,
        save: payload.save,
        written_at: payload.written_at,
    })
}

fn record_error(detail: &str) -> UprivError {
    UprivError::VaultStoreInvalid {
        path: std::path::PathBuf::from("data"),
        detail: detail.into(),
    }
}

/// A tree built from what names a store's blobs ([`rebuild_tree`]).
pub(crate) struct RebuiltTree {
    pub index: VaultIndex,
    /// Files placed in the tree.
    pub placed: usize,
    /// Of those, files a backup named because it is newer than the blob's
    /// record, or the blob has none.
    pub from_backups: usize,
    /// Blobs whose name a newer file took, or that cannot sit in the tree.
    pub left: usize,
    /// Blobs nothing names: no record opens, and no backup names them.
    pub unnamed: usize,
}

/// What a rebuild reads to name a store's blobs.
pub(crate) struct RebuildSources<'a> {
    pub header: &'a VaultHeader,
    pub content_key: &'a [u8; CONTENT_KEY_LEN],
    pub index_key: &'a [u8; INDEX_KEY_LEN],
    pub record_key: &'a [u8; RECORD_KEY_LEN],
    /// This vault's backup zips, newest first.
    pub backup_zips: &'a dyn Fn() -> Vec<PathBuf>,
}

/// One blob's file, as the newest thing that names it gives it.
struct Named {
    node: VaultNode,
    /// The save count of what named it: the record's seal, or the backup's tree.
    save: u64,
    /// Breaks a tie of `save`: when the record was written, or the file changed.
    at: u64,
    from_backup: bool,
}

/// Build the tree of the store at `store_dir` from what names each blob in
/// its `data/`: the newest record it carries, searched whole when its last
/// bytes are no record ([`read_record`]), and the newest backup zip whose
/// tree names it and whose first chunk opens from it. The one with the higher
/// save count wins, the backup on a tie, so a file renamed since its record
/// takes its name from the backup, and a blob with no record still comes
/// back. `step` runs before each blob and may stop the walk.
///
/// Files are placed newest first, by save count, then time. A file takes its
/// path, and each folder above it is made. A path a newer file took, or one
/// under a file, is left: that blob stays in `data/`, as does every blob
/// nothing names, and the next unlock sets them aside in `held/`. Nothing is
/// moved, rewritten, or deleted here. Empty folders and empty files have no
/// blob, so they do not come back. The tree's save count goes on from the
/// highest one it read.
pub(crate) fn rebuild_tree(
    store_dir: &Path,
    sources: &RebuildSources<'_>,
    step: &mut dyn FnMut() -> Result<()>,
) -> Result<RebuiltTree> {
    let blobs = list_blobs(store_dir)?;
    let mut records = Vec::with_capacity(blobs.len());
    for (path, file_id) in &blobs {
        step()?;
        records.push(read_record(
            path,
            file_id,
            sources.header,
            sources.record_key,
            true,
        ));
    }
    step()?;
    let backups = super::held::name_from_backups(
        &blobs,
        sources.header,
        sources.content_key,
        sources.index_key,
        sources.backup_zips,
    );
    let mut named: Vec<Named> = Vec::with_capacity(blobs.len());
    let mut unnamed = 0;
    for (record, backup) in records.into_iter().zip(backups) {
        let from_record = record.map(|record| Named {
            node: record.node,
            save: record.save,
            at: record.written_at,
            from_backup: false,
        });
        let from_backup = backup.map(|(save, node)| Named {
            at: node.modified_at,
            node,
            save,
            from_backup: true,
        });
        match (from_record, from_backup) {
            (Some(record), Some(backup)) if backup.save >= record.save => named.push(backup),
            (Some(record), _) => named.push(record),
            (None, Some(backup)) => named.push(backup),
            (None, None) => unnamed += 1,
        }
    }
    named.sort_by(|a, b| (b.save, b.at).cmp(&(a.save, a.at)));
    let mut index = VaultIndex::empty();
    index.saves = named.first().map_or(0, |newest| newest.save);
    let (mut placed, mut from_backups, mut left) = (0, 0, 0);
    for file in named {
        if place(&mut index, file.node) {
            placed += 1;
            from_backups += usize::from(file.from_backup);
        } else {
            left += 1;
        }
    }
    index
        .check_tree()
        .map_err(|problem| record_error(&format!("rebuilt tree: {problem}")))?;
    Ok(RebuiltTree {
        index,
        placed,
        from_backups,
        left,
        unnamed,
    })
}

/// Put `node` in `index` with the folders above it, when its path is free and
/// every folder on the way is one. False leaves `index` as it was.
fn place(index: &mut VaultIndex, node: VaultNode) -> bool {
    if index.find(&node.path).is_some() {
        return false;
    }
    let mut made: Vec<String> = Vec::new();
    let mut folder = String::new();
    let parent = super::tree::parent_logical(&node.path).unwrap_or("");
    for part in parent.split('/').filter(|part| !part.is_empty()) {
        if !folder.is_empty() {
            folder.push('/');
        }
        folder.push_str(part);
        let fits = match index.find(&folder) {
            Some(existing) => existing.is_dir(),
            None => {
                let made_now = super::tree::mkdir_logical(index, &folder).is_ok();
                if made_now {
                    made.push(folder.clone());
                }
                made_now
            }
        };
        if !fits {
            for path in made.iter().rev() {
                index.remove(path);
            }
            return false;
        }
    }
    index.push(node);
    true
}

/// Every blob in the `data/` of `store_dir`, with its file id: a file named
/// `<id>.blob` in a shard folder of two hex digits. Anything else is skipped.
fn list_blobs(store_dir: &Path) -> Result<Vec<(PathBuf, String)>> {
    let data = store_dir.join(super::index::DATA_DIR_NAME);
    let shards = match crate::host_fs::read_dir(&data) {
        Ok(shards) => shards,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.into()),
    };
    let mut blobs = Vec::new();
    for shard in shards {
        let shard = shard?;
        let is_shard = shard.file_name().to_str().is_some_and(|name| {
            name.len() == 2 && name.bytes().all(|byte| byte.is_ascii_hexdigit())
        });
        if !is_shard || !shard.file_type()?.host_is_dir() {
            continue;
        }
        for entry in crate::host_fs::read_dir(shard.path())? {
            let path = entry?.path();
            if let Some(file_id) = blob_file_id(&path) {
                let file_id = file_id.to_string();
                blobs.push((path, file_id));
            }
        }
    }
    blobs.sort();
    Ok(blobs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::chunk::{blob_path, write_logical_file};
    use crate::store::index::FileProblem;
    use crate::store::{create_empty_store, open_store, KdfUnlockPreset, OpenedStore};

    const PW: &[u8] = b"records-ok";

    struct Store {
        _tmp: tempfile::TempDir,
        dir: PathBuf,
        opened: OpenedStore,
    }

    impl Store {
        fn new() -> Self {
            let tmp = tempfile::tempdir().unwrap();
            let dir = tmp.path().join("vault").join(crate::paths::STORE_DIR_NAME);
            create_empty_store(&dir, PW, KdfUnlockPreset::M32).unwrap();
            let opened = open_store(&dir, PW).unwrap();
            Self {
                _tmp: tmp,
                dir,
                opened,
            }
        }

        /// Write `path` whole and record it, as the seal that names it does.
        /// Returns its blob and id.
        fn write(&mut self, path: &str, body: &[u8]) -> (PathBuf, String) {
            let opened = &mut self.opened;
            let (_, mutation) = write_logical_file(
                &self.dir,
                &opened.header,
                &opened.content_key,
                &mut opened.index,
                path,
                body,
            )
            .unwrap();
            mutation.sync_before_index(&opened.records()).unwrap();
            let id = self.node(path).as_file().unwrap().0.to_string();
            (blob_path(&self.dir, &id).unwrap(), id)
        }

        fn node(&self, path: &str) -> &VaultNode {
            self.opened.index.find(path).unwrap()
        }

        fn read(&self, blob: &Path, id: &str, scan: bool) -> Option<BlobRecord> {
            read_record(blob, id, &self.opened.header, &self.opened.record_key, scan)
        }

        /// Append `payload` as a record sealed with this vault's key, bound
        /// to `id` and `seq`, the way [`append_record`] does.
        fn append_sealed(&self, blob: &Path, id: &str, seq: u32, payload: &[u8]) {
            let header = &self.opened.header;
            let sealed = encrypt_xchacha(
                &self.opened.record_key,
                payload,
                &record_aad(header, id, seq).unwrap(),
            )
            .unwrap();
            let len = crate::host_fs::metadata(blob).unwrap().len();
            let mut bytes = crate::host_fs::read(blob).unwrap();
            let prev_end = if seq > 1 { len } else { 0 };
            bytes.extend_from_slice(&sealed);
            bytes.extend_from_slice(
                &Footer {
                    seq,
                    len: sealed.len() as u32,
                    prev_end,
                }
                .encode(),
            );
            crate::host_fs::write(blob, bytes).unwrap();
        }

        /// The record of `node` as a payload, with `edit` applied.
        fn payload(&self, node: &VaultNode, edit: impl FnOnce(&mut RecordPayload)) -> Vec<u8> {
            let mut payload = RecordPayload {
                vault: self.opened.header.content_identity,
                save: 9,
                written_at: 1,
                node: node.clone(),
            };
            edit(&mut payload);
            serde_json::to_vec(&payload).unwrap()
        }
    }

    fn tail(blob: &Path) -> u64 {
        let mut file = crate::paths::open_nofollow(blob, crate::paths::NofollowMode::Read).unwrap();
        let len = file.metadata().unwrap().len();
        newest_record_span(&mut file, len).map_or(len, |(start, _)| start)
    }

    #[test]
    fn a_record_reads_back_as_the_entry_its_seal_writes() {
        let mut store = Store::new();
        let (blob, id) = store.write("a.txt", b"first body");
        let record = store.read(&blob, &id, false).expect("its record");
        assert_eq!(&record.node, store.node("a.txt"));
        assert_eq!(record.save, store.opened.index.saves + 1);
        assert!(record.written_at > 0);
        // The record sits after the one chunk it names.
        assert_eq!(tail(&blob), cipher_len(10) as u64);
    }

    #[test]
    fn a_problem_mark_stays_out_of_the_record() {
        let mut store = Store::new();
        let (blob, id) = store.write("a.txt", b"body");
        let mut node = store.node("a.txt").clone();
        node.problem = Some(FileProblem::Damaged);
        append_record(
            &blob,
            &store.opened.header,
            &store.opened.record_key,
            &node,
            4,
            None,
        )
        .unwrap();
        let record = store.read(&blob, &id, false).unwrap();
        assert_eq!(record.node.problem, None);
        assert_eq!(record.save, 4);
    }

    #[test]
    fn the_newest_record_wins_and_a_broken_one_falls_back_along_the_chain() {
        let mut store = Store::new();
        let (blob, id) = store.write("a.txt", b"body");
        let first = store.read(&blob, &id, false).unwrap();
        let mut renamed = store.node("a.txt").clone();
        renamed.path = "b.txt".into();
        let header = &store.opened.header;
        append_record(&blob, header, &store.opened.record_key, &renamed, 7, None).unwrap();
        let newest = store.read(&blob, &id, false).unwrap();
        assert_eq!((newest.node.path.as_str(), newest.save), ("b.txt", 7));

        // A byte of the newest record's ciphertext: its tag fails, and the
        // one before it is read through the footer's link.
        let mut bytes = crate::host_fs::read(&blob).unwrap();
        let at = bytes.len() - FOOTER_LEN as usize - 1;
        bytes[at] ^= 0x01;
        crate::host_fs::write(&blob, &bytes).unwrap();
        assert_eq!(store.read(&blob, &id, false), Some(first));
    }

    #[test]
    fn a_record_after_later_chunks_still_links_to_the_one_before() {
        let mut store = Store::new();
        let (blob, id) = store.write("a.txt", b"body");
        let first = store.read(&blob, &id, false).unwrap();
        let mut file =
            crate::paths::open_nofollow(&blob, crate::paths::NofollowMode::Read).unwrap();
        let len = file.metadata().unwrap().len();
        let span = newest_record_span(&mut file, len);
        drop(file);
        // Chunks a session wrote after the record: the blob no longer ends with it.
        let mut bytes = crate::host_fs::read(&blob).unwrap();
        bytes.extend_from_slice(&[0x33; 100]);
        crate::host_fs::write(&blob, &bytes).unwrap();
        let header = &store.opened.header;
        let node = store.node("a.txt").clone();
        append_record(&blob, header, &store.opened.record_key, &node, 8, span).unwrap();
        assert_eq!(store.read(&blob, &id, false).unwrap().save, 8);

        // The newest broken: the chain still reaches the first, with no scan.
        let mut bytes = crate::host_fs::read(&blob).unwrap();
        let at = bytes.len() - FOOTER_LEN as usize - 1;
        bytes[at] ^= 0x01;
        crate::host_fs::write(&blob, &bytes).unwrap();
        assert_eq!(store.read(&blob, &id, false), Some(first));
    }

    #[test]
    fn a_record_moved_to_another_blob_or_place_in_the_chain_does_not_open() {
        let mut store = Store::new();
        let (a_blob, a_id) = store.write("a.txt", b"first");
        let (b_blob, b_id) = store.write("b.txt", b"second");
        let a_bytes = crate::host_fs::read(&a_blob).unwrap();
        let record = &a_bytes[tail(&a_blob) as usize..];

        // Onto another blob: the AAD binds the blob's id.
        let mut b_bytes = crate::host_fs::read(&b_blob).unwrap();
        b_bytes.truncate(tail(&b_blob) as usize);
        b_bytes.extend_from_slice(record);
        crate::host_fs::write(&b_blob, &b_bytes).unwrap();
        assert_eq!(store.read(&b_blob, &b_id, false), None);

        // Another place in the chain: the AAD binds `seq`.
        let mut moved = a_bytes.clone();
        let seq_at = moved.len() - FOOTER_LEN as usize + 4;
        moved[seq_at..seq_at + 4].copy_from_slice(&2u32.to_le_bytes());
        crate::host_fs::write(&a_blob, &moved).unwrap();
        assert_eq!(store.read(&a_blob, &a_id, false), None);
        crate::host_fs::write(&a_blob, &a_bytes).unwrap();
        assert!(store.read(&a_blob, &a_id, false).is_some());
    }

    #[test]
    fn a_record_of_another_vault_does_not_open() {
        let mut store = Store::new();
        let (blob, id) = store.write("a.txt", b"body");
        let mut other = Store::new();
        let (other_blob, other_id) = other.write("a.txt", b"body");
        // The other vault's record, put on a blob of this vault's id.
        let other_bytes = crate::host_fs::read(&other_blob).unwrap();
        let mut bytes = crate::host_fs::read(&blob).unwrap();
        bytes.truncate(tail(&blob) as usize);
        bytes.extend_from_slice(&other_bytes[tail(&other_blob) as usize..]);
        crate::host_fs::write(&blob, &bytes).unwrap();
        assert_eq!(store.read(&blob, &id, false), None);
        assert!(other.read(&other_blob, &other_id, false).is_some());
    }

    /// `node` with its file id, size, and chunk offsets edited.
    fn edit_file(
        node: &VaultNode,
        edit: impl FnOnce(&mut String, &mut u64, &mut [u64]),
    ) -> VaultNode {
        let mut node = node.clone();
        if let super::super::index::VaultNodeKind::File {
            file_id,
            size,
            chunk_offsets,
            ..
        } = &mut node.kind
        {
            edit(file_id, size, chunk_offsets);
        }
        node
    }

    #[test]
    fn a_sealed_record_that_breaks_a_rule_is_ignored() {
        let mut store = Store::new();
        let (blob, id) = store.write("a.txt", b"body");
        let chunks = crate::host_fs::read(&blob).unwrap()[..tail(&blob) as usize].to_vec();
        let node = store.node("a.txt").clone();
        let broken: Vec<(&str, Vec<u8>)> = vec![
            (
                "another vault",
                store.payload(&node, |payload| payload.vault = Uuid::new_v4()),
            ),
            (
                "another file id",
                store.payload(
                    &edit_file(&node, |file_id, _, _| *file_id = Uuid::new_v4().to_string()),
                    |_| {},
                ),
            ),
            (
                "a path outside the vault",
                store.payload(&node, |payload| payload.node.path = "../a.txt".into()),
            ),
            (
                "a chunk list that does not match the size",
                store.payload(&edit_file(&node, |_, size, _| *size = 600 * 1024), |_| {}),
            ),
            (
                "a chunk that ends past the record's start",
                store.payload(&edit_file(&node, |_, _, offsets| offsets[0] = 40), |_| {}),
            ),
            (
                "a problem mark",
                store.payload(&node, |payload| {
                    payload.node.problem = Some(FileProblem::Missing)
                }),
            ),
            ("not a record", b"{\"vault\":1}".to_vec()),
        ];
        // Each in place of the real record, so nothing older can answer.
        for (why, payload) in broken {
            crate::host_fs::write(&blob, &chunks).unwrap();
            store.append_sealed(&blob, &id, 1, &payload);
            assert_eq!(store.read(&blob, &id, true), None, "{why}");
        }
        crate::host_fs::write(&blob, &chunks).unwrap();
        store.append_sealed(&blob, &id, 1, &store.payload(&node, |_| {}));
        assert!(store.read(&blob, &id, false).is_some());
    }

    #[test]
    fn a_tail_that_is_no_footer_hides_the_record_until_a_scan() {
        let mut store = Store::new();
        let (blob, id) = store.write("a.txt", b"body");
        let record = store.read(&blob, &id, false).unwrap();
        // Chunks a session wrote after the record, or an append cut short.
        let mut bytes = crate::host_fs::read(&blob).unwrap();
        bytes.extend(std::iter::repeat_n(0x55, 3 * SCAN_WINDOW as usize / 2));
        crate::host_fs::write(&blob, &bytes).unwrap();
        assert_eq!(store.read(&blob, &id, false), None);
        assert_eq!(store.read(&blob, &id, true), Some(record));
    }

    #[test]
    fn a_footer_reads_only_when_it_fits_before_its_end() {
        let footer = Footer {
            seq: 2,
            len: 100,
            prev_end: 30,
        };
        let bytes = footer.encode();
        assert_eq!(Footer::decode(&bytes, 150), Some(footer));
        // Its record would start before the blob.
        assert_eq!(Footer::decode(&bytes, 119), None);
        // The previous footer would end inside this record.
        assert_eq!(Footer::decode(&bytes, 149), None);
        let with = |edit: &dyn Fn(&mut Footer)| {
            let mut footer = footer;
            edit(&mut footer);
            Footer::decode(&footer.encode(), 1 << 40)
        };
        assert_eq!(with(&|footer| footer.seq = 0), None);
        assert_eq!(with(&|footer| footer.len = 0), None);
        assert_eq!(with(&|footer| footer.len = MAX_RECORD_LEN as u32 + 1), None);
        let mut magic = bytes;
        magic[0] = b'X';
        assert_eq!(Footer::decode(&magic, 150), None);
    }

    #[test]
    fn a_blob_with_no_record_has_no_newest_record_span() {
        let mut store = Store::new();
        let (blob, _) = store.write("a.txt", b"body");
        let chunk_end = tail(&blob);
        let bytes = crate::host_fs::read(&blob).unwrap();
        crate::host_fs::write(&blob, &bytes[..chunk_end as usize]).unwrap();
        assert_eq!(tail(&blob), chunk_end);
        let mut file =
            crate::paths::open_nofollow(&blob, crate::paths::NofollowMode::Read).unwrap();
        assert_eq!(newest_record_span(&mut file, chunk_end), None);
    }
}
