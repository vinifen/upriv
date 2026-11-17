//! A closed vault's store, unlocked by a job that changes it with no session:
//! the password change and its Finish, the unlock-RAM change, and the
//! rebuild. The job holds the vault's directory lock, so no session opens
//! meanwhile.
//!
//! It seals as a session does: the blobs a seal drops are listed as released
//! in the index it writes, and deleted once that seal is flushed
//! ([`crate::store::delete_released`]). Every write of the header or index
//! records the store's hash in the same step, so the list never reads one as
//! a change outside Upriv.

use std::path::{Path, PathBuf};

use crate::error::{Result, UprivError};
use crate::host_fs::HostFsQuery;
use crate::logging::{log_event, LogLevel};
use crate::paths::VaultRoot;
use crate::runtime_state::refuse_if_held_elsewhere;
use crate::session::{
    check_unlock_allowed, counts_as_failed_unlock, ensure_vault_session_closed,
    is_vault_closing_at, is_vault_open_at, record_unlock_failure, record_unlock_success,
    with_vault_dir_lock, PreparingGuard,
};
use crate::store::{
    delete_released, flush_index_parts, settle_held, unlock, Kek, Keyring, Sealed, Unlock,
    VaultHeader, VaultIndex,
};

use super::header_commit::{commit_header, CommitRecord};

/// A closed vault's store whose header and index opened together.
pub(crate) struct ClosedStore {
    pub vault_dir: PathBuf,
    pub vault_id: String,
    pub header: VaultHeader,
    pub keys: Keyring,
    /// The KEK of `keys`' block: a header write under the same password and
    /// settings needs no derive. Wiped when it drops.
    pub kek: Kek,
    pub index: VaultIndex,
    /// `data/` and `held/` were matched with the tree ([`Self::settle`]), and
    /// no file was found missing for the first time: only then are released
    /// blobs deleted.
    pub settled: bool,
}

impl ClosedStore {
    pub(crate) fn store_dir(&self) -> PathBuf {
        self.vault_dir.join(crate::paths::STORE_DIR_NAME)
    }

    /// Match `data/` and `held/` with the tree, as an open does
    /// ([`settle_held`]), and seal what that changed. When the walk found a
    /// file missing for the first time, it set the released blobs aside and
    /// emptied the list, so what a later seal releases is safe to delete.
    pub(crate) fn settle(&mut self) -> Result<()> {
        let store = self.store_dir();
        let vault_dir = self.vault_dir.clone();
        let backup_zips = || super::backup::backup_zips_newest_first(&vault_dir);
        self.settled = true;
        if settle_held(&store, &self.keys, &mut self.index, &backup_zips) {
            self.seal(Vec::new())?;
        }
        Ok(())
    }

    /// [`Self::seal_under`] the store's own keys.
    pub(crate) fn seal(&mut self, dropped: Vec<String>) -> Result<Sealed> {
        let keys = self.keys.clone();
        self.seal_under(&keys, dropped)
    }

    /// Seal the tree under `keys`' pair, with `dropped` listed as released,
    /// and record the store's hash. A seal that flushed deletes what the
    /// released list holds, once the store is settled. An error takes
    /// `dropped` off the list again and leaves the previous index on disk.
    pub(crate) fn seal_under(&mut self, keys: &Keyring, dropped: Vec<String>) -> Result<Sealed> {
        let store = self.store_dir();
        let listed = self.index.list_released(dropped);
        let sealed = match flush_index_parts(&store, keys, &mut self.index) {
            Ok((_, sealed)) => sealed,
            Err(error) => {
                self.index.unlist_released(&listed);
                return Err(error);
            }
        };
        if sealed == Sealed::Flushed {
            self.index.clear_unsealed_holes();
            if self.settled {
                delete_released(&store, &mut self.index);
            }
        }
        self.record(CommitRecord::Hash);
        Ok(sealed)
    }

    /// Make `keys` the header's top block with the tree, through the
    /// four-write commit ([`commit_header`]), and record the store as
    /// `record` says. The index is sealed with `key_copies_due` on. The
    /// store then holds `keys` and `kek`.
    pub(crate) fn commit(&mut self, keys: Keyring, kek: Kek, record: CommitRecord) -> Result<()> {
        let (header, sealed) = commit_header(
            &self.vault_dir,
            &self.vault_id,
            &self.header,
            &keys,
            &mut self.index,
            record,
        )?;
        self.header = header;
        self.keys = keys;
        self.kek = kek;
        if sealed == Sealed::Flushed && self.settled {
            delete_released(&self.store_dir(), &mut self.index);
        }
        Ok(())
    }

    /// Record the store as a write left it ([`CommitRecord`]).
    pub(crate) fn record(&self, record: CommitRecord) {
        super::header_commit::record_commit(&self.vault_dir, &self.vault_id, record);
    }
}

/// Unlock the closed vault at `vault_dir` with `password` ([`unlock`]) and let
/// `decide` turn what it opened, or why it opened nothing, into the caller's
/// answer, under the unlock limit: an answer [`counts_as_failed_unlock`]
/// counts once, and any other clears the count. The caller holds the process
/// unlock gate.
pub(crate) fn unlock_counted<T>(
    vault_dir: &Path,
    password: &[u8],
    decide: impl FnOnce(Result<Unlock>) -> Result<T>,
) -> Result<T> {
    if password.is_empty() {
        return Err(UprivError::WrongPassword);
    }
    check_unlock_allowed(vault_dir)?;
    let store = vault_dir.join(crate::paths::STORE_DIR_NAME);
    let answer = decide(unlock(&store, password));
    match &answer {
        Ok(_) => record_unlock_success(vault_dir),
        Err(error) if counts_as_failed_unlock(error) => {
            let _ = record_unlock_failure(vault_dir);
        }
        Err(_) => {}
    }
    answer
}

/// A steady unlock of the vault `vault_id`, as a [`ClosedStore`]; a pending
/// password change is refused ([`UprivError::PasswordChangeInterrupted`]),
/// and a lost index is its error. The store's twin files a repair wrote are
/// recorded.
pub(crate) fn steady(
    vault_dir: &Path,
    vault_id: &str,
    unlocked: Result<Unlock>,
) -> Result<ClosedStore> {
    match unlocked? {
        Unlock::Steady(unlocked) => {
            let store = ClosedStore {
                vault_dir: vault_dir.to_path_buf(),
                vault_id: vault_id.to_string(),
                header: unlocked.header,
                keys: unlocked.keys,
                kek: unlocked.kek,
                index: unlocked.index,
                settled: false,
            };
            if unlocked.repaired {
                store.record(CommitRecord::Hash);
            }
            Ok(store)
        }
        Unlock::Pending(_) => Err(UprivError::PasswordChangeInterrupted),
        Unlock::IndexLost(lost) => Err(lost.why),
    }
}

/// Run `work` on the closed vault `vault_id` under its locks, after the
/// checks every change makes ([`lock_closed_vault`]), and with no password
/// change pending: only an open and a rebuild settle one.
pub(crate) fn with_closed_vault<T>(
    root: &VaultRoot,
    vault_id: &str,
    work: impl FnOnce(&Path) -> Result<T>,
) -> Result<T> {
    lock_closed_vault(root, vault_id, |vault_dir| {
        if change_pending(vault_dir) {
            return Err(UprivError::PasswordChangeInterrupted);
        }
        work(vault_dir)
    })
}

/// Run `work` on the closed vault `vault_id` under its locks: the vault
/// closed and not held by another app, no plain-text folder left, no delete
/// started.
pub(crate) fn lock_closed_vault<T>(
    root: &VaultRoot,
    vault_id: &str,
    work: impl FnOnce(&Path) -> Result<T>,
) -> Result<T> {
    let vault_dir = root.vault_dir(vault_id)?;
    if !vault_dir.host_is_dir() {
        return Err(UprivError::VaultNotFound(vault_dir));
    }
    ensure_vault_session_closed(&vault_dir)?;
    refuse_if_held_elsewhere(root, vault_id)?;
    let _preparing = PreparingGuard::enter_exclusive(&vault_dir)?;
    with_vault_dir_lock(&vault_dir, || {
        if is_vault_open_at(&vault_dir) || is_vault_closing_at(&vault_dir) {
            return Err(UprivError::VaultMustBeClosed);
        }
        super::plain::ensure_no_leftover(root, vault_id)?;
        super::delete::refuse_deleting(&vault_dir)?;
        work(&vault_dir)
    })
}

/// True when either header file of the store at `vault_dir` holds a pending
/// password change. Reads the header files only, so it needs no password.
pub(crate) fn change_pending(vault_dir: &Path) -> bool {
    let store = vault_dir.join(crate::paths::STORE_DIR_NAME);
    crate::store::read_header_files(&store).is_ok_and(|files| {
        files
            .iter()
            .flatten()
            .filter_map(|file| file.header.as_ref().ok())
            .any(|header| header.change.is_some())
    })
}

/// A flow on a closed vault ended a step with something left for later: log
/// it with the vault folder id and a fixed reason, never an error's text.
pub(crate) fn log_left(vault_id: &str, event: &str, reason: &'static str) {
    log_event(
        LogLevel::Warn,
        event,
        &[("id", vault_id), ("reason", reason)],
    );
}
