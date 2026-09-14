//! `contents/vault.header` — JSON, versioned. Ciphertext is the wrapped master key only.

use std::path::{Path, PathBuf};

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::aead::{unwrap_master_key, wrap_master_key, MASTER_KEY_LEN};
use super::kdf::{derive_kek, KdfUnlockPreset, SALT_LEN};
use crate::error::{Result, UprivError};
use crate::paths;

pub const FORMAT_VERSION: u32 = 1;
pub const HEADER_FILE_NAME: &str = "vault.header";
pub const AEAD_ID: &str = "xchacha20poly1305";
pub const NAME_CIPHER_ID: &str = "aes256-siv";
pub const KDF_ALG: &str = "argon2id";
pub const CHUNK_SIZE: u32 = 256 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultHeader {
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
    pub fn path(contents_dir: impl AsRef<Path>) -> PathBuf {
        contents_dir.as_ref().join(HEADER_FILE_NAME)
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
/// (existing wrap/index/chunk tags would fail). Golden: `aad_bytes_are_struct_field_order`.
///
/// Chunk extras sit after `kind` and are omitted (`skip_serializing_if`) for wrap/index
/// so those JSON objects stay byte-identical to v1.
#[derive(Serialize)]
struct StoreAad<'a> {
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
    #[serde(skip_serializing_if = "Option::is_none")]
    file_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    chunk_index: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    file_size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    chunk_len: Option<u32>,
}

fn store_aad_bytes(
    header: &VaultHeader,
    kind: &'static str,
    chunk: Option<(&str, u32, u64, u32)>,
    err_path: PathBuf,
) -> Result<Vec<u8>> {
    let (file_id, chunk_index, file_size, chunk_len) = match chunk {
        Some((fid, idx, fsz, clen)) => (Some(fid), Some(idx), Some(fsz), Some(clen)),
        None => (None, None, None, None),
    };
    serde_json::to_vec(&StoreAad {
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
        file_id,
        chunk_index,
        file_size,
        chunk_len,
    })
    .map_err(|error| UprivError::VaultStoreInvalid {
        path: err_path,
        detail: format!("AAD serialize: {error}"),
    })
}

fn wrap_aad_bytes(header: &VaultHeader) -> Result<Vec<u8>> {
    store_aad_bytes(header, "wrap", None, PathBuf::from(HEADER_FILE_NAME))
}

pub fn index_aad(header: &VaultHeader) -> Result<Vec<u8>> {
    store_aad_bytes(header, "index", None, PathBuf::from("index/root.idx.enc"))
}

pub fn chunk_aad(
    header: &VaultHeader,
    file_id: &str,
    chunk_index: u32,
    file_size: u64,
    chunk_len: u32,
) -> Result<Vec<u8>> {
    // v1 still binds salt/m/t/p (same as wrap/index). That collides with
    // “change password = new wrap, same master, do not rewrite chunks.” Do not
    // ship rewrap that rotates salt until format_version ≥ 2 drops those fields
    // from *chunk* AAD only. Do not reorder these fields.
    store_aad_bytes(
        header,
        "chunk",
        Some((file_id, chunk_index, file_size, chunk_len)),
        PathBuf::from("data"),
    )
}

pub fn load_header(contents_dir: impl AsRef<Path>) -> Result<VaultHeader> {
    let path = VaultHeader::path(&contents_dir);
    if !path.is_file() {
        return Err(UprivError::VaultStoreInvalid {
            path: path.clone(),
            detail: "missing vault.header".into(),
        });
    }
    let raw = std::fs::read_to_string(&path)?;
    let header: VaultHeader =
        serde_json::from_str(&raw).map_err(|error| UprivError::VaultStoreInvalid {
            path: path.clone(),
            detail: format!("invalid vault.header: {error}"),
        })?;
    if header.format_version != FORMAT_VERSION {
        return Err(UprivError::VaultStoreInvalid {
            path,
            detail: format!("unsupported format_version {}", header.format_version),
        });
    }
    if header.kdf.alg != KDF_ALG
        || header.aead != AEAD_ID
        || header.name_cipher != NAME_CIPHER_ID
        || header.chunk_size != CHUNK_SIZE
    {
        return Err(UprivError::VaultStoreInvalid {
            path,
            detail: "unsupported algorithms or chunk size".into(),
        });
    }
    if !super::kdf::kdf_params_in_bounds(
        header.kdf.memory_kib,
        header.kdf.time_cost,
        header.kdf.parallelism,
    ) {
        return Err(UprivError::VaultStoreInvalid {
            path,
            detail: "KDF parameters out of bounds".into(),
        });
    }
    Ok(header)
}

pub fn save_header(contents_dir: impl AsRef<Path>, header: &VaultHeader) -> Result<()> {
    let path = VaultHeader::path(contents_dir);
    let body =
        serde_json::to_string_pretty(header).map_err(|error| UprivError::VaultStoreInvalid {
            path: path.clone(),
            detail: format!("serialize vault.header: {error}"),
        })?;
    paths::write_bytes_atomic(&path, body.as_bytes())
}

pub fn create_header(
    password: &[u8],
    preset: KdfUnlockPreset,
    master: &[u8; MASTER_KEY_LEN],
) -> Result<VaultHeader> {
    let salt = super::aead::random_bytes::<SALT_LEN>();
    let salt_b64 = B64.encode(salt);
    let mut header = VaultHeader {
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
            format_version: 1,
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
            300_000,
            37756,
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
            br#"{"v":1,"cid":"00000000-0000-4000-8000-000000000001","kdf":"argon2id","m":32768,"t":3,"p":1,"salt":"AAAAAAAAAAAAAAAAAAAAAA==","aead":"xchacha20poly1305","names":"aes256-siv","chunk":262144,"kind":"chunk","file_id":"11111111-1111-4111-8111-111111111111","chunk_index":2,"file_size":300000,"chunk_len":37756}"#
        );
    }
}
