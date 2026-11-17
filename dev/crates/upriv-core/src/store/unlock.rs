//! The unlock: every caller opens a store through [`unlock`], with one rule.
//!
//! 1. Both header files are read. The typed password is tried on their
//!    blocks, newest generation first, one Argon2 derive per distinct salt
//!    and cost (the caller holds the unlock gate).
//! 2. For each block that opens, the index files are tried with the pairs
//!    that block may use: its own; for a `change` block, also its header's
//!    top block's, since the index stays under that pair until a password
//!    change seals its first batch. The first block that opens an index is
//!    the vault's header.
//! 3. A pending change is decided first: when the block that decides (the one
//!    that opened an index, or the newest that opened when none did) comes
//!    from a header file that holds `change`, the answer is
//!    [`Unlock::Pending`] and the password change settles it. Otherwise:
//!
//! | What the password opens | Answer | Written |
//! |---|---|---|
//! | A block and an index | [`Unlock::Steady`] | The other header and index files, when they differ |
//! | A block, no index, no sampled blob newer | `vault_index_unreadable` | Nothing |
//! | A block, no index, a sampled blob newer, whose key copy the password opens | `vault_header_unreadable` | Nothing |
//! | A block, no index, a sampled blob newer, the rest | `password_outdated` | Nothing |
//! | No block, no sampled blob newer than both header files | `wrong_password` | Nothing |
//! | No block and a newer sampled blob, or no header file reads | `vault_header_unreadable` | Nothing |
//!
//! Only a failed unlock samples: the first 72 bytes of up to
//! [`SAMPLED_BLOBS`] blobs of `data/` ([`super::key_copy`]). A sampled blob is
//! newer when it carries this vault's content identity and a generation above
//! the one compared. A pass that has not ended leaves key copies behind the
//! header, never above it, so it never reads as a newer blob. Nothing is
//! written before a header and an index open together.

use std::path::{Path, PathBuf};

use super::header::{read_header_files, HeaderBlock, HeaderKdf, HeaderSlot, VaultHeader};
use super::index::{load_index_files, IndexPair, LoadedIndex, VaultIndex, DATA_DIR_NAME};
use super::kdf::Kek;
use super::key_copy::{read_key_copy, read_prefix, KeyCopyPrefix};
use super::keys::Keyring;
use crate::error::{Result, UprivError};
use crate::paths;

/// Most blobs a failed unlock reads the key copy of.
pub(crate) const SAMPLED_BLOBS: usize = 4;

/// What the typed password opened.
pub(crate) enum Unlock {
    /// A header block and an index opened together.
    Steady(Unlocked),
    /// The vault's header holds a pending password change ([`PendingChange`]).
    Pending(PendingChange),
    /// A block of a steady header opened, no index did, and no sampled blob
    /// is newer: the index is lost (`vault_index_unreadable`).
    IndexLost(IndexLost),
}

/// A steady header block whose index files do not open.
pub(crate) struct IndexLost {
    pub header: VaultHeader,
    pub keys: Keyring,
    pub kek: Kek,
    /// Why the index files were refused: [`UprivError::VaultIndexUnreadable`].
    pub why: UprivError,
}

/// A header block and an index that opened together.
pub(crate) struct Unlocked {
    /// The header file the block came from.
    pub header: VaultHeader,
    pub keys: Keyring,
    /// The block's KEK, for a header write under the same password and
    /// settings. Wiped when it drops.
    pub kek: Kek,
    pub index: VaultIndex,
    /// The other header file or index file did not match and was written
    /// from this pair.
    pub repaired: bool,
}

/// Which block of a pending header the password opened.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PendingSide {
    /// The top block: the password from before the change.
    Top,
    /// `change`: the new password.
    Change,
}

/// A header that holds `change`, opened by one of its blocks.
pub(crate) struct PendingChange {
    /// The pending header.
    pub header: VaultHeader,
    pub side: PendingSide,
    /// The keys of the block that opened.
    pub keys: Keyring,
    pub kek: Kek,
    /// The index that opened with that block, when one did.
    pub index: Option<VaultIndex>,
}

/// One block of one header file, as the unlock tries it.
struct Candidate<'a> {
    slot: HeaderSlot,
    raw: &'a [u8],
    header: &'a VaultHeader,
    side: PendingSide,
    block: &'a HeaderBlock,
}

/// KEKs already derived for this unlock, by the settings they were derived
/// under, so blocks that share a salt and cost cost one derive.
struct Keks<'a> {
    password: &'a [u8],
    derived: Vec<(HeaderKdf, Kek)>,
}

impl Keks<'_> {
    /// The KEK of `kdf`. `None` when its settings cannot derive one; a lack of
    /// RAM fails the unlock.
    fn of(&mut self, kdf: &HeaderKdf) -> Result<Option<Kek>> {
        if let Some((_, kek)) = self.derived.iter().find(|(seen, _)| seen.same_lock(kdf)) {
            return Ok(Some(kek.clone()));
        }
        match kdf.derive_kek(self.password) {
            Ok(kek) => {
                self.derived.push((kdf.clone(), kek.clone()));
                Ok(Some(kek))
            }
            Err(UprivError::InsufficientRam) => Err(UprivError::InsufficientRam),
            Err(_) => Ok(None),
        }
    }
}

/// Unlock the store at `store_dir` with `password`, by the rule of the module
/// documentation. The caller holds the unlock gate and counts a failure for
/// the unlock limit.
pub(crate) fn unlock(store_dir: &Path, password: &[u8]) -> Result<Unlock> {
    let files = read_header_files(store_dir)?;
    let parsed: Vec<(HeaderSlot, &[u8], &VaultHeader)> = files
        .iter()
        .flatten()
        .filter_map(|file| {
            let header = file.header.as_ref().ok()?;
            Some((file.slot, file.raw.as_slice(), header))
        })
        .collect();
    if parsed.is_empty() {
        return Err(UprivError::VaultHeaderUnreadable);
    }
    let mut candidates: Vec<Candidate<'_>> = Vec::new();
    for (slot, raw, header) in &parsed {
        candidates.push(Candidate {
            slot: *slot,
            raw,
            header,
            side: PendingSide::Top,
            block: &header.top,
        });
        if let Some(change) = &header.change {
            candidates.push(Candidate {
                slot: *slot,
                raw,
                header,
                side: PendingSide::Change,
                block: change,
            });
        }
    }
    // Newest first; on a tie, a block of a pending header, so the change
    // decides; then the primary.
    candidates.sort_by_key(|candidate| {
        (
            std::cmp::Reverse(candidate.block.generation),
            candidate.header.change.is_none(),
            candidate.slot != HeaderSlot::Primary,
        )
    });
    let mut keks = Keks {
        password,
        derived: Vec::new(),
    };
    // The newest block that opened, with why no index opened under it.
    let mut newest_opened: Option<(usize, Keyring, Kek, UprivError)> = None;
    for (at, candidate) in candidates.iter().enumerate() {
        let Some(kek) = keks.of(&candidate.block.kdf)? else {
            continue;
        };
        let Ok(keys) = Keyring::open(candidate.header.content_identity, candidate.block, &kek)
        else {
            continue;
        };
        match open_index(store_dir, candidate, &keys) {
            Ok(loaded) => {
                if candidate.header.change.is_some() {
                    return Ok(Unlock::Pending(PendingChange {
                        header: candidate.header.clone(),
                        side: candidate.side,
                        keys,
                        kek,
                        index: Some(loaded.index),
                    }));
                }
                let repaired = repair_header_twin(store_dir, candidate, &parsed, &files)?
                    | loaded.repair_twin(store_dir)?;
                return Ok(Unlock::Steady(Unlocked {
                    header: candidate.header.clone(),
                    keys,
                    kek,
                    index: loaded.index,
                    repaired,
                }));
            }
            Err(error) => {
                if newest_opened.is_none() {
                    newest_opened = Some((at, keys, kek, error));
                }
            }
        }
    }
    let identity = parsed[0].2.content_identity;
    let Some((at, keys, kek, why)) = newest_opened else {
        let newest = parsed
            .iter()
            .map(|(_, _, header)| header.newest_generation())
            .max()
            .unwrap_or(0);
        return match sample_newer(store_dir, identity, newest) {
            Some(_) => Err(UprivError::VaultHeaderUnreadable),
            None => Err(UprivError::WrongPassword),
        };
    };
    let candidate = &candidates[at];
    if candidate.header.change.is_some() {
        return Ok(Unlock::Pending(PendingChange {
            header: candidate.header.clone(),
            side: candidate.side,
            keys,
            kek,
            index: None,
        }));
    }
    match sample_newer(store_dir, identity, candidate.block.generation) {
        None => Ok(Unlock::IndexLost(IndexLost {
            header: candidate.header.clone(),
            keys,
            kek,
            why,
        })),
        Some(newer) => {
            // The header is older than the files. When the password opens
            // their key copy it is the vault's current one, and the header
            // can come back from the key copies; otherwise it is an earlier
            // password of this vault.
            let opens = read_key_copy(&newer)
                .map(|copy| -> Result<bool> {
                    Ok(keks
                        .of(&copy.prefix.kdf)?
                        .is_some_and(|kek| copy.open(&kek).is_ok()))
                })
                .transpose()?
                .unwrap_or(false);
            Err(if opens {
                UprivError::VaultHeaderUnreadable
            } else {
                UprivError::PasswordOutdated
            })
        }
    }
}

/// The index files under the pairs `candidate` may use: its own, and for a
/// `change` block also its header's top block's.
fn open_index(store_dir: &Path, candidate: &Candidate<'_>, keys: &Keyring) -> Result<LoadedIndex> {
    let mut pairs = vec![IndexPair::of(keys)?];
    if candidate.side == PendingSide::Change {
        pairs.extend(IndexPair::of_block(keys, &candidate.header.top));
    }
    let held = |id: super::keys::KeyId| keys.contains(id);
    load_index_files(store_dir, &pairs, &held)
}

/// Write the other header file from the one `candidate` came from when its
/// bytes differ. True when it was written.
fn repair_header_twin(
    store_dir: &Path,
    candidate: &Candidate<'_>,
    parsed: &[(HeaderSlot, &[u8], &VaultHeader)],
    files: &[Option<super::header::HeaderFile>; 2],
) -> Result<bool> {
    let twin = match candidate.slot {
        HeaderSlot::Primary => HeaderSlot::Copy,
        HeaderSlot::Copy => HeaderSlot::Primary,
    };
    let twin_raw = files
        .iter()
        .flatten()
        .find(|file| file.slot == twin)
        .map(|file| file.raw.as_slice());
    if twin_raw == Some(candidate.raw) {
        return Ok(false);
    }
    debug_assert!(parsed.iter().any(|(slot, _, _)| *slot == candidate.slot));
    paths::write_bytes_atomic(&twin.path(store_dir), candidate.raw)?;
    log_store_event(store_dir, "vault_header_restored", twin.file_name());
    super::header::ensure_danger_notice(store_dir)?;
    Ok(true)
}

/// The newest of up to [`SAMPLED_BLOBS`] blobs of `data/` whose key copy is
/// this vault's and above `generation`, by its path.
fn sample_newer(store_dir: &Path, identity: uuid::Uuid, generation: u32) -> Option<PathBuf> {
    sample(store_dir)
        .into_iter()
        .filter(|(_, prefix)| prefix.identity == identity && prefix.generation > generation)
        .max_by_key(|(_, prefix)| prefix.generation)
        .map(|(path, _)| path)
}

/// The key copy prefixes of up to [`SAMPLED_BLOBS`] blobs of `data/`, each
/// with its path. A blob whose first bytes are no key copy is skipped.
pub(crate) fn sample(store_dir: &Path) -> Vec<(PathBuf, KeyCopyPrefix)> {
    let mut found = Vec::new();
    let Ok(shards) = crate::host_fs::read_dir(store_dir.join(DATA_DIR_NAME)) else {
        return found;
    };
    for shard in shards.flatten() {
        let Ok(blobs) = crate::host_fs::read_dir(shard.path()) else {
            continue;
        };
        for blob in blobs.flatten() {
            let path = blob.path();
            if super::chunk::blob_file_id(&path).is_none() {
                continue;
            }
            if let Some(prefix) = read_prefix(&path) {
                found.push((path, prefix));
                if found.len() == SAMPLED_BLOBS {
                    return found;
                }
            }
        }
    }
    found
}

/// Most groups of key copies, by salt and cost, a header restore tries the
/// password on.
const RESTORE_GROUPS: usize = 8;

/// A header with no index that opened under it: read back from the blobs'
/// key copies ([`restore_header`]), or a pending change's settled forward.
/// Its top block's keys, and the KEK that opened them.
pub(crate) struct OpenedHeader {
    pub header: VaultHeader,
    pub keys: Keyring,
    pub kek: Kek,
}

/// The key copy prefix of every blob of `data/` that carries one, with its
/// path. With `identity`, only that vault's.
fn key_copies(
    store_dir: &Path,
    identity: Option<uuid::Uuid>,
) -> Result<Vec<(PathBuf, KeyCopyPrefix)>> {
    Ok(super::record::list_blobs(store_dir)?
        .into_iter()
        .filter_map(|(path, _)| read_prefix(&path).map(|prefix| (path, prefix)))
        .filter(|(_, prefix)| identity.is_none_or(|identity| prefix.identity == identity))
        .collect())
}

/// The vault's content identity, as a header file that parses gives it.
fn header_identity(store_dir: &Path) -> Option<uuid::Uuid> {
    read_header_files(store_dir)
        .ok()?
        .iter()
        .flatten()
        .find_map(|file| {
            file.header
                .as_ref()
                .ok()
                .map(|header| header.content_identity)
        })
}

/// The newest key copy of a blob of this vault in `data/`, read in full: its
/// generation and path. Every blob is read, not a sample: a rebuild must not
/// seal a tree under a header older than one file.
pub(crate) fn newest_key_copy(
    store_dir: &Path,
    identity: uuid::Uuid,
) -> Result<Option<(u32, PathBuf)>> {
    Ok(key_copies(store_dir, Some(identity))?
        .into_iter()
        .max_by_key(|(_, prefix)| prefix.generation)
        .map(|(path, prefix)| (prefix.generation, path)))
}

/// True when `password` opens the key copy of the blob at `path`. A lack of
/// RAM fails.
pub(crate) fn key_copy_opens(path: &Path, password: &[u8]) -> Result<bool> {
    let Some(copy) = read_key_copy(path) else {
        return Ok(false);
    };
    let mut keks = Keks {
        password,
        derived: Vec::new(),
    };
    Ok(keks
        .of(&copy.prefix.kdf)?
        .is_some_and(|kek| copy.open(&kek).is_ok()))
}

/// Read the vault's header back from the key copies its blobs carry, for a
/// header that is lost or older than the files. The copies are grouped by
/// salt and cost, and `password` is tried on the newest copy of each group,
/// from the highest generation down, [`RESTORE_GROUPS`] at most: the first
/// that opens holds the newest unlock settings the password opens, so a
/// restore never lands on a cost the person replaced. The header takes a
/// generation above every blob's and every header file's. Nothing is
/// written. [`UprivError::WrongPassword`] when no group opens.
pub(crate) fn restore_header(store_dir: &Path, password: &[u8]) -> Result<OpenedHeader> {
    let copies = key_copies(store_dir, header_identity(store_dir))?;
    let mut groups: Vec<&(PathBuf, KeyCopyPrefix)> = Vec::new();
    for copy in &copies {
        let prefix = &copy.1;
        match groups
            .iter_mut()
            .find(|(_, seen)| seen.identity == prefix.identity && seen.kdf.same_lock(&prefix.kdf))
        {
            Some(group) if group.1.generation < prefix.generation => *group = copy,
            Some(_) => {}
            None => groups.push(copy),
        }
    }
    groups.sort_by_key(|(_, prefix)| std::cmp::Reverse(prefix.generation));
    let mut keks = Keks {
        password,
        derived: Vec::new(),
    };
    let on_disk = read_header_files(store_dir)?
        .iter()
        .flatten()
        .filter_map(|file| {
            file.header
                .as_ref()
                .ok()
                .map(VaultHeader::newest_generation)
        })
        .max()
        .unwrap_or(0);
    let newest = copies
        .iter()
        .map(|(_, prefix)| prefix.generation)
        .max()
        .unwrap_or(0)
        .max(on_disk);
    for (path, prefix) in groups.into_iter().take(RESTORE_GROUPS) {
        let Some(kek) = keks.of(&prefix.kdf)? else {
            continue;
        };
        let Some(copy) = read_key_copy(path) else {
            continue;
        };
        let Ok(found) = copy.open(&kek) else {
            continue;
        };
        let generation = newest
            .checked_add(1)
            .ok_or(UprivError::VaultHeaderUnreadable)?;
        let keys = found.draft().seal(generation, prefix.kdf.clone(), &kek)?;
        let header = VaultHeader::new(prefix.identity, keys.block().clone());
        return Ok(OpenedHeader { header, keys, kek });
    }
    Err(UprivError::WrongPassword)
}

/// The tree of `store_dir` under the pair of `keys`, when an index file
/// opens with it. Nothing is written.
pub(crate) fn open_index_under(store_dir: &Path, keys: &Keyring) -> Result<VaultIndex> {
    let pairs = [IndexPair::of(keys)?];
    let held = |id: super::keys::KeyId| keys.contains(id);
    load_index_files(store_dir, &pairs, &held).map(|loaded| loaded.index)
}

fn log_store_event(store_dir: &Path, event: &str, file_name: &str) {
    let id = store_dir
        .parent()
        .and_then(|parent| parent.file_name())
        .and_then(|name| name.to_str())
        .unwrap_or("");
    crate::logging::log_event(
        crate::logging::LogLevel::Warn,
        event,
        &[("id", id), ("file", file_name)],
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::chunk::write_logical_file;
    use crate::store::{create_empty_store, flush_index, open_store, KdfUnlockPreset};

    const PW: &[u8] = b"unlock-rule-ok";

    #[test]
    fn a_failed_unlock_reads_four_blobs_at_most() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("vault").join(crate::paths::STORE_DIR_NAME);
        create_empty_store(&dir, PW, KdfUnlockPreset::M32).unwrap();
        let mut opened = open_store(&dir, PW).unwrap();
        for at in 0..10 {
            let path = format!("{at}.txt");
            write_logical_file(&dir, &opened.keys, &mut opened.index, &path, b"body").unwrap();
        }
        flush_index(&dir, &mut opened).unwrap();
        assert_eq!(sample(&dir).len(), SAMPLED_BLOBS);
        assert!(matches!(
            unlock(&dir, b"wrong"),
            Err(UprivError::WrongPassword)
        ));
    }

    /// A header and an index that open together repair the other files:
    /// before that, nothing is written.
    #[test]
    fn the_other_files_are_written_only_from_a_header_and_index_that_opened() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("vault").join(crate::paths::STORE_DIR_NAME);
        create_empty_store(&dir, PW, KdfUnlockPreset::M32).unwrap();
        let header_copy = VaultHeader::copy_path(&dir);
        let original = crate::host_fs::read(&header_copy).unwrap();
        crate::host_fs::write(&header_copy, b"torn").unwrap();
        // A wrong password writes nothing.
        assert!(unlock(&dir, b"wrong").is_err());
        assert_eq!(crate::host_fs::read(&header_copy).unwrap(), b"torn");
        let Ok(Unlock::Steady(unlocked)) = unlock(&dir, PW) else {
            panic!("a steady store");
        };
        assert!(unlocked.repaired);
        assert_eq!(crate::host_fs::read(&header_copy).unwrap(), original);
    }
}
