//! The four-write commit every header write that changes the top block goes
//! through: the finish and the stop of a password change, the settle and the
//! cancel of a pending one, the unlock-RAM change, the open's removal of keys
//! nothing uses, the key a change frees, and a header a rebuild brings back
//! from the key copies.
//!
//! The new header's keyring and its index are sealed together: the index under
//! the new block's pair, with `key_copies_due` on, since no key copy is the new
//! block's yet. The writes keep a window where one of the two headers opens an
//! index at every point:
//!
//! 1. Index copy. The old header still opens the primary index.
//! 2. Header primary. The old header in the copy still opens the primary
//!    index; the new one opens the index copy.
//! 3. Header copy. Only the new header is on disk.
//! 4. Index primary, so the two index files match without waiting for the
//!    next unlock to repair them.
//!
//! Once the files are in place the store's hash is recorded, so the list does
//! not read the write as a change outside Upriv.

use std::path::Path;

use crate::error::{Result, UprivError};
use crate::logging::{log_event, LogLevel};
use crate::store::{
    header_bytes, read_header_files, sealed_index_bytes, Keyring, Sealed, VaultHeader, VaultIndex,
    INDEX_COPY_FILE_NAME, INDEX_DIR_NAME, INDEX_FILE_NAME,
};

/// How far [`commit_files`] publishes the new header and index, in the order
/// of the writes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum HeaderCommitStep {
    /// New index in the copy slot. The primary index and both headers are old.
    IndexCopy,
    /// New header in the primary slot. The header copy is still the old one.
    HeaderPrimary,
    /// Both header files are the new one. The primary index is still old.
    HeaderCopy,
    /// Both header files and both index files are the new ones.
    IndexPrimary,
}

impl HeaderCommitStep {
    pub(crate) const ALL: [Self; 4] = [
        Self::IndexCopy,
        Self::HeaderPrimary,
        Self::HeaderCopy,
        Self::IndexPrimary,
    ];

    /// The step's name in the log.
    fn as_str(self) -> &'static str {
        match self {
            Self::IndexCopy => "index_copy",
            Self::HeaderPrimary => "header_primary",
            Self::HeaderCopy => "header_copy",
            Self::IndexPrimary => "index_primary",
        }
    }
}

/// A header and index sealed for the commit, before any is written.
pub(crate) struct SealedCommit {
    header: Vec<u8>,
    index: Vec<u8>,
}

/// Seal the header whose top block is `keys`' block, and `index` under its
/// pair with `key_copies_due` on. Nothing is written.
pub(crate) fn seal_commit(
    previous: &VaultHeader,
    keys: &Keyring,
    index: &mut VaultIndex,
) -> Result<(VaultHeader, SealedCommit)> {
    let header = VaultHeader {
        change: None,
        top: keys.block().clone(),
        ..previous.clone()
    };
    index.key_copies_due = true;
    index.saves = index.saves.saturating_add(1);
    let sealed = SealedCommit {
        header: header_bytes(&header)?,
        index: sealed_index_bytes(keys, index)?,
    };
    Ok((header, sealed))
}

/// Write `sealed` into `store`, step by step, through `through`
/// ([`HeaderCommitStep`]). The header primary is the commit: once it is in
/// place, its generation is the newest on disk, so the next unlock with the
/// new header's password picks it and repairs the other files from it. A
/// step before it that fails returns the error, and the old header still
/// opens the vault. A step after it that fails is logged and the commit
/// stands. A file in place whose folder did not flush counts as written.
pub(crate) fn commit_files(
    store: &Path,
    sealed: &SealedCommit,
    through: HeaderCommitStep,
) -> Result<Sealed> {
    let mut flushed = Sealed::Flushed;
    for step in HeaderCommitStep::ALL {
        let (path, bytes) = match step {
            HeaderCommitStep::IndexCopy => (
                store.join(INDEX_DIR_NAME).join(INDEX_COPY_FILE_NAME),
                &sealed.index,
            ),
            HeaderCommitStep::HeaderPrimary => (VaultHeader::path(store), &sealed.header),
            HeaderCommitStep::HeaderCopy => (VaultHeader::copy_path(store), &sealed.header),
            HeaderCommitStep::IndexPrimary => (
                store.join(INDEX_DIR_NAME).join(INDEX_FILE_NAME),
                &sealed.index,
            ),
        };
        match crate::paths::write_bytes_atomic_reporting(&path, bytes) {
            Ok(()) => {}
            Err(crate::paths::AtomicWriteError::Unflushed(_)) => {
                flushed = Sealed::Unflushed;
                log_step(store, "vault_header_commit_unflushed", step);
            }
            Err(crate::paths::AtomicWriteError::NotWritten(error)) => {
                if step <= HeaderCommitStep::HeaderPrimary {
                    return Err(error);
                }
                flushed = Sealed::Unflushed;
                log_step(store, "vault_header_commit_tail_failed", step);
            }
        }
        if step == through {
            break;
        }
    }
    Ok(flushed)
}

/// The generation the next header write of the store at `store` takes: one
/// above every generation either header file holds, `change`'s included, and
/// above `header`'s.
pub(crate) fn next_generation(store: &Path, header: &VaultHeader) -> Result<u32> {
    let on_disk = read_header_files(store)?
        .iter()
        .flatten()
        .filter_map(|file| file.header.as_ref().ok())
        .map(VaultHeader::newest_generation)
        .max()
        .unwrap_or(0);
    on_disk
        .max(header.newest_generation())
        .checked_add(1)
        .ok_or_else(|| UprivError::VaultStoreInvalid {
            path: VaultHeader::path(store),
            detail: "no generation is left".into(),
        })
}

/// How [`commit_header`] records the store once the files are in place.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CommitRecord {
    /// The vault's content and keys are the same: only the hash.
    Hash,
    /// The keys or the unlock settings changed: the hash, and every device's
    /// last backup is forgotten, so the next close writes a zip of the store
    /// as it is now.
    Rewritten,
}

/// Seal and write the header of `keys` with `index`, all four files
/// ([`commit_files`]), and record the store. Returns the header now on disk,
/// and whether every write flushed. An error leaves the old header opening
/// the vault. A record that cannot be written is logged.
pub(crate) fn commit_header(
    vault_dir: &Path,
    vault_id: &str,
    previous: &VaultHeader,
    keys: &Keyring,
    index: &mut VaultIndex,
    record: CommitRecord,
) -> Result<(VaultHeader, Sealed)> {
    let store = vault_dir.join(crate::paths::STORE_DIR_NAME);
    let (header, sealed) = seal_commit(previous, keys, index)?;
    let flushed = commit_files(&store, &sealed, HeaderCommitStep::IndexPrimary)?;
    record_commit(vault_dir, vault_id, record);
    Ok((header, flushed))
}

/// Record the store as a commit left it ([`CommitRecord`]).
pub(crate) fn record_commit(vault_dir: &Path, vault_id: &str, record: CommitRecord) {
    let recorded = match record {
        CommitRecord::Hash => super::persistence::record_store_hash(vault_dir, vault_id),
        CommitRecord::Rewritten => crate::config::load_vault_config(vault_dir).and_then(|config| {
            let hash =
                crate::store::content_hash_hex(vault_dir.join(crate::paths::STORE_DIR_NAME))?;
            super::persistence::record_store_rewritten(
                vault_dir,
                vault_id,
                &config.vault.display_name,
                &hash,
                None,
            )
        }),
    };
    if recorded.is_err() {
        // Fixed fields only: an error's text can hold a folder path.
        log_event(
            LogLevel::Warn,
            "vault_header_commit_record_failed",
            &[("id", vault_id)],
        );
    }
}

/// A commit write that did not fully reach the disk, with the vault folder id
/// and the step.
fn log_step(store: &Path, event: &str, step: HeaderCommitStep) {
    let id = store
        .parent()
        .and_then(|vault| vault.file_name())
        .and_then(|name| name.to_str())
        .unwrap_or("");
    log_event(
        LogLevel::Warn,
        event,
        &[("id", id), ("step", step.as_str())],
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::host_fs::HostFsQuery;
    use crate::store::{
        create_seeded_store, open_store, read_logical_file, HeaderKdf, KdfUnlockPreset,
        SEED_LOGICAL_PATH,
    };

    const OLD: &[u8] = b"pass-word-ok";

    fn copy_tree(src: &Path, dst: &Path) {
        crate::host_fs::create_dir_all(dst).unwrap();
        for entry in crate::host_fs::read_dir(src).unwrap() {
            let entry = entry.unwrap();
            let to = dst.join(entry.file_name());
            if entry.file_type().unwrap().host_is_dir() {
                copy_tree(&entry.path(), &to);
            } else {
                crate::host_fs::write(&to, crate::host_fs::read(entry.path()).unwrap()).unwrap();
            }
        }
    }

    /// At every step of the commit the store opens with the one password the
    /// header of that moment wants, and reads its files.
    #[test]
    fn every_step_of_the_commit_opens_and_reads() {
        let tmp = tempfile::tempdir().unwrap();
        let store = tmp.path().join("store");
        create_seeded_store(&store, OLD, KdfUnlockPreset::M32, &[]).unwrap();
        let mut opened = open_store(&store, OLD).unwrap();
        let kdf = HeaderKdf::fresh(KdfUnlockPreset::M64);
        let kek = kdf.derive_kek(OLD).unwrap();
        let next = opened
            .keys
            .draft()
            .seal(opened.header.newest_generation() + 1, kdf, &kek)
            .unwrap();
        let (_, sealed) = seal_commit(&opened.header, &next, &mut opened.index).unwrap();
        for through in HeaderCommitStep::ALL {
            let copy = tmp.path().join(through.as_str());
            copy_tree(&store, &copy);
            commit_files(&copy, &sealed, through).unwrap();
            let reopened = open_store(&copy, OLD).unwrap();
            let expected = if through == HeaderCommitStep::IndexCopy {
                KdfUnlockPreset::M32
            } else {
                KdfUnlockPreset::M64
            };
            // The header primary step: the copy's old block is older, so the
            // primary's new block decides and opens the index copy.
            assert_eq!(
                reopened.header.unlock_preset(),
                Some(expected),
                "{through:?}"
            );
            read_logical_file(&copy, &reopened.keys, &reopened.index, SEED_LOGICAL_PATH).unwrap();
        }
    }
}
