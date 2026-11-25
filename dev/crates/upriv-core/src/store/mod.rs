//! At-rest vault body: `header/vault.header` (+ `.copy`) + AES-SIV index (+ `.copy`) + one `.blob` per file.
//!
//! The header holds the vault's keys as a keyring ([`keys`]); every blob
//! starts with a copy of the header block it was written under
//! ([`key_copy`]), holds its file's chunks, and ends with recovery records
//! ([`record`]), so any blob plus the password opens its file. The index also
//! holds the storage value ([`storage`]), the only thing that lets an open
//! write plain text to disk. Create writes a non-secret seed file so wrap +
//! index + chunk AEAD can be validated.

#[allow(unused_imports)]
use crate::host_fs::HostFsQuery;
mod aead;
mod chunk;
mod header;
mod held;
mod index;
mod kdf;
mod key_copy;
mod keys;
mod pass;
mod record;
mod storage;
mod tree;
mod unlock;

use std::path::Path;

use sha2::{Digest, Sha256};

use crate::error::{Result, UprivError};

#[cfg(test)]
pub(crate) use chunk::blob_path;
pub(crate) use chunk::imported_node;
pub(crate) use chunk::{
    blobs_need_pack, chunk_count, convert_files, convert_held_blob, flush_made_blob,
    mutation_blob_ids, pack_blob_waste, read_file_chunks_keeping, read_logical_range_keeping,
    record_imported_file, seal_import_chunk, BlobPackMode, ChunkBlobMutation, ImportBlob,
    RecordsDue, StagedBlobs, BLOB_FILE_SUFFIX,
};
pub use chunk::{
    read_logical_file, read_logical_range, seed_plaintext, truncate_logical_file,
    write_logical_file, write_logical_range, RetiredFileChunks, SEED_LOGICAL_PATH,
    VAULT_FS_MAX_INLINE_BYTES,
};
pub use header::{
    create_header, ensure_danger_notice, header_bytes, load_header, HeaderBlock, HeaderKdf,
    VaultHeader, CHUNK_SIZE, FORMAT_VERSION, HEADER_DIR_NAME, HEADER_FILE_NAME,
    STORE_DANGER_FILE_NAME,
};
pub(crate) use header::{read_header_files, save_header};
pub(crate) use held::{
    backup_zip_header, delete_held, delete_released, held_blob_paths, held_dir, held_disk_bytes,
    newly_missing, remove_empty_held, restore_held, settle_held,
};
pub(crate) use index::sha256_hex;
pub use index::{
    sealed_index_bytes, ChunkList, ChunkVersion, ContentDigest, FileProblem, HeldBlob, Sealed,
    VaultIndex, VaultNode, DATA_DIR_NAME, INDEX_COPY_FILE_NAME, INDEX_DIR_NAME, INDEX_FILE_NAME,
};
pub use kdf::{KdfUnlockPreset, Kek};
pub(crate) use key_copy::KEY_COPY_LEN;
#[cfg(test)]
pub(crate) use key_copy::{read_key_copy, read_prefix};
pub(crate) use keys::KeyringDraft;
pub use keys::{KeyId, Keyring, MAX_KEYS};
pub(crate) use pass::{pass_one, pass_targets, PassStep, PassTarget};
#[cfg(test)]
pub(crate) use record::read_record;
pub(crate) use record::{
    append_record, list_blobs, rebuild_tree, record_made_blob, RebuildSources, Records,
};
pub use storage::{VaultPlainFiles, VaultStorage, VaultStorageMode};
pub use tree::{
    build_file_tree, child_logical_path, delete_empty_directory, delete_logical_path,
    ensure_folder, file_name, from_ui_path, is_export_config, is_plain_internal,
    is_reserved_logical, is_skipped_on_import, mkdir_logical, move_logical_path, parent_logical,
    relocate_logical_path, relocate_replacing, rename_logical_path, to_ui_path, unique_file_name,
    unique_folder_name, FileTreeNode, EXPORT_CONFIG_DIR, INTERNAL_WORKSPACE_FILE, LOGICAL_NAME_MAX,
    PLAIN_RESERVED_PREFIX,
};
pub(crate) use unlock::{
    key_copy_opens, newest_key_copy, open_index_under, restore_header, unlock, OpenedHeader,
    PendingChange, PendingSide, Unlock,
};

pub(crate) use tree::require_parent_dir;

use index::{save_new_sealed_index, save_sealed_index, VaultIndex as Index};

/// A store whose header and index opened together, steady (no password
/// change pending).
pub struct OpenedStore {
    pub header: VaultHeader,
    pub keys: Keyring,
    pub index: Index,
    /// The unlock wrote a header or index twin from the pair that opened.
    pub repaired: bool,
}

#[cfg(test)]
impl OpenedStore {
    /// What a seal of this store's tree writes its records and key copies
    /// with.
    pub(crate) fn records(&self) -> Records<'_> {
        Records {
            keys: &self.keys,
            index: &self.index,
        }
    }
}

/// Make `store_dir` with a new header under `password` at `preset` and persist
/// it. Caller writes the sealed index once (empty store or seed + flush) so
/// wrap stays in one place.
///
/// Library API: still accepts an empty password (SECURITY-CRYPTO P3). User RPC
/// (`create_vault` / `open_vault`) must keep rejecting empty. Do not call this
/// from UI without that check.
fn create_store_core(
    store_dir: &Path,
    password: &[u8],
    preset: KdfUnlockPreset,
) -> Result<(VaultHeader, Keyring)> {
    crate::host_fs::create_dir_all(store_dir.join(INDEX_DIR_NAME))?;
    crate::host_fs::create_dir_all(store_dir.join(DATA_DIR_NAME))?;
    let (header, keys) = create_header(password, preset)?;
    save_header(store_dir, &header)?;
    Ok((header, keys))
}

#[cfg(test)]
pub fn create_empty_store(
    store_dir: impl AsRef<Path>,
    password: &[u8],
    preset: KdfUnlockPreset,
) -> Result<VaultHeader> {
    let store_dir = store_dir.as_ref();
    let (header, keys) = create_store_core(store_dir, password, preset)?;
    save_new_sealed_index(store_dir, &keys, &mut Index::empty())?;
    Ok(header)
}

/// Create `store/` plus a non-secret seed chunk (`upriv-seed.txt` in the index),
/// with `storage` sealed in the first index.
///
/// `initial_files` are `(logical_path, plaintext)` pairs sealed beside the seed
/// before the first index write — plaintext never leaves RAM.
pub fn create_seeded_store(
    store_dir: impl AsRef<Path>,
    password: &[u8],
    preset: KdfUnlockPreset,
    storage: VaultStorage,
    initial_files: &[(&str, &[u8])],
) -> Result<VaultHeader> {
    let store_dir = store_dir.as_ref();
    let (header, keys) = create_store_core(store_dir, password, preset)?;
    let mut index = Index::empty();
    index.storage = storage;
    let seed = seed_plaintext(header.content_identity);
    let files =
        std::iter::once((SEED_LOGICAL_PATH, seed.as_slice())).chain(initial_files.iter().copied());
    for (logical_path, plaintext) in files {
        let (_retired, mutation) =
            chunk::write_logical_file(store_dir, &keys, &mut index, logical_path, plaintext)?;
        mutation.sync_before_index(&Records {
            keys: &keys,
            index: &index,
        })?;
    }
    save_new_sealed_index(store_dir, &keys, &mut index)?;
    Ok(header)
}

/// Unlock an existing steady `store/` (empty or populated index) by the rule
/// of [`unlock`]. A pending password change is refused with
/// [`UprivError::PasswordChangeInterrupted`]: only an open and a rebuild settle
/// one. `data/` stays as it is: the unlocks that go on to change the store
/// match its blobs with the index ([`settle_held`]).
///
/// Bypasses the in-app unlock throttle on purpose (library API). `open_vault` is
/// the throttled surface.
pub fn open_store(store_dir: impl AsRef<Path>, password: &[u8]) -> Result<OpenedStore> {
    match unlock(store_dir.as_ref(), password)? {
        Unlock::Steady(unlocked) => Ok(OpenedStore {
            header: unlocked.header,
            keys: unlocked.keys,
            index: unlocked.index,
            repaired: unlocked.repaired,
        }),
        Unlock::Pending(_) => Err(UprivError::PasswordChangeInterrupted),
        Unlock::IndexLost(lost) => Err(lost.why),
    }
}

/// The unlock cost of the newest header of `store_dir` ([`probe_header`]).
pub fn probe_unlock_preset(store_dir: impl AsRef<Path>) -> Option<KdfUnlockPreset> {
    probe_header(store_dir).and_then(|probe| probe.unlock_preset)
}

/// Where a vault's password change stands, as its header says in the clear.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PasswordChangeState {
    None,
    /// A change started and neither finished nor stopped: a header file
    /// holds `change`. The next open or rebuild settles it.
    Pending,
    /// A change settled forward: the header holds a key below `since`, whose
    /// files wait to be rewritten (Finish).
    Unfinished,
}

/// What the header files of a store say with no password, for the list and
/// Info.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HeaderProbe {
    /// The unlock cost of the newest header.
    pub unlock_preset: Option<KdfUnlockPreset>,
    /// Keys the newest header's top block holds.
    pub keys: usize,
    pub password_change: PasswordChangeState,
}

/// Read both header files of `store_dir` and describe the newest by
/// generation ([`HeaderProbe`]). `None` when no header file parses. Nothing
/// is written.
pub fn probe_header(store_dir: impl AsRef<Path>) -> Option<HeaderProbe> {
    let files = read_header_files(store_dir.as_ref()).ok()?;
    let headers: Vec<&VaultHeader> = files
        .iter()
        .flatten()
        .filter_map(|file| file.header.as_ref().ok())
        .collect();
    let newest = headers
        .iter()
        .max_by_key(|header| header.newest_generation())?;
    let top = &newest.top;
    let password_change = if headers.iter().any(|header| header.change.is_some()) {
        PasswordChangeState::Pending
    } else if top.key_ids.iter().any(|id| *id < top.since) {
        PasswordChangeState::Unfinished
    } else {
        PasswordChangeState::None
    };
    Some(HeaderProbe {
        unlock_preset: newest.unlock_preset(),
        keys: top.key_ids.len(),
        password_change,
    })
}

#[cfg(test)]
pub fn flush_index(store_dir: impl AsRef<Path>, store: &mut OpenedStore) -> Result<()> {
    let (_, sealed) = flush_index_parts(store_dir, &store.keys, &mut store.index)?;
    if sealed == Sealed::Flushed {
        store.index.clear_unsealed_holes();
    }
    Ok(())
}

#[cfg(test)]
pub fn sealed_index_contains(store_dir: &Path, keys: &Keyring, logical_path: &str) -> Result<bool> {
    let pairs = [index::IndexPair::of(keys)?];
    let held = |id: KeyId| keys.contains(id);
    let loaded = index::load_index_files(store_dir, &pairs, &held)?;
    Ok(loaded.index.find(logical_path).is_some())
}

/// Seal `index` into `store/index/` under the pair of `keys` and return the
/// sealed bytes, which are now the primary index file, and whether that file
/// is flushed. The seal counts one more save in `index`
/// ([`VaultIndex::saves`]). An error leaves the previous primary in place. A
/// seal that does not flush is logged (`vault_index_unflushed`).
pub fn flush_index_parts(
    store_dir: impl AsRef<Path>,
    keys: &Keyring,
    index: &mut Index,
) -> Result<(Vec<u8>, Sealed)> {
    let store_dir = store_dir.as_ref();
    let (bytes, sealed) = save_sealed_index(store_dir, keys, index)?;
    if sealed == Sealed::Unflushed {
        index::log_index_unflushed(store_dir);
    }
    Ok((bytes, sealed))
}

/// SHA-256 of both header files and the primary index file (recovery A /
/// persistence `content_hash`): a header file that comes back from an earlier
/// time, either one, shows as a change outside Upriv. A missing file counts as
/// missing; the copy of the index stands in for a missing primary. Blobs are
/// not part of it.
pub fn content_hash_hex(store_dir: impl AsRef<Path>) -> Result<String> {
    let store_dir = store_dir.as_ref();
    let index_bytes = match crate::host_fs::read(index::index_path(store_dir)) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            crate::host_fs::read(index::index_copy_path(store_dir)).map_err(UprivError::from)?
        }
        Err(error) => return Err(error.into()),
    };
    content_hash_with_index(store_dir, &index_bytes)
}

/// True when `store_dir` holds a header file and neither index file: the
/// tree is gone while the vault can still unlock, so its list row is recovery.
pub(crate) fn index_files_missing(store_dir: impl AsRef<Path>) -> bool {
    let store_dir = store_dir.as_ref();
    let header_there = header::VaultHeader::path(store_dir).host_exists()
        || header::VaultHeader::copy_path(store_dir).host_exists();
    header_there
        && !index::index_path(store_dir).host_exists()
        && !index::index_copy_path(store_dir).host_exists()
}

/// [`content_hash_hex`] for a store whose primary index file holds
/// `sealed_index`, as [`flush_index_parts`] just wrote it. Reads the header
/// files only.
pub fn content_hash_with_index(store_dir: impl AsRef<Path>, sealed_index: &[u8]) -> Result<String> {
    let store_dir = store_dir.as_ref();
    let files = read_header_files(store_dir)?;
    if files.iter().all(Option::is_none) {
        return Err(UprivError::VaultStoreInvalid {
            path: VaultHeader::path(store_dir),
            detail: "missing vault.header".into(),
        });
    }
    let mut hasher = Sha256::new();
    for file in &files {
        match file {
            Some(file) => {
                hasher.update(b"present\0");
                hasher.update((file.raw.len() as u64).to_le_bytes());
                hasher.update(&file.raw);
            }
            None => hasher.update(b"missing\0"),
        }
    }
    hasher.update(sealed_index);
    Ok(format!("sha256:{:x}", hasher.finalize()))
}

/// `.upriv-workspace.json` at the root: the file-manager layout is not a
/// vault change.
fn counts_as_vault_content(node: &VaultNode) -> bool {
    node.path != INTERNAL_WORKSPACE_FILE
}

/// Stable id of the vault contents used to decide whether a close needs a new
/// backup zip: each path, whether it is a folder, and each file's size and
/// plaintext digest. Blob ids, chunk versions, offsets, timestamps, and node
/// order are not part of it, so writing the same bytes again is not a change.
/// [`counts_as_vault_content`] decides which files count.
///
/// Writers keep digests from bytes they already hold, so nothing is read here.
/// A file without a current digest (written at random offsets, shrunk, or not
/// written since digests existed) counts by its storage instead: the same
/// storage is the same bytes, and different storage only costs one more zip.
pub fn index_logical_hash(index: &VaultIndex) -> String {
    let mut content: Vec<&VaultNode> = index
        .nodes()
        .iter()
        .filter(|node| counts_as_vault_content(node))
        .collect();
    content.sort_unstable_by(|left, right| left.path.cmp(&right.path));
    let mut hasher = Sha256::new();
    for node in content {
        hasher.update(node.path.as_bytes());
        hasher.update([0]);
        let Some((_, size, _)) = node.as_file() else {
            hasher.update(b"dir\0");
            continue;
        };
        hasher.update(size.to_le_bytes());
        match node.current_digest() {
            Some(sha256) => {
                hasher.update(b"content\0");
                hasher.update(sha256.as_bytes());
            }
            None => {
                hasher.update(b"storage\0");
                hasher.update(node.storage_tag().unwrap_or_default().as_bytes());
            }
        }
        hasher.update([0]);
    }
    format!("sha256:{:x}", hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[allow(unused_imports)]
    use crate::host_fs::HostFsQuery;

    #[test]
    fn the_flushed_index_hashes_like_the_files_on_disk() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(crate::paths::STORE_DIR_NAME);
        create_empty_store(&dir, b"correct-horse", KdfUnlockPreset::M32).expect("create");
        let mut opened = open_store(&dir, b"correct-horse").expect("open");
        opened.index.push(VaultNode::dir("docs"));
        let (sealed, flushed) = flush_index_parts(&dir, &opened.keys, &mut opened.index).unwrap();
        assert_eq!(flushed, Sealed::Flushed);
        assert_eq!(
            content_hash_with_index(&dir, &sealed).unwrap(),
            content_hash_hex(&dir).unwrap()
        );
    }

    #[test]
    fn either_header_file_put_back_changes_the_hash() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(crate::paths::STORE_DIR_NAME);
        create_empty_store(&dir, b"correct-horse", KdfUnlockPreset::M32).expect("create");
        let recorded = content_hash_hex(&dir).unwrap();
        for path in [VaultHeader::path(&dir), VaultHeader::copy_path(&dir)] {
            let bytes = crate::host_fs::read(&path).unwrap();
            let mut edited = bytes.clone();
            edited.push(b'\n');
            crate::host_fs::write(&path, &edited).unwrap();
            assert_ne!(content_hash_hex(&dir).unwrap(), recorded);
            crate::host_fs::remove_file(&path).unwrap();
            assert_ne!(content_hash_hex(&dir).unwrap(), recorded);
            crate::host_fs::write(&path, &bytes).unwrap();
            assert_eq!(content_hash_hex(&dir).unwrap(), recorded);
        }
    }

    #[test]
    fn create_open_round_trip_empty() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(crate::paths::STORE_DIR_NAME);
        let password = b"correct-horse";
        create_empty_store(&dir, password, KdfUnlockPreset::M32).expect("create");
        let opened = open_store(&dir, password).expect("open");
        assert!(opened.index.nodes().is_empty());
        assert_eq!(opened.header.unlock_preset(), Some(KdfUnlockPreset::M32));
        assert_eq!(opened.header.top.generation, 1);
        assert_eq!(opened.keys.write_id(), KeyId::new(1));
        assert!(!opened.repaired);
        let hash = index_logical_hash(&opened.index);
        assert!(hash.starts_with("sha256:"));
        assert_eq!(index_logical_hash(&opened.index), hash);
    }

    /// A file node whose digest matches its storage.
    fn digested(mut node: VaultNode, sha256: &str) -> VaultNode {
        node.content_digest = Some(ContentDigest {
            sha256: sha256.into(),
            storage: node.storage_tag().expect("file"),
        });
        node
    }

    fn version(byte: u8) -> ChunkVersion {
        ChunkVersion::from_bytes([byte; 8])
    }

    /// One chunk of `version` at `offset`, on key 1.
    fn one_chunk(version: ChunkVersion, offset: u64) -> ChunkList {
        ChunkList {
            versions: vec![version],
            keys: vec![KeyId::new(1)],
            offsets: vec![offset],
        }
    }

    /// `node` with its first chunk written again.
    fn rewrite_first_chunk(mut node: VaultNode, to: ChunkVersion) -> VaultNode {
        if let index::VaultNodeKind::File { chunk_versions, .. } = &mut node.kind {
            chunk_versions[0] = to;
        }
        node
    }

    #[test]
    fn index_logical_hash_ignores_storage_timestamps_and_order() {
        let mut index = VaultIndex::empty();
        index.push(VaultNode::dir("docs"));
        index.push(digested(
            VaultNode::file(
                "docs/a.txt",
                "file-a".into(),
                4,
                one_chunk(version(1), 4096),
            ),
            "sha256:aaaa",
        ));
        index.push(digested(
            VaultNode::file("b.txt", "file-b".into(), 2, one_chunk(version(1), 4096)),
            "sha256:bbbb",
        ));
        let before = index_logical_hash(&index);
        let same = |other: &VaultIndex| index_logical_hash(other) == before;

        // Same bytes written again: new blob, versions, offsets, times, and the
        // rewritten node moved to the end of the list.
        let mut rewritten = index.clone();
        let again = VaultNode::file("docs/a.txt", "a2".into(), 4, one_chunk(version(9), 4160));
        let mut again = digested(again, "sha256:aaaa");
        again.created_at += 1_000;
        again.modified_at += 5_000;
        assert!(rewritten.remove("docs/a.txt"));
        rewritten.push(again);
        assert!(same(&rewritten));

        let mut edited = index.clone();
        edited.put(digested(
            VaultNode::file("b.txt", "file-b".into(), 2, one_chunk(version(2), 4096)),
            "sha256:cccc",
        ));
        assert!(!same(&edited));

        let mut renamed = index.clone();
        renamed.move_tree("b.txt", "c.txt", 0);
        assert!(!same(&renamed));

        let mut folder = index.clone();
        folder.push(VaultNode::dir("empty"));
        assert!(!same(&folder));
    }

    #[test]
    fn a_file_without_a_current_digest_counts_by_its_storage() {
        let mut index = VaultIndex::empty();
        let note = VaultNode::file("note.txt", "file".into(), 4, one_chunk(version(1), 4096));
        index.push(note.clone());
        let by_storage = index_logical_hash(&index);
        // Untouched, it is stable.
        assert_eq!(index_logical_hash(&index), by_storage);

        // A chunk rewrite with no digest is a change, even if the bytes match.
        let mut rewritten = index.clone();
        rewritten.put(rewrite_first_chunk(note.clone(), version(2)));
        assert_ne!(index_logical_hash(&rewritten), by_storage);

        // A digest left from older storage is ignored, not trusted.
        let stale = rewrite_first_chunk(digested(note.clone(), "sha256:aaaa"), version(2));
        assert!(stale.current_digest().is_none());
        rewritten.put(stale);
        assert_ne!(index_logical_hash(&rewritten), by_storage);

        // The same file once it has a digest is a different id: one more zip.
        let mut digested_index = index.clone();
        digested_index.put(digested(note, "sha256:aaaa"));
        assert_ne!(index_logical_hash(&digested_index), by_storage);
    }

    #[test]
    fn index_logical_hash_ignores_workspace_layout() {
        let mut with_layout = VaultIndex::empty();
        with_layout.push(digested(
            VaultNode::file("note.txt", "file".into(), 4, one_chunk(version(1), 4096)),
            "sha256:aaaa",
        ));
        with_layout.push(VaultNode::file(
            INTERNAL_WORKSPACE_FILE,
            "layout".into(),
            2,
            one_chunk(version(3), 4096),
        ));
        let mut other_layout = with_layout.clone();
        other_layout.put(VaultNode::file(
            INTERNAL_WORKSPACE_FILE,
            "layout".into(),
            40,
            one_chunk(version(4), 4176),
        ));
        let same = index_logical_hash(&with_layout);
        assert_eq!(index_logical_hash(&other_layout), same);

        let mut edited = with_layout;
        edited.put(digested(
            VaultNode::file("note.txt", "file".into(), 5, one_chunk(version(2), 4096)),
            "sha256:bbbb",
        ));
        assert_ne!(index_logical_hash(&edited), same);
    }

    #[test]
    fn wrong_password_yields_no_plaintext() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(crate::paths::STORE_DIR_NAME);
        create_empty_store(&dir, b"right-password", KdfUnlockPreset::M32).unwrap();
        assert!(matches!(
            open_store(&dir, b"wrong-password"),
            Err(UprivError::WrongPassword)
        ));
    }

    fn patch_both_headers(dir: &Path, edit: impl Fn(&mut serde_json::Value)) {
        for path in [
            header::VaultHeader::path(dir),
            header::VaultHeader::copy_path(dir),
        ] {
            let mut value: serde_json::Value =
                serde_json::from_str(&crate::host_fs::read_to_string(&path).unwrap()).unwrap();
            edit(&mut value);
            crate::host_fs::write(&path, serde_json::to_string(&value).unwrap()).unwrap();
        }
    }

    #[test]
    fn unknown_version_fails_closed() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(crate::paths::STORE_DIR_NAME);
        create_empty_store(&dir, b"pw-ok-ok", KdfUnlockPreset::M32).unwrap();
        patch_both_headers(&dir, |header| {
            header["format_version"] = serde_json::json!(99);
        });
        assert!(matches!(
            open_store(&dir, b"pw-ok-ok"),
            Err(UprivError::VaultHeaderUnreadable)
        ));
    }

    #[test]
    fn unique_salts_across_vaults() {
        let tmp = tempfile::tempdir().unwrap();
        let a = tmp.path().join("a");
        let b = tmp.path().join("b");
        let ha = create_empty_store(&a, b"same-password-ok", KdfUnlockPreset::M32).unwrap();
        let hb = create_empty_store(&b, b"same-password-ok", KdfUnlockPreset::M32).unwrap();
        assert_ne!(ha.top.kdf.salt_b64, hb.top.kdf.salt_b64);
        assert_ne!(ha.content_identity, hb.content_identity);
        assert_ne!(ha.top.wrapped_keys_b64, hb.top.wrapped_keys_b64);
    }

    #[test]
    fn tamper_kdf_params_fails() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(crate::paths::STORE_DIR_NAME);
        create_empty_store(&dir, b"pw-ok-ok-2", KdfUnlockPreset::M32).unwrap();
        patch_both_headers(&dir, |header| {
            header["kdf"]["memory_kib"] = serde_json::json!(64 * 1024);
        });
        assert!(matches!(
            open_store(&dir, b"pw-ok-ok-2"),
            Err(UprivError::WrongPassword)
        ));
    }

    #[test]
    fn password_bytes_are_exact_no_trim() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(crate::paths::STORE_DIR_NAME);
        create_empty_store(&dir, b"  padded  ", KdfUnlockPreset::M32).unwrap();
        assert!(open_store(&dir, b"padded").is_err());
        open_store(&dir, b"  padded  ").expect("spaces are part of the password");
    }

    #[test]
    fn load_header_rejects_huge_memory_before_argon2() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(crate::paths::STORE_DIR_NAME);
        create_empty_store(&dir, b"pw-ok-ok-3", KdfUnlockPreset::M32).unwrap();
        patch_both_headers(&dir, |header| {
            header["kdf"]["memory_kib"] = serde_json::json!(kdf::MAX_KDF_MEMORY_KIB + 1024);
        });
        assert!(matches!(
            load_header(&dir),
            Err(UprivError::VaultStoreInvalid { .. })
        ));
    }

    #[test]
    fn create_seeded_store_round_trips_seed_chunk() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(crate::paths::STORE_DIR_NAME);
        let password = b"seed-round-trip-ok";
        create_seeded_store(
            &dir,
            password,
            KdfUnlockPreset::M32,
            VaultStorage::default(),
            &[],
        )
        .expect("create");
        let opened = open_store(&dir, password).expect("open");
        let expected = seed_plaintext(opened.header.content_identity);
        let got =
            read_logical_file(&dir, &opened.keys, &opened.index, SEED_LOGICAL_PATH).expect("seed");
        assert_eq!(got, expected);
        assert_eq!(opened.index.nodes().len(), 1);
        assert_eq!(opened.index.storage, VaultStorage::default());
    }

    #[test]
    fn create_seals_the_storage_value_it_is_given() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(crate::paths::STORE_DIR_NAME);
        let storage = VaultStorage {
            mode: VaultStorageMode::UprivPlain,
            plain_files: VaultPlainFiles::Whole,
        };
        create_seeded_store(&dir, b"seed-plain-ok", KdfUnlockPreset::M32, storage, &[])
            .expect("create");
        let opened = open_store(&dir, b"seed-plain-ok").expect("open");
        assert_eq!(opened.index.storage, storage);
    }

    #[test]
    fn create_seeded_store_seals_initial_files() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(crate::paths::STORE_DIR_NAME);
        let password = b"seed-initial-files";
        create_seeded_store(
            &dir,
            password,
            KdfUnlockPreset::M32,
            VaultStorage::default(),
            &[("README.md", b"# Hello\n")],
        )
        .expect("create");
        let opened = open_store(&dir, password).expect("open");
        let got =
            read_logical_file(&dir, &opened.keys, &opened.index, "README.md").expect("readme");
        assert_eq!(got, b"# Hello\n");
        assert_eq!(opened.index.nodes().len(), 2);
    }

    #[test]
    fn create_writes_matching_header_copy_and_danger_notice() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(crate::paths::STORE_DIR_NAME);
        create_empty_store(&dir, b"copy-pair-ok", KdfUnlockPreset::M32).unwrap();
        let primary = crate::host_fs::read(header::VaultHeader::path(&dir)).unwrap();
        let copy = crate::host_fs::read(header::VaultHeader::copy_path(&dir)).unwrap();
        assert_eq!(primary, copy);
        assert!(dir.join(header::STORE_DANGER_FILE_NAME).host_is_file());
        let header = load_header(&dir).unwrap();
        assert_eq!(header.warning, header::HEADER_WARNING);
    }

    #[test]
    fn load_header_does_not_rewrite_a_missing_primary() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(crate::paths::STORE_DIR_NAME);
        create_empty_store(&dir, b"list-reads-copy", KdfUnlockPreset::M32).unwrap();
        crate::host_fs::remove_file(header::VaultHeader::path(&dir)).unwrap();
        let header = load_header(&dir).expect("preset comes from the copy");
        assert_eq!(header.warning, header::HEADER_WARNING);
        assert!(!header::VaultHeader::path(&dir).host_exists());
    }

    #[test]
    fn broken_primary_reports_its_own_error_when_copy_is_absent() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(crate::paths::STORE_DIR_NAME);
        create_empty_store(&dir, b"broken-primary", KdfUnlockPreset::M32).unwrap();
        let path = header::VaultHeader::path(&dir);
        crate::host_fs::write(&path, b"not-json").unwrap();
        crate::host_fs::remove_file(header::VaultHeader::copy_path(&dir)).unwrap();
        let err = load_header(&dir).expect_err("broken header");
        match err {
            UprivError::VaultStoreInvalid { detail, .. } => {
                assert!(detail.contains("invalid"), "{detail}");
            }
            other => panic!("expected invalid header, got {other:?}"),
        }
    }
}
