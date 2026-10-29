//! Session-backed logical file operations. Mutations seal the index.
//! One OS import seals before it returns. A batch stages each file and seals
//! a full wave of them, then the tail, so a crash keeps the last finished wave.
//! A range write into an existing file waits for the next seal; see
//! [`fs_write_range`].

use crate::host_fs::File;
#[allow(unused_imports)]
use crate::host_fs::HostFsQuery;
use std::collections::HashSet;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Condvar, LazyLock, Mutex};
use std::time::{Duration, Instant};

use zeroize::Zeroize;

use crate::error::{Result, UprivError};
use crate::logging::{log_event, LogLevel};
use crate::paths::VaultRoot;
use crate::session::{with_open_session, DeferredWrites, OpenSession};
use crate::store::{
    blobs_need_pack, build_file_tree, child_logical_path, delete_empty_directory,
    delete_logical_path, ensure_folder, file_name, flush_index_parts, from_ui_path,
    is_plain_internal, is_reserved_logical, mkdir_logical, move_logical_path, mutation_blob_ids,
    pack_blob_waste, read_logical_file, read_logical_range, record_imported_file,
    relocate_logical_path, relocate_replacing, remove_file_chunks, rename_logical_path,
    seal_import_chunk, to_ui_path, truncate_logical_file, unique_file_name, unique_folder_name,
    write_logical_file, write_logical_range, BlobPackMode, ChunkBlobMutation, FileTreeNode,
    ImportBlob, RetiredFileChunks, VaultIndex, INTERNAL_WORKSPACE_FILE, VAULT_FS_MAX_INLINE_BYTES,
};

fn store_dir(session: &OpenSession) -> std::path::PathBuf {
    session.vault_dir.join(crate::paths::STORE_DIR_NAME)
}

/// Seal the index. An open plaintext folder is told the store changed, so the
/// change reaches the folder too.
fn commit(session: &mut OpenSession) -> Result<()> {
    seal_index(session)?;
    if session.plain.is_some() {
        super::plain::store_changed(&session.vault_dir);
    }
    Ok(())
}

fn seal_index(session: &mut OpenSession) -> Result<()> {
    sync_staged_blobs(&session.staged_blobs)?;
    let store = store_dir(session);
    flush_index_parts(&store, &session.header, &session.index_key, &session.index)?;
    session.staged_blobs.clear();
    session.index.clear_unsealed_holes();
    session.unsealed_imports = 0;
    session.deferred = None;
    session.dirty = false;
    session.tree_revision = session.tree_revision.saturating_add(1);
    Ok(())
}

fn commit_or_restore(session: &mut OpenSession, before: VaultIndex) -> Result<()> {
    match commit(session) {
        Ok(()) => Ok(()),
        Err(error) => {
            session.index = before;
            Err(error)
        }
    }
}

/// Seal `session.index`, then unlink `retired` blobs. A failed seal restores
/// the previous index and leaves blobs in place. After a successful seal the
/// logical delete has landed; a failed unlink leaves orphan ciphertext and is
/// logged instead of being reported as a failed delete.
fn commit_then_unlink(
    session: &mut OpenSession,
    before: VaultIndex,
    retired: Vec<RetiredFileChunks>,
) -> Result<()> {
    if let Err(error) = commit(session) {
        session.index = before;
        return Err(error);
    }
    let store = store_dir(session);
    for item in &retired {
        if remove_file_chunks(&store, &item.file_id, item.chunk_count).is_err() {
            log_event(
                LogLevel::Warn,
                "vault_fs_leftover_blobs",
                &[
                    ("vault_id", session.vault_id.as_str()),
                    ("file_id", item.file_id.as_str()),
                    ("chunk_count", &item.chunk_count.to_string()),
                ],
            );
        }
    }
    Ok(())
}

fn commit_mutation(
    session: &mut OpenSession,
    before: VaultIndex,
    mutation: ChunkBlobMutation,
    retired: Option<RetiredFileChunks>,
) -> Result<()> {
    if let Err(error) = mutation.sync_before_index() {
        session.index = before;
        mutation.discard_created();
        return Err(error);
    }
    match commit(session) {
        Ok(()) => {
            mutation.delete_superseded();
            if let Some(retired) = retired {
                let _ =
                    remove_file_chunks(&store_dir(session), &retired.file_id, retired.chunk_count);
            }
            pack_sealed_waste(session, &mutation_blob_ids(&mutation));
            Ok(())
        }
        Err(error) => {
            session.index = before;
            mutation.discard_created();
            Err(error)
        }
    }
}

/// After a seal, pack any of these blobs that holds enough dead ciphertext.
fn pack_sealed_waste(session: &mut OpenSession, ids: &[String]) {
    let store = store_dir(session);
    if !blobs_need_pack(
        &store,
        &session.header,
        &session.index,
        BlobPackMode::SessionWaste,
        Some(ids),
    ) {
        return;
    }
    match pack_blob_waste(
        &store,
        &session.header,
        &session.content_key,
        &mut session.index,
        BlobPackMode::SessionWaste,
        Some(ids),
    ) {
        Ok(packed) if packed.created.is_empty() => {}
        Ok(packed) => match packed.sync_before_index().and_then(|_| commit(session)) {
            Ok(()) => packed.delete_superseded(),
            Err(_error) => {
                packed.restore_packed_nodes(&mut session.index);
                packed.discard_created();
                log_event(
                    LogLevel::Warn,
                    "vault_blob_pack_failed",
                    &[("id", session.vault_id.as_str())],
                );
            }
        },
        Err(_error) => {
            log_event(
                LogLevel::Warn,
                "vault_blob_pack_failed",
                &[("id", session.vault_id.as_str())],
            );
        }
    }
}

fn require_open(root: &VaultRoot, vault_id: &str) -> Result<std::path::PathBuf> {
    let dir = root.vault_dir(vault_id)?;
    if !dir.host_is_dir() {
        return Err(UprivError::VaultNotFound(dir));
    }
    Ok(dir)
}

/// A plaintext-folder name is never addressable from the app, so the confirmed
/// place cannot be read or replaced through a file call.
fn logical(ui_path: &str) -> Result<String> {
    let path = from_ui_path(ui_path)?;
    if is_plain_internal(&path) {
        return Err(reserved_path(&path));
    }
    Ok(path)
}

fn reserved_path(path: &str) -> UprivError {
    UprivError::VaultStoreInvalid {
        path: std::path::PathBuf::from(path),
        detail: "reserved internal path".into(),
    }
}

/// Missing layout file is “start clean”, not a user-visible path error (SDD).
fn is_missing_internal_workspace(err: &UprivError, logical: &str) -> bool {
    matches!(err, UprivError::VaultPathNotFound(_)) && file_name(logical) == INTERNAL_WORKSPACE_FILE
}

/// Explorer/FUSE/create/rename/delete must not touch reserved internal files.
/// Reads/writes of `.upriv-workspace.json` stay allowed for layout persistence.
fn require_user_visible_logical(path: &str) -> Result<()> {
    if is_reserved_logical(path) {
        return Err(reserved_path(path));
    }
    Ok(())
}

pub fn fs_tree_revision(root: &VaultRoot, vault_id: &str) -> Result<u64> {
    let dir = require_open(root, vault_id)?;
    with_open_session(&dir, |session| Ok(session.tree_revision))
}

pub fn fs_list_tree(root: &VaultRoot, vault_id: &str) -> Result<FileTreeNode> {
    let dir = require_open(root, vault_id)?;
    with_open_session(&dir, |session| {
        let name = crate::config::load_vault_config_raw(&session.vault_dir)
            .map(|c| c.vault.display_name)
            .unwrap_or_else(|_| session.vault_id.clone());
        Ok(build_file_tree(&session.index, &name))
    })
}

pub fn fs_read_file(root: &VaultRoot, vault_id: &str, ui_path: &str) -> Result<Vec<u8>> {
    let dir = require_open(root, vault_id)?;
    let path = logical(ui_path)?;
    with_open_session(&dir, |session| {
        if let Some(node) = session.index.find(&path) {
            if let Some((_, size, _)) = node.as_file() {
                if size > VAULT_FS_MAX_INLINE_BYTES {
                    return Err(UprivError::VaultFileTooLarge {
                        path: std::path::PathBuf::from(&path),
                        size,
                        max: VAULT_FS_MAX_INLINE_BYTES,
                    });
                }
            }
        }
        let bytes = match read_logical_file(
            store_dir(session),
            &session.header,
            &session.content_key,
            &session.index,
            &path,
        ) {
            Ok(bytes) => bytes,
            Err(err) if is_missing_internal_workspace(&err, &path) => return Ok(Vec::new()),
            Err(err) => return Err(err),
        };
        if bytes.len() as u64 > VAULT_FS_MAX_INLINE_BYTES {
            return Err(UprivError::VaultFileTooLarge {
                path: std::path::PathBuf::from(&path),
                size: bytes.len() as u64,
                max: VAULT_FS_MAX_INLINE_BYTES,
            });
        }
        Ok(bytes)
    })
}

pub fn fs_read_range(
    root: &VaultRoot,
    vault_id: &str,
    ui_path: &str,
    offset: u64,
    len: u64,
) -> Result<Vec<u8>> {
    let dir = require_open(root, vault_id)?;
    let path = logical(ui_path)?;
    if len == 0 {
        return with_open_session(&dir, |session| match session.index.find(&path) {
            Some(node) if node.as_file().is_some() => Ok(Vec::new()),
            Some(_) => Err(UprivError::VaultStoreInvalid {
                path: std::path::PathBuf::from(&path),
                detail: "logical path is a directory".into(),
            }),
            None if is_missing_internal_workspace(
                &UprivError::VaultPathNotFound(path.clone()),
                &path,
            ) =>
            {
                Ok(Vec::new())
            }
            None => Err(UprivError::VaultPathNotFound(path)),
        });
    }
    if len > VAULT_FS_MAX_INLINE_BYTES {
        return Err(UprivError::VaultFileTooLarge {
            path: std::path::PathBuf::from(&path),
            size: len,
            max: VAULT_FS_MAX_INLINE_BYTES,
        });
    }
    with_open_session(&dir, |session| {
        match read_logical_range(
            store_dir(session),
            &session.header,
            &session.content_key,
            &session.index,
            &path,
            offset,
            len,
        ) {
            Ok(bytes) => Ok(bytes),
            Err(err) if is_missing_internal_workspace(&err, &path) => Ok(Vec::new()),
            Err(err) => Err(err),
        }
    })
}

pub fn fs_write_file(root: &VaultRoot, vault_id: &str, ui_path: &str, data: &[u8]) -> Result<u64> {
    if data.len() as u64 > VAULT_FS_MAX_INLINE_BYTES {
        return Err(UprivError::VaultFileTooLarge {
            path: std::path::PathBuf::from(ui_path),
            size: data.len() as u64,
            max: VAULT_FS_MAX_INLINE_BYTES,
        });
    }
    let dir = require_open(root, vault_id)?;
    let path = logical(ui_path)?;
    with_open_session(&dir, |session| {
        session.dirty = true;
        let before = session.index.clone();
        let (retired, mutation) = write_logical_file(
            store_dir(session),
            &session.header,
            &session.content_key,
            &mut session.index,
            &path,
            data,
        )?;
        commit_mutation(session, before, mutation, retired)?;
        Ok(session.tree_revision)
    })
}

/// Write `data` at `offset`. A write past the end fills the gap with zeros.
///
/// In an existing file the chunks land in its blob now and the index entry
/// waits for the next seal: [`fs_flush`] (a mount flush, fsync, or handle
/// close), any other committed change, [`DEFERRED_SEAL_BYTES`] of pending
/// writes, [`DEFERRED_SEAL_AFTER`], or close. Until then the sealed index
/// still names the previous bytes, which no later write overwrites, so a crash
/// loses at most that batch. A write that creates the file seals at once.
/// When the size cap seals and that seal fails, the error is returned and the
/// batch, this write included, stays pending for the next seal.
pub fn fs_write_range(
    root: &VaultRoot,
    vault_id: &str,
    ui_path: &str,
    offset: u64,
    data: &[u8],
) -> Result<u64> {
    if data.len() as u64 > VAULT_FS_MAX_INLINE_BYTES {
        return Err(UprivError::VaultFileTooLarge {
            path: std::path::PathBuf::from(ui_path),
            size: data.len() as u64,
            max: VAULT_FS_MAX_INLINE_BYTES,
        });
    }
    let dir = require_open(root, vault_id)?;
    let path = logical(ui_path)?;
    with_open_session(&dir, |session| {
        if session.index.find(&path).is_none() {
            // A new name changes the tree, which is sealed before it is shown.
            session.dirty = true;
            let before = session.index.clone();
            let mutation = write_logical_range(
                store_dir(session),
                &session.header,
                &session.content_key,
                &mut session.index,
                &path,
                offset,
                data,
            )?;
            commit_mutation(session, before, mutation, None)?;
            return Ok(session.tree_revision);
        }
        // A failed range write leaves the index as it was, so no copy is kept.
        let mutation = write_logical_range(
            store_dir(session),
            &session.header,
            &session.content_key,
            &mut session.index,
            &path,
            offset,
            data,
        )?;
        defer_range_write(session, &mutation, data.len() as u64)?;
        Ok(session.tree_revision)
    })
}

/// Pending range writes past this many plaintext bytes seal at once. This
/// also caps the dead ciphertext a batch of rewrites keeps until its seal.
const DEFERRED_SEAL_BYTES: u64 = 64 * 1024 * 1024;

/// A batch no flush, fsync, handle close, or other change sealed first is
/// sealed this long after its first write. Tests wait longer, so a slow machine
/// does not seal a batch while a test still expects it pending.
const DEFERRED_SEAL_AFTER: Duration = if cfg!(test) {
    Duration::from_secs(30)
} else {
    Duration::from_secs(2)
};

/// Longest pause between retries of a timed seal that failed.
const DEFERRED_RETRY_MAX: Duration = Duration::from_secs(32);

/// Batch numbers are unique in the process, so a timer left from a closed
/// session never matches a batch of a session opened later.
static DEFERRED_BATCH: AtomicU64 = AtomicU64::new(0);

/// Queue a range write that already landed in its blob for the next seal.
fn defer_range_write(
    session: &mut OpenSession,
    mutation: &ChunkBlobMutation,
    len: u64,
) -> Result<()> {
    session.dirty = true;
    let touched = mutation
        .created
        .iter()
        .chain(mutation.truncate_to.iter().map(|(path, _)| path));
    for path in touched {
        if !session.staged_blobs.contains(path) {
            session.staged_blobs.push(path.clone());
        }
    }
    let ids = mutation_blob_ids(mutation);
    let pending = join_pending_batch(session);
    pending.bytes = pending.bytes.saturating_add(len);
    for id in ids {
        if !pending.blob_ids.contains(&id) {
            pending.blob_ids.push(id);
        }
    }
    if pending.bytes >= DEFERRED_SEAL_BYTES {
        return seal_deferred(session);
    }
    Ok(())
}

/// The batch waiting for the next seal, started with its timed seal when
/// there is none.
fn join_pending_batch(session: &mut OpenSession) -> &mut DeferredWrites {
    let vault_dir = &session.vault_dir;
    session.deferred.get_or_insert_with(|| {
        let batch = DEFERRED_BATCH.fetch_add(1, Ordering::Relaxed) + 1;
        schedule_deferred_seal(vault_dir.clone(), batch);
        DeferredWrites {
            batch,
            bytes: 0,
            blob_ids: Vec::new(),
        }
    })
}

/// Seal the pending batch with the rest of the index, then pack the blobs it
/// wrote that now hold enough dead ciphertext. A failed seal keeps the batch.
fn seal_deferred(session: &mut OpenSession) -> Result<()> {
    let ids = session
        .deferred
        .as_ref()
        .map(|pending| pending.blob_ids.clone())
        .unwrap_or_default();
    commit(session)?;
    pack_sealed_waste(session, &ids);
    Ok(())
}

/// Seal range writes still waiting for the index. A mount calls this on flush,
/// fsync, and handle close; with nothing pending it touches no disk.
#[cfg_attr(not(any(target_os = "linux", windows)), allow(dead_code))]
pub fn fs_flush(root: &VaultRoot, vault_id: &str) -> Result<u64> {
    let dir = require_open(root, vault_id)?;
    with_open_session(&dir, |session| {
        if session.deferred.is_some() {
            seal_deferred(session)?;
        }
        Ok(session.tree_revision)
    })
}

/// One timed seal: the newest batch of one vault.
struct DeferredDue {
    dir: PathBuf,
    batch: u64,
    at: Instant,
    /// Wait before the next try once a seal failed.
    retry: Duration,
    failed: bool,
}

/// Timed seals for every vault, served by one worker thread that exits when
/// none is left. A vault has at most one entry: its newest batch.
struct DeferredTimers {
    due: Vec<DeferredDue>,
    worker_alive: bool,
}

static DEFERRED_TIMERS: LazyLock<(Mutex<DeferredTimers>, Condvar)> = LazyLock::new(|| {
    let timers = DeferredTimers {
        due: Vec::new(),
        worker_alive: false,
    };
    (Mutex::new(timers), Condvar::new())
});

fn deferred_timers() -> std::sync::MutexGuard<'static, DeferredTimers> {
    DEFERRED_TIMERS
        .0
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Seal `batch` [`DEFERRED_SEAL_AFTER`] after it started, unless something
/// sealed it first. Without the worker thread the batch still seals on a
/// flush, fsync, handle close, other change, the size cap, or close.
fn schedule_deferred_seal(dir: PathBuf, batch: u64) {
    schedule_deferred_seal_in(dir, batch, DEFERRED_SEAL_AFTER);
}

fn schedule_deferred_seal_in(dir: PathBuf, batch: u64, delay: Duration) {
    let mut timers = deferred_timers();
    timers.due.retain(|due| due.dir != dir);
    timers.due.push(DeferredDue {
        dir,
        batch,
        at: Instant::now() + delay,
        retry: delay,
        failed: false,
    });
    if timers.worker_alive {
        // The worker may be waiting for a later retry; this one comes first.
        DEFERRED_TIMERS.1.notify_one();
        return;
    }
    timers.worker_alive = true;
    let spawned = std::thread::Builder::new()
        .name("upriv-deferred-seal".into())
        .spawn(run_deferred_timers);
    if spawned.is_err() {
        timers.worker_alive = false;
        log_event(LogLevel::Warn, "vault_fs_deferred_timer_skipped", &[]);
    }
}

fn run_deferred_timers() {
    let (_, wake) = &*DEFERRED_TIMERS;
    let mut timers = deferred_timers();
    loop {
        let Some(next) = timers.due.iter().map(|due| due.at).min() else {
            timers.worker_alive = false;
            return;
        };
        let now = Instant::now();
        if next > now {
            timers = wake
                .wait_timeout(timers, next - now)
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .0;
            continue;
        }
        let (ready, waiting) = std::mem::take(&mut timers.due)
            .into_iter()
            .partition(|due: &DeferredDue| due.at <= now);
        timers.due = waiting;
        drop(timers);
        let mut retries = Vec::new();
        for mut due in ready {
            if seal_deferred_batch(&due.dir, due.batch, !due.failed) == DeferredTimer::Retry {
                due.failed = true;
                due.retry = (due.retry * 2).min(DEFERRED_RETRY_MAX);
                due.at = Instant::now() + due.retry;
                retries.push(due);
            }
        }
        timers = deferred_timers();
        for due in retries {
            // A newer batch of the same vault replaces the retry; its seal
            // covers these writes too.
            if !timers.due.iter().any(|other| other.dir == due.dir) {
                timers.due.push(due);
            }
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
enum DeferredTimer {
    /// Sealed, sealed by something else, replaced by a newer batch, or closed.
    Done,
    /// The seal failed and the batch is still pending.
    Retry,
}

/// One timer step. Only the first failure of a batch is logged.
fn seal_deferred_batch(dir: &Path, batch: u64, log_failure: bool) -> DeferredTimer {
    let step = with_open_session(dir, |session| {
        if session.deferred.as_ref().map(|pending| pending.batch) != Some(batch) {
            return Ok(DeferredTimer::Done);
        }
        if seal_deferred(session).is_ok() {
            return Ok(DeferredTimer::Done);
        }
        if log_failure {
            log_event(
                LogLevel::Warn,
                "vault_fs_deferred_seal_failed",
                &[("id", session.vault_id.as_str())],
            );
        }
        Ok(DeferredTimer::Retry)
    });
    // A closed vault was sealed by its close, or by recovery after a crash.
    step.unwrap_or(DeferredTimer::Done)
}

/// Fill one store chunk. A pipe or content file often returns a short read;
/// those bytes still belong to the same chunk.
fn read_full_chunk(reader: &mut (impl Read + ?Sized), buf: &mut [u8]) -> std::io::Result<usize> {
    let mut filled = 0;
    while filled < buf.len() {
        match reader.read(&mut buf[filled..]) {
            Ok(0) => break,
            Ok(n) => filled += n,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        }
    }
    Ok(filled)
}

/// Ciphertext for one file, sealed before the vault index is touched.
/// Dropping it deletes the blob unless the commit has taken the mutation.
struct PreparedImport {
    mutation: ChunkBlobMutation,
    versions: Vec<String>,
    offsets: Vec<u64>,
    size: u64,
    /// Digest of the plaintext read, when the session tracks digests.
    sha256: Option<String>,
}

impl Drop for PreparedImport {
    fn drop(&mut self) {
        self.mutation.discard_created();
    }
}

/// Read, encrypt, and write this file's blob. The session lock stays free so
/// other imports can do the same work at the same time. `None` is an empty file.
/// With `hash`, the plaintext digest is taken from the same buffer. With
/// `durable`, the blob and the folders naming it are flushed here, before the
/// index can name it; otherwise its caller lists it for the next index seal.
#[allow(clippy::too_many_arguments)]
fn seal_into_new_blob(
    store: &Path,
    header: &crate::store::VaultHeader,
    content_key: &zeroize::Zeroizing<[u8; 32]>,
    file_id: &str,
    reader: &mut (impl Read + ?Sized),
    map_read: impl FnOnce(std::io::Error) -> UprivError,
    durable: bool,
    hash: bool,
) -> Result<Option<PreparedImport>> {
    use sha2::Digest;
    let chunk_size = header.chunk_size as usize;
    if chunk_size == 0 {
        return Err(UprivError::VaultStoreInvalid {
            path: store.to_path_buf(),
            detail: "chunk size is zero".into(),
        });
    }
    let mut buf = vec![0u8; chunk_size];
    let mut blob: Option<ImportBlob> = None;
    let mut versions = Vec::new();
    let mut offsets = Vec::new();
    let mut size = 0u64;
    let mut index = 0u32;
    let mut hasher = hash.then(sha2::Sha256::new);
    let outcome = loop {
        let n = match read_full_chunk(reader, &mut buf) {
            Ok(0) => break Ok(()),
            Ok(n) => n,
            Err(error) => break Err(map_read(error)),
        };
        if let Some(hasher) = hasher.as_mut() {
            hasher.update(&buf[..n]);
        }
        let piece = match seal_import_chunk(header, content_key, file_id, index, &buf[..n]) {
            Ok(piece) => piece,
            Err(error) => {
                buf.as_mut_slice().zeroize();
                break Err(error);
            }
        };
        // `Vec::zeroize` also clears the length. The next read needs the buffer.
        buf.as_mut_slice().zeroize();
        if blob.is_none() {
            match ImportBlob::create(store, file_id) {
                Ok(created) => blob = Some(created),
                Err(error) => break Err(error),
            }
        }
        let Some(open) = blob.as_mut() else {
            break Err(UprivError::VaultStoreInvalid {
                path: store.to_path_buf(),
                detail: "import blob missing".into(),
            });
        };
        match open.append(&piece.bytes) {
            Ok(offset) => {
                versions.push(piece.version);
                offsets.push(offset);
                size += u64::from(piece.plaintext_len);
            }
            Err(error) => break Err(error),
        }
        index = index.saturating_add(1);
    };
    buf.zeroize();
    if let Err(error) = outcome {
        if let Some(blob) = blob.as_ref() {
            blob.mutation().discard_created();
        }
        return Err(error);
    }
    let Some(blob) = blob else {
        return Ok(None);
    };
    let mutation = blob.mutation();
    drop(blob);
    if durable {
        if let Err(error) = sync_staged_blobs(&mutation.created) {
            mutation.discard_created();
            return Err(error);
        }
    }
    Ok(Some(PreparedImport {
        mutation,
        versions,
        offsets,
        size,
        sha256: hasher.map(crate::store::sha256_hex),
    }))
}

/// Header, content key, and whether this session keeps plaintext digests.
fn session_secrets(
    dir: &Path,
) -> Result<(
    crate::store::VaultHeader,
    zeroize::Zeroizing<[u8; 32]>,
    bool,
)> {
    let (header, mut raw_key, hash) = with_open_session(dir, |session| {
        Ok((
            session.header.clone(),
            session.content_key,
            session.index.writes.track_digests,
        ))
    })?;
    let key = zeroize::Zeroizing::new(raw_key);
    raw_key.zeroize();
    Ok((header, key, hash))
}

fn commit_prepared(
    session: &mut OpenSession,
    path: &str,
    file_id: &str,
    mut prepared: PreparedImport,
) -> Result<()> {
    let was_dirty = session.dirty;
    session.dirty = true;
    let before = session.index.clone();
    let size = prepared.size;
    let versions = std::mem::take(&mut prepared.versions);
    let offsets = std::mem::take(&mut prepared.offsets);
    let mutation = std::mem::take(&mut prepared.mutation);
    match record_imported_file(
        &mut session.index,
        path,
        file_id.to_string(),
        size,
        versions,
        offsets,
        prepared.sha256.take(),
    ) {
        Ok(retired) => {
            let committed = commit_mutation(session, before, mutation, retired);
            if committed.is_err() {
                session.dirty = was_dirty;
            }
            committed
        }
        Err(error) => {
            mutation.discard_created();
            session.index = before;
            session.dirty = was_dirty;
            Err(error)
        }
    }
}

fn commit_empty_file(session: &mut OpenSession, path: &str) -> Result<()> {
    let was_dirty = session.dirty;
    session.dirty = true;
    let before = session.index.clone();
    match write_logical_file(
        store_dir(session),
        &session.header,
        &session.content_key,
        &mut session.index,
        path,
        b"",
    ) {
        Ok((retired, mutation)) => {
            let committed = commit_mutation(session, before, mutation, retired);
            if committed.is_err() {
                session.dirty = was_dirty;
            }
            committed
        }
        Err(error) => {
            session.index = before;
            session.dirty = was_dirty;
            Err(error)
        }
    }
}

/// Append a new file without copying the index, staged for the next seal.
/// An existing path commits on its own.
fn publish_prepared(
    dir: &Path,
    path: &str,
    file_id: &str,
    mut prepared: PreparedImport,
) -> Result<u64> {
    let staged = with_open_session(dir, |session| {
        if session.index.find(path).is_some() {
            return Ok(None);
        }
        let mutation = std::mem::take(&mut prepared.mutation);
        if let Err(error) = record_imported_file(
            &mut session.index,
            path,
            file_id.to_string(),
            prepared.size,
            std::mem::take(&mut prepared.versions),
            std::mem::take(&mut prepared.offsets),
            prepared.sha256.take(),
        ) {
            mutation.discard_created();
            return Err(error);
        }
        stage_import(session);
        Ok(Some(session.tree_revision))
    })?;
    match staged {
        Some(revision) => Ok(revision),
        None => with_open_session(dir, |session| {
            commit_prepared(session, path, file_id, prepared).map(|_| session.tree_revision)
        }),
    }
}

/// An imported file or folder is listed in RAM; a file's blob is already
/// durable on disk. The sealed index names it at the next seal:
/// [`STAGED_IMPORT_WAVE`] staged imports, [`DEFERRED_SEAL_AFTER`] after the
/// pending batch began, any other committed change, a flush, or close. A crash
/// before then forgets it; open removes its unnamed blob.
fn stage_import(session: &mut OpenSession) {
    session.dirty = true;
    session.unsealed_imports = session.unsealed_imports.saturating_add(1);
    session.tree_revision = session.tree_revision.saturating_add(1);
    join_pending_batch(session);
    if session.unsealed_imports >= STAGED_IMPORT_WAVE {
        // A failed seal keeps the batch for its timer, which retries and logs.
        let _ = seal_deferred(session);
    }
}

/// Staged imports sealed together: a file manager import, or the files and
/// folders of a vault import.
///
/// A kill keeps this prefix in the index. Blobs from the unfinished wave are
/// not named there; open drops those unreferenced blobs.
const STAGED_IMPORT_WAVE: u64 = 32;

/// Seal the open import wave once it is full. A short tail stays staged until
/// [`fs_seal_staged_imports`].
pub(crate) fn fs_seal_staged_wave(root: &VaultRoot, vault_id: &str) -> Result<()> {
    let dir = require_open(root, vault_id)?;
    let due = with_open_session(&dir, |session| {
        Ok(session.unsealed_imports >= STAGED_IMPORT_WAVE)
    })?;
    if due {
        fs_seal_staged_imports(root, vault_id)?;
    }
    Ok(())
}

/// Flush the blobs staged since the last seal, then write the index once.
pub(crate) fn fs_seal_staged_imports(root: &VaultRoot, vault_id: &str) -> Result<u64> {
    let dir = require_open(root, vault_id)?;
    with_open_session(&dir, |session| {
        if session.unsealed_imports == 0 {
            return Ok(session.tree_revision);
        }
        commit(session)?;
        Ok(session.tree_revision)
    })
}

/// Create `logical` and its missing parents without sealing the index.
/// [`fs_seal_staged_imports`] seals them with the staged files. `known` holds
/// folders this batch already ensured, so a deep tree does not rescan the
/// index for every file.
pub(crate) fn fs_ensure_folder_path_staged(
    root: &VaultRoot,
    vault_id: &str,
    logical: &str,
    known: &mut HashSet<String>,
) -> Result<()> {
    let logical = logical.trim_matches('/');
    if logical.is_empty() || known.contains(logical) {
        return Ok(());
    }
    let dir = require_open(root, vault_id)?;
    with_open_session(&dir, |session| {
        let mut parent = String::new();
        for part in logical.split('/').filter(|part| !part.is_empty()) {
            let path = child_logical_path(&parent, part)?;
            if !known.contains(&path) {
                require_user_visible_logical(&path)?;
                match session.index.find(&path) {
                    Some(node) if node.is_dir() => {}
                    Some(_) => return Err(UprivError::VaultPathExists(path)),
                    None => {
                        mkdir_logical(&mut session.index, &path)?;
                        session.dirty = true;
                        session.unsealed_imports = session.unsealed_imports.saturating_add(1);
                    }
                }
                known.insert(path.clone());
            }
            parent = path;
        }
        Ok(())
    })
}

/// Stream one file into the vault, staged for the next seal (see
/// [`stage_import`]). It is encrypted without holding the session lock, so
/// other imports can encrypt at the same time.
pub(crate) fn fs_write_staged(
    root: &VaultRoot,
    vault_id: &str,
    ui_path: &str,
    reader: &mut (impl Read + ?Sized),
) -> Result<u64> {
    let dir = require_open(root, vault_id)?;
    let path = logical(ui_path)?;
    write_reader_ahead(&dir, &path, reader)
}

/// Flush each staged blob, then the directory that names it.
pub(crate) fn sync_staged_blobs(paths: &[PathBuf]) -> Result<()> {
    let mut parents: Vec<PathBuf> = Vec::new();
    for path in paths {
        crate::paths::sync_file_durable(path)?;
        if let Some(parent) = path.parent() {
            if !parents.iter().any(|seen| seen == parent) {
                parents.push(parent.to_path_buf());
            }
        }
    }
    #[cfg(unix)]
    {
        let mut grandparents: Vec<PathBuf> = Vec::new();
        for parent in &parents {
            crate::paths::sync_dir_durable(parent)?;
            if let Some(grand) = parent.parent() {
                if !grandparents.iter().any(|seen| seen == grand) {
                    grandparents.push(grand.to_path_buf());
                }
            }
        }
        for grand in &grandparents {
            crate::paths::sync_dir_durable(grand)?;
        }
    }
    Ok(())
}

fn write_reader_ahead(dir: &Path, path: &str, reader: &mut (impl Read + ?Sized)) -> Result<u64> {
    with_open_session(dir, |_| require_user_visible_logical(path))?;
    let (header, key, hash) = session_secrets(dir)?;
    let file_id = uuid::Uuid::new_v4().to_string();
    let store = dir.join(crate::paths::STORE_DIR_NAME);
    let prepared = seal_into_new_blob(
        &store,
        &header,
        &key,
        &file_id,
        reader,
        |error| error.into(),
        true,
        hash,
    )?;
    match prepared {
        Some(prepared) => publish_prepared(dir, path, &file_id, prepared),
        None => with_open_session(dir, |session| {
            require_user_visible_logical(path)?;
            commit_empty_file(session, path).map(|_| session.tree_revision)
        }),
    }
}

fn import_os_file_ahead(
    dir: &Path,
    parent: &str,
    base_name: &str,
    source: &Path,
    mut file: File,
) -> Result<(String, u64)> {
    let (header, key, hash) = session_secrets(dir)?;
    let file_id = uuid::Uuid::new_v4().to_string();
    let store = dir.join(crate::paths::STORE_DIR_NAME);
    let source_seal = source.to_path_buf();
    let prepared = seal_into_new_blob(
        &store,
        &header,
        &key,
        &file_id,
        &mut file,
        |_| UprivError::ImportSourceUnreadable(source_seal),
        true,
        hash,
    )?;
    let Some(mut prepared) = prepared else {
        return with_open_session(dir, |session| {
            let path = import_destination(session, parent, base_name)?;
            commit_empty_file(session, &path).map(|_| (to_ui_path(&path), session.tree_revision))
        });
    };
    with_open_session(dir, |session| {
        let path = import_destination(session, parent, base_name)?;
        let mutation = std::mem::take(&mut prepared.mutation);
        if let Err(error) = record_imported_file(
            &mut session.index,
            &path,
            file_id.clone(),
            prepared.size,
            std::mem::take(&mut prepared.versions),
            std::mem::take(&mut prepared.offsets),
            prepared.sha256.take(),
        ) {
            mutation.discard_created();
            return Err(error);
        }
        stage_import(session);
        Ok((to_ui_path(&path), session.tree_revision))
    })
}

/// A free name in `parent` (`unique_file_name` never returns a taken path).
fn import_destination(session: &OpenSession, parent: &str, base_name: &str) -> Result<String> {
    let name = unique_file_name(&session.index, parent, base_name);
    let path = if parent.is_empty() {
        name
    } else {
        format!("{parent}/{name}")
    };
    require_user_visible_logical(&path)?;
    Ok(path)
}

/// Stream plaintext into the open session without the NDJSON inline size cap.
pub fn fs_write_from_reader(
    root: &VaultRoot,
    vault_id: &str,
    ui_path: &str,
    reader: &mut (impl Read + ?Sized),
) -> Result<u64> {
    let dir = require_open(root, vault_id)?;
    let path = logical(ui_path)?;
    with_open_session(&dir, |session| {
        session.dirty = true;
        let before = session.index.clone();
        let mut mutation = ChunkBlobMutation::default();
        let mut retired_acc: Option<RetiredFileChunks> = None;
        let mut buf = vec![0u8; VAULT_FS_MAX_INLINE_BYTES as usize];
        let mut offset = 0u64;
        let mut first = true;
        let streamed: Result<()> = (|| {
            loop {
                let n = reader.read(&mut buf)?;
                if n == 0 {
                    break;
                }
                let piece = if first {
                    let (retired, piece) = write_logical_file(
                        store_dir(session),
                        &session.header,
                        &session.content_key,
                        &mut session.index,
                        &path,
                        &buf[..n],
                    )?;
                    retired_acc = retired;
                    first = false;
                    piece
                } else {
                    write_logical_range(
                        store_dir(session),
                        &session.header,
                        &session.content_key,
                        &mut session.index,
                        &path,
                        offset,
                        &buf[..n],
                    )?
                };
                mutation.merge(piece);
                offset += n as u64;
            }
            if first {
                let (retired, piece) = write_logical_file(
                    store_dir(session),
                    &session.header,
                    &session.content_key,
                    &mut session.index,
                    &path,
                    b"",
                )?;
                retired_acc = retired;
                mutation.merge(piece);
            }
            Ok(())
        })();
        let outcome = match streamed {
            Ok(()) => commit_mutation(session, before, mutation, retired_acc)
                .map(|_| session.tree_revision),
            Err(error) => {
                session.index = before;
                mutation.discard_created();
                Err(error)
            }
        };
        buf.zeroize();
        outcome
    })
}

/// Stream an OS file into the open vault without pulling bytes through JSON-RPC.
///
/// The source must be an absolute regular file (no symlink). The opened path
/// is canonicalized, and ciphertext under this vault's `store/` is refused so
/// a directory symlink cannot re-encrypt our own store.
/// Encryption and the blob write run without the session lock, so other
/// imports can encrypt at the same time. The lock is taken only to name the
/// file and stage it for the next seal (see [`stage_import`]).
pub fn fs_import_from_os_path(
    root: &VaultRoot,
    vault_id: &str,
    parent_ui: &str,
    base_name: &str,
    os_path: &Path,
) -> Result<(String, u64)> {
    let source = validate_import_os_path(root, vault_id, os_path)?;
    let file = open_import_source(&source)?;
    let dir = require_open(root, vault_id)?;
    let parent = logical(parent_ui)?;
    import_os_file_ahead(&dir, &parent, base_name, &source, file)
}

/// A link swapped in after the path was checked is refused on every system,
/// including a Windows reparse point.
fn open_import_source(path: &Path) -> Result<File> {
    crate::paths::open_nofollow(path, crate::paths::NofollowMode::Read)
        .map_err(|_| UprivError::ImportSourceUnreadable(path.to_path_buf()))
}

fn reject_unreadable(path: &Path) -> UprivError {
    UprivError::ImportSourceUnreadable(path.to_path_buf())
}

/// Real path of `path`, after directory symlinks. Fail closed when the OS
/// cannot resolve it.
fn canonical_file(path: &Path) -> Result<PathBuf> {
    crate::host_fs::canonicalize(path).map_err(|_| reject_unreadable(path))
}

fn validate_import_os_path(root: &VaultRoot, vault_id: &str, os_path: &Path) -> Result<PathBuf> {
    if !os_path.is_absolute() {
        return Err(reject_unreadable(os_path));
    }
    let meta = crate::host_fs::symlink_metadata(os_path).map_err(|_| reject_unreadable(os_path))?;
    if meta.file_type().is_symlink() || !meta.host_is_file() {
        return Err(reject_unreadable(os_path));
    }
    let canonical = canonical_file(os_path)?;
    if let Ok(store) = root.vault_store_dir(vault_id) {
        if store.host_exists() {
            let store = canonical_file(&store).map_err(|_| reject_unreadable(os_path))?;
            if canonical.starts_with(&store) {
                return Err(reject_unreadable(os_path));
            }
        }
    }
    Ok(canonical)
}

pub fn fs_truncate(root: &VaultRoot, vault_id: &str, ui_path: &str, size: u64) -> Result<u64> {
    let dir = require_open(root, vault_id)?;
    let path = logical(ui_path)?;
    with_open_session(&dir, |session| {
        session.dirty = true;
        let before = session.index.clone();
        let mutation = truncate_logical_file(
            store_dir(session),
            &session.header,
            &session.content_key,
            &mut session.index,
            &path,
            size,
        )?;
        commit_mutation(session, before, mutation, None)?;
        Ok(session.tree_revision)
    })
}

pub fn fs_mkdir(root: &VaultRoot, vault_id: &str, ui_path: &str) -> Result<u64> {
    let dir = require_open(root, vault_id)?;
    let path = logical(ui_path)?;
    require_user_visible_logical(&path)?;
    with_open_session(&dir, |session| {
        session.dirty = true;
        let before = session.index.clone();
        mkdir_logical(&mut session.index, &path)?;
        commit_or_restore(session, before)?;
        Ok(session.tree_revision)
    })
}

pub fn fs_create_file(
    root: &VaultRoot,
    vault_id: &str,
    parent_ui: &str,
    base_name: &str,
) -> Result<(String, u64)> {
    let dir = require_open(root, vault_id)?;
    let parent = logical(parent_ui)?;
    with_open_session(&dir, |session| {
        let name = unique_file_name(&session.index, &parent, base_name);
        let path = if parent.is_empty() {
            name
        } else {
            format!("{parent}/{name}")
        };
        require_user_visible_logical(&path)?;
        session.dirty = true;
        let before = session.index.clone();
        let (_retired, mutation) = write_logical_file(
            store_dir(session),
            &session.header,
            &session.content_key,
            &mut session.index,
            &path,
            b"",
        )?;
        commit_mutation(session, before, mutation, None)?;
        Ok((to_ui_path(&path), session.tree_revision))
    })
}

/// Create `parent/name` exactly. FUSE uses this; in-app "New file" uses [`fs_create_file`].
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn fs_create_named_file(
    root: &VaultRoot,
    vault_id: &str,
    parent_ui: &str,
    name: &str,
) -> Result<(String, u64)> {
    let dir = require_open(root, vault_id)?;
    let parent = logical(parent_ui)?;
    let path = child_logical_path(&parent, name)?;
    require_user_visible_logical(&path)?;
    with_open_session(&dir, |session| {
        if session.index.find(&path).is_some() {
            return Err(UprivError::VaultPathExists(path));
        }
        session.dirty = true;
        let before = session.index.clone();
        let (_retired, mutation) = write_logical_file(
            store_dir(session),
            &session.header,
            &session.content_key,
            &mut session.index,
            &path,
            b"",
        )?;
        commit_mutation(session, before, mutation, None)?;
        Ok((to_ui_path(&path), session.tree_revision))
    })
}

pub fn fs_create_folder(
    root: &VaultRoot,
    vault_id: &str,
    parent_ui: &str,
    base_name: &str,
) -> Result<(String, u64)> {
    let dir = require_open(root, vault_id)?;
    let parent = logical(parent_ui)?;
    with_open_session(&dir, |session| {
        let name = unique_folder_name(&session.index, &parent, base_name);
        let path = if parent.is_empty() {
            name
        } else {
            format!("{parent}/{name}")
        };
        require_user_visible_logical(&path)?;
        session.dirty = true;
        let before = session.index.clone();
        mkdir_logical(&mut session.index, &path)?;
        commit_or_restore(session, before)?;
        Ok((to_ui_path(&path), session.tree_revision))
    })
}

/// The folder `parent/name` an import writes into: an existing folder is
/// reused, and a missing one is staged with the import (see [`stage_import`]).
pub fn fs_ensure_folder(
    root: &VaultRoot,
    vault_id: &str,
    parent_ui: &str,
    name: &str,
) -> Result<(String, u64)> {
    let dir = require_open(root, vault_id)?;
    let parent = logical(parent_ui)?;
    require_user_visible_logical(name)?;
    with_open_session(&dir, |session| {
        let path = child_logical_path(&parent, name)?;
        if let Some(node) = session.index.find(&path) {
            if node.is_dir() {
                return Ok((to_ui_path(&path), session.tree_revision));
            }
            return Err(UprivError::VaultPathExists(path));
        }
        // Fails before it touches the index, or adds this one folder.
        let created = ensure_folder(&mut session.index, &parent, name)?;
        stage_import(session);
        Ok((to_ui_path(&created), session.tree_revision))
    })
}

pub fn fs_delete(root: &VaultRoot, vault_id: &str, ui_path: &str) -> Result<u64> {
    let dir = require_open(root, vault_id)?;
    let path = logical(ui_path)?;
    if path.is_empty() {
        return Err(UprivError::VaultStoreInvalid {
            path: std::path::PathBuf::from("/"),
            detail: "cannot delete vault root".into(),
        });
    }
    require_user_visible_logical(&path)?;
    with_open_session(&dir, |session| {
        session.dirty = true;
        let before = session.index.clone();
        let retired = delete_logical_path(&mut session.index, &path)?;
        commit_then_unlink(session, before, retired)?;
        Ok(session.tree_revision)
    })
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn fs_rmdir(root: &VaultRoot, vault_id: &str, ui_path: &str) -> Result<u64> {
    let dir = require_open(root, vault_id)?;
    let path = logical(ui_path)?;
    if path.is_empty() {
        return Err(UprivError::VaultStoreInvalid {
            path: std::path::PathBuf::from("/"),
            detail: "cannot delete vault root".into(),
        });
    }
    require_user_visible_logical(&path)?;
    with_open_session(&dir, |session| {
        session.dirty = true;
        let before = session.index.clone();
        delete_empty_directory(&mut session.index, &path)?;
        commit_or_restore(session, before)?;
        Ok(session.tree_revision)
    })
}

pub fn fs_rename(
    root: &VaultRoot,
    vault_id: &str,
    ui_path: &str,
    new_name: &str,
) -> Result<(String, u64)> {
    let dir = require_open(root, vault_id)?;
    let path = logical(ui_path)?;
    require_user_visible_logical(&path)?;
    require_user_visible_logical(new_name)?;
    with_open_session(&dir, |session| {
        session.dirty = true;
        let before = session.index.clone();
        let next = rename_logical_path(&mut session.index, &path, new_name)?;
        commit_or_restore(session, before)?;
        Ok((to_ui_path(&next), session.tree_revision))
    })
}

pub fn fs_move(
    root: &VaultRoot,
    vault_id: &str,
    from_ui: &str,
    to_folder_ui: &str,
) -> Result<(String, u64)> {
    let dir = require_open(root, vault_id)?;
    let from = logical(from_ui)?;
    let to_folder = logical(to_folder_ui)?;
    require_user_visible_logical(&from)?;
    with_open_session(&dir, |session| {
        session.dirty = true;
        let before = session.index.clone();
        let next = move_logical_path(&mut session.index, &from, &to_folder)?;
        commit_or_restore(session, before)?;
        Ok((to_ui_path(&next), session.tree_revision))
    })
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn fs_relocate(
    root: &VaultRoot,
    vault_id: &str,
    from_ui: &str,
    to_folder_ui: &str,
    new_name: &str,
    replace_existing: bool,
) -> Result<(String, u64)> {
    let dir = require_open(root, vault_id)?;
    let from = logical(from_ui)?;
    let to_folder = logical(to_folder_ui)?;
    require_user_visible_logical(&from)?;
    require_user_visible_logical(new_name)?;
    with_open_session(&dir, |session| {
        session.dirty = true;
        let before = session.index.clone();
        let relocated = if replace_existing {
            relocate_replacing(&mut session.index, &from, &to_folder, new_name)
        } else {
            relocate_logical_path(&mut session.index, &from, &to_folder, new_name)
                .map(|next| (next, Vec::new()))
        };
        let (next, retired) = match relocated {
            Ok(value) => value,
            Err(error) => {
                session.index = before;
                return Err(error);
            }
        };
        commit_then_unlink(session, before, retired)?;
        Ok((to_ui_path(&next), session.tree_revision))
    })
}

/// A folder file encrypted into a new blob of this vault, not yet named in
/// the index. Dropping it deletes the blob.
pub(super) struct SealedFile {
    file_id: String,
    /// `None` for an empty file, which has no blob.
    prepared: Option<PreparedImport>,
}

/// Encrypt `reader` into a new blob without holding the session lock. The
/// blob is flushed with the next index seal, like a range write.
pub(super) fn seal_reader(
    dir: &Path,
    reader: &mut (impl Read + ?Sized),
    map_read: impl FnOnce(std::io::Error) -> UprivError,
) -> Result<SealedFile> {
    let (header, key, hash) = session_secrets(dir)?;
    let file_id = uuid::Uuid::new_v4().to_string();
    let store = dir.join(crate::paths::STORE_DIR_NAME);
    let prepared = seal_into_new_blob(
        &store, &header, &key, &file_id, reader, map_read, false, hash,
    )?;
    Ok(SealedFile { file_id, prepared })
}

/// Name `sealed` at `path`, replacing a file there. The replaced blob is
/// returned; unlink it only after [`seal_staged_sync`] succeeds.
pub(super) fn stage_sealed(
    session: &mut OpenSession,
    path: &str,
    mut sealed: SealedFile,
) -> Result<Option<RetiredFileChunks>> {
    let (size, versions, offsets, mutation, sha256) = match sealed.prepared.as_mut() {
        Some(prepared) => (
            prepared.size,
            std::mem::take(&mut prepared.versions),
            std::mem::take(&mut prepared.offsets),
            std::mem::take(&mut prepared.mutation),
            prepared.sha256.take(),
        ),
        None => {
            let empty = session
                .index
                .writes
                .track_digests
                .then(|| crate::store::sha256_hex(<sha2::Sha256 as sha2::Digest>::new()));
            (
                0,
                Vec::new(),
                Vec::new(),
                ChunkBlobMutation::default(),
                empty,
            )
        }
    };
    match record_imported_file(
        &mut session.index,
        path,
        std::mem::take(&mut sealed.file_id),
        size,
        versions,
        offsets,
        sha256,
    ) {
        Ok(retired) => {
            session
                .staged_blobs
                .extend(mutation.created.iter().cloned());
            session.dirty = true;
            Ok(retired)
        }
        Err(error) => {
            mutation.discard_created();
            Err(error)
        }
    }
}

/// Add an empty folder. Its parent must already be a folder.
pub(super) fn stage_mkdir(session: &mut OpenSession, path: &str) -> Result<()> {
    mkdir_logical(&mut session.index, path)?;
    session.dirty = true;
    Ok(())
}

/// Drop `path` (and anything under it). Unlink the returned blobs only after
/// [`seal_staged_sync`] succeeds.
pub(super) fn stage_delete(
    session: &mut OpenSession,
    path: &str,
) -> Result<Vec<RetiredFileChunks>> {
    let retired = delete_logical_path(&mut session.index, path)?;
    session.dirty = true;
    Ok(retired)
}

/// Drop one folder that holds nothing.
pub(super) fn stage_remove_empty_dir(session: &mut OpenSession, path: &str) -> Result<()> {
    delete_empty_directory(&mut session.index, path)?;
    session.dirty = true;
    Ok(())
}

/// Rename or move one file. No ciphertext is rewritten.
pub(super) fn stage_move(session: &mut OpenSession, from: &str, to: &str) -> Result<()> {
    let parent = crate::store::parent_logical(to).unwrap_or("");
    relocate_logical_path(&mut session.index, from, parent, file_name(to))?;
    session.dirty = true;
    Ok(())
}

/// Seal every staged change, then unlink the blobs no index names any more.
/// The folder is not poked: these changes came from it.
pub(super) fn seal_staged_sync(
    session: &mut OpenSession,
    retired: &[RetiredFileChunks],
) -> Result<()> {
    seal_index(session)?;
    let store = store_dir(session);
    for item in retired {
        if remove_file_chunks(&store, &item.file_id, item.chunk_count).is_err() {
            log_event(
                LogLevel::Warn,
                "vault_fs_leftover_blobs",
                &[
                    ("vault_id", session.vault_id.as_str()),
                    ("file_id", item.file_id.as_str()),
                    ("chunk_count", &item.chunk_count.to_string()),
                ],
            );
        }
    }
    Ok(())
}

/// Plaintext of `len` bytes of one store file, for the folder copy.
pub(super) fn read_store_range(
    session: &OpenSession,
    path: &str,
    offset: u64,
    len: u64,
) -> Result<Vec<u8>> {
    read_logical_range(
        store_dir(session),
        &session.header,
        &session.content_key,
        &session.index,
        path,
        offset,
        len,
    )
}

/// An internal store file (the plaintext policy). `None` when it is absent.
pub(super) fn read_internal(session: &OpenSession, path: &str) -> Result<Option<Vec<u8>>> {
    if session.index.find(path).is_none() {
        return Ok(None);
    }
    read_logical_file(
        store_dir(session),
        &session.header,
        &session.content_key,
        &session.index,
        path,
    )
    .map(Some)
}

/// Replace an internal store file and seal the index.
pub(super) fn write_internal(session: &mut OpenSession, path: &str, bytes: &[u8]) -> Result<()> {
    session.dirty = true;
    let before = session.index.clone();
    let (retired, mutation) = write_logical_file(
        store_dir(session),
        &session.header,
        &session.content_key,
        &mut session.index,
        path,
        bytes,
    )?;
    commit_mutation(session, before, mutation, retired)
}

/// Remove an internal store file when it exists, and seal the index.
pub(super) fn remove_internal(session: &mut OpenSession, path: &str) -> Result<()> {
    if session.index.find(path).is_none() {
        return Ok(());
    }
    session.dirty = true;
    let before = session.index.clone();
    let retired = delete_logical_path(&mut session.index, path)?;
    commit_then_unlink(session, before, retired)
}

/// Join a validated logical path (`notes/a.txt`, or `""` for the mount root)
/// onto an OS mount point. Rejects `.` / `..` / empty components.
pub(crate) fn join_logical_under_mount(mount: &Path, logical: &str) -> Result<PathBuf> {
    if logical.is_empty() {
        return Ok(mount.to_path_buf());
    }
    let mut out = mount.to_path_buf();
    for part in logical.split('/') {
        if part.is_empty() || part == "." || part == ".." {
            return Err(UprivError::VaultStoreInvalid {
                path: PathBuf::from(logical),
                detail: "invalid mount relative path".into(),
            });
        }
        out.push(part);
    }
    Ok(out)
}

/// Absolute OS path of a logical item: in the plaintext folder of an open
/// `upriv_plain` vault, or on the live FUSE/WinFsp mount.
///
/// Does not create files. Missing mount (mobile, WinFsp not installed, FUSE failure)
/// returns [`UprivError::VaultMountFailed`] — never a plaintext extract.
pub fn fs_os_path(root: &VaultRoot, vault_id: &str, ui_path: &str) -> Result<PathBuf> {
    let dir = require_open(root, vault_id)?;
    let logical = logical(ui_path)?;
    with_open_session(&dir, |session| {
        if let Some(folder) = session.plain.as_ref().map(|plain| plain.folder()) {
            return join_logical_under_mount(folder, &logical);
        }
        let Some(mount) = session.mount.as_ref() else {
            let detail = session
                .mount_failure
                .clone()
                .unwrap_or_else(|| "OS mount is not available; use the in-app file manager".into());
            return Err(UprivError::VaultMountFailed(detail));
        };
        join_logical_under_mount(mount.mount_point(), &logical)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[allow(unused_imports)]
    use crate::host_fs::HostFsQuery;
    use crate::store::{open_store, KdfUnlockPreset};
    use crate::test_support::vault_root_with;
    use crate::vault::{close_vault, create_vault, open_vault};

    struct ByteAtATime<'a> {
        rest: &'a [u8],
    }

    impl std::io::Read for ByteAtATime<'_> {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            if self.rest.is_empty() || buf.is_empty() {
                return Ok(0);
            }
            buf[0] = self.rest[0];
            self.rest = &self.rest[1..];
            Ok(1)
        }
    }

    fn sample_config(id: &str, name: &str) -> crate::config::VaultConfig {
        toml::from_str(&format!(
            r#"
[vault]
id = "{id}"
display_name = "{name}"
order = 1
[storage]
mode = "encrypted_dir"
"#
        ))
        .expect("config")
    }

    #[test]
    fn missing_workspace_snapshot_reads_as_empty() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        assert!(fs_read_file(&root, "notes", "/.upriv-workspace.json")
            .unwrap()
            .is_empty());
        assert!(
            fs_read_range(&root, "notes", "/.upriv-workspace.json", 0, 64)
                .unwrap()
                .is_empty()
        );
        let missing = fs_read_file(&root, "notes", "/gone.txt").unwrap_err();
        assert!(matches!(missing, UprivError::VaultPathNotFound(_)));
        fs_write_file(
            &root,
            "notes",
            "/.upriv-workspace.json",
            b"{\"format_version\":1}\n",
        )
        .unwrap();
        let got = fs_read_file(&root, "notes", "/.upriv-workspace.json").unwrap();
        assert_eq!(got, b"{\"format_version\":1}\n");
        close_vault(&root, "notes").unwrap();
    }

    fn root_file_names(tree: &FileTreeNode) -> Vec<String> {
        tree.children
            .iter()
            .flatten()
            .map(|child| child.name.clone())
            .collect()
    }

    #[test]
    fn scratch_create_seals_welcome_readme_and_layout() {
        let (_tmp, root) = vault_root_with(&[]);
        let readme = "# Welcome-note-plaintext\n";
        let workspace = "{\"format_version\":1,\"openTabs\":[\"/README.md\"]}\n";
        crate::vault::create_vault_with_welcome(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
            Some(crate::vault::VaultWelcome { readme, workspace }),
        )
        .unwrap();
        let vault_dir = root.vault_dir("notes").unwrap();
        for entry in walkdir_files(&vault_dir) {
            let bytes = crate::host_fs::read(&entry).unwrap_or_default();
            assert!(
                !bytes
                    .windows(b"Welcome-note-plaintext".len())
                    .any(|w| w == b"Welcome-note-plaintext"),
                "plaintext leaked at {}",
                entry.display()
            );
        }
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        let tree = fs_list_tree(&root, "notes").unwrap();
        assert_eq!(root_file_names(&tree), vec!["README.md".to_string()]);
        assert_eq!(
            fs_read_file(&root, "notes", "/README.md").unwrap(),
            readme.as_bytes()
        );
        assert_eq!(
            fs_read_file(&root, "notes", "/.upriv-workspace.json").unwrap(),
            workspace.as_bytes()
        );
        close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn plain_create_has_no_welcome_readme() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        let tree = fs_list_tree(&root, "notes").unwrap();
        assert!(root_file_names(&tree).is_empty());
        close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn oversized_welcome_is_refused_before_the_folder_exists() {
        let (_tmp, root) = vault_root_with(&[]);
        let readme = "x".repeat(crate::vault::WELCOME_FILE_MAX_BYTES + 1);
        let err = crate::vault::create_vault_with_welcome(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
            Some(crate::vault::VaultWelcome {
                readme: &readme,
                workspace: "{}",
            }),
        )
        .unwrap_err();
        assert!(matches!(err, UprivError::VaultFileTooLarge { .. }));
        assert!(!root.vault_dir("notes").unwrap().host_exists());
    }

    #[test]
    fn write_is_durable_before_close() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        fs_write_file(&root, "notes", "/hello.txt", b"hello-from-session").unwrap();
        let store = root.vault_store_dir("notes").unwrap();
        let data_dir = store.join("data");
        assert!(
            crate::host_fs::read_dir(&data_dir).unwrap().count() >= 1,
            "ciphertext must land before close"
        );
        // No plaintext next to store/.
        let vault_dir = root.vault_dir("notes").unwrap();
        for entry in walkdir_files(&vault_dir) {
            let bytes = crate::host_fs::read(&entry).unwrap_or_default();
            assert!(
                !bytes
                    .windows(b"hello-from-session".len())
                    .any(|w| w == b"hello-from-session"),
                "plaintext leaked at {}",
                entry.display()
            );
        }
        close_vault(&root, "notes").unwrap();
        let opened = open_store(&store, b"pass-word-ok").unwrap();
        let got = crate::store::read_logical_file(
            &store,
            &opened.header,
            &opened.content_key,
            &opened.index,
            "hello.txt",
        )
        .unwrap();
        assert_eq!(got, b"hello-from-session");
    }

    fn walkdir_files(root: &std::path::Path) -> Vec<std::path::PathBuf> {
        let mut out = Vec::new();
        fn rec(path: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
            let Ok(entries) = crate::host_fs::read_dir(path) else {
                return;
            };
            for entry in entries.flatten() {
                let p = entry.path();
                if p.host_is_dir() {
                    rec(&p, out);
                } else {
                    out.push(p);
                }
            }
        }
        rec(root, &mut out);
        out
    }

    #[test]
    fn named_create_does_not_unique_and_relocate_is_one_commit() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        fs_create_named_file(&root, "notes", "/", "exact.txt").unwrap();
        let err = fs_create_named_file(&root, "notes", "/", "exact.txt").unwrap_err();
        assert!(matches!(err, UprivError::VaultPathExists(_)));
        let unique = fs_create_file(&root, "notes", "/", "exact.txt").unwrap();
        assert_eq!(unique.0, "/exact-2.txt");
        fs_mkdir(&root, "notes", "/inbox").unwrap();
        let moved =
            fs_relocate(&root, "notes", "/exact.txt", "/inbox", "renamed.txt", false).unwrap();
        assert_eq!(moved.0, "/inbox/renamed.txt");
        close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn write_from_reader_accepts_payload_over_inline_rpc_cap() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        let size = (VAULT_FS_MAX_INLINE_BYTES as usize) + 64;
        let data = vec![0x5Au8; size];
        fs_write_from_reader(&root, "notes", "/big.bin", &mut data.as_slice()).unwrap();
        let inline = fs_write_file(&root, "notes", "/too-big.bin", &data).unwrap_err();
        assert!(matches!(inline, UprivError::VaultFileTooLarge { .. }));
        let store = root.vault_store_dir("notes").unwrap();
        crate::session::with_open_session(&root.vault_dir("notes").unwrap(), |session| {
            let got = crate::store::read_logical_file(
                &store,
                &session.header,
                &session.content_key,
                &session.index,
                "big.bin",
            )
            .unwrap();
            assert_eq!(got, data);
            Ok(())
        })
        .unwrap();
        close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn write_from_reader_restores_index_when_a_later_read_fails() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        fs_write_file(&root, "notes", "/notes.txt", b"generation-one").unwrap();

        struct FailAfterFirst {
            first: &'static [u8],
            sent: bool,
        }
        impl Read for FailAfterFirst {
            fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
                if !self.sent {
                    self.sent = true;
                    let n = self.first.len().min(buf.len());
                    buf[..n].copy_from_slice(&self.first[..n]);
                    return Ok(n);
                }
                Err(std::io::Error::other("injected read failure"))
            }
        }

        let err = fs_write_from_reader(
            &root,
            "notes",
            "/notes.txt",
            &mut FailAfterFirst {
                first: b"generation-two",
                sent: false,
            },
        )
        .unwrap_err();
        assert!(matches!(err, UprivError::Io(_)));
        let got = fs_read_file(&root, "notes", "/notes.txt").unwrap();
        assert_eq!(got, b"generation-one");
        close_vault(&root, "notes").unwrap();
        let store = root.vault_store_dir("notes").unwrap();
        let opened = open_store(&store, b"pass-word-ok").unwrap();
        let durable = crate::store::read_logical_file(
            &store,
            &opened.header,
            &opened.content_key,
            &opened.index,
            "notes.txt",
        )
        .unwrap();
        assert_eq!(durable, b"generation-one");
    }

    fn open_notes() -> (tempfile::TempDir, VaultRoot) {
        let (tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        (tmp, root)
    }

    /// What a crash now would keep: the file as the sealed index on disk names
    /// it, read with the session keys so no unlock runs.
    fn sealed_bytes(root: &VaultRoot, path: &str) -> Vec<u8> {
        with_open_session(&root.vault_dir("notes").unwrap(), |session| {
            let store = store_dir(session);
            let sealed =
                crate::store::load_sealed_index(&store, &session.header, &session.index_key)?;
            read_logical_file(&store, &session.header, &session.content_key, &sealed, path)
        })
        .unwrap()
    }

    fn pending_batch(root: &VaultRoot) -> Option<u64> {
        with_open_session(&root.vault_dir("notes").unwrap(), |session| {
            Ok(session.deferred.as_ref().map(|pending| pending.batch))
        })
        .unwrap()
    }

    #[test]
    fn a_range_write_waits_for_flush_and_a_crash_keeps_the_sealed_bytes() {
        let (_tmp, root) = open_notes();
        fs_write_file(&root, "notes", "/notes.txt", b"generation-one").unwrap();
        let sealed_revision = fs_tree_revision(&root, "notes").unwrap();

        let revision = fs_write_range(&root, "notes", "/notes.txt", 0, b"generation-two").unwrap();
        assert_eq!(revision, sealed_revision, "nothing was sealed");
        assert_eq!(
            fs_read_file(&root, "notes", "/notes.txt").unwrap(),
            b"generation-two"
        );
        assert_eq!(sealed_bytes(&root, "notes.txt"), b"generation-one");
        assert!(pending_batch(&root).is_some());

        assert!(fs_flush(&root, "notes").unwrap() > sealed_revision);
        assert_eq!(sealed_bytes(&root, "notes.txt"), b"generation-two");
        assert_eq!(pending_batch(&root), None);
        // Nothing pending: no seal, so the revision stays.
        let flushed = fs_tree_revision(&root, "notes").unwrap();
        assert_eq!(fs_flush(&root, "notes").unwrap(), flushed);
        close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn unsealed_rewrites_never_reuse_space_the_sealed_index_names() {
        let (_tmp, root) = open_notes();
        // Three chunks, the last one partial.
        let original: Vec<u8> = (0..600 * 1024).map(|i| (i % 251) as u8).collect();
        fs_write_file(&root, "notes", "/big.bin", &original).unwrap();
        let mut expected = original.clone();
        // Each rewrite of chunk 0 abandons a span the sealed index still names.
        for round in 0..6u8 {
            let patch = vec![round; 1000];
            fs_write_range(&root, "notes", "/big.bin", 10, &patch).unwrap();
            expected[10..1010].copy_from_slice(&patch);
            assert_eq!(sealed_bytes(&root, "big.bin"), original, "round {round}");
        }
        let tail = vec![0xEE; 300 * 1024];
        fs_write_range(&root, "notes", "/big.bin", 500 * 1024, &tail).unwrap();
        expected.truncate(500 * 1024);
        expected.extend_from_slice(&tail);
        assert_eq!(sealed_bytes(&root, "big.bin"), original);
        assert_eq!(
            fs_read_range(&root, "notes", "/big.bin", 0, expected.len() as u64).unwrap(),
            expected
        );

        fs_flush(&root, "notes").unwrap();
        assert_eq!(sealed_bytes(&root, "big.bin"), expected);

        // After the seal the older spans are free again, and these rewrites may
        // land in them. The bytes the new seal names stay intact.
        let sealed = expected.clone();
        for round in 0..6u8 {
            let patch = vec![0x80 | round; 2000];
            fs_write_range(&root, "notes", "/big.bin", 300 * 1024, &patch).unwrap();
            expected[300 * 1024..300 * 1024 + 2000].copy_from_slice(&patch);
            assert_eq!(sealed_bytes(&root, "big.bin"), sealed, "round {round}");
        }
        fs_flush(&root, "notes").unwrap();
        assert_eq!(sealed_bytes(&root, "big.bin"), expected);
        close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn a_range_write_that_creates_a_file_seals_at_once() {
        let (_tmp, root) = open_notes();
        let before = fs_tree_revision(&root, "notes").unwrap();
        let revision = fs_write_range(&root, "notes", "/fresh.txt", 0, b"fresh").unwrap();
        assert!(revision > before);
        assert_eq!(sealed_bytes(&root, "fresh.txt"), b"fresh");
        assert_eq!(pending_batch(&root), None);
        close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn any_committed_change_seals_the_pending_range_writes() {
        let (_tmp, root) = open_notes();
        fs_write_file(&root, "notes", "/notes.txt", b"generation-one").unwrap();
        fs_write_range(&root, "notes", "/notes.txt", 0, b"generation-two").unwrap();
        fs_mkdir(&root, "notes", "/inbox").unwrap();
        assert_eq!(sealed_bytes(&root, "notes.txt"), b"generation-two");
        assert_eq!(pending_batch(&root), None);
        close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn close_seals_the_pending_range_writes() {
        let (_tmp, root) = open_notes();
        fs_write_file(&root, "notes", "/notes.txt", b"generation-one").unwrap();
        fs_write_range(&root, "notes", "/notes.txt", 0, b"generation-two").unwrap();
        close_vault(&root, "notes").unwrap();
        let store = root.vault_store_dir("notes").unwrap();
        let opened = open_store(&store, b"pass-word-ok").unwrap();
        let durable = read_logical_file(
            &store,
            &opened.header,
            &opened.content_key,
            &opened.index,
            "notes.txt",
        )
        .unwrap();
        assert_eq!(durable, b"generation-two");
    }

    #[test]
    fn a_full_batch_seals_without_a_flush() {
        let (_tmp, root) = open_notes();
        fs_write_file(&root, "notes", "/notes.txt", b"generation-one").unwrap();
        fs_write_range(&root, "notes", "/notes.txt", 0, b"g").unwrap();
        with_open_session(&root.vault_dir("notes").unwrap(), |session| {
            session.deferred.as_mut().unwrap().bytes = DEFERRED_SEAL_BYTES - 1;
            Ok(())
        })
        .unwrap();
        fs_write_range(&root, "notes", "/notes.txt", 1, b"E").unwrap();
        assert_eq!(pending_batch(&root), None);
        assert_eq!(sealed_bytes(&root, "notes.txt"), b"gEneration-one");
        close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn a_timer_seals_only_the_batch_it_was_started_for() {
        let (_tmp, root) = open_notes();
        fs_write_file(&root, "notes", "/notes.txt", b"generation-one").unwrap();
        fs_write_range(&root, "notes", "/notes.txt", 0, b"generation-two").unwrap();
        let batch = pending_batch(&root).unwrap();
        let dir = root.vault_dir("notes").unwrap();

        assert_eq!(
            seal_deferred_batch(&dir, batch + 1_000, true),
            DeferredTimer::Done
        );
        assert_eq!(pending_batch(&root), Some(batch));
        assert_eq!(sealed_bytes(&root, "notes.txt"), b"generation-one");

        assert_eq!(seal_deferred_batch(&dir, batch, true), DeferredTimer::Done);
        assert_eq!(pending_batch(&root), None);
        assert_eq!(sealed_bytes(&root, "notes.txt"), b"generation-two");

        close_vault(&root, "notes").unwrap();
        assert_eq!(seal_deferred_batch(&dir, batch, true), DeferredTimer::Done);
    }

    #[test]
    fn the_timer_seals_a_batch_nothing_else_sealed() {
        let (_tmp, root) = open_notes();
        fs_write_file(&root, "notes", "/notes.txt", b"generation-one").unwrap();
        fs_write_range(&root, "notes", "/notes.txt", 0, b"generation-two").unwrap();
        let batch = pending_batch(&root).unwrap();
        // The write scheduled its seal for the test window; bring it forward.
        let dir = root.vault_dir("notes").unwrap();
        schedule_deferred_seal_in(dir, batch, Duration::from_millis(100));
        let deadline = Instant::now() + Duration::from_secs(10);
        while pending_batch(&root).is_some() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
        }
        assert_eq!(pending_batch(&root), None, "the timer sealed the batch");
        assert_eq!(sealed_bytes(&root, "notes.txt"), b"generation-two");
        close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn a_vault_keeps_one_timed_seal_for_its_newest_batch() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("not-open");
        schedule_deferred_seal(dir.clone(), 7);
        schedule_deferred_seal(dir.clone(), 8);
        let batches: Vec<u64> = deferred_timers()
            .due
            .iter()
            .filter(|due| due.dir == dir)
            .map(|due| due.batch)
            .collect();
        assert_eq!(batches, vec![8]);
        // A vault that is not open has nothing to seal: the timer just ends.
        assert_eq!(seal_deferred_batch(&dir, 8, true), DeferredTimer::Done);
    }

    /// Write timings on this machine. Needs about 400 MiB free in the temp dir:
    /// `cargo test --release -p upriv-core --lib write_cost_report -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn write_cost_report() {
        let (_tmp, root) = open_notes();
        fs_mkdir(&root, "notes", "/small").unwrap();
        for i in 0..2000 {
            let path = format!("/small/{i}.txt");
            fs_write_file(&root, "notes", &path, &[b'x'; 1024]).unwrap();
        }
        let piece: Vec<u8> = (0..128 * 1024).map(|i| (i % 251) as u8).collect();
        let pieces = 512u64;
        let write_all = |path: &str, flush_each: bool| {
            fs_write_range(&root, "notes", path, 0, &piece).unwrap();
            let started = Instant::now();
            for i in 1..pieces {
                let offset = i * piece.len() as u64;
                fs_write_range(&root, "notes", path, offset, &piece).unwrap();
                if flush_each {
                    fs_flush(&root, "notes").unwrap();
                }
            }
            fs_flush(&root, "notes").unwrap();
            started.elapsed()
        };
        let batched = write_all("/batched.bin", false);
        let sealed_each = write_all("/sealed-each.bin", true);
        eprintln!("64 MiB in 128 KiB writes, 2000 files: {batched:?} batched");
        eprintln!("same with a seal after every write: {sealed_each:?}");
        close_vault(&root, "notes").unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_failed_flush_keeps_the_batch_for_the_next_flush() {
        use std::os::unix::fs::PermissionsExt;

        let (_tmp, root) = open_notes();
        fs_write_file(&root, "notes", "/notes.txt", b"generation-one").unwrap();
        fs_write_range(&root, "notes", "/notes.txt", 0, b"generation-two").unwrap();
        let store = root.vault_store_dir("notes").unwrap();
        let index_dir = store.join(crate::store::INDEX_DIR_NAME);
        let restore = crate::host_fs::metadata(&index_dir).unwrap().permissions();
        let mut locked = restore.clone();
        locked.set_mode(0o555);
        crate::host_fs::set_permissions(&index_dir, locked).unwrap();
        let flushed = fs_flush(&root, "notes");
        crate::host_fs::set_permissions(&index_dir, restore).unwrap();
        if flushed.is_ok() {
            // Running as root: the lock did not apply.
            close_vault(&root, "notes").unwrap();
            return;
        }
        assert_eq!(
            fs_read_file(&root, "notes", "/notes.txt").unwrap(),
            b"generation-two"
        );
        assert_eq!(sealed_bytes(&root, "notes.txt"), b"generation-one");
        assert!(pending_batch(&root).is_some());

        fs_flush(&root, "notes").unwrap();
        assert_eq!(sealed_bytes(&root, "notes.txt"), b"generation-two");
        close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn import_from_os_path_streams_over_inline_cap() {
        let (tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        let size = (VAULT_FS_MAX_INLINE_BYTES as usize) + 64;
        let data = vec![0xA5u8; size];
        let src = tmp.path().join("payload.bin");
        crate::host_fs::write(&src, &data).unwrap();
        let (path, _) = fs_import_from_os_path(&root, "notes", "/", "payload.bin", &src).unwrap();
        assert_eq!(path, "/payload.bin");
        let store = root.vault_store_dir("notes").unwrap();
        crate::session::with_open_session(&root.vault_dir("notes").unwrap(), |session| {
            let got = crate::store::read_logical_file(
                &store,
                &session.header,
                &session.content_key,
                &session.index,
                "payload.bin",
            )
            .unwrap();
            assert_eq!(got, data);
            Ok(())
        })
        .unwrap();
        let relative = fs_import_from_os_path(
            &root,
            "notes",
            "/",
            "nope.bin",
            std::path::Path::new("payload.bin"),
        )
        .unwrap_err();
        assert!(matches!(relative, UprivError::ImportSourceUnreadable(_)));

        let bait = store.join("bait.bin");
        crate::host_fs::write(&bait, b"x").unwrap();
        let from_store =
            fs_import_from_os_path(&root, "notes", "/", "bait.bin", &bait).unwrap_err();
        assert!(matches!(from_store, UprivError::ImportSourceUnreadable(_)));

        #[cfg(unix)]
        {
            let link = tmp.path().join("link.bin");
            std::os::unix::fs::symlink(&src, &link).unwrap();
            let linked =
                fs_import_from_os_path(&root, "notes", "/", "link.bin", &link).unwrap_err();
            assert!(matches!(linked, UprivError::ImportSourceUnreadable(_)));

            let alias = tmp.path().join("alias");
            crate::host_fs::create_dir(&alias).unwrap();
            let store_link = alias.join("into-store");
            std::os::unix::fs::symlink(&store, &store_link).unwrap();
            let via = store_link.join("bait.bin");
            let via_store =
                fs_import_from_os_path(&root, "notes", "/", "via.bin", &via).unwrap_err();
            assert!(matches!(via_store, UprivError::ImportSourceUnreadable(_)));
        }

        close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn short_reads_still_land_as_full_chunks() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        let chunk = crate::store::CHUNK_SIZE as usize;
        let mut data = vec![0u8; chunk + 7];
        for (index, byte) in data.iter_mut().enumerate() {
            *byte = (index % 251) as u8;
        }
        let mut reader = ByteAtATime { rest: &data };
        fs_write_staged(&root, "notes", "/short.bin", &mut reader).unwrap();
        let store = root.vault_store_dir("notes").unwrap();
        crate::session::with_open_session(&root.vault_dir("notes").unwrap(), |session| {
            let node = session
                .index
                .find("short.bin")
                .and_then(|node| node.as_file())
                .expect("imported file");
            assert_eq!(
                (session.header.chunk_size, node.1, node.2.len()),
                (crate::store::CHUNK_SIZE, data.len() as u64, 2)
            );
            let got = crate::store::read_logical_file(
                &store,
                &session.header,
                &session.content_key,
                &session.index,
                "short.bin",
            )
            .unwrap();
            assert_eq!(got, data);
            Ok(())
        })
        .unwrap();
        close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn parallel_imports_of_the_same_name_stay_distinct() {
        let (tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        let left_src = tmp.path().join("left.bin");
        let right_src = tmp.path().join("right.bin");
        crate::host_fs::write(&left_src, b"alpha-file").unwrap();
        crate::host_fs::write(&right_src, b"beta-file!!").unwrap();
        let (left, right) = std::thread::scope(|scope| {
            let left =
                scope.spawn(|| fs_import_from_os_path(&root, "notes", "/", "same.txt", &left_src));
            let right =
                scope.spawn(|| fs_import_from_os_path(&root, "notes", "/", "same.txt", &right_src));
            (left.join().unwrap(), right.join().unwrap())
        });
        let mut paths = [left.unwrap().0, right.unwrap().0];
        paths.sort();
        assert_eq!(paths, ["/same-2.txt".to_string(), "/same.txt".to_string()]);
        let mut bodies = [
            fs_read_file(&root, "notes", "/same.txt").unwrap(),
            fs_read_file(&root, "notes", "/same-2.txt").unwrap(),
        ];
        bodies.sort();
        assert_eq!(bodies, [b"alpha-file".to_vec(), b"beta-file!!".to_vec()]);
        close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn parallel_imports_encrypt_at_the_same_time() {
        use std::io::{self, Read};
        use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
        use std::sync::Arc;
        use std::time::{Duration, Instant};

        struct Hold {
            data: &'static [u8],
            pos: usize,
            entered: Arc<AtomicUsize>,
            overlapped: Arc<AtomicBool>,
        }

        impl Read for Hold {
            fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
                if self.pos == 0 {
                    let now = self.entered.fetch_add(1, Ordering::SeqCst) + 1;
                    if now == 1 {
                        let start = Instant::now();
                        while self.entered.load(Ordering::SeqCst) < 2
                            && start.elapsed() < Duration::from_secs(2)
                        {
                            std::thread::yield_now();
                        }
                        if self.entered.load(Ordering::SeqCst) >= 2 {
                            self.overlapped.store(true, Ordering::SeqCst);
                        }
                    }
                }
                if self.pos >= self.data.len() {
                    return Ok(0);
                }
                let n = buf.len().min(self.data.len() - self.pos);
                buf[..n].copy_from_slice(&self.data[self.pos..self.pos + n]);
                self.pos += n;
                Ok(n)
            }
        }

        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        let entered = Arc::new(AtomicUsize::new(0));
        let overlapped = Arc::new(AtomicBool::new(false));
        let (left, right) = std::thread::scope(|scope| {
            let left = scope.spawn(|| {
                let mut reader = Hold {
                    data: b"alpha-file-one",
                    pos: 0,
                    entered: Arc::clone(&entered),
                    overlapped: Arc::clone(&overlapped),
                };
                fs_write_staged(&root, "notes", "/left.txt", &mut reader)
            });
            let right = scope.spawn(|| {
                let mut reader = Hold {
                    data: b"beta-file-two!",
                    pos: 0,
                    entered: Arc::clone(&entered),
                    overlapped: Arc::clone(&overlapped),
                };
                fs_write_staged(&root, "notes", "/right.txt", &mut reader)
            });
            (left.join().unwrap(), right.join().unwrap())
        });
        left.unwrap();
        right.unwrap();
        assert!(overlapped.load(Ordering::SeqCst));
        assert_eq!(
            fs_read_file(&root, "notes", "/left.txt").unwrap(),
            b"alpha-file-one"
        );
        assert_eq!(
            fs_read_file(&root, "notes", "/right.txt").unwrap(),
            b"beta-file-two!"
        );
        close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn import_batch_is_readable_after_close_seals_the_index() {
        let (tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        let (folder, _) = fs_ensure_folder(&root, "notes", "/", "photos").unwrap();
        assert_eq!(folder, "/photos");
        let (again, _) = fs_ensure_folder(&root, "notes", "/", "photos").unwrap();
        assert_eq!(again, "/photos");
        let count = 4;
        for index in 0..count {
            let name = format!("f{index}.txt");
            let src = tmp.path().join(&name);
            let body = format!("body-{index}");
            crate::host_fs::write(&src, &body).unwrap();
            let (path, _) = fs_import_from_os_path(&root, "notes", "/photos", &name, &src).unwrap();
            assert_eq!(path, format!("/photos/{name}"));
            let live = fs_read_file(&root, "notes", &path).unwrap();
            assert_eq!(live, body.as_bytes());
        }
        close_vault(&root, "notes").unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        for index in 0..count {
            let path = format!("/photos/f{index}.txt");
            let got = fs_read_file(&root, "notes", &path).unwrap();
            assert_eq!(got, format!("body-{index}").into_bytes());
        }
        close_vault(&root, "notes").unwrap();
    }

    fn sealed_index_names(root: &VaultRoot, path: &str) -> bool {
        with_open_session(&root.vault_dir("notes").unwrap(), |session| {
            crate::store::sealed_index_contains(
                &store_dir(session),
                &session.header,
                &session.index_key,
                path,
            )
        })
        .unwrap()
    }

    fn os_source(dir: &Path, name: &str, body: &[u8]) -> PathBuf {
        let path = dir.join(name);
        crate::host_fs::write(&path, body).unwrap();
        path
    }

    #[test]
    fn an_os_import_is_listed_at_once_and_its_timer_seals_it() {
        let (tmp, root) = open_notes();
        let before = fs_tree_revision(&root, "notes").unwrap();
        let src = os_source(tmp.path(), "one.txt", b"one");
        let (path, revision) =
            fs_import_from_os_path(&root, "notes", "/", "one.txt", &src).unwrap();
        assert!(revision > before, "the explorer sees the new file");
        assert_eq!(fs_read_file(&root, "notes", &path).unwrap(), b"one");
        // What a crash would keep: the sealed index does not name it yet.
        assert!(!sealed_index_names(&root, "one.txt"));
        let batch = pending_batch(&root).expect("the import joined the pending batch");

        let dir = root.vault_dir("notes").unwrap();
        assert_eq!(seal_deferred_batch(&dir, batch, true), DeferredTimer::Done);
        assert!(sealed_index_names(&root, "one.txt"));
        assert_eq!(pending_batch(&root), None);
        close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn a_full_wave_of_os_imports_seals_on_the_last_one() {
        let (tmp, root) = open_notes();
        let src = os_source(tmp.path(), "src.txt", b"wave");
        for index in 0..STAGED_IMPORT_WAVE - 1 {
            fs_import_from_os_path(&root, "notes", "/", &format!("w{index}.txt"), &src).unwrap();
        }
        assert!(!sealed_index_names(&root, "w0.txt"));
        let last = STAGED_IMPORT_WAVE - 1;
        fs_import_from_os_path(&root, "notes", "/", &format!("w{last}.txt"), &src).unwrap();
        assert!(sealed_index_names(&root, "w0.txt"));
        assert!(sealed_index_names(&root, &format!("w{last}.txt")));
        assert_eq!(pending_batch(&root), None);
        close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn an_import_into_a_folder_deleted_meanwhile_is_refused() {
        let (tmp, root) = open_notes();
        let src = os_source(tmp.path(), "a.txt", b"orphan?");
        let (docs, _) = fs_ensure_folder(&root, "notes", "/", "docs").unwrap();
        fs_delete(&root, "notes", &docs).unwrap();
        let err = fs_import_from_os_path(&root, "notes", &docs, "a.txt", &src).unwrap_err();
        assert!(matches!(err, UprivError::VaultPathNotFound(_)), "{err:?}");
        with_open_session(&root.vault_dir("notes").unwrap(), |session| {
            assert!(session.index.find("docs/a.txt").is_none());
            assert_eq!(session.unsealed_imports, 0);
            Ok(())
        })
        .unwrap();
        close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn a_new_import_folder_is_staged_with_its_files() {
        let (tmp, root) = open_notes();
        let src = os_source(tmp.path(), "a.txt", b"inside");
        let before = fs_tree_revision(&root, "notes").unwrap();
        let (docs, revision) = fs_ensure_folder(&root, "notes", "/", "docs").unwrap();
        assert!(revision > before);
        assert!(!sealed_index_names(&root, "docs"));
        assert_eq!(
            fs_ensure_folder(&root, "notes", "/", "docs").unwrap().0,
            docs
        );
        fs_import_from_os_path(&root, "notes", &docs, "a.txt", &src).unwrap();
        fs_flush(&root, "notes").unwrap();
        assert!(sealed_index_names(&root, "docs"));
        assert!(sealed_index_names(&root, "docs/a.txt"));
        close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn another_change_or_close_seals_staged_imports() {
        let (tmp, root) = open_notes();
        let src = os_source(tmp.path(), "a.txt", b"staged");
        fs_import_from_os_path(&root, "notes", "/", "a.txt", &src).unwrap();
        fs_create_folder(&root, "notes", "/", "docs").unwrap();
        assert!(sealed_index_names(&root, "a.txt"));

        let mut body = b"streamed".as_slice();
        crate::vault::ingest_import_reader(&root, "notes", "docs/b.txt", &mut body).unwrap();
        assert!(!sealed_index_names(&root, "docs/b.txt"));
        close_vault(&root, "notes").unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        assert_eq!(fs_read_file(&root, "notes", "/a.txt").unwrap(), b"staged");
        assert_eq!(
            fs_read_file(&root, "notes", "/docs/b.txt").unwrap(),
            b"streamed"
        );
        close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn staged_imports_seal_once_and_stay_readable() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        for index in 0..3 {
            let path = format!("/d{index}.txt");
            let body = format!("body-{index}");
            fs_write_staged(&root, "notes", &path, &mut body.as_bytes()).unwrap();
            assert_eq!(
                fs_read_file(&root, "notes", &path).unwrap(),
                format!("body-{index}").into_bytes()
            );
        }
        let dir = root.vault_dir("notes").unwrap();
        crate::session::with_open_session(&dir, |session| {
            let store = store_dir(session);
            assert!(!crate::store::sealed_index_contains(
                &store,
                &session.header,
                &session.index_key,
                "d0.txt",
            )
            .unwrap());
            assert!(session.unsealed_imports >= 3);
            Ok(())
        })
        .unwrap();
        fs_seal_staged_imports(&root, "notes").unwrap();
        crate::session::with_open_session(&dir, |session| {
            let store = store_dir(session);
            assert!(crate::store::sealed_index_contains(
                &store,
                &session.header,
                &session.index_key,
                "d2.txt",
            )
            .unwrap());
            assert_eq!(session.unsealed_imports, 0);
            Ok(())
        })
        .unwrap();
        fs_seal_staged_imports(&root, "notes").unwrap();
        close_vault(&root, "notes").unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        for index in 0..3 {
            let got = fs_read_file(&root, "notes", &format!("/d{index}.txt")).unwrap();
            assert_eq!(got, format!("body-{index}").into_bytes());
        }
        close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn a_full_import_wave_is_sealed_before_the_importer_returns() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        for index in 0..STAGED_IMPORT_WAVE {
            let mut body = b"wave".as_slice();
            fs_write_staged(&root, "notes", &format!("/w{index}.txt"), &mut body).unwrap();
            fs_seal_staged_wave(&root, "notes").unwrap();
        }
        let dir = root.vault_dir("notes").unwrap();
        crate::session::with_open_session(&dir, |session| {
            let store = store_dir(session);
            assert!(crate::store::sealed_index_contains(
                &store,
                &session.header,
                &session.index_key,
                "w0.txt",
            )
            .unwrap());
            assert_eq!(session.unsealed_imports, 0);
            Ok(())
        })
        .unwrap();
        let mut tail = b"tail".as_slice();
        fs_write_staged(&root, "notes", "/tail.txt", &mut tail).unwrap();
        crate::session::with_open_session(&dir, |session| {
            let store = store_dir(session);
            assert!(!crate::store::sealed_index_contains(
                &store,
                &session.header,
                &session.index_key,
                "tail.txt",
            )
            .unwrap());
            assert_eq!(session.unsealed_imports, 1);
            Ok(())
        })
        .unwrap();
        close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn join_logical_under_mount_keeps_root_and_rejects_dots() {
        let mount = PathBuf::from("/workspace/Notes");
        assert_eq!(
            join_logical_under_mount(&mount, "").unwrap(),
            PathBuf::from("/workspace/Notes")
        );
        assert_eq!(
            join_logical_under_mount(&mount, "a/b.txt").unwrap(),
            PathBuf::from("/workspace/Notes/a/b.txt")
        );
        assert!(join_logical_under_mount(&mount, "a/../b").is_err());
        assert!(join_logical_under_mount(&mount, "a//b").is_err());
    }

    #[test]
    fn os_path_requires_open_session_and_a_mount() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        let closed = fs_os_path(&root, "notes", "/").unwrap_err();
        assert!(matches!(closed, UprivError::VaultNotOpen(_)));

        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        let result = fs_os_path(&root, "notes", "/hello.txt");
        match crate::session::with_open_session(&root.vault_dir("notes").unwrap(), |session| {
            Ok(session.mount.is_some())
        }) {
            Ok(true) => {
                let path = result.expect("mounted vault should resolve an OS path");
                assert!(path.ends_with("hello.txt"));
            }
            Ok(false) => {
                assert!(matches!(
                    result.unwrap_err(),
                    UprivError::VaultMountFailed(_)
                ));
            }
            Err(error) => panic!("{error}"),
        }
        close_vault(&root, "notes").unwrap();
    }
}
