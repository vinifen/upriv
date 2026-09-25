//! `store/header/vault.header` — JSON, versioned. Ciphertext is the wrapped master key only.
//! `vault.header.copy` is the same bytes. `warning` is human-only and is not part of the wrap AAD.

use std::path::{Path, PathBuf};

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::aead::{unwrap_master_key, wrap_master_key, MASTER_KEY_LEN, XCHACHA_NONCE_LEN};
use super::kdf::{derive_kek, KdfUnlockPreset, SALT_LEN};
use crate::error::{Result, UprivError};
use crate::paths;

pub const FORMAT_VERSION: u32 = 1;
pub const HEADER_DIR_NAME: &str = "header";
pub const HEADER_FILE_NAME: &str = "vault.header";
pub const HEADER_COPY_FILE_NAME: &str = "vault.header.copy";
pub const STORE_DANGER_FILE_NAME: &str = "DANGER-DO-NOT-EDIT-PERMANENT-DATA-LOSS.md";
pub const HEADER_WARNING: &str = "DO NOT EDIT. Changing or deleting this file can permanently destroy the vault, even if you know the password.";
const POLY1305_TAG_LEN: usize = 16;
const WRAPPED_MASTER_LEN: usize = XCHACHA_NONCE_LEN + MASTER_KEY_LEN + POLY1305_TAG_LEN;
const DANGER_NOTICE: &str = include_str!("DANGER-DO-NOT-EDIT-PERMANENT-DATA-LOSS.md");
pub const AEAD_ID: &str = "xchacha20poly1305";
pub const NAME_CIPHER_ID: &str = "aes256-siv";
pub const KDF_ALG: &str = "argon2id";
pub const CHUNK_SIZE: u32 = 256 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultHeader {
    pub warning: String,
    pub format_version: u32,
    pub content_identity: Uuid,
    pub kdf: HeaderKdf,
    pub aead: String,
    pub name_cipher: String,
    pub chunk_size: u32,
    pub wrapped_master_key_b64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeaderKdf {
    pub alg: String,
    pub memory_kib: u32,
    pub time_cost: u32,
    pub parallelism: u32,
    pub salt_b64: String,
}

impl VaultHeader {
    pub fn path(store_dir: impl AsRef<Path>) -> PathBuf {
        header_dir(store_dir).join(HEADER_FILE_NAME)
    }

    pub fn copy_path(store_dir: impl AsRef<Path>) -> PathBuf {
        header_dir(store_dir).join(HEADER_COPY_FILE_NAME)
    }

    pub fn unlock_preset(&self) -> Option<KdfUnlockPreset> {
        KdfUnlockPreset::from_params(
            self.kdf.memory_kib,
            self.kdf.time_cost,
            self.kdf.parallelism,
        )
    }

    pub fn wrap_aad(&self) -> Result<Vec<u8>> {
        wrap_aad_bytes(self)
    }
}

/// Compact serde_json of this struct’s field order. This is NOT RFC 8785 sorted
/// JSON and NOT the pretty-printed vault.header on disk. Do not reorder fields,
/// rename keys, or switch to BTreeMap/sorted maps without a format_version bump
/// (existing wrap/index tags would fail). Golden: `aad_bytes_are_struct_field_order`.
///
/// Covers `wrap` and `index`. Both bind the KDF parameters on purpose: they are
/// what a password change rewrites, so authenticating them here is correct.
#[derive(Serialize)]
struct HeaderAad<'a> {
    v: u32,
    cid: String,
    kdf: &'a str,
    m: u32,
    t: u32,
    p: u32,
    salt: &'a str,
    aead: &'a str,
    names: &'a str,
    chunk: u32,
    kind: &'static str,
}

/// Chunk AAD — deliberately narrower than [`HeaderAad`]. Same serialization
/// freeze applies: field order is the byte order.
///
/// Three fields are absent by design, and each omission is load-bearing:
///
/// - **No `salt`/`m`/`t`/`p`.** A password change rotates the salt while keeping
///   the same master key. Binding KDF material here would invalidate every
///   chunk in the vault on rewrap.
/// - **No `file_size`.** Appending to a file changes its size, which would
///   change the AAD of every chunk already written and force a full rewrite —
///   O(file) per write, and unusable for random-access writes through a mount.
///   The sealed index is the authenticated authority on length, so a truncated
///   file still fails closed via a missing chunk or a `chunk_len` mismatch.
/// - **No `names`.** The name cipher governs the index, not content blobs.
///
/// `version` replaces the rollback protection that `file_size` incidentally
/// provided: it is fresh CSPRNG on every chunk write and is recorded in the
/// index, so a stale blob cannot be replayed at the same
/// `(file_id, chunk_index)` without the index key.
#[derive(Serialize)]
struct ChunkAad<'a> {
    v: u32,
    cid: String,
    aead: &'a str,
    chunk: u32,
    kind: &'static str,
    file_id: &'a str,
    chunk_index: u32,
    chunk_len: u32,
    version: &'a str,
}

fn header_aad_bytes(
    header: &VaultHeader,
    kind: &'static str,
    err_path: PathBuf,
) -> Result<Vec<u8>> {
    serde_json::to_vec(&HeaderAad {
        v: header.format_version,
        cid: header.content_identity.to_string(),
        kdf: &header.kdf.alg,
        m: header.kdf.memory_kib,
        t: header.kdf.time_cost,
        p: header.kdf.parallelism,
        salt: &header.kdf.salt_b64,
        aead: &header.aead,
        names: &header.name_cipher,
        chunk: header.chunk_size,
        kind,
    })
    .map_err(|error| UprivError::VaultStoreInvalid {
        path: err_path,
        detail: format!("AAD serialize: {error}"),
    })
}

fn wrap_aad_bytes(header: &VaultHeader) -> Result<Vec<u8>> {
    header_aad_bytes(header, "wrap", PathBuf::from(HEADER_FILE_NAME))
}

pub fn index_aad(header: &VaultHeader) -> Result<Vec<u8>> {
    header_aad_bytes(header, "index", PathBuf::from("index/root.idx.enc"))
}

pub fn chunk_aad(
    header: &VaultHeader,
    file_id: &str,
    chunk_index: u32,
    chunk_len: u32,
    version: &str,
) -> Result<Vec<u8>> {
    serde_json::to_vec(&ChunkAad {
        v: header.format_version,
        cid: header.content_identity.to_string(),
        aead: &header.aead,
        chunk: header.chunk_size,
        kind: "chunk",
        file_id,
        chunk_index,
        chunk_len,
        version,
    })
    .map_err(|error| UprivError::VaultStoreInvalid {
        path: PathBuf::from("data"),
        detail: format!("AAD serialize: {error}"),
    })
}

fn header_dir(store_dir: impl AsRef<Path>) -> PathBuf {
    store_dir.as_ref().join(HEADER_DIR_NAME)
}

pub fn load_header(store_dir: impl AsRef<Path>) -> Result<VaultHeader> {
    let store_dir = store_dir.as_ref();
    let primary_path = VaultHeader::path(store_dir);
    let copy_path = VaultHeader::copy_path(store_dir);
    let primary_raw = read_bytes(&primary_path)?;
    let copy_raw = read_bytes(&copy_path)?;
    if let Some(raw) = primary_raw.as_deref() {
        if let Ok(header) = parse_structural(&primary_path, raw) {
            return Ok(header);
        }
    }
    if let Some(raw) = copy_raw.as_deref() {
        if let Ok(header) = parse_structural(&copy_path, raw) {
            return Ok(header);
        }
    }
    Err(header_read_error(
        &primary_path,
        primary_raw.as_deref(),
        &copy_path,
        copy_raw.as_deref(),
    ))
}

pub struct UnlockedHeader {
    pub header: VaultHeader,
    pub master_key: zeroize::Zeroizing<[u8; MASTER_KEY_LEN]>,
}

/// Password check for the primary header, then the copy when the primary wrap
/// does not open and the copy is allowed to replace it.
pub fn unlock_header(store_dir: impl AsRef<Path>, password: &[u8]) -> Result<UnlockedHeader> {
    let store_dir = store_dir.as_ref();
    let primary_path = VaultHeader::path(store_dir);
    let copy_path = VaultHeader::copy_path(store_dir);
    let primary_raw = read_bytes(&primary_path)?;
    let copy_raw = read_bytes(&copy_path)?;
    let primary = primary_raw
        .as_ref()
        .and_then(|raw| parse_structural(&primary_path, raw).ok());
    let copy = copy_raw
        .as_ref()
        .and_then(|raw| parse_structural(&copy_path, raw).ok());

    let unlocked = match primary {
        Some(primary) => unlock_primary(
            store_dir,
            password,
            &primary,
            copy.as_ref(),
            primary_raw.as_deref(),
            copy_raw.as_deref(),
        )?,
        None => {
            let copy = copy.ok_or_else(|| {
                header_read_error(
                    &primary_path,
                    primary_raw.as_deref(),
                    &copy_path,
                    copy_raw.as_deref(),
                )
            })?;
            let master_key = unwrap_header_master(&copy, password)?;
            write_primary_from_copy(store_dir, copy_raw.as_deref())?;
            UnlockedHeader {
                header: copy,
                master_key,
            }
        }
    };
    ensure_danger_notice(store_dir)?;
    Ok(unlocked)
}

fn unlock_primary(
    store_dir: &Path,
    password: &[u8],
    primary: &VaultHeader,
    copy: Option<&VaultHeader>,
    primary_raw: Option<&[u8]>,
    copy_raw: Option<&[u8]>,
) -> Result<UnlockedHeader> {
    if kdf_matches(primary, copy) {
        let kek = derive_header_kek(primary, password)?;
        if let Ok(master_key) = unwrap_with_kek(primary, &kek) {
            write_copy_from_primary(store_dir, primary_raw, copy_raw)?;
            return Ok(UnlockedHeader {
                header: primary.clone(),
                master_key,
            });
        }
        if same_file_bytes(primary_raw, copy_raw) {
            return Err(UprivError::WrongPassword);
        }
        if let Some(copy) = copy {
            if let Ok(master_key) = unwrap_with_kek(copy, &kek) {
                write_primary_from_copy(store_dir, copy_raw)?;
                return Ok(UnlockedHeader {
                    header: copy.clone(),
                    master_key,
                });
            }
        }
        return Err(UprivError::WrongPassword);
    }
    if let Ok(master_key) = unwrap_header_master(primary, password) {
        write_copy_from_primary(store_dir, primary_raw, copy_raw)?;
        return Ok(UnlockedHeader {
            header: primary.clone(),
            master_key,
        });
    }
    if same_file_bytes(primary_raw, copy_raw) {
        return Err(UprivError::WrongPassword);
    }
    if let Some(copy) = copy {
        if let Ok(master_key) = unwrap_header_master(copy, password) {
            write_primary_from_copy(store_dir, copy_raw)?;
            return Ok(UnlockedHeader {
                header: copy.clone(),
                master_key,
            });
        }
    }
    Err(UprivError::WrongPassword)
}

fn header_read_error(
    primary_path: &Path,
    primary_raw: Option<&[u8]>,
    copy_path: &Path,
    copy_raw: Option<&[u8]>,
) -> UprivError {
    if let Some(raw) = primary_raw {
        return match parse_structural(primary_path, raw) {
            Err(error) => error,
            Ok(_) => UprivError::VaultStoreInvalid {
                path: primary_path.to_path_buf(),
                detail: "invalid vault.header".into(),
            },
        };
    }
    if let Some(raw) = copy_raw {
        return match parse_structural(copy_path, raw) {
            Err(error) => error,
            Ok(_) => UprivError::VaultStoreInvalid {
                path: copy_path.to_path_buf(),
                detail: "invalid vault.header.copy".into(),
            },
        };
    }
    UprivError::VaultStoreInvalid {
        path: primary_path.to_path_buf(),
        detail: "missing vault.header".into(),
    }
}

fn same_file_bytes(primary_raw: Option<&[u8]>, copy_raw: Option<&[u8]>) -> bool {
    matches!((primary_raw, copy_raw), (Some(primary), Some(copy)) if primary == copy)
}

fn kdf_matches(primary: &VaultHeader, copy: Option<&VaultHeader>) -> bool {
    let Some(copy) = copy else {
        return false;
    };
    primary.kdf.memory_kib == copy.kdf.memory_kib
        && primary.kdf.time_cost == copy.kdf.time_cost
        && primary.kdf.parallelism == copy.kdf.parallelism
        && primary.kdf.salt_b64 == copy.kdf.salt_b64
}

fn write_copy_from_primary(
    store_dir: &Path,
    primary_raw: Option<&[u8]>,
    copy_raw: Option<&[u8]>,
) -> Result<()> {
    let Some(primary_raw) = primary_raw else {
        return Ok(());
    };
    if copy_raw == Some(primary_raw) {
        return Ok(());
    }
    paths::write_bytes_atomic(&VaultHeader::copy_path(store_dir), primary_raw)?;
    log_header_restored(store_dir, HEADER_COPY_FILE_NAME);
    Ok(())
}

fn write_primary_from_copy(store_dir: &Path, copy_raw: Option<&[u8]>) -> Result<()> {
    let Some(copy_raw) = copy_raw else {
        return Err(UprivError::VaultStoreInvalid {
            path: VaultHeader::copy_path(store_dir),
            detail: "missing vault.header.copy".into(),
        });
    };
    paths::write_bytes_atomic(&VaultHeader::path(store_dir), copy_raw)?;
    log_header_restored(store_dir, HEADER_FILE_NAME);
    Ok(())
}

fn log_header_restored(store_dir: &Path, file_name: &str) {
    let id = store_dir
        .parent()
        .and_then(|parent| parent.file_name())
        .and_then(|name| name.to_str())
        .unwrap_or("");
    crate::logging::log_event(
        crate::logging::LogLevel::Warn,
        "vault_header_restored",
        &[("id", id), ("file", file_name)],
    );
}

fn read_bytes(path: &Path) -> Result<Option<Vec<u8>>> {
    match std::fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn parse_structural(path: &Path, raw: &[u8]) -> Result<VaultHeader> {
    let text = std::str::from_utf8(raw).map_err(|_| UprivError::VaultStoreInvalid {
        path: path.to_path_buf(),
        detail: "invalid vault.header".into(),
    })?;
    let header: VaultHeader =
        serde_json::from_str(text).map_err(|error| UprivError::VaultStoreInvalid {
            path: path.to_path_buf(),
            detail: format!("invalid vault.header: {error}"),
        })?;
    if header.format_version != FORMAT_VERSION {
        return Err(UprivError::VaultStoreInvalid {
            path: path.to_path_buf(),
            detail: format!(
                "unsupported format_version {} (this build writes {FORMAT_VERSION})",
                header.format_version
            ),
        });
    }
    if header.kdf.alg != KDF_ALG
        || header.aead != AEAD_ID
        || header.name_cipher != NAME_CIPHER_ID
        || header.chunk_size != CHUNK_SIZE
    {
        return Err(UprivError::VaultStoreInvalid {
            path: path.to_path_buf(),
            detail: "unsupported algorithms or chunk size".into(),
        });
    }
    if !super::kdf::kdf_params_in_bounds(
        header.kdf.memory_kib,
        header.kdf.time_cost,
        header.kdf.parallelism,
    ) {
        return Err(UprivError::VaultStoreInvalid {
            path: path.to_path_buf(),
            detail: "KDF parameters out of bounds".into(),
        });
    }
    if !sealed_fields_well_formed(&header) {
        return Err(UprivError::VaultStoreInvalid {
            path: path.to_path_buf(),
            detail: "invalid sealed master key".into(),
        });
    }
    Ok(header)
}

fn sealed_fields_well_formed(header: &VaultHeader) -> bool {
    let Ok(salt) = B64.decode(header.kdf.salt_b64.as_bytes()) else {
        return false;
    };
    if salt.len() != SALT_LEN {
        return false;
    }
    let Ok(wrapped) = B64.decode(header.wrapped_master_key_b64.as_bytes()) else {
        return false;
    };
    wrapped.len() == WRAPPED_MASTER_LEN
}

fn derive_header_kek(
    header: &VaultHeader,
    password: &[u8],
) -> Result<zeroize::Zeroizing<[u8; 32]>> {
    let salt = B64
        .decode(header.kdf.salt_b64.as_bytes())
        .map_err(|_| UprivError::WrongPassword)?;
    let mut salt_bytes = [0u8; SALT_LEN];
    if salt.len() != SALT_LEN {
        return Err(UprivError::WrongPassword);
    }
    salt_bytes.copy_from_slice(&salt);
    derive_kek(
        password,
        &salt_bytes,
        header.kdf.memory_kib,
        header.kdf.time_cost,
        header.kdf.parallelism,
    )
}

fn unwrap_with_kek(
    header: &VaultHeader,
    kek: &[u8; 32],
) -> Result<zeroize::Zeroizing<[u8; MASTER_KEY_LEN]>> {
    let wrapped = B64
        .decode(header.wrapped_master_key_b64.as_bytes())
        .map_err(|_| UprivError::WrongPassword)?;
    let aad = header.wrap_aad()?;
    unwrap_master_key(kek, &wrapped, &aad)
}

pub fn ensure_danger_notice(store_dir: &Path) -> Result<()> {
    let path = store_dir.join(STORE_DANGER_FILE_NAME);
    if std::fs::read(&path).ok().as_deref() == Some(DANGER_NOTICE.as_bytes()) {
        return Ok(());
    }
    paths::write_bytes_atomic(&path, DANGER_NOTICE.as_bytes())
}

pub fn save_header(store_dir: impl AsRef<Path>, header: &VaultHeader) -> Result<()> {
    let store_dir = store_dir.as_ref();
    let path = VaultHeader::path(store_dir);
    let body =
        serde_json::to_string_pretty(header).map_err(|error| UprivError::VaultStoreInvalid {
            path: path.clone(),
            detail: format!("serialize vault.header: {error}"),
        })?;
    let bytes = body.as_bytes();
    paths::write_bytes_atomic(&path, bytes)?;
    paths::write_bytes_atomic(&VaultHeader::copy_path(store_dir), bytes)?;
    ensure_danger_notice(store_dir)
}

pub fn create_header(
    password: &[u8],
    preset: KdfUnlockPreset,
    master: &[u8; MASTER_KEY_LEN],
) -> Result<VaultHeader> {
    let salt = super::aead::random_bytes::<SALT_LEN>();
    let salt_b64 = B64.encode(salt);
    let mut header = VaultHeader {
        warning: HEADER_WARNING.to_string(),
        format_version: FORMAT_VERSION,
        content_identity: Uuid::new_v4(),
        kdf: HeaderKdf {
            alg: KDF_ALG.to_string(),
            memory_kib: preset.memory_kib(),
            time_cost: preset.time_cost(),
            parallelism: preset.parallelism(),
            salt_b64,
        },
        aead: AEAD_ID.to_string(),
        name_cipher: NAME_CIPHER_ID.to_string(),
        chunk_size: CHUNK_SIZE,
        wrapped_master_key_b64: String::new(),
    };
    let kek = derive_kek(
        password,
        &salt,
        header.kdf.memory_kib,
        header.kdf.time_cost,
        header.kdf.parallelism,
    )?;
    let aad = header.wrap_aad()?;
    let wrapped = wrap_master_key(&kek, master, &aad)?;
    header.wrapped_master_key_b64 = B64.encode(wrapped);
    Ok(header)
}

pub fn unwrap_header_master(
    header: &VaultHeader,
    password: &[u8],
) -> Result<zeroize::Zeroizing<[u8; MASTER_KEY_LEN]>> {
    let salt = B64
        .decode(header.kdf.salt_b64.as_bytes())
        .map_err(|_| UprivError::WrongPassword)?;
    if salt.len() != SALT_LEN {
        return Err(UprivError::WrongPassword);
    }
    let wrapped = B64
        .decode(header.wrapped_master_key_b64.as_bytes())
        .map_err(|_| UprivError::WrongPassword)?;
    let kek = derive_kek(
        password,
        &salt,
        header.kdf.memory_kib,
        header.kdf.time_cost,
        header.kdf.parallelism,
    )?;
    let aad = header.wrap_aad()?;
    unwrap_master_key(&kek, &wrapped, &aad)
}

#[cfg(test)]
mod aad_golden_tests {
    use super::*;
    use uuid::Uuid;

    fn fixture_header() -> VaultHeader {
        VaultHeader {
            warning: HEADER_WARNING.into(),
            format_version: FORMAT_VERSION,
            content_identity: Uuid::parse_str("00000000-0000-4000-8000-000000000001").unwrap(),
            kdf: HeaderKdf {
                alg: KDF_ALG.into(),
                memory_kib: 32 * 1024,
                time_cost: 3,
                parallelism: 1,
                salt_b64: "AAAAAAAAAAAAAAAAAAAAAA==".into(),
            },
            aead: AEAD_ID.into(),
            name_cipher: NAME_CIPHER_ID.into(),
            chunk_size: CHUNK_SIZE,
            wrapped_master_key_b64: "not-used-for-aad".into(),
        }
    }

    #[test]
    fn aad_bytes_are_struct_field_order() {
        let header = fixture_header();
        let wrap = header.wrap_aad().unwrap();
        let index = index_aad(&header).unwrap();
        let chunk = chunk_aad(
            &header,
            "11111111-1111-4111-8111-111111111111",
            2,
            37756,
            "a1b2c3d4e5f60718",
        )
        .unwrap();
        assert_eq!(
            wrap,
            br#"{"v":1,"cid":"00000000-0000-4000-8000-000000000001","kdf":"argon2id","m":32768,"t":3,"p":1,"salt":"AAAAAAAAAAAAAAAAAAAAAA==","aead":"xchacha20poly1305","names":"aes256-siv","chunk":262144,"kind":"wrap"}"#
        );
        assert_eq!(
            index,
            br#"{"v":1,"cid":"00000000-0000-4000-8000-000000000001","kdf":"argon2id","m":32768,"t":3,"p":1,"salt":"AAAAAAAAAAAAAAAAAAAAAA==","aead":"xchacha20poly1305","names":"aes256-siv","chunk":262144,"kind":"index"}"#
        );
        assert_eq!(
            chunk,
            br#"{"v":1,"cid":"00000000-0000-4000-8000-000000000001","aead":"xchacha20poly1305","chunk":262144,"kind":"chunk","file_id":"11111111-1111-4111-8111-111111111111","chunk_index":2,"chunk_len":37756,"version":"a1b2c3d4e5f60718"}"#
        );
    }

    /// The three omissions in [`ChunkAad`] are load-bearing for this format —
    /// assert them directly so a future "let's bind more context" edit fails here
    /// instead of silently making writes O(file) or bricking change-password.
    #[test]
    fn chunk_aad_omits_kdf_material_and_file_size() {
        let header = fixture_header();
        let chunk = chunk_aad(
            &header,
            "11111111-1111-4111-8111-111111111111",
            2,
            37756,
            "a1b2c3d4e5f60718",
        )
        .unwrap();
        let text = String::from_utf8(chunk).unwrap();
        for forbidden in ["\"salt\"", "\"m\":", "\"t\":", "\"p\":", "\"file_size\""] {
            assert!(
                !text.contains(forbidden),
                "chunk AAD must not bind {forbidden}: {text}"
            );
        }
        assert!(text.contains("\"version\":\"a1b2c3d4e5f60718\""));
    }

    #[test]
    fn chunk_version_changes_the_aad() {
        let header = fixture_header();
        let fid = "11111111-1111-4111-8111-111111111111";
        let a = chunk_aad(&header, fid, 0, 16, "aaaaaaaaaaaaaaaa").unwrap();
        let b = chunk_aad(&header, fid, 0, 16, "bbbbbbbbbbbbbbbb").unwrap();
        assert_ne!(a, b, "a rewritten chunk must not accept the stale blob");
    }
}
