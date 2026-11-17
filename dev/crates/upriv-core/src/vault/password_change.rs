//! The password change of a closed vault: a new key, and every file
//! rewritten with it, so nothing in the vault opens with the old password
//! afterwards.
//!
//! In order, as one job:
//!
//! 1. Checks: the vault closed, no plain-text folder left, no change pending,
//!    no delete started, a new password that differs.
//! 2. The current password unlocks, under the unlock limit.
//! 3. Free space for the change itself: its largest file, twice the index,
//!    and [`SPACE_MARGIN`]. Short of that, the change is refused with the
//!    sizes.
//! 4. The save of the store as it is, when **Back up first** is on and there
//!    is room ([`backup_before_password_change`]). No room or a failure skips
//!    it; the change goes on.
//! 5. Blobs no file names are set aside, as at an open.
//! 6. A header holding more than [`KEYS_AT_START`] keys gets keys freed: the
//!    files of the key with the least content are rewritten onto the write
//!    key under the current password, and that key leaves the header.
//! 7. The new key, under the new password (same cost, new salt), goes into
//!    the header as the `change` block, beside the top block, which stays as
//!    it is. Its id is the generation of that write.
//! 8. The index is sealed under the top block's pair, with the first batch's
//!    new blobs released before they exist.
//! 9. Convert, batch by batch ([`BATCH_BYTES`] at most, never more than the
//!    free space beyond the reserve, always one file at least): each file
//!    whose chunks are not all on the new key is read chunk by chunk, each
//!    with its own key, and written to a new blob with `change`'s key copy;
//!    a chunk that does not read is carried byte for byte with no key. The
//!    blobs are flushed, then the index is sealed under `change`'s pair,
//!    naming the new blobs and releasing the old ones and the next batch's.
//!    Held blobs with a file are rewritten too, in `held/`.
//! 10. Finish, a step a stop cannot enter: the header with `change`'s unlock
//!     settings and the keys still in use, which after a full convert is the
//!     new key alone; the chunks no key opens any more get none. Four writes
//!     commit it ([`super::header_commit`]).
//! 11. The pass makes every blob's key copy the final header's
//!     ([`super::key_pass`]). A stop there is not a cancel.
//!
//! A stop, or a write that fails, after step 7 writes the stop header: the
//! old unlock settings and keys, the attempt's key when a batch was sealed,
//! and a fresh key made now as the write key, under the old password. Every
//! key of `change` was on disk under the new password, so none of them takes
//! a new write again. A crash leaves the pending header for the next unlock
//! ([`settle_pending`]).

use std::collections::VecDeque;
use std::path::Path;

use serde::Serialize;
use uuid::Uuid;

use crate::config::{load_vault_config, save_vault_config};
use crate::error::{Result, UprivError};
use crate::logging::{log_event, LogLevel};
use crate::paths::VaultRoot;
use crate::session::{with_unlock_lock, Job, JobKind, JobStep};
use crate::store::{
    append_record, convert_files, convert_held_blob, flush_made_blob, held_dir, newly_missing,
    sealed_index_bytes, HeaderKdf, HeldBlob, KeyId, Keyring, PendingChange, PendingSide, Records,
    VaultHeader, VaultIndex, VaultNode, DATA_DIR_NAME, MAX_KEYS,
};
use crate::time::utc_timestamp_iso_millis;

use super::backup::{backup_before_password_change, BackupSkip, CopyBefore};
use super::closed_store::{change_pending, steady, unlock_counted, with_closed_vault, ClosedStore};
use super::header_commit::{next_generation, CommitRecord};
use super::key_pass::{pass_closed, KeyCopies};

/// Free space a change keeps beside its largest file and twice the index.
pub(crate) const SPACE_MARGIN: u64 = 16 * 1024 * 1024;
/// Most file content one batch rewrites before its seal.
const BATCH_BYTES: u64 = 64 * 1024 * 1024;
/// Most keys a header holds when a change starts: a stop then has room for
/// the two it adds.
pub(crate) const KEYS_AT_START: usize = MAX_KEYS - 2;

/// What a password change did.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PasswordChangeResult {
    /// The save written before the change, by its file name.
    pub backup: Option<String>,
    /// Why no save was written.
    pub backup_skipped: Option<BackupSkip>,
    /// Files with a part the vault could not read, or whose data is missing:
    /// those parts can no longer be read from the vault.
    pub unreadable: u64,
    pub key_copies: KeyCopies,
}

/// What Finish did.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PasswordChangeFinishResult {
    /// Files with a part the vault could not read, or whose data is missing.
    pub unreadable: u64,
    pub key_copies: KeyCopies,
}

/// Change the password of the closed vault `vault_id` from `current` to
/// `new`, as the job `job_id`. `back_up_first` writes a save of the store
/// before anything changes, when there is room for it.
pub fn change_vault_password(
    root: &VaultRoot,
    vault_id: &str,
    current: &[u8],
    new: &[u8],
    back_up_first: bool,
    job_id: &str,
) -> Result<PasswordChangeResult> {
    Job::run(job_id, JobKind::PasswordChange, Some(vault_id), |job| {
        if current.is_empty() || new.is_empty() {
            return Err(UprivError::WrongPassword);
        }
        if current == new {
            return Err(UprivError::PasswordUnchanged);
        }
        with_closed_vault(root, vault_id, |vault_dir| {
            job.set_step(JobStep::Unlocking);
            let mut store = with_unlock_lock(|| {
                unlock_counted(vault_dir, current, |unlocked| {
                    steady(vault_dir, vault_id, unlocked)
                })
            })?;
            job.ensure_running()?;
            let reserve = space_needed(&store)?;
            let (backup, backup_skipped) = if back_up_first {
                job.set_step(JobStep::BackingUp);
                match backup_before_password_change(root, vault_id, reserve, job)? {
                    CopyBefore::Written(zip) => (file_name(&zip), None),
                    CopyBefore::Skipped(reason) => (None, Some(reason)),
                }
            } else {
                log_event(
                    LogLevel::Warn,
                    "backup_skipped",
                    &[("id", vault_id), ("reason", BackupSkip::Off.as_str())],
                );
                (None, Some(BackupSkip::Off))
            };
            job.ensure_running()?;
            store.settle()?;
            free_keys(&mut store, reserve, job)?;
            let kdf = store.keys.block().kdf.with_new_salt();
            let new_kek = with_unlock_lock(|| kdf.derive_kek(new))?;
            job.ensure_running()?;
            let change = begin_change(&mut store, kdf, &new_kek)?;
            if let Err(Interrupted { error, converted }) =
                run_change(&mut store, &change, reserve, job)
            {
                if stop_change(&mut store, &change, converted).is_err() {
                    // The header keeps `change`: the next unlock settles it.
                    super::closed_store::log_left(
                        vault_id,
                        "vault_password_change_stop_failed",
                        "commit",
                    );
                }
                log_event(
                    LogLevel::Info,
                    "vault_password_change_stopped",
                    &[("id", vault_id)],
                );
                return Err(error);
            }
            job.set_step(JobStep::Finishing);
            let generation = next_generation(&store.store_dir(), &store.header)?;
            let finished = finish_keys(&mut store.index, &change)?.seal(
                generation,
                change.block().kdf.clone(),
                &new_kek,
            )?;
            store.commit(finished, new_kek, CommitRecord::Rewritten)?;
            record_password_changed(vault_dir, vault_id);
            log_event(
                LogLevel::Info,
                "vault_password_changed",
                &[("id", vault_id)],
            );
            let key_copies = pass_closed(&mut store, job)?;
            Ok(PasswordChangeResult {
                backup,
                backup_skipped,
                unreadable: unreadable_files(&store.index),
                key_copies,
            })
        })
    })
}

/// Rewrite the files an unfinished password change left on keys below
/// `since`, onto the write key, as the job `job_id`: the convert of a change
/// with no new key and one password. Then the header keeps only the keys in
/// use, and the pass runs. A stop leaves the files not reached for the next
/// run.
pub fn finish_password_change(
    root: &VaultRoot,
    vault_id: &str,
    password: &[u8],
    job_id: &str,
) -> Result<PasswordChangeFinishResult> {
    Job::run(
        job_id,
        JobKind::PasswordChangeFinish,
        Some(vault_id),
        |job| {
            with_closed_vault(root, vault_id, |vault_dir| {
                job.set_step(JobStep::Unlocking);
                let mut store = with_unlock_lock(|| {
                    unlock_counted(vault_dir, password, |unlocked| {
                        steady(vault_dir, vault_id, unlocked)
                    })
                })?;
                job.ensure_running()?;
                if !store.keys.holds_key_below_since() {
                    return Ok(PasswordChangeFinishResult {
                        unreadable: unreadable_files(&store.index),
                        key_copies: pass_closed(&mut store, job)?,
                    });
                }
                let reserve = space_needed(&store)?;
                store.settle()?;
                let since = store.keys.since();
                let keys = store.keys.clone();
                let plan = ConvertPlan::of(&store.index, |key| key < since);
                convert(&mut store, &keys, plan, reserve, job).map_err(|stopped| stopped.error)?;
                job.final_step()?;
                job.set_step(JobStep::Finishing);
                let generation = next_generation(&store.store_dir(), &store.header)?;
                let finished = finish_keys(&mut store.index, &keys)?.seal(
                    generation,
                    keys.block().kdf.clone(),
                    &store.kek,
                )?;
                let kek = store.kek.clone();
                store.commit(finished, kek, CommitRecord::Hash)?;
                log_event(
                    LogLevel::Info,
                    "vault_password_change_finished",
                    &[("id", vault_id)],
                );
                let key_copies = pass_closed(&mut store, job)?;
                Ok(PasswordChangeFinishResult {
                    unreadable: unreadable_files(&store.index),
                    key_copies,
                })
            })
        },
    )
}

/// Free space the change itself needs on the drive of the data folder: its
/// largest file, twice the index, and [`SPACE_MARGIN`]. Refused with the
/// sizes when the drive has less.
fn space_needed(store: &ClosedStore) -> Result<u64> {
    let largest = store
        .index
        .nodes()
        .iter()
        .filter_map(VaultNode::as_file)
        .map(|(_, size, _)| blob_bytes(size))
        .chain(
            store
                .index
                .held
                .iter()
                .filter(|entry| entry.file.is_some())
                .map(|entry| entry.size),
        )
        .max()
        .unwrap_or(0);
    let index = sealed_index_bytes(&store.keys, &store.index)?.len() as u64;
    let needed = largest
        .saturating_add(index.saturating_mul(2))
        .saturating_add(SPACE_MARGIN);
    if let Some(available) = crate::host_fs::free_bytes(&store.store_dir().join(DATA_DIR_NAME)) {
        if available < needed {
            return Err(UprivError::PasswordChangeSpaceShort { needed, available });
        }
    }
    Ok(needed)
}

/// Bytes a blob of a file of `size` takes once rewritten: its key copy, its
/// chunks with their nonces and tags, and room for one record.
fn blob_bytes(size: u64) -> u64 {
    let chunks = u64::from(crate::store::chunk_count(size, crate::store::CHUNK_SIZE));
    crate::store::KEY_COPY_LEN
        .saturating_add(size)
        .saturating_add(chunks.saturating_mul(40))
        .saturating_add(64 * 1024)
}

/// Free keys until the header holds [`KEYS_AT_START`]: each time, the files
/// of the key with the least content, never the write key, are rewritten
/// onto the write key under the current password, and the header is written
/// without that key. A stop ends it with the password and every file's
/// content as they were.
fn free_keys(store: &mut ClosedStore, reserve: u64, job: &Job) -> Result<()> {
    while store.keys.ids().count() > KEYS_AT_START {
        let write = store.keys.write_id();
        let bytes = store.index.bytes_on_keys();
        let Some(freed) = store
            .keys
            .ids()
            .filter(|id| *id != write)
            .min_by_key(|id| bytes.get(id).copied().unwrap_or(0))
        else {
            return Ok(());
        };
        job.set_step(JobStep::RewritingFiles);
        let keys = store.keys.clone();
        let plan = ConvertPlan::of(&store.index, |key| key == freed);
        convert(store, &keys, plan, reserve, job).map_err(|stopped| stopped.error)?;
        store.index.drop_keys(|id| id != freed);
        let generation = next_generation(&store.store_dir(), &store.header)?;
        let fewer = keys.draft().retain(|id| id != freed).seal(
            generation,
            keys.block().kdf.clone(),
            &store.kek,
        )?;
        let kek = store.kek.clone();
        store.commit(fewer, kek, CommitRecord::Hash)?;
        log_event(
            LogLevel::Info,
            "vault_key_freed",
            &[("id", store.vault_id.as_str())],
        );
    }
    Ok(())
}

/// Write the header twins with `change`: the current keys, then a new key
/// whose id is this write's generation, `since` that key, sealed under
/// `kek`, which `kdf` derives from the new password. The top block stays as
/// it is, byte for byte. Returns `change`'s keys. When the write fails after
/// a header file took `change`, the stop header is written, so the old
/// password stays.
fn begin_change(
    store: &mut ClosedStore,
    kdf: HeaderKdf,
    kek: &crate::store::Kek,
) -> Result<Keyring> {
    let generation = next_generation(&store.store_dir(), &store.header)?;
    let new_key = KeyId::new(generation);
    let change = store
        .keys
        .draft()
        .fresh(new_key)?
        .since(new_key)
        .seal(generation, kdf, kek)?;
    let pending = VaultHeader {
        change: Some(change.block().clone()),
        ..store.header.clone()
    };
    let written = crate::store::save_header(store.store_dir(), &pending);
    store.record(CommitRecord::Hash);
    if let Err(error) = written {
        if change_pending(&store.vault_dir) && stop_change(store, &change, false).is_err() {
            super::closed_store::log_left(
                &store.vault_id,
                "vault_password_change_stop_failed",
                "commit",
            );
        }
        return Err(error);
    }
    Ok(change)
}

/// Why a convert ended before it was done, and whether a batch was sealed
/// before, so the stop knows whether the files on the attempt's key need it.
struct Interrupted {
    error: UprivError,
    converted: bool,
}

/// Steps 8 and 9 of the change: every file not on `change`'s write key is
/// rewritten onto it.
fn run_change(
    store: &mut ClosedStore,
    change: &Keyring,
    reserve: u64,
    job: &Job,
) -> std::result::Result<(), Interrupted> {
    let new_key = change.write_id();
    let plan = ConvertPlan::of(&store.index, |key| key != new_key);
    let converted = convert(store, change, plan, reserve, job)?;
    job.final_step()
        .map_err(|error| Interrupted { error, converted })
}

/// The stop of a change, or its cancel: the old unlock settings and keys,
/// the attempt's key when `converted`, and a fresh write key made now, under
/// the old password, in a new generation with no `change`. The four writes
/// commit it. A failure leaves the pending header for the next unlock.
fn stop_change(store: &mut ClosedStore, change: &Keyring, converted: bool) -> Result<()> {
    let generation = next_generation(&store.store_dir(), &store.header)?;
    let mut draft = store.keys.draft();
    if converted {
        draft = draft.take(change, change.write_id())?;
    }
    let keys = draft.fresh(KeyId::new(generation))?.seal(
        generation,
        store.keys.block().kdf.clone(),
        &store.kek,
    )?;
    let kek = store.kek.clone();
    store.commit(keys, kek, CommitRecord::Hash)
}

/// The keys of the header a finish writes: every chunk on a key below
/// `keys`' `since` gets no key, since only a file the convert could not read
/// is still on one; then the keys some chunk uses, and the write key.
fn finish_keys(index: &mut VaultIndex, keys: &Keyring) -> Result<crate::store::KeyringDraft> {
    let since = keys.since();
    index.drop_keys(|id| id >= since);
    let in_use = index.keys_in_use();
    let write = keys.write_id();
    Ok(keys
        .draft()
        .retain(|id| id == write || in_use.contains(&id)))
}

/// Files of the tree with a part no key opens, or marked as missing or
/// damaged.
fn unreadable_files(index: &VaultIndex) -> u64 {
    index
        .nodes()
        .iter()
        .filter(|node| {
            node.problem.is_some()
                || node
                    .chunk_keys()
                    .is_some_and(|keys| keys.iter().any(|key| key.is_none()))
        })
        .count() as u64
}

fn file_name(path: &Path) -> Option<String> {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(str::to_string)
}

/// Write `password_changed_at` into the vault's `config.toml`. A failure is
/// logged: the password is changed by then.
pub(crate) fn record_password_changed(vault_dir: &Path, vault_id: &str) {
    let saved = load_vault_config(vault_dir).and_then(|mut config| {
        config.security.password_changed_at = Some(utc_timestamp_iso_millis());
        save_vault_config(vault_dir, &config)
    });
    if saved.is_err() {
        log_event(
            LogLevel::Warn,
            "vault_password_change_unrecorded",
            &[("id", vault_id)],
        );
    }
}

/// One file to rewrite.
#[derive(Debug, Clone)]
enum ConvertItem {
    /// A file of the tree, by its blob's file id.
    Tree { file_id: String, bytes: u64 },
    /// A held blob with a file, by its name in `held/`.
    Held { name: String, bytes: u64 },
}

impl ConvertItem {
    fn bytes(&self) -> u64 {
        match self {
            Self::Tree { bytes, .. } | Self::Held { bytes, .. } => *bytes,
        }
    }
}

/// The files a convert rewrites, in order: the tree's, then the held blobs'.
struct ConvertPlan {
    items: VecDeque<ConvertItem>,
}

/// One batch, each file with the id its new blob takes.
#[derive(Default)]
struct Batch {
    /// `(file id, new file id)` of each file of the tree.
    tree: Vec<(String, String)>,
    /// `(held name, new file id)` of each held blob.
    held: Vec<(String, String)>,
}

impl Batch {
    /// What a seal releases before this batch makes it: the new blobs, a
    /// tree file's by its id, a held one's by its name in `held/`.
    fn reserved(&self) -> Vec<String> {
        self.tree
            .iter()
            .map(|(_, new_id)| new_id.clone())
            .chain(self.held.iter().map(|(_, new_id)| held_name(new_id)))
            .collect()
    }
}

fn held_name(file_id: &str) -> String {
    format!("{file_id}{}", crate::store::BLOB_FILE_SUFFIX)
}

impl ConvertPlan {
    /// Every file of `index` with data and a chunk on a key `wanted` picks.
    /// A chunk with no key has nothing to rewrite.
    fn of(index: &VaultIndex, wanted: impl Fn(KeyId) -> bool) -> Self {
        let needs = |node: &VaultNode| {
            node.chunk_keys()
                .is_some_and(|keys| keys.iter().any(|key| !key.is_none() && wanted(*key)))
        };
        let tree = index.nodes().iter().filter_map(|node| {
            let (file_id, size, _) = node.as_file()?;
            (size > 0 && needs(node)).then(|| ConvertItem::Tree {
                file_id: file_id.to_string(),
                bytes: size,
            })
        });
        let held = index.held.iter().filter_map(|entry| {
            let node = entry.file.as_ref()?;
            let (_, size, _) = node.as_file()?;
            (size > 0 && needs(node)).then(|| ConvertItem::Held {
                name: entry.name.clone(),
                bytes: size,
            })
        });
        Self {
            items: tree.chain(held).collect(),
        }
    }

    fn total_bytes(&self) -> u64 {
        self.items.iter().map(ConvertItem::bytes).sum()
    }

    /// The next batch: files up to `budget` bytes, one at least.
    fn next_batch(&mut self, budget: u64) -> Option<Batch> {
        let mut batch = Batch::default();
        let mut bytes: u64 = 0;
        while let Some(item) = self.items.front() {
            let size = item.bytes();
            let empty = batch.tree.is_empty() && batch.held.is_empty();
            if !empty && bytes.saturating_add(size) > budget {
                break;
            }
            bytes = bytes.saturating_add(size);
            let new_id = Uuid::new_v4().to_string();
            match self.items.pop_front()? {
                ConvertItem::Tree { file_id, .. } => batch.tree.push((file_id, new_id)),
                ConvertItem::Held { name, .. } => batch.held.push((name, new_id)),
            }
        }
        (!batch.tree.is_empty() || !batch.held.is_empty()).then_some(batch)
    }
}

/// Bytes the next batch may rewrite: [`BATCH_BYTES`], and no more than the
/// free space beyond `reserve`. The first file of a batch always goes in: the
/// reserve holds the largest one.
fn batch_budget(store: &ClosedStore, reserve: u64) -> u64 {
    #[cfg(test)]
    let batch_bytes = TEST_BATCH_BYTES.with(std::cell::Cell::get);
    #[cfg(not(test))]
    let batch_bytes = BATCH_BYTES;
    match crate::host_fs::free_bytes(&store.store_dir().join(DATA_DIR_NAME)) {
        Some(free) => batch_bytes.min(free.saturating_sub(reserve)),
        None => batch_bytes,
    }
}

#[cfg(test)]
thread_local! {
    /// [`BATCH_BYTES`] on this thread, so a test of a few small files runs
    /// several batches.
    static TEST_BATCH_BYTES: std::cell::Cell<u64> = const { std::cell::Cell::new(BATCH_BYTES) };
}

/// Rewrite every file of `plan` onto the write key of `keys`, batch by
/// batch. The first batch's new blobs are released by a seal under the
/// store's own pair before any is made; each batch is then sealed under
/// `keys`' pair, releasing its old blobs and the next batch's new ones.
/// A stop is taken between chunks. True when a batch was sealed.
fn convert(
    store: &mut ClosedStore,
    keys: &Keyring,
    mut plan: ConvertPlan,
    reserve: u64,
    job: &Job,
) -> std::result::Result<bool, Interrupted> {
    let mut converted = false;
    let interrupted = |error: UprivError, converted: bool| Interrupted { error, converted };
    job.set_step(JobStep::RewritingFiles);
    job.set_total(plan.total_bytes());
    let Some(first) = plan.next_batch(batch_budget(store, reserve)) else {
        return Ok(false);
    };
    store
        .seal(first.reserved())
        .map_err(|error| interrupted(error, converted))?;
    let mut batch = Some(first);
    while let Some(current) = batch.take() {
        let made = convert_batch(store, keys, &current, job)
            .map_err(|error| interrupted(error, converted))?;
        let next = plan.next_batch(batch_budget(store, reserve));
        let mut dropped = made.dropped.clone();
        dropped.extend(next.iter().flat_map(Batch::reserved));
        if let Err(error) = store.seal_under(keys, dropped) {
            made.undo(&mut store.index);
            return Err(interrupted(error, converted));
        }
        converted = true;
        batch = next;
    }
    Ok(converted)
}

/// What one batch made, kept until its seal lands.
struct BatchMade {
    /// New blobs in `data/` and the nodes as they were before.
    tree: crate::store::ChunkBlobMutation,
    /// Each held blob rewritten: its entry before, and its new file.
    held: Vec<(HeldBlob, std::path::PathBuf)>,
    /// The old blobs the batch's seal releases.
    dropped: Vec<String>,
}

impl BatchMade {
    /// The batch's seal did not land: the files point at their old blobs
    /// again, and the new blobs are deleted.
    fn undo(&self, index: &mut VaultIndex) {
        self.tree.restore_packed_nodes(index);
        self.tree.discard_created();
        for (before, path) in &self.held {
            let made = file_name(path);
            if let Some(entry) = index
                .held
                .iter_mut()
                .find(|entry| Some(&entry.name) == made.as_ref())
            {
                *entry = before.clone();
            }
            let _ = crate::host_fs::remove_file(path);
        }
    }
}

/// Rewrite the files of `batch` onto the write key of `keys` and flush the
/// new blobs, each with its record. A failure or a stop deletes what the
/// batch made and leaves the index as it was.
fn convert_batch(
    store: &mut ClosedStore,
    keys: &Keyring,
    batch: &Batch,
    job: &Job,
) -> Result<BatchMade> {
    let dir = store.store_dir();
    let on_chunk = |bytes: u64| -> Result<()> {
        job.ensure_running()?;
        job.advance(bytes);
        Ok(())
    };
    let packed = convert_files(&dir, keys, &mut store.index, &batch.tree, &on_chunk)?;
    let records = Records {
        keys,
        index: &store.index,
    };
    if let Err(error) = packed.mutation.sync_before_index(&records) {
        packed.mutation.restore_packed_nodes(&mut store.index);
        packed.mutation.discard_created();
        return Err(error);
    }
    let mut made = BatchMade {
        dropped: packed.mutation.superseded_ids(),
        tree: packed.mutation,
        held: Vec::new(),
    };
    for (name, new_id) in &batch.held {
        match convert_held(store, keys, name, new_id, &on_chunk) {
            Ok(Some((before, path))) => {
                made.dropped.push(name.clone());
                made.held.push((before, path));
            }
            Ok(None) => {}
            Err(error) => {
                made.undo(&mut store.index);
                return Err(error);
            }
        }
    }
    Ok(made)
}

/// Rewrite the held blob `name` with a file onto the write key of `keys`,
/// into `held/` under `new_id`, with its record, and flush it. Its entry in
/// the index names the new blob; returns the entry as it was and the new
/// blob's path. `None` when its blob does not open at all: nothing can be
/// copied, and its chunks get no key when the change finishes.
fn convert_held(
    store: &mut ClosedStore,
    keys: &Keyring,
    name: &str,
    new_id: &str,
    on_chunk: &dyn Fn(u64) -> Result<()>,
) -> Result<Option<(HeldBlob, std::path::PathBuf)>> {
    let held = held_dir(&store.store_dir());
    let Some(at) = store.index.held.iter().position(|entry| entry.name == name) else {
        return Ok(None);
    };
    let before = store.index.held[at].clone();
    let Some(node) = before.file.as_ref() else {
        return Ok(None);
    };
    let copy = match convert_held_blob(
        held.join(name),
        held.join(held_name(new_id)),
        new_id,
        keys,
        node,
        on_chunk,
    ) {
        Ok(copy) => copy,
        Err(UprivError::VaultFileUnreadable { .. }) => return Ok(None),
        Err(error) => return Err(error),
    };
    let save = store.index.saves.saturating_add(1);
    let flushed = append_record(&copy.path, keys, &copy.node, save, None)
        .and_then(|()| flush_made_blob(&copy.path));
    if let Err(error) = flushed {
        let _ = crate::host_fs::remove_file(&copy.path);
        return Err(error);
    }
    let size = crate::host_fs::metadata(&copy.path)
        .map(|meta| meta.len())
        .unwrap_or(before.size);
    let mut file = copy.node;
    file.problem = copy.problem.or(node.problem);
    store.index.held[at] = HeldBlob {
        name: held_name(new_id),
        size,
        held_at: before.held_at,
        file: Some(file),
    };
    Ok(Some((before, copy.path)))
}

/// A header with a pending password change, settled by an open or a rebuild.
pub(crate) enum SettledPending {
    /// The change settled forward or was cancelled: the header and the index
    /// opened together, and the vault goes on as a steady one.
    Settled(Box<ClosedStore>),
    /// The new password opened `change`, and no index opened: the rebuild
    /// settles the header with the tree it builds (`vault_index_unreadable`
    /// for every other caller). The header still holds `change`.
    IndexLost(Box<crate::store::OpenedHeader>),
}

/// Settle a pending password change at an open or a rebuild:
///
/// - The new password opened `change`: the header becomes `change`'s unlock
///   settings, keys, and `since`, in a new generation with no `change`, and
///   the index is sealed under that block's pair with the pass due. The vault
///   holds keys below `since` until Finish, or another change, rewrites their
///   files.
/// - The old password opened the top block, and the index opened with it
///   with no file found missing for the first time: no batch was converted,
///   so the change is cancelled as a stop cancels it.
/// - Otherwise the old password cannot settle it:
///   [`UprivError::PasswordChangeInterrupted`], and the new one is asked for.
pub(crate) fn settle_pending(
    vault_dir: &Path,
    vault_id: &str,
    pending: PendingChange,
) -> Result<SettledPending> {
    let store_dir = vault_dir.join(crate::paths::STORE_DIR_NAME);
    let PendingChange {
        header,
        side,
        keys,
        kek,
        index,
    } = pending;
    let generation = next_generation(&store_dir, &header)?;
    match (side, index) {
        (PendingSide::Change, None) => Ok(SettledPending::IndexLost(Box::new(
            crate::store::OpenedHeader { header, keys, kek },
        ))),
        (PendingSide::Change, Some(index)) => {
            let settled = keys
                .draft()
                .seal(generation, keys.block().kdf.clone(), &kek)?;
            let mut store = ClosedStore {
                vault_dir: vault_dir.to_path_buf(),
                vault_id: vault_id.to_string(),
                header,
                keys,
                kek: kek.clone(),
                index,
                settled: false,
            };
            store.commit(settled, kek, CommitRecord::Rewritten)?;
            record_password_changed(vault_dir, vault_id);
            log_event(
                LogLevel::Warn,
                "vault_password_change_settled",
                &[("id", vault_id)],
            );
            Ok(SettledPending::Settled(Box::new(store)))
        }
        (PendingSide::Top, Some(index)) if !newly_missing(&store_dir, &index) => {
            let top = keys.clone();
            let mut store = ClosedStore {
                vault_dir: vault_dir.to_path_buf(),
                vault_id: vault_id.to_string(),
                header,
                keys,
                kek,
                index,
                settled: false,
            };
            // The attempt's key sealed nothing this index names.
            stop_change(&mut store, &top, false)?;
            log_event(
                LogLevel::Warn,
                "vault_password_change_cancelled",
                &[("id", vault_id)],
            );
            Ok(SettledPending::Settled(Box::new(store)))
        }
        (PendingSide::Top, _) => Err(UprivError::PasswordChangeInterrupted),
    }
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::collections::BTreeMap;
    use std::path::PathBuf;
    use std::rc::Rc;

    use super::*;
    use crate::host_fs::HostFsQuery;
    use crate::session::cancel_job;
    use crate::store::{
        open_store, read_key_copy, read_prefix, FileProblem, KdfUnlockPreset, CHUNK_SIZE,
    };
    use crate::test_support::{copy_dir, dir_bytes, quiet_config, test_job_id, vault_root_with};
    use crate::vault::{
        close_vault, create_vault, fs_held_list, fs_read_file, fs_write_file, list_backups,
        open_vault,
    };

    const OLD: &[u8] = b"pass-word-ok";
    const NEW: &[u8] = b"next-pass-ok";

    /// Files of every shape a change meets: small, one of two chunks, empty.
    fn sample_files() -> Vec<(String, Vec<u8>)> {
        let wide: Vec<u8> = (0..CHUNK_SIZE as usize + 100).map(|n| n as u8).collect();
        vec![
            ("a.txt".into(), b"first".to_vec()),
            ("docs/b.bin".into(), wide),
            ("docs/c.txt".into(), b"third".to_vec()),
            ("empty.txt".into(), Vec::new()),
        ]
    }

    /// A data folder with the closed vault `notes` holding `files`, under
    /// [`OLD`]. Its closes write no backup.
    fn notes_with(files: &[(String, Vec<u8>)]) -> (tempfile::TempDir, VaultRoot) {
        let (tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            quiet_config("notes", "Notes"),
            OLD,
            KdfUnlockPreset::M32,
        )
        .unwrap();
        open_vault(&root, "notes", OLD).unwrap();
        for (path, body) in files {
            if let Some((folder, _)) = path.rsplit_once('/') {
                let _ = crate::vault::fs_mkdir(&root, "notes", &format!("/{folder}"));
            }
            fs_write_file(&root, "notes", &format!("/{path}"), body).unwrap();
        }
        close_vault(&root, "notes").unwrap();
        (tmp, root)
    }

    fn store_of(root: &VaultRoot) -> PathBuf {
        root.vault_store_dir("notes").unwrap()
    }

    fn change(root: &VaultRoot, back_up_first: bool) -> Result<PasswordChangeResult> {
        change_vault_password(root, "notes", OLD, NEW, back_up_first, &test_job_id())
    }

    /// Open `notes` with `password`, check every one of `files` reads whole,
    /// and close it.
    fn reads_whole(root: &VaultRoot, password: &[u8], files: &[(String, Vec<u8>)]) {
        open_vault(root, "notes", password).unwrap();
        for (path, body) in files {
            assert_eq!(
                &fs_read_file(root, "notes", &format!("/{path}")).unwrap(),
                body,
                "{path}"
            );
        }
        close_vault(root, "notes").unwrap();
    }

    /// The blob files of the vault's `data/` and `held/`.
    fn blobs(root: &VaultRoot) -> Vec<PathBuf> {
        let store = store_of(root);
        let mut found: Vec<PathBuf> = crate::store::list_blobs(&store)
            .unwrap()
            .into_iter()
            .map(|(path, _)| path)
            .collect();
        found.extend(crate::store::held_blob_paths(&store));
        found
    }

    #[test]
    fn a_change_rewrites_every_file_onto_one_new_key() {
        let files = sample_files();
        let (_tmp, root) = notes_with(&files);
        let before = open_store(store_of(&root), OLD).unwrap();
        let old_blobs = blobs(&root);
        let old_key = before.keys.write_id();
        drop(before);

        let result = change(&root, false).unwrap();
        assert_eq!(result.key_copies, KeyCopies::Done);
        assert_eq!(result.unreadable, 0);
        assert_eq!(result.backup_skipped, Some(BackupSkip::Off));

        let after = open_store(store_of(&root), NEW).unwrap();
        let ids: Vec<KeyId> = after.keys.ids().collect();
        assert_eq!(ids.len(), 1);
        assert_ne!(ids[0], old_key);
        for node in after.index.nodes() {
            if let Some(keys) = node.chunk_keys() {
                assert!(keys.iter().all(|key| *key == ids[0]), "{}", node.path);
            }
        }
        // Every blob is new, and its key copy is the final header's.
        let now = blobs(&root);
        assert!(now.iter().all(|blob| !old_blobs.contains(blob)));
        for blob in &now {
            assert_eq!(
                read_prefix(blob).unwrap().generation,
                after.header.top.generation
            );
        }
        assert!(matches!(
            open_store(store_of(&root), OLD),
            Err(UprivError::WrongPassword)
        ));
        drop(after);
        reads_whole(&root, NEW, &files);
        let config = crate::config::load_vault_config(root.vault_dir("notes").unwrap()).unwrap();
        assert!(config.security.password_changed_at.is_some());
    }

    #[test]
    fn the_same_password_is_refused_before_any_unlock() {
        let (_tmp, root) = notes_with(&[]);
        let before = dir_bytes(&store_of(&root));
        assert!(matches!(
            change_vault_password(&root, "notes", OLD, OLD, true, &test_job_id()),
            Err(UprivError::PasswordUnchanged)
        ));
        assert_eq!(dir_bytes(&store_of(&root)), before);
    }

    #[test]
    fn a_stop_before_the_header_is_written_changes_nothing() {
        let files = sample_files();
        let (_tmp, root) = notes_with(&files);
        let before = dir_bytes(&store_of(&root));
        let job = test_job_id();
        cancel_job(&job).unwrap();
        assert!(matches!(
            change_vault_password(&root, "notes", OLD, NEW, true, &job),
            Err(UprivError::JobCancelled)
        ));
        assert_eq!(dir_bytes(&store_of(&root)), before);
        reads_whole(&root, OLD, &files);
    }

    /// Calls of the write observer up to the end of the first batch's seal
    /// under `change`, one file a batch: each write is seen before and after
    /// it, and the header with `change`, the seal that releases the first
    /// batch, and that batch's seal are three writes each (two files and the
    /// store's hash).
    const FIRST_BATCH_SEALED: usize = 18;
    /// Calls up to the end of the second batch's seal.
    const SECOND_BATCH_SEALED: usize = FIRST_BATCH_SEALED + 6;
    /// Calls up to the header with `change` in both files, before its hash
    /// is recorded: no batch is released yet.
    const CHANGE_WRITTEN: usize = 5;

    /// Run the change of `notes`, stopping it at the `stop_at`-th call of the
    /// write observer. Returns the change's answer, and a copy of the store
    /// at that call.
    fn change_stopped_at(
        root: &VaultRoot,
        stop_at: usize,
    ) -> (Result<PasswordChangeResult>, PathBuf) {
        let job = test_job_id();
        let seen = Rc::new(RefCell::new(0usize));
        let during = root.root().join(format!("during-{job}"));
        {
            let (seen, during, job) = (Rc::clone(&seen), during.clone(), job.clone());
            let store = store_of(root);
            crate::paths::observe_atomic_writes(Some(Box::new(move || {
                *seen.borrow_mut() += 1;
                if *seen.borrow() == stop_at {
                    if !during.host_exists() {
                        copy_dir(&store, &during);
                    }
                    let _ = cancel_job(&job);
                }
            })));
        }
        let changed = change_vault_password(root, "notes", OLD, NEW, false, &job);
        crate::paths::observe_atomic_writes(None);
        (changed, during)
    }

    #[test]
    fn a_stop_keeps_the_old_password_and_takes_a_fresh_write_key() {
        let files = sample_files();
        let (_tmp, root) = notes_with(&files);
        TEST_BATCH_BYTES.with(|bytes| bytes.set(1));
        let (changed, during) = change_stopped_at(&root, FIRST_BATCH_SEALED);
        TEST_BATCH_BYTES.with(|bytes| bytes.set(BATCH_BYTES));
        assert!(matches!(changed, Err(UprivError::JobCancelled)));

        let after = open_store(store_of(&root), OLD).unwrap();
        assert!(after.header.change.is_none());
        let write = after.keys.write_id();
        assert!(matches!(
            open_store(store_of(&root), NEW),
            Err(UprivError::WrongPassword)
        ));
        drop(after);
        reads_whole(&root, OLD, &files);

        // A copy taken during the change holds the attempt's keys under the
        // new password: the write key after the stop is not among them.
        let header = crate::store::load_header(&during).unwrap();
        let change = header.change.expect("the copy is pending");
        let kek = change.kdf.derive_kek(NEW).unwrap();
        let attempt = Keyring::open(header.content_identity, &change, &kek).unwrap();
        assert!(!attempt.contains(write));

        // A file saved after the stop is on the fresh key.
        open_vault(&root, "notes", OLD).unwrap();
        fs_write_file(&root, "notes", "/after.txt", b"after the stop").unwrap();
        close_vault(&root, "notes").unwrap();
        let reopened = open_store(store_of(&root), OLD).unwrap();
        let keys = reopened
            .index
            .find("after.txt")
            .unwrap()
            .chunk_keys()
            .unwrap();
        assert_eq!(keys, [write]);
        assert!(!attempt.contains(keys[0]));
    }

    #[test]
    fn the_backup_at_the_start_is_a_save_that_stays() {
        let files = sample_files();
        let (_tmp, root) = notes_with(&files);
        let result = change(&root, true).unwrap();
        let name = result.backup.clone().expect("a backup with room for it");
        assert_eq!(result.backup_skipped, None);
        let saved: Vec<_> = list_backups(&root, "notes")
            .unwrap()
            .into_iter()
            .filter(|entry| entry.saved)
            .collect();
        assert_eq!(saved.len(), 1);
        assert_eq!(saved[0].file_name, name);
        // It holds the vault as it was, under the old password.
        let zip = crate::vault::backup_zip_file(&root, "notes", &saved[0].key).unwrap();
        assert!(zip.host_is_file());
        reads_whole(&root, NEW, &files);
    }

    #[test]
    fn with_the_switch_off_no_backup_is_written() {
        let (_tmp, root) = notes_with(&sample_files());
        let result = change(&root, false).unwrap();
        assert_eq!(result.backup, None);
        assert_eq!(result.backup_skipped, Some(BackupSkip::Off));
        assert!(list_backups(&root, "notes").unwrap().is_empty());
    }

    #[test]
    fn unreadable_parts_are_carried_with_no_key_and_the_files_stay_marked() {
        let files = sample_files();
        let (_tmp, root) = notes_with(&files);
        let before = open_store(store_of(&root), OLD).unwrap();
        let blob_of = |path: &str| {
            let (id, _, _) = before.index.find(path).unwrap().as_file().unwrap();
            crate::store::blob_path(store_of(&root), id).unwrap()
        };
        // The second chunk of the wide file fails its tag.
        let wide = blob_of("docs/b.bin");
        let second = before
            .index
            .find("docs/b.bin")
            .unwrap()
            .chunk_offsets()
            .unwrap()[1];
        let mut bytes = crate::host_fs::read(&wide).unwrap();
        bytes[second as usize + 30] ^= 0x01;
        crate::host_fs::write(&wide, &bytes).unwrap();
        let damaged_chunk = bytes[second as usize..second as usize + 100 + 40].to_vec();
        // The blob of `c.txt` is gone.
        crate::host_fs::remove_file(blob_of("docs/c.txt")).unwrap();
        drop(before);

        let result = change(&root, false).unwrap();
        assert_eq!(result.unreadable, 2);
        let after = open_store(store_of(&root), NEW).unwrap();
        let write = after.keys.write_id();
        let node = after.index.find("docs/b.bin").unwrap();
        assert_eq!(node.chunk_keys().unwrap(), [write, KeyId::NONE]);
        assert_eq!(node.problem, Some(FileProblem::Damaged));
        let (id, _, _) = node.as_file().unwrap();
        let copied =
            crate::host_fs::read(crate::store::blob_path(store_of(&root), id).unwrap()).unwrap();
        let at = node.chunk_offsets().unwrap()[1] as usize;
        assert_eq!(
            &copied[at..at + damaged_chunk.len()],
            damaged_chunk.as_slice()
        );
        let gone = after.index.find("docs/c.txt").unwrap();
        assert_eq!(gone.chunk_keys().unwrap(), [KeyId::NONE]);
        assert_eq!(gone.problem, Some(FileProblem::Missing));
        // The header holds one key whatever the vault held.
        assert_eq!(after.keys.ids().count(), 1);
    }

    #[test]
    fn after_a_finished_change_no_earlier_key_is_in_the_vault() {
        let files = sample_files();
        let (_tmp, root) = notes_with(&files);
        let old_header = crate::store::load_header(store_of(&root)).unwrap();
        let old_kek = old_header.top.kdf.derive_kek(OLD).unwrap();
        let old = Keyring::open(old_header.content_identity, &old_header.top, &old_kek).unwrap();
        change(&root, false).unwrap();
        let now = open_store(store_of(&root), NEW).unwrap();
        assert!(old.ids().all(|id| !now.keys.contains(id)));
        // The old password opens none of the vault's key copies, and each is
        // the header's.
        for blob in blobs(&root) {
            let copy = read_key_copy(&blob).unwrap();
            assert!(copy.open(&old_kek).is_err());
            assert_eq!(copy.prefix.generation, now.header.top.generation);
        }
    }

    /// Stop changes after a sealed batch until the header holds `keys`: each
    /// stop adds the attempt's key and a fresh one.
    fn stop_until_keys(root: &VaultRoot, keys: usize) {
        TEST_BATCH_BYTES.with(|bytes| bytes.set(1));
        for _ in 0..MAX_KEYS {
            if open_store(store_of(root), OLD).unwrap().keys.ids().count() >= keys {
                TEST_BATCH_BYTES.with(|bytes| bytes.set(BATCH_BYTES));
                return;
            }
            let (changed, _) = change_stopped_at(root, FIRST_BATCH_SEALED);
            assert!(matches!(changed, Err(UprivError::JobCancelled)));
        }
        panic!("the header never held {keys} keys");
    }

    /// Every one of `files` reads whole from the store under `password`,
    /// with no session: an open would drop the keys nothing uses.
    fn store_reads_whole(root: &VaultRoot, password: &[u8], files: &[(String, Vec<u8>)]) {
        let opened = open_store(store_of(root), password).unwrap();
        for (path, body) in files {
            let read =
                crate::store::read_logical_file(store_of(root), &opened.keys, &opened.index, path)
                    .unwrap();
            assert_eq!(&read, body, "{path}");
        }
    }

    #[test]
    fn keys_are_freed_down_to_six_and_never_the_write_key() {
        let files = sample_files();
        let (_tmp, root) = notes_with(&files);
        stop_until_keys(&root, KEYS_AT_START + 1);
        let vault_dir = root.vault_dir("notes").unwrap();
        let mut store = with_unlock_lock(|| {
            unlock_counted(&vault_dir, OLD, |unlocked| {
                steady(&vault_dir, "notes", unlocked)
            })
        })
        .unwrap();
        store.settle().unwrap();
        let write = store.keys.write_id();
        let reserve = space_needed(&store).unwrap();
        free_keys(&mut store, reserve, &Job::untracked()).unwrap();
        assert_eq!(store.keys.ids().count(), KEYS_AT_START);
        assert_eq!(store.keys.write_id(), write);
        drop(store);
        store_reads_whole(&root, OLD, &files);

        // A stop then fills the header to its limit, and a change still runs.
        stop_until_keys(&root, MAX_KEYS);
        assert_eq!(
            open_store(store_of(&root), OLD).unwrap().keys.ids().count(),
            MAX_KEYS
        );
        change(&root, false).unwrap();
        assert_eq!(
            open_store(store_of(&root), NEW).unwrap().keys.ids().count(),
            1
        );
        reads_whole(&root, NEW, &files);
    }

    #[test]
    fn finish_rewrites_what_a_settled_change_left_and_the_open_drops_unused_keys() {
        let files = sample_files();
        let (_tmp, root) = notes_with(&files);
        TEST_BATCH_BYTES.with(|bytes| bytes.set(1));
        // A crash right after the first batch: the copy taken there.
        let (_, during) = change_stopped_at(&root, FIRST_BATCH_SEALED);
        TEST_BATCH_BYTES.with(|bytes| bytes.set(BATCH_BYTES));
        let store = store_of(&root);
        crate::host_fs::remove_dir_all(&store).unwrap();
        copy_dir(&during, &store);
        let listed = |root: &VaultRoot| crate::vault::vault_list_item(root, "notes").unwrap();
        assert_eq!(listed(&root).session, Some("recovery"));

        // The new password settles it forward: unfinished.
        reads_whole(&root, NEW, &files);
        assert_eq!(
            listed(&root).password_change,
            crate::store::PasswordChangeState::Unfinished
        );
        let result = finish_password_change(&root, "notes", NEW, &test_job_id()).unwrap();
        assert_eq!(result.key_copies, KeyCopies::Done);
        let after = open_store(&store, NEW).unwrap();
        assert!(!after.keys.holds_key_below_since());
        assert_eq!(after.keys.ids().count(), 1);
        drop(after);
        assert_eq!(
            listed(&root).password_change,
            crate::store::PasswordChangeState::None
        );
        reads_whole(&root, NEW, &files);
    }

    #[test]
    fn a_pending_change_settles_with_the_new_password_and_cancels_with_the_old_before_a_batch() {
        let files = sample_files();
        let (_tmp, root) = notes_with(&files);
        let store = store_of(&root);
        let pristine = root.root().join("pristine");
        copy_dir(&store, &pristine);
        TEST_BATCH_BYTES.with(|bytes| bytes.set(1));
        let (_, header_only) = change_stopped_at(&root, CHANGE_WRITTEN);
        crate::host_fs::remove_dir_all(&store).unwrap();
        copy_dir(&pristine, &store);
        let (_, batch_sealed) = change_stopped_at(&root, FIRST_BATCH_SEALED);
        TEST_BATCH_BYTES.with(|bytes| bytes.set(BATCH_BYTES));

        let put = |copy: &Path| {
            crate::host_fs::remove_dir_all(&store).unwrap();
            copy_dir(copy, &store);
        };
        put(&header_only);
        assert!(change_pending(&root.vault_dir("notes").unwrap()));
        // No batch converted: the old password cancels the change.
        reads_whole(&root, OLD, &files);
        assert!(!change_pending(&root.vault_dir("notes").unwrap()));

        put(&batch_sealed);
        let written = dir_bytes(&store);
        assert!(matches!(
            open_vault(&root, "notes", OLD),
            Err(UprivError::PasswordChangeInterrupted)
        ));
        assert_eq!(
            dir_bytes(&store),
            written,
            "a refused password writes nothing"
        );
        reads_whole(&root, NEW, &files);
    }

    #[test]
    fn an_old_index_put_back_after_a_batch_sets_the_converted_blobs_aside() {
        let files = sample_files();
        let (_tmp, root) = notes_with(&files);
        let store = store_of(&root);
        let index_dir = store.join(crate::store::INDEX_DIR_NAME);
        let old_index = dir_bytes(&index_dir);
        TEST_BATCH_BYTES.with(|bytes| bytes.set(1));
        // The first batch is the vault's seed file, the second `a.txt`.
        let (_, batch_sealed) = change_stopped_at(&root, SECOND_BATCH_SEALED);
        TEST_BATCH_BYTES.with(|bytes| bytes.set(BATCH_BYTES));
        crate::host_fs::remove_dir_all(&store).unwrap();
        copy_dir(&batch_sealed, &store);
        let file_name = |path: &PathBuf| path.file_name().unwrap().to_string_lossy().into_owned();
        // The seed's blob holds a file of the app, which goes when it is set
        // aside; every other blob of the vault stays.
        let Ok(crate::store::Unlock::Pending(pending)) = crate::store::unlock(&store, NEW) else {
            panic!("the copy is pending");
        };
        let seed = pending
            .index
            .unwrap()
            .find(crate::store::SEED_LOGICAL_PATH)
            .and_then(|node| node.as_file().map(|(id, _, _)| id.to_string()))
            .unwrap();
        let kept: Vec<String> = blobs(&root)
            .iter()
            .map(file_name)
            .filter(|name| !name.starts_with(&seed))
            .collect();
        for (name, bytes) in &old_index {
            crate::host_fs::write(index_dir.join(name), bytes).unwrap();
        }

        let written = dir_bytes(&store);
        assert!(matches!(
            open_vault(&root, "notes", OLD),
            Err(UprivError::PasswordChangeInterrupted)
        ));
        assert_eq!(dir_bytes(&store), written);
        open_vault(&root, "notes", NEW).unwrap();
        let held = fs_held_list(&root, "notes").unwrap();
        assert!(held
            .iter()
            .any(|item| item.file.as_ref().is_some_and(|file| file.path == "/a.txt")));
        close_vault(&root, "notes").unwrap();
        // Nothing of the vault was deleted: each blob is in `data/` or `held/`.
        let now: Vec<String> = blobs(&root).iter().map(file_name).collect();
        for name in &kept {
            let id = name.trim_end_matches(".blob");
            assert!(now.iter().any(|now| now.starts_with(id)), "{name}");
        }
    }

    /// A copy of the vault folder at each call of the write observer while
    /// `work` runs, once per distinct state. `on_call` is told the number of
    /// each call after its copy.
    fn copies_at_every_write(
        root: &VaultRoot,
        into: &Path,
        mut on_call: impl FnMut(usize) + 'static,
        work: impl FnOnce(),
    ) -> Vec<PathBuf> {
        let copies = Rc::new(RefCell::new(Vec::<PathBuf>::new()));
        let seen = Rc::new(RefCell::new(Vec::<BTreeMap<PathBuf, Vec<u8>>>::new()));
        {
            let (copies, seen, into) = (Rc::clone(&copies), Rc::clone(&seen), into.to_path_buf());
            let vault = root.vault_dir("notes").unwrap();
            let mut calls = 0;
            crate::paths::observe_atomic_writes(Some(Box::new(move || {
                calls += 1;
                copy_if_new(&vault, &into, &seen, &copies);
                on_call(calls);
            })));
        }
        work();
        crate::paths::observe_atomic_writes(None);
        Rc::try_unwrap(copies).unwrap().into_inner()
    }

    /// Copy `vault` into `into` when its files are in no state seen before.
    fn copy_if_new(
        vault: &Path,
        into: &Path,
        seen: &RefCell<Vec<BTreeMap<PathBuf, Vec<u8>>>>,
        copies: &RefCell<Vec<PathBuf>>,
    ) {
        let state = dir_bytes(vault);
        if seen.borrow().contains(&state) {
            return;
        }
        let copy = into.join(seen.borrow().len().to_string());
        copy_dir(vault, &copy);
        seen.borrow_mut().push(state);
        copies.borrow_mut().push(copy);
    }

    /// Each password, on a fresh copy of `copy`, opens the vault and reads
    /// every file, or is refused having written nothing; one opens at least.
    fn one_password_opens_whole(copy: &Path, files: &[(String, Vec<u8>)]) {
        let mut opened = 0;
        for password in [OLD, NEW] {
            let (_tmp, root) = vault_root_with(&[]);
            let vault = root.vault_dir("notes").unwrap();
            copy_dir(copy, &vault);
            let store = vault.join(crate::paths::STORE_DIR_NAME);
            let before = dir_bytes(&store);
            match open_vault(&root, "notes", password) {
                Ok(_) => {
                    for (path, body) in files {
                        assert_eq!(
                            &fs_read_file(&root, "notes", &format!("/{path}")).unwrap(),
                            body,
                            "{path} in {}",
                            copy.display()
                        );
                    }
                    close_vault(&root, "notes").unwrap();
                    opened += 1;
                }
                Err(error) => {
                    assert!(
                        crate::session::counts_as_failed_unlock(&error),
                        "{error:?} in {}",
                        copy.display()
                    );
                    assert_eq!(dir_bytes(&store), before, "{}", copy.display());
                }
            }
        }
        assert!(opened >= 1, "no password opens {}", copy.display());
    }

    /// The oracle of a crash: the vault folder copied aside at every write of
    /// a whole change, of a stop, and of the settle and the cancel an open
    /// makes of a pending change. On each copy each password, tried on a
    /// fresh copy of its own, opens and reads every file, or is refused
    /// having written nothing. At least one of the two opens.
    #[test]
    fn a_crash_at_every_write_leaves_one_password_that_opens_every_file() {
        let files = sample_files();
        let (tmp, root) = notes_with(&files);
        let pristine = tmp.path().join("pristine");
        copy_dir(&root.vault_dir("notes").unwrap(), &pristine);
        TEST_BATCH_BYTES.with(|bytes| bytes.set(1));

        let whole = copies_at_every_write(
            &root,
            &tmp.path().join("whole"),
            |_| {},
            || {
                change(&root, false).unwrap();
            },
        );
        let reset = || {
            let vault = root.vault_dir("notes").unwrap();
            crate::host_fs::remove_dir_all(&vault).unwrap();
            copy_dir(&pristine, &vault);
        };
        reset();
        let job = test_job_id();
        let stop = job.clone();
        let at_first_batch = move |call| {
            if call == FIRST_BATCH_SEALED {
                let _ = cancel_job(&stop);
            }
        };
        let stopped =
            copies_at_every_write(&root, &tmp.path().join("stopped"), at_first_batch, || {
                let changed = change_vault_password(&root, "notes", OLD, NEW, false, &job);
                assert!(matches!(changed, Err(UprivError::JobCancelled)));
            });
        TEST_BATCH_BYTES.with(|bytes| bytes.set(BATCH_BYTES));

        // The settle and the cancel of a pending vault, at every write.
        let pending: Vec<&PathBuf> = whole.iter().filter(|copy| change_pending(copy)).collect();
        let (first, last) = (pending[0].clone(), pending[pending.len() - 1].clone());
        let mut opened = Vec::new();
        for (copy, password, name) in [(&first, OLD, "cancel"), (&last, NEW, "settle")] {
            reset();
            let vault = root.vault_dir("notes").unwrap();
            crate::host_fs::remove_dir_all(&vault).unwrap();
            copy_dir(copy, &vault);
            opened.extend(copies_at_every_write(
                &root,
                &tmp.path().join(name),
                |_| {},
                || {
                    open_vault(&root, "notes", password).unwrap();
                    close_vault(&root, "notes").unwrap();
                },
            ));
        }

        for copy in whole.iter().chain(&stopped).chain(&opened) {
            one_password_opens_whole(copy, &files);
        }
        assert!(whole.len() > 10, "a change of several batches");
    }

    #[test]
    fn a_batch_holds_one_file_at_least_and_no_more_than_its_budget() {
        let mut index = VaultIndex::empty();
        for (at, size) in [10u64, 20, 30, 40].into_iter().enumerate() {
            let mut chunks = crate::store::ChunkList::with_capacity(1);
            chunks.push(
                crate::store::ChunkVersion::from_bytes([at as u8; 8]),
                KeyId::new(1),
                crate::store::KEY_COPY_LEN,
            );
            index.push(VaultNode::file(
                &format!("{at}.bin"),
                Uuid::new_v4().to_string(),
                size,
                chunks,
            ));
        }
        let mut plan = ConvertPlan::of(&index, |key| key == KeyId::new(1));
        assert_eq!(plan.total_bytes(), 100);
        let first = plan.next_batch(0).unwrap();
        assert_eq!(first.tree.len(), 1, "one file even with no room");
        let second = plan.next_batch(50).unwrap();
        assert_eq!(second.tree.len(), 2, "20 + 30 fit in 50, 40 does not");
        let third = plan.next_batch(1000).unwrap();
        assert_eq!(third.tree.len(), 1);
        assert!(plan.next_batch(1000).is_none());
        // Each new blob is released by its id before it exists.
        assert_eq!(
            second.reserved(),
            vec![second.tree[0].1.clone(), second.tree[1].1.clone()]
        );
    }

    /// RF-49: no file of the vault folder holds a file's plaintext at any
    /// write of a change.
    #[test]
    fn a_change_writes_no_plaintext() {
        let marker = b"plaintext-marker-that-must-never-reach-the-disk".to_vec();
        let files = vec![("secret.txt".to_string(), marker.clone())];
        let (tmp, root) = notes_with(&files);
        let copies = copies_at_every_write(
            &root,
            &tmp.path().join("copies"),
            |_| {},
            || {
                change(&root, true).unwrap();
            },
        );
        for copy in copies.iter().map(PathBuf::as_path).chain([tmp.path()]) {
            for (path, bytes) in dir_bytes(copy) {
                assert!(
                    !bytes.windows(marker.len()).any(|window| window == marker),
                    "{}",
                    path.display()
                );
            }
        }
    }

    /// A wrong password, an earlier one, and one that cannot settle a
    /// pending change each count once: five of them block the unlock.
    #[test]
    fn refused_passwords_each_count_once_for_the_unlock_limit() {
        let files = sample_files();
        let (_tmp, root) = notes_with(&files);
        let vault_dir = root.vault_dir("notes").unwrap();
        let store = store_of(&root);
        let pristine = root.root().join("pristine");
        copy_dir(&store, &pristine);
        TEST_BATCH_BYTES.with(|bytes| bytes.set(1));
        let (_, batch_sealed) = change_stopped_at(&root, FIRST_BATCH_SEALED);
        TEST_BATCH_BYTES.with(|bytes| bytes.set(BATCH_BYTES));
        // A header file from before a finished change: the old password
        // opens it, but the files are newer.
        let put = |copy: &Path| {
            crate::host_fs::remove_dir_all(&store).unwrap();
            copy_dir(copy, &store);
        };
        put(&pristine);
        let earlier = crate::host_fs::read(VaultHeader::path(&store)).unwrap();
        change(&root, false).unwrap();
        crate::host_fs::write(VaultHeader::path(&store), &earlier).unwrap();
        crate::host_fs::remove_file(VaultHeader::copy_path(&store)).unwrap();
        let outdated = root.root().join("outdated");
        copy_dir(&store, &outdated);
        crate::session::clear_throttle_key_for_tests(&vault_dir);

        let refused = |password: &[u8], expected: fn(&UprivError) -> bool| {
            let error = open_vault(&root, "notes", password).unwrap_err();
            assert!(expected(&error), "{error:?}");
        };
        put(&batch_sealed);
        refused(b"wrong-password", |e| {
            matches!(e, UprivError::WrongPassword)
        });
        refused(OLD, |e| matches!(e, UprivError::PasswordChangeInterrupted));
        refused(OLD, |e| matches!(e, UprivError::PasswordChangeInterrupted));
        put(&outdated);
        refused(OLD, |e| matches!(e, UprivError::PasswordOutdated));
        refused(OLD, |e| matches!(e, UprivError::PasswordOutdated));
        assert!(matches!(
            open_vault(&root, "notes", NEW),
            Err(UprivError::VaultUnlockBlocked { .. })
        ));
        crate::session::clear_throttle_key_for_tests(&vault_dir);
    }

    /// Times a password change of a 1 GiB vault: eight files of 128 MiB and
    /// 2,000 small ones. Run with `cargo test --release -p upriv-core
    /// password_change_cost_report -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn password_change_cost_report() {
        let (_tmp, root) = notes_with(&[]);
        open_vault(&root, "notes", OLD).unwrap();
        let piece: Vec<u8> = (0..4 * 1024 * 1024).map(|i| (i * 7 % 251) as u8).collect();
        for file in 0..8 {
            for at in 0..32u64 {
                let path = format!("/big{file}.bin");
                crate::vault::fs_write_range(
                    &root,
                    "notes",
                    &path,
                    at * piece.len() as u64,
                    &piece,
                )
                .unwrap();
            }
        }
        crate::vault::fs_mkdir(&root, "notes", "/small").unwrap();
        for at in 0..2000 {
            fs_write_file(&root, "notes", &format!("/small/{at}.txt"), &piece[..4096]).unwrap();
        }
        close_vault(&root, "notes").unwrap();
        let started = std::time::Instant::now();
        let result = change(&root, false).unwrap();
        eprintln!(
            "password change of 1 GiB: {:?} ({result:?})",
            started.elapsed()
        );
    }

    /// A blob whose key copy is behind the header, as a pass that has not
    /// ended leaves it, never reads as newer than the header.
    #[test]
    fn a_wrong_password_while_a_pass_is_due_is_a_wrong_password() {
        let files = sample_files();
        let (_tmp, root) = notes_with(&files);
        let earlier: Vec<(PathBuf, Vec<u8>)> = blobs(&root)
            .into_iter()
            .map(|blob| {
                let bytes = crate::host_fs::read(&blob).unwrap();
                (blob, bytes[..crate::store::KEY_COPY_LEN as usize].to_vec())
            })
            .collect();
        crate::vault::change_vault_kdf(&root, "notes", OLD, KdfUnlockPreset::M64, &test_job_id())
            .unwrap();
        for (blob, copy) in &earlier {
            let mut bytes = crate::host_fs::read(blob).unwrap();
            bytes[..copy.len()].copy_from_slice(copy);
            crate::host_fs::write(blob, &bytes).unwrap();
        }
        assert!(matches!(
            open_vault(&root, "notes", b"wrong-password"),
            Err(UprivError::WrongPassword)
        ));
        reads_whole(&root, OLD, &files);
    }

    /// A header file put back from an earlier time puts the row in recovery
    /// before any unlock; the changes record what they write, so they leave
    /// the row as it was.
    #[test]
    fn a_header_put_back_shows_as_recovery_and_a_change_leaves_the_row_as_it_was() {
        let files = sample_files();
        let (_tmp, root) = notes_with(&files);
        let store = store_of(&root);
        let session = |root: &VaultRoot| {
            crate::vault::vault_list_item(root, "notes")
                .unwrap()
                .session
        };
        let earlier = crate::host_fs::read(VaultHeader::copy_path(&store)).unwrap();
        change(&root, true).unwrap();
        assert_eq!(session(&root), None);
        crate::vault::change_vault_kdf(&root, "notes", NEW, KdfUnlockPreset::M64, &test_job_id())
            .unwrap();
        assert_eq!(session(&root), None);

        let current = crate::host_fs::read(VaultHeader::copy_path(&store)).unwrap();
        crate::host_fs::write(VaultHeader::copy_path(&store), &earlier).unwrap();
        assert_eq!(session(&root), Some("recovery"));
        crate::host_fs::write(VaultHeader::copy_path(&store), &current).unwrap();
        assert_eq!(session(&root), None);
    }
}
