//! At-rest vault body: `header/vault.header` (+ `.copy`) + AES-SIV index (+ `.copy`) + one `.blob` per file.
//!
//! Create writes a non-secret seed file so wrap + index + chunk AEAD can be
//! validated. The in-app file manager / FUSE still does not list that tree.

#[allow(unused_imports)]
use crate::host_fs::HostFsQuery;
mod aead;
mod chunk;
mod header;
mod index;
mod kdf;
mod tree;

use std::path::Path;

use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use crate::error::{Result, UprivError};

#[cfg(test)]
pub(crate) use chunk::blob_path;
pub(crate) use chunk::{
    blobs_need_pack, mutation_blob_ids, pack_blob_waste, record_imported_file, remove_file_chunks,
    seal_import_chunk, BlobPackMode, ChunkBlobMutation, ImportBlob,
};
pub use chunk::{
    read_logical_file, read_logical_range, seed_plaintext, truncate_logical_file,
    write_logical_file, write_logical_range, RetiredFileChunks, SEED_LOGICAL_PATH,
    VAULT_FS_MAX_INLINE_BYTES,
};
pub use header::{
    ensure_danger_notice, header_bytes, load_header, rewrap_header, unlock_header, VaultHeader,
    CHUNK_SIZE, FORMAT_VERSION, HEADER_DIR_NAME, HEADER_FILE_NAME, STORE_DANGER_FILE_NAME,
};
pub(crate) use index::sha256_hex;
pub use index::{
    sealed_index_bytes, ContentDigest, VaultIndex, VaultNode, DATA_DIR_NAME, INDEX_COPY_FILE_NAME,
    INDEX_DIR_NAME, INDEX_FILE_NAME,
};
pub use kdf::KdfUnlockPreset;
pub use tree::{
    build_file_tree, child_logical_path, delete_empty_directory, delete_logical_path,
    ensure_folder, file_name, from_ui_path, is_plain_internal, is_reserved_logical, mkdir_logical,
    move_logical_path, parent_logical, relocate_logical_path, relocate_replacing,
    rename_logical_path, to_ui_path, unique_file_name, unique_folder_name, FileTreeNode,
    INTERNAL_WORKSPACE_FILE, LOGICAL_NAME_MAX, PLAIN_POLICY_FILE, PLAIN_RESERVED_PREFIX,
};

use aead::{derive_layer_keys, random_master_key, ContentKey, INDEX_KEY_LEN, MASTER_KEY_LEN};
use header::{create_header, save_header};
pub(crate) use index::load_sealed_index;
use index::{save_sealed_index, VaultIndex as Index};

pub struct OpenedStore {
    pub header: VaultHeader,
    pub master_key: Zeroizing<[u8; MASTER_KEY_LEN]>,
    pub content_key: ContentKey,
    pub index_key: Zeroizing<[u8; INDEX_KEY_LEN]>,
    pub index: Index,
}

/// Wrap a master key and persist `vault.header`. Caller writes the sealed index
/// once (empty store or seed + flush) so wrap stays in one place.
///
/// Library API: still accepts an empty password (SECURITY-CRYPTO P3). User RPC
/// (`create_vault` / `open_vault`) must keep rejecting empty. Do not call this
/// from UI without that check.
fn create_store_core(
    store_dir: &Path,
    password: &[u8],
    preset: KdfUnlockPreset,
) -> Result<(VaultHeader, ContentKey, Zeroizing<[u8; INDEX_KEY_LEN]>)> {
    crate::host_fs::create_dir_all(store_dir.join(INDEX_DIR_NAME))?;
    crate::host_fs::create_dir_all(store_dir.join(DATA_DIR_NAME))?;
    let master = random_master_key();
    let header = create_header(password, preset, &master)?;
    let (content_key, index_key) = derive_layer_keys(&master)?;
    save_header(store_dir, &header)?;
    Ok((header, content_key, index_key))
}

#[cfg(test)]
pub fn create_empty_store(
    store_dir: impl AsRef<Path>,
    password: &[u8],
    preset: KdfUnlockPreset,
) -> Result<VaultHeader> {
    let store_dir = store_dir.as_ref();
    let (header, _, index_key) = create_store_core(store_dir, password, preset)?;
    save_sealed_index(store_dir, &header, &index_key, &Index::empty())?;
    Ok(header)
}

/// Create `store/` plus a non-secret seed chunk (`upriv-seed.txt` in the index).
///
/// `initial_files` are `(logical_path, plaintext)` pairs sealed beside the seed
/// before the first index write — plaintext never leaves RAM.
pub fn create_seeded_store(
    store_dir: impl AsRef<Path>,
    password: &[u8],
    preset: KdfUnlockPreset,
    initial_files: &[(&str, &[u8])],
) -> Result<VaultHeader> {
    let store_dir = store_dir.as_ref();
    let (header, content_key, index_key) = create_store_core(store_dir, password, preset)?;
    let mut index = Index::empty();
    let seed = seed_plaintext(header.content_identity);
    let files =
        std::iter::once((SEED_LOGICAL_PATH, seed.as_slice())).chain(initial_files.iter().copied());
    for (logical_path, plaintext) in files {
        let (_retired, mutation) = chunk::write_logical_file(
            store_dir,
            &header,
            &content_key,
            &mut index,
            logical_path,
            plaintext,
        )?;
        mutation.sync_before_index()?;
    }
    save_sealed_index(store_dir, &header, &index_key, &index)?;
    Ok(header)
}

/// Unlock an existing `store/` (empty or populated index).
///
/// Bypasses the in-app unlock throttle on purpose (library API). `open_vault` is
/// the throttled surface.
pub fn open_store(store_dir: impl AsRef<Path>, password: &[u8]) -> Result<OpenedStore> {
    let store_dir = store_dir.as_ref();
    let header = unlock_header(store_dir, password)?;
    let (content_key, index_key) = derive_layer_keys(&header.master_key)?;
    let index = load_sealed_index(store_dir, &header.header, &index_key)?;
    chunk::remove_unreferenced_blobs(store_dir, &index);
    Ok(OpenedStore {
        header: header.header,
        master_key: header.master_key,
        content_key,
        index_key,
        index,
    })
}

/// Argon2id wrap check only — does not load the index or keep keys.
pub fn probe_store_password(store_dir: impl AsRef<Path>, password: &[u8]) -> Result<()> {
    if password.is_empty() {
        return Err(UprivError::WrongPassword);
    }
    drop(unlock_header(store_dir, password)?);
    Ok(())
}

pub fn probe_unlock_preset(store_dir: impl AsRef<Path>) -> Option<KdfUnlockPreset> {
    load_header(store_dir).ok().and_then(|h| h.unlock_preset())
}

#[cfg(test)]
pub fn flush_index(store_dir: impl AsRef<Path>, store: &mut OpenedStore) -> Result<()> {
    flush_index_parts(store_dir, &store.header, &store.index_key, &store.index)?;
    store.index.clear_unsealed_holes();
    Ok(())
}

#[cfg(test)]
pub fn sealed_index_contains(
    store_dir: &Path,
    header: &VaultHeader,
    index_key: &[u8; INDEX_KEY_LEN],
    logical_path: &str,
) -> Result<bool> {
    let index = load_sealed_index(store_dir, header, index_key)?;
    Ok(index.find(logical_path).is_some())
}

pub fn flush_index_parts(
    store_dir: impl AsRef<Path>,
    header: &VaultHeader,
    index_key: &[u8; aead::INDEX_KEY_LEN],
    index: &Index,
) -> Result<()> {
    save_sealed_index(store_dir, header, index_key, index)
}

/// SHA-256 of header + index ciphertext (recovery A / persistence `content_hash`).
pub fn content_hash_hex(store_dir: impl AsRef<Path>) -> Result<String> {
    let store_dir = store_dir.as_ref();
    let header_path = header::VaultHeader::path(store_dir);
    let index_path = index::index_path(store_dir);
    let header_bytes = match crate::host_fs::read(&header_path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            crate::host_fs::read(header::VaultHeader::copy_path(store_dir))
                .map_err(UprivError::from)?
        }
        Err(error) => return Err(error.into()),
    };
    let index_bytes = match crate::host_fs::read(&index_path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            crate::host_fs::read(index::index_copy_path(store_dir)).map_err(UprivError::from)?
        }
        Err(error) => return Err(error.into()),
    };
    let mut hasher = Sha256::new();
    hasher.update(&header_bytes);
    hasher.update(&index_bytes);
    Ok(format!("sha256:{:x}", hasher.finalize()))
}

/// `.upriv-workspace.json` and the root plaintext policy: file-manager layout
/// and the confirmed plaintext place are not vault changes.
fn counts_as_vault_content(node: &VaultNode) -> bool {
    node.path != INTERNAL_WORKSPACE_FILE && node.path != PLAIN_POLICY_FILE
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
        .nodes
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
    use crate::store::header::unwrap_header_master;

    #[test]
    fn create_open_round_trip_empty() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(crate::paths::STORE_DIR_NAME);
        let password = b"correct-horse";
        create_empty_store(&dir, password, KdfUnlockPreset::M32).expect("create");
        let opened = open_store(&dir, password).expect("open");
        assert!(opened.index.nodes.is_empty());
        assert_eq!(opened.header.unlock_preset(), Some(KdfUnlockPreset::M32));
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

    #[test]
    fn index_logical_hash_ignores_storage_timestamps_and_order() {
        let mut index = VaultIndex::empty();
        index.nodes.push(VaultNode::dir("docs"));
        index.nodes.push(digested(
            VaultNode::file("docs/a.txt", "file-a".into(), 4, vec!["v1".into()], vec![0]),
            "sha256:aaaa",
        ));
        index.nodes.push(digested(
            VaultNode::file("b.txt", "file-b".into(), 2, vec!["v1".into()], vec![0]),
            "sha256:bbbb",
        ));
        let before = index_logical_hash(&index);
        let same = |other: &VaultIndex| index_logical_hash(other) == before;

        // Same bytes written again: new blob, versions, offsets, times, and the
        // rewritten node moved to the end of the list.
        let mut rewritten = index.clone();
        let again = VaultNode::file("docs/a.txt", "a2".into(), 4, vec!["v9".into()], vec![64]);
        let mut again = digested(again, "sha256:aaaa");
        again.created_at += 1_000;
        again.modified_at += 5_000;
        rewritten.nodes.remove(1);
        rewritten.nodes.push(again);
        assert!(same(&rewritten));

        let mut edited = index.clone();
        edited.nodes[2] = digested(
            VaultNode::file("b.txt", "file-b".into(), 2, vec!["v2".into()], vec![0]),
            "sha256:cccc",
        );
        assert!(!same(&edited));

        let mut renamed = index.clone();
        renamed.nodes[2].path = "c.txt".into();
        assert!(!same(&renamed));

        let mut folder = index.clone();
        folder.nodes.push(VaultNode::dir("empty"));
        assert!(!same(&folder));
    }

    #[test]
    fn a_file_without_a_current_digest_counts_by_its_storage() {
        let mut index = VaultIndex::empty();
        index.nodes.push(VaultNode::file(
            "note.txt",
            "file".into(),
            4,
            vec!["v1".into()],
            vec![0],
        ));
        let by_storage = index_logical_hash(&index);
        // Untouched, it is stable.
        assert_eq!(index_logical_hash(&index), by_storage);

        // A chunk rewrite with no digest is a change, even if the bytes match.
        let mut rewritten = index.clone();
        if let index::VaultNodeKind::File { chunk_versions, .. } = &mut rewritten.nodes[0].kind {
            chunk_versions[0] = "v2".into();
        }
        assert_ne!(index_logical_hash(&rewritten), by_storage);

        // A digest left from older storage is ignored, not trusted.
        let mut stale = digested(index.nodes[0].clone(), "sha256:aaaa");
        if let index::VaultNodeKind::File { chunk_versions, .. } = &mut stale.kind {
            chunk_versions[0] = "v2".into();
        }
        assert!(stale.current_digest().is_none());
        rewritten.nodes[0] = stale;
        assert_ne!(index_logical_hash(&rewritten), by_storage);

        // The same file once it has a digest is a different id: one more zip.
        let mut digested_index = index.clone();
        digested_index.nodes[0] = digested(index.nodes[0].clone(), "sha256:aaaa");
        assert_ne!(index_logical_hash(&digested_index), by_storage);
    }

    #[test]
    fn index_logical_hash_ignores_workspace_layout() {
        let mut with_layout = VaultIndex::empty();
        with_layout.nodes.push(digested(
            VaultNode::file("note.txt", "file".into(), 4, vec!["v1".into()], vec![0]),
            "sha256:aaaa",
        ));
        with_layout.nodes.push(VaultNode::file(
            INTERNAL_WORKSPACE_FILE,
            "layout".into(),
            2,
            vec!["w1".into()],
            vec![0],
        ));
        let mut other_layout = with_layout.clone();
        other_layout.nodes[1] = VaultNode::file(
            INTERNAL_WORKSPACE_FILE,
            "layout".into(),
            40,
            vec!["w2".into()],
            vec![80],
        );
        let same = index_logical_hash(&with_layout);
        assert_eq!(index_logical_hash(&other_layout), same);

        let mut edited = with_layout;
        edited.nodes[0] = digested(
            VaultNode::file("note.txt", "file".into(), 5, vec!["v2".into()], vec![0]),
            "sha256:bbbb",
        );
        assert_ne!(index_logical_hash(&edited), same);
    }

    #[test]
    fn index_logical_hash_ignores_the_root_plain_policy_only() {
        let mut index = VaultIndex::empty();
        index.nodes.push(digested(
            VaultNode::file("note.txt", "file".into(), 4, vec!["v1".into()], vec![0]),
            "sha256:aaaa",
        ));
        let before = index_logical_hash(&index);
        let mut with_policy = index.clone();
        with_policy.nodes.push(VaultNode::file(
            PLAIN_POLICY_FILE,
            "policy".into(),
            9,
            vec!["p1".into()],
            vec![0],
        ));
        assert_eq!(index_logical_hash(&with_policy), before);

        let mut nested = index;
        nested.nodes.push(VaultNode::dir("docs"));
        nested.nodes.push(digested(
            VaultNode::file(
                &format!("docs/{PLAIN_POLICY_FILE}"),
                "nested".into(),
                9,
                vec!["p1".into()],
                vec![0],
            ),
            "sha256:pppp",
        ));
        assert_ne!(index_logical_hash(&nested), before);
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

    fn flip_sealed(sealed: &str) -> String {
        let mut chars = sealed.as_bytes().to_vec();
        chars[0] = if chars[0] == b'A' { b'B' } else { b'A' };
        String::from_utf8(chars).unwrap()
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
            Err(UprivError::VaultStoreInvalid { .. })
        ));
    }

    #[test]
    fn unique_salts_across_vaults() {
        let tmp = tempfile::tempdir().unwrap();
        let a = tmp.path().join("a");
        let b = tmp.path().join("b");
        let ha = create_empty_store(&a, b"same-password-ok", KdfUnlockPreset::M32).unwrap();
        let hb = create_empty_store(&b, b"same-password-ok", KdfUnlockPreset::M32).unwrap();
        assert_ne!(ha.kdf.salt_b64, hb.kdf.salt_b64);
        assert_ne!(ha.content_identity, hb.content_identity);
        assert_ne!(ha.wrapped_master_key_b64, hb.wrapped_master_key_b64);
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
            Err(UprivError::WrongPassword | UprivError::VaultStoreInvalid { .. })
        ));
    }

    #[test]
    fn password_bytes_are_exact_no_trim() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(crate::paths::STORE_DIR_NAME);
        create_empty_store(&dir, b"  padded  ", KdfUnlockPreset::M32).unwrap();
        assert!(open_store(&dir, b"padded").is_err());
        open_store(&dir, b"  padded  ").expect("spaces are part of the password");
        let header = load_header(&dir).unwrap();
        unwrap_header_master(&header, b"  padded  ").expect("wrap");
    }

    #[test]
    fn load_header_rejects_huge_memory_before_argon2() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(crate::paths::STORE_DIR_NAME);
        create_empty_store(&dir, b"pw-ok-ok-3", KdfUnlockPreset::M32).unwrap();
        patch_both_headers(&dir, |header| {
            header["kdf"]["memory_kib"] = serde_json::json!(4096 * 1024);
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
        create_seeded_store(&dir, password, KdfUnlockPreset::M32, &[]).expect("create");
        let opened = open_store(&dir, password).expect("open");
        let expected = seed_plaintext(opened.header.content_identity);
        let got = read_logical_file(
            &dir,
            &opened.header,
            &opened.content_key,
            &opened.index,
            SEED_LOGICAL_PATH,
        )
        .expect("seed");
        assert_eq!(got, expected);
        assert_eq!(opened.index.nodes.len(), 1);
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
            &[("README.md", b"# Hello\n")],
        )
        .expect("create");
        let opened = open_store(&dir, password).expect("open");
        let got = read_logical_file(
            &dir,
            &opened.header,
            &opened.content_key,
            &opened.index,
            "README.md",
        )
        .expect("readme");
        assert_eq!(got, b"# Hello\n");
        assert_eq!(opened.index.nodes.len(), 2);
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
    fn missing_primary_is_restored_from_copy() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(crate::paths::STORE_DIR_NAME);
        create_empty_store(&dir, b"restore-primary", KdfUnlockPreset::M32).unwrap();
        let copy = crate::host_fs::read(header::VaultHeader::copy_path(&dir)).unwrap();
        crate::host_fs::remove_file(header::VaultHeader::path(&dir)).unwrap();
        open_store(&dir, b"restore-primary").expect("open from copy");
        assert_eq!(
            crate::host_fs::read(header::VaultHeader::path(&dir)).unwrap(),
            copy
        );
    }

    #[test]
    fn bad_primary_wrap_is_restored_when_copy_opens() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(crate::paths::STORE_DIR_NAME);
        create_empty_store(&dir, b"restore-wrap", KdfUnlockPreset::M32).unwrap();
        let copy = crate::host_fs::read(header::VaultHeader::copy_path(&dir)).unwrap();
        let path = header::VaultHeader::path(&dir);
        let mut value: serde_json::Value =
            serde_json::from_str(&crate::host_fs::read_to_string(&path).unwrap()).unwrap();
        let sealed = value["wrapped_master_key_b64"]
            .as_str()
            .unwrap()
            .to_string();
        value["wrapped_master_key_b64"] = serde_json::json!(flip_sealed(&sealed));
        crate::host_fs::write(&path, serde_json::to_string_pretty(&value).unwrap()).unwrap();
        open_store(&dir, b"restore-wrap").expect("copy opens");
        assert_eq!(crate::host_fs::read(&path).unwrap(), copy);
    }

    #[test]
    fn unreadable_primary_is_restored_from_copy() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(crate::paths::STORE_DIR_NAME);
        create_empty_store(&dir, b"newer-broken", KdfUnlockPreset::M32).unwrap();
        let path = header::VaultHeader::path(&dir);
        let copy_path = header::VaultHeader::copy_path(&dir);
        let copy_bytes = crate::host_fs::read(&copy_path).unwrap();
        let mut primary: serde_json::Value =
            serde_json::from_slice(&crate::host_fs::read(&path).unwrap()).unwrap();
        primary["wrapped_master_key_b64"] = serde_json::json!("YQ==");
        crate::host_fs::write(&path, serde_json::to_vec_pretty(&primary).unwrap()).unwrap();
        load_header(&dir).expect("copy is readable");
        assert_ne!(crate::host_fs::read(&path).unwrap(), copy_bytes);
        open_store(&dir, b"newer-broken").expect("copy opens");
        assert_eq!(crate::host_fs::read(&path).unwrap(), copy_bytes);
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
