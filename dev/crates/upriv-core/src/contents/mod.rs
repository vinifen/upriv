//! At-rest vault body: `vault.header` + AES-SIV index + chunk files.
//!
//! Create writes a non-secret seed file so wrap + index + chunk AEAD can be
//! validated. The in-app file manager / FUSE still does not list that tree.

mod aead;
mod chunk;
mod header;
mod index;
mod kdf;

use std::path::Path;

use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use crate::error::{Result, UprivError};

pub use chunk::{read_logical_file, seed_plaintext, SEED_LOGICAL_PATH};
pub use header::{load_header, VaultHeader, CHUNK_SIZE, FORMAT_VERSION};
pub use index::{VaultIndex, DATA_DIR_NAME, INDEX_DIR_NAME};
pub use kdf::KdfUnlockPreset;

use aead::{derive_layer_keys, random_master_key, ContentKey, INDEX_KEY_LEN, MASTER_KEY_LEN};
use header::{create_header, save_header, unwrap_header_master};
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
    contents_dir: &Path,
    password: &[u8],
    preset: KdfUnlockPreset,
) -> Result<(VaultHeader, ContentKey, Zeroizing<[u8; INDEX_KEY_LEN]>)> {
    std::fs::create_dir_all(contents_dir.join(INDEX_DIR_NAME))?;
    std::fs::create_dir_all(contents_dir.join(DATA_DIR_NAME))?;
    let master = random_master_key();
    let header = create_header(password, preset, &master)?;
    let (content_key, index_key) = derive_layer_keys(&master)?;
    save_header(contents_dir, &header)?;
    Ok((header, content_key, index_key))
}

pub fn create_empty_store(
    contents_dir: impl AsRef<Path>,
    password: &[u8],
    preset: KdfUnlockPreset,
) -> Result<VaultHeader> {
    let contents_dir = contents_dir.as_ref();
    let (header, _, index_key) = create_store_core(contents_dir, password, preset)?;
    save_sealed_index(contents_dir, &header, &index_key, &Index::empty())?;
    Ok(header)
}

/// Create `contents/` plus a non-secret seed chunk (`upriv-seed.txt` in the index).
pub fn create_seeded_store(
    contents_dir: impl AsRef<Path>,
    password: &[u8],
    preset: KdfUnlockPreset,
) -> Result<VaultHeader> {
    let contents_dir = contents_dir.as_ref();
    let (header, content_key, index_key) = create_store_core(contents_dir, password, preset)?;
    let mut index = Index::empty();
    chunk::write_logical_file(
        contents_dir,
        &header,
        &content_key,
        &mut index,
        SEED_LOGICAL_PATH,
        &seed_plaintext(header.content_identity),
    )?;
    save_sealed_index(contents_dir, &header, &index_key, &index)?;
    Ok(header)
}

/// Unlock an existing `contents/` (empty or populated index).
///
/// Bypasses the in-app unlock throttle on purpose (library API). `open_vault` is
/// the throttled surface.
pub fn open_store(contents_dir: impl AsRef<Path>, password: &[u8]) -> Result<OpenedStore> {
    let contents_dir = contents_dir.as_ref();
    let header = load_header(contents_dir)?;
    let master_key = unwrap_header_master(&header, password)?;
    let (content_key, index_key) = derive_layer_keys(&master_key)?;
    let index = load_sealed_index(contents_dir, &header, &index_key)?;
    Ok(OpenedStore {
        header,
        master_key,
        content_key,
        index_key,
        index,
    })
}

pub fn probe_unlock_preset(contents_dir: impl AsRef<Path>) -> Option<KdfUnlockPreset> {
    load_header(contents_dir)
        .ok()
        .and_then(|h| h.unlock_preset())
}

pub fn flush_index(contents_dir: impl AsRef<Path>, store: &OpenedStore) -> Result<()> {
    flush_index_parts(contents_dir, &store.header, &store.index_key, &store.index)
}

pub fn flush_index_parts(
    contents_dir: impl AsRef<Path>,
    header: &VaultHeader,
    index_key: &[u8; aead::INDEX_KEY_LEN],
    index: &Index,
) -> Result<()> {
    save_sealed_index(contents_dir, header, index_key, index)
}

/// SHA-256 of header + index ciphertext (recovery A / persistence `content_hash`).
pub fn content_hash_hex(contents_dir: impl AsRef<Path>) -> Result<String> {
    let contents_dir = contents_dir.as_ref();
    let header_path = header::VaultHeader::path(contents_dir);
    let index_path = index::index_path(contents_dir);
    let header_bytes = std::fs::read(&header_path).map_err(UprivError::from)?;
    let index_bytes = std::fs::read(&index_path).map_err(UprivError::from)?;
    let mut hasher = Sha256::new();
    hasher.update(&header_bytes);
    hasher.update(&index_bytes);
    Ok(format!("sha256:{:x}", hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contents::header::unwrap_header_master;

    #[test]
    fn create_open_round_trip_empty() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("contents");
        let password = b"correct-horse";
        create_empty_store(&dir, password, KdfUnlockPreset::M32).expect("create");
        let opened = open_store(&dir, password).expect("open");
        assert!(opened.index.entries.is_empty());
        assert_eq!(opened.header.unlock_preset(), Some(KdfUnlockPreset::M32));
    }

    #[test]
    fn wrong_password_yields_no_plaintext() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("contents");
        create_empty_store(&dir, b"right-password", KdfUnlockPreset::M32).unwrap();
        assert!(matches!(
            open_store(&dir, b"wrong-password"),
            Err(UprivError::WrongPassword)
        ));
    }

    #[test]
    fn unknown_version_fails_closed() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("contents");
        create_empty_store(&dir, b"pw-ok-ok", KdfUnlockPreset::M32).unwrap();
        let path = header::VaultHeader::path(&dir);
        let mut header: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        header["format_version"] = serde_json::json!(99);
        std::fs::write(&path, serde_json::to_string(&header).unwrap()).unwrap();
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
        let dir = tmp.path().join("contents");
        create_empty_store(&dir, b"pw-ok-ok-2", KdfUnlockPreset::M32).unwrap();
        let path = header::VaultHeader::path(&dir);
        let mut header: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        header["kdf"]["memory_kib"] = serde_json::json!(64 * 1024);
        std::fs::write(&path, serde_json::to_string(&header).unwrap()).unwrap();
        assert!(matches!(
            open_store(&dir, b"pw-ok-ok-2"),
            Err(UprivError::WrongPassword | UprivError::VaultStoreInvalid { .. })
        ));
    }

    #[test]
    fn password_bytes_are_exact_no_trim() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("contents");
        create_empty_store(&dir, b"  padded  ", KdfUnlockPreset::M32).unwrap();
        assert!(open_store(&dir, b"padded").is_err());
        open_store(&dir, b"  padded  ").expect("spaces are part of the password");
        let header = load_header(&dir).unwrap();
        unwrap_header_master(&header, b"  padded  ").expect("wrap");
    }

    #[test]
    fn load_header_rejects_huge_memory_before_argon2() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("contents");
        create_empty_store(&dir, b"pw-ok-ok-3", KdfUnlockPreset::M32).unwrap();
        let path = header::VaultHeader::path(&dir);
        let mut header: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        header["kdf"]["memory_kib"] = serde_json::json!(4096 * 1024);
        std::fs::write(&path, serde_json::to_string(&header).unwrap()).unwrap();
        assert!(matches!(
            load_header(&dir),
            Err(UprivError::VaultStoreInvalid { .. })
        ));
    }

    #[test]
    fn create_seeded_store_round_trips_seed_chunk() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("contents");
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
        assert_eq!(opened.index.entries.len(), 1);
    }
}
