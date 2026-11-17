//! The pass: makes every blob's key copy the header's ([`super::key_copy`]).
//!
//! [`VaultIndex::key_copies_due`] means some blob's key copy is behind the
//! header. A pass walks the blobs of `data/` the tree names and the blobs of
//! `held/`, and for each whose key copy is behind it writes the header's over
//! it; the caller flushes each and, at the end, seals `key_copies_due` off.
//! It covers the held blobs with no file too, so no blob keeps an earlier key
//! or cost. It never touches a key copy above the header's, or one of another
//! vault. It reads only the first 72 bytes of a blob before it writes, and
//! skips a key copy that is already good.
//!
//! Writing a key copy needs no password, but the copy of a blob whose flush
//! failed and the seal at the end need the keys, so a pass runs only where
//! they are: inside a change, or as the job after an open, blob by blob
//! through the session ([`super::chunk::StagedBlobs::flush_key_copy`]).

use std::path::{Path, PathBuf};

use uuid::Uuid;

use super::chunk::blob_path;
use super::held::{held_blob_id, held_dir};
use super::index::VaultIndex;
use super::key_copy::{read_prefix, write_key_copy};
use super::keys::Keyring;
use crate::error::Result;

/// One blob a pass visits.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PassTarget {
    pub path: PathBuf,
    pub file_id: Uuid,
    /// The vault's own blob: a file names it, or it is held with its file.
    /// One whose key copy does not read is written only then.
    pub ours: bool,
    /// A blob of `held/`.
    pub held: bool,
}

/// What [`pass_one`] did with a blob.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PassStep {
    /// Its key copy was behind, or did not read, and is the header's now. The
    /// caller flushes it.
    Wrote,
    /// Its key copy is the header's already, or it is gone.
    Good,
    /// Left as it is: a key copy above the header's, another vault's, or no
    /// key copy on a blob that is not known to be the vault's.
    Skipped,
}

/// The blobs a pass visits: each blob of a file of `index` with data, then
/// each held blob, by name. Blobs the index released are left out: the first
/// seal that flushes deletes them.
pub(crate) fn pass_targets(store_dir: &Path, index: &VaultIndex) -> Vec<PassTarget> {
    let mut targets = Vec::new();
    for node in index.nodes() {
        let Some((file_id, size, _)) = node.as_file() else {
            continue;
        };
        let (Ok(id), Ok(path)) = (Uuid::parse_str(file_id), blob_path(store_dir, file_id)) else {
            continue;
        };
        if size > 0 {
            targets.push(PassTarget {
                path,
                file_id: id,
                ours: true,
                held: false,
            });
        }
    }
    let held = held_dir(store_dir);
    for entry in &index.held {
        let Some(id) = held_blob_id(&entry.name) else {
            continue;
        };
        targets.push(PassTarget {
            path: held.join(&entry.name),
            file_id: id,
            ours: entry.file.is_some(),
            held: true,
        });
    }
    targets
}

/// Make the key copy of `target` the one of the block `keys` came from when it
/// is behind. The caller flushes a blob this wrote.
pub(crate) fn pass_one(target: &PassTarget, keys: &Keyring) -> Result<PassStep> {
    let generation = keys.block().generation;
    match read_prefix(&target.path) {
        Some(prefix) if prefix.identity != keys.identity() => return Ok(PassStep::Skipped),
        Some(prefix) if prefix.generation == generation => return Ok(PassStep::Good),
        Some(prefix) if prefix.generation > generation => return Ok(PassStep::Skipped),
        Some(_) => {}
        None if !target.ours => return Ok(PassStep::Skipped),
        None => {}
    }
    let mut file =
        match crate::paths::open_nofollow(&target.path, crate::paths::NofollowMode::ReadWrite) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(PassStep::Good)
            }
            Err(error) => return Err(error.into()),
        };
    write_key_copy(&mut file, keys, target.file_id)?;
    Ok(PassStep::Wrote)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::chunk::write_logical_file;
    use crate::store::key_copy::KEY_COPY_LEN;
    use crate::store::{create_empty_store, flush_index, open_store, KdfUnlockPreset};

    const PW: &[u8] = b"pass-blobs-ok";

    #[test]
    fn a_pass_writes_only_key_copies_that_are_behind() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("vault").join(crate::paths::STORE_DIR_NAME);
        create_empty_store(&dir, PW, KdfUnlockPreset::M32).unwrap();
        let mut opened = open_store(&dir, PW).unwrap();
        write_logical_file(&dir, &opened.keys, &mut opened.index, "a.txt", b"body").unwrap();
        flush_index(&dir, &mut opened).unwrap();
        let targets = pass_targets(&dir, &opened.index);
        assert_eq!(targets.len(), 1);
        let target = &targets[0];
        let before = crate::host_fs::read(&target.path).unwrap();
        assert_eq!(pass_one(target, &opened.keys).unwrap(), PassStep::Good);

        // A key copy behind the header: the generation below it.
        let mut behind = before.clone();
        behind[64..68].copy_from_slice(&0u32.to_le_bytes());
        crate::host_fs::write(&target.path, &behind).unwrap();
        assert_eq!(pass_one(target, &opened.keys).unwrap(), PassStep::Wrote);
        assert_eq!(crate::host_fs::read(&target.path).unwrap(), before);

        // Above the header: left as it is.
        let mut above = before.clone();
        above[64..68].copy_from_slice(&9u32.to_le_bytes());
        crate::host_fs::write(&target.path, &above).unwrap();
        assert_eq!(pass_one(target, &opened.keys).unwrap(), PassStep::Skipped);
        assert_eq!(crate::host_fs::read(&target.path).unwrap(), above);

        // Torn: the vault's own blob gets the header's again; one not known
        // to be the vault's is left.
        let mut torn = before.clone();
        torn[..KEY_COPY_LEN as usize].fill(0);
        crate::host_fs::write(&target.path, &torn).unwrap();
        let stranger = PassTarget {
            ours: false,
            ..target.clone()
        };
        assert_eq!(
            pass_one(&stranger, &opened.keys).unwrap(),
            PassStep::Skipped
        );
        assert_eq!(pass_one(target, &opened.keys).unwrap(), PassStep::Wrote);
        assert_eq!(crate::host_fs::read(&target.path).unwrap(), before);

        // A blob that is gone holds nothing to update.
        crate::host_fs::remove_file(&target.path).unwrap();
        assert_eq!(pass_one(target, &opened.keys).unwrap(), PassStep::Good);
    }
}
