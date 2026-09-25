//! At-rest vault body: `header/vault.header` (+ `.copy`) + AES-SIV index + chunk files.
//!
//! Create writes a non-secret seed file so wrap + index + chunk AEAD can be
//! validated. The in-app file manager / FUSE still does not list that tree.

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

pub use chunk::{
    read_logical_file, read_logical_range, seed_plaintext, truncate_logical_file,
    write_logical_file, write_logical_range, RetiredFileChunks, SEED_LOGICAL_PATH,
    VAULT_FS_MAX_INLINE_BYTES,
};
pub(crate) use chunk::{remove_file_chunks, ChunkBlobMutation};
pub use header::{
    load_header, unlock_header, VaultHeader, CHUNK_SIZE, FORMAT_VERSION, HEADER_DIR_NAME,
    HEADER_FILE_NAME,
};
pub use index::{VaultIndex, VaultNode, DATA_DIR_NAME, INDEX_DIR_NAME};
pub use kdf::KdfUnlockPreset;
pub use tree::{
    build_file_tree, child_logical_path, delete_empty_directory, delete_logical_path,
    ensure_folder, file_name, from_ui_path, mkdir_logical, move_logical_path, parent_logical,
    relocate_logical_path, relocate_replacing, rename_logical_path, to_ui_path, unique_file_name,
    unique_folder_name, FileTreeNode, INTERNAL_WORKSPACE_FILE, LOGICAL_NAME_MAX,
};

use aead::{derive_layer_keys, random_master_key, ContentKey, INDEX_KEY_LEN, MASTER_KEY_LEN};
use header::{create_header, save_header};
use index::{load_sealed_index, save_sealed_index, VaultIndex as Index};

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
    std::fs::create_dir_all(store_dir.join(INDEX_DIR_NAME))?;
    std::fs::create_dir_all(store_dir.join(DATA_DIR_NAME))?;
    let master = random_master_key();
    let header = create_header(password, preset, &master)?;
    let (content_key, index_key) = derive_layer_keys(&master)?;
    save_header(store_dir, &header)?;
    Ok((header, content_key, index_key))
}

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
pub fn create_seeded_store(
    store_dir: impl AsRef<Path>,
    password: &[u8],
    preset: KdfUnlockPreset,
) -> Result<VaultHeader> {
    let store_dir = store_dir.as_ref();
    let (header, content_key, index_key) = create_store_core(store_dir, password, preset)?;
    let mut index = Index::empty();
    chunk::write_logical_file(
        store_dir,
        &header,
        &content_key,
        &mut index,
        SEED_LOGICAL_PATH,
        &seed_plaintext(header.content_identity),
    )?;
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

pub fn flush_index(store_dir: impl AsRef<Path>, store: &OpenedStore) -> Result<()> {
    flush_index_parts(store_dir, &store.header, &store.index_key, &store.index)
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
    let header_bytes = match std::fs::read(&header_path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            std::fs::read(header::VaultHeader::copy_path(store_dir)).map_err(UprivError::from)?
        }
        Err(error) => return Err(error.into()),
    };
    let index_bytes = std::fs::read(&index_path).map_err(UprivError::from)?;
    let mut hasher = Sha256::new();
    hasher.update(&header_bytes);
    hasher.update(&index_bytes);
    Ok(format!("sha256:{:x}", hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;
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
                serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
            edit(&mut value);
            std::fs::write(&path, serde_json::to_string(&value).unwrap()).unwrap();
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
        create_seeded_store(&dir, password, KdfUnlockPreset::M32).expect("create");
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
    fn create_writes_matching_header_copy_and_danger_notice() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(crate::paths::STORE_DIR_NAME);
        create_empty_store(&dir, b"copy-pair-ok", KdfUnlockPreset::M32).unwrap();
        let primary = std::fs::read(header::VaultHeader::path(&dir)).unwrap();
        let copy = std::fs::read(header::VaultHeader::copy_path(&dir)).unwrap();
        assert_eq!(primary, copy);
        assert!(dir.join(header::STORE_DANGER_FILE_NAME).is_file());
        let header = load_header(&dir).unwrap();
        assert_eq!(header.warning, header::HEADER_WARNING);
    }

    #[test]
    fn missing_primary_is_restored_from_copy() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(crate::paths::STORE_DIR_NAME);
        create_empty_store(&dir, b"restore-primary", KdfUnlockPreset::M32).unwrap();
        let copy = std::fs::read(header::VaultHeader::copy_path(&dir)).unwrap();
        std::fs::remove_file(header::VaultHeader::path(&dir)).unwrap();
        open_store(&dir, b"restore-primary").expect("open from copy");
        assert_eq!(
            std::fs::read(header::VaultHeader::path(&dir)).unwrap(),
            copy
        );
    }

    #[test]
    fn bad_primary_wrap_is_restored_when_copy_opens() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(crate::paths::STORE_DIR_NAME);
        create_empty_store(&dir, b"restore-wrap", KdfUnlockPreset::M32).unwrap();
        let copy = std::fs::read(header::VaultHeader::copy_path(&dir)).unwrap();
        let path = header::VaultHeader::path(&dir);
        let mut value: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        let sealed = value["wrapped_master_key_b64"]
            .as_str()
            .unwrap()
            .to_string();
        value["wrapped_master_key_b64"] = serde_json::json!(flip_sealed(&sealed));
        std::fs::write(&path, serde_json::to_string_pretty(&value).unwrap()).unwrap();
        open_store(&dir, b"restore-wrap").expect("copy opens");
        assert_eq!(std::fs::read(&path).unwrap(), copy);
    }

    #[test]
    fn unreadable_primary_is_restored_from_copy() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(crate::paths::STORE_DIR_NAME);
        create_empty_store(&dir, b"newer-broken", KdfUnlockPreset::M32).unwrap();
        let path = header::VaultHeader::path(&dir);
        let copy_path = header::VaultHeader::copy_path(&dir);
        let copy_bytes = std::fs::read(&copy_path).unwrap();
        let mut primary: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        primary["wrapped_master_key_b64"] = serde_json::json!("YQ==");
        std::fs::write(&path, serde_json::to_vec_pretty(&primary).unwrap()).unwrap();
        load_header(&dir).expect("copy is readable");
        assert_ne!(std::fs::read(&path).unwrap(), copy_bytes);
        open_store(&dir, b"newer-broken").expect("copy opens");
        assert_eq!(std::fs::read(&path).unwrap(), copy_bytes);
    }

    #[test]
    fn load_header_does_not_rewrite_a_missing_primary() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(crate::paths::STORE_DIR_NAME);
        create_empty_store(&dir, b"list-reads-copy", KdfUnlockPreset::M32).unwrap();
        std::fs::remove_file(header::VaultHeader::path(&dir)).unwrap();
        let header = load_header(&dir).expect("preset comes from the copy");
        assert_eq!(header.warning, header::HEADER_WARNING);
        assert!(!header::VaultHeader::path(&dir).exists());
    }

    #[test]
    fn broken_primary_reports_its_own_error_when_copy_is_absent() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(crate::paths::STORE_DIR_NAME);
        create_empty_store(&dir, b"broken-primary", KdfUnlockPreset::M32).unwrap();
        let path = header::VaultHeader::path(&dir);
        std::fs::write(&path, b"not-json").unwrap();
        std::fs::remove_file(header::VaultHeader::copy_path(&dir)).unwrap();
        let err = load_header(&dir).expect_err("broken header");
        match err {
            UprivError::VaultStoreInvalid { detail, .. } => {
                assert!(detail.contains("invalid"), "{detail}");
            }
            other => panic!("expected invalid header, got {other:?}"),
        }
    }
}
