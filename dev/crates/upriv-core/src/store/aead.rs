//! XChaCha20-Poly1305 wrap/chunks and AES-SIV index seal.

use aes_siv::{
    aead::{generic_array::GenericArray, Aead, KeyInit, Payload},
    Aes256SivAead,
};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use hkdf::Hkdf;
use rand::RngCore;
use sha2::Sha256;
use zeroize::Zeroizing;

use crate::error::{Result, UprivError};

pub const MASTER_KEY_LEN: usize = 32;
pub const CONTENT_KEY_LEN: usize = 32;
pub const INDEX_KEY_LEN: usize = 64;
pub const XCHACHA_NONCE_LEN: usize = 24;
pub const AES_SIV_NONCE_LEN: usize = 16;

const HKDF_CONTENT_INFO: &[u8] = b"upriv-content-key-v1";
const HKDF_INDEX_INFO: &[u8] = b"upriv-index-key-v1";

pub fn random_bytes<const N: usize>() -> [u8; N] {
    let mut bytes = [0u8; N];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    bytes
}

pub fn random_master_key() -> Zeroizing<[u8; MASTER_KEY_LEN]> {
    Zeroizing::new(random_bytes())
}

pub type ContentKey = Zeroizing<[u8; CONTENT_KEY_LEN]>;
pub type IndexKey = Zeroizing<[u8; INDEX_KEY_LEN]>;

/// HKDF-SHA256, `salt=None` (RFC 5869 zeros). Intentional: IKM is a 32-byte
/// CSPRNG master. Do not add a public salt without a `format_version` bump.
pub fn derive_layer_keys(master: &[u8; MASTER_KEY_LEN]) -> Result<(ContentKey, IndexKey)> {
    let hk = Hkdf::<Sha256>::new(None, master);
    let mut content = Zeroizing::new([0u8; CONTENT_KEY_LEN]);
    hk.expand(HKDF_CONTENT_INFO, content.as_mut())
        .map_err(|_| store_err("HKDF content key expand failed"))?;
    let mut index = Zeroizing::new([0u8; INDEX_KEY_LEN]);
    hk.expand(HKDF_INDEX_INFO, index.as_mut())
        .map_err(|_| store_err("HKDF index key expand failed"))?;
    Ok((content, index))
}

pub fn wrap_master_key(
    kek: &[u8; 32],
    master: &[u8; MASTER_KEY_LEN],
    aad: &[u8],
) -> Result<Vec<u8>> {
    encrypt_xchacha(kek, master, aad)
}

pub fn unwrap_master_key(
    kek: &[u8; 32],
    blob: &[u8],
    aad: &[u8],
) -> Result<Zeroizing<[u8; MASTER_KEY_LEN]>> {
    let plain = decrypt_xchacha(kek, blob, aad)?;
    if plain.len() != MASTER_KEY_LEN {
        return Err(UprivError::WrongPassword);
    }
    let mut key = Zeroizing::new([0u8; MASTER_KEY_LEN]);
    key.copy_from_slice(&plain);
    Ok(key)
}

pub fn encrypt_xchacha(key: &[u8; 32], plaintext: &[u8], aad: &[u8]) -> Result<Vec<u8>> {
    if aad.is_empty() {
        return Err(store_err("AAD required for XChaCha encrypt"));
    }
    let cipher = XChaCha20Poly1305::new(key.into());
    let nonce_bytes = random_bytes::<XCHACHA_NONCE_LEN>();
    let nonce = XNonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(
            nonce,
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| store_err("XChaCha20-Poly1305 encrypt failed"))?;
    let mut out = Vec::with_capacity(XCHACHA_NONCE_LEN + ciphertext.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

pub fn decrypt_xchacha(key: &[u8; 32], blob: &[u8], aad: &[u8]) -> Result<Vec<u8>> {
    if blob.len() <= XCHACHA_NONCE_LEN {
        return Err(UprivError::WrongPassword);
    }
    let (nonce_bytes, rest) = blob.split_at(XCHACHA_NONCE_LEN);
    let cipher = XChaCha20Poly1305::new(key.into());
    let nonce = XNonce::from_slice(nonce_bytes);
    cipher
        .decrypt(nonce, Payload { msg: rest, aad })
        .map_err(|_| UprivError::WrongPassword)
}

/// AES-SIV (crate `aes-siv` 0.7.0 — no public audit; constant-time warning is
/// residual). Do **not** replace with OpenSSL EVP AES-SIV (CVE-2026-45446) or a
/// hand-rolled SIV.
pub fn seal_index(
    index_key: &[u8; INDEX_KEY_LEN],
    plaintext: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>> {
    if aad.is_empty() {
        return Err(store_err("AAD required for AES-SIV index seal"));
    }
    let cipher = Aes256SivAead::new(GenericArray::from_slice(index_key));
    let nonce_bytes = random_bytes::<AES_SIV_NONCE_LEN>();
    let nonce = GenericArray::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(
            nonce,
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| store_err("AES-SIV index seal failed"))?;
    let mut out = Vec::with_capacity(AES_SIV_NONCE_LEN + ciphertext.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

pub fn open_index(index_key: &[u8; INDEX_KEY_LEN], blob: &[u8], aad: &[u8]) -> Result<Vec<u8>> {
    if aad.is_empty() {
        return Err(store_err("AAD required for AES-SIV index open"));
    }
    if blob.len() <= AES_SIV_NONCE_LEN {
        return Err(store_err("index blob truncated"));
    }
    let (nonce_bytes, rest) = blob.split_at(AES_SIV_NONCE_LEN);
    let cipher = Aes256SivAead::new(GenericArray::from_slice(index_key));
    let nonce = GenericArray::from_slice(nonce_bytes);
    cipher
        .decrypt(nonce, Payload { msg: rest, aad })
        .map_err(|_| store_err("AES-SIV index open failed"))
}

fn store_err(detail: &str) -> UprivError {
    UprivError::VaultStoreInvalid {
        path: std::path::PathBuf::from(crate::paths::STORE_DIR_NAME),
        detail: detail.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypt_xchacha_rejects_empty_aad() {
        let key = [7u8; 32];
        let err = encrypt_xchacha(&key, b"pt", b"").unwrap_err();
        assert!(matches!(err, UprivError::VaultStoreInvalid { .. }));
    }

    #[test]
    fn seal_index_rejects_empty_aad() {
        let key = [7u8; INDEX_KEY_LEN];
        let err = seal_index(&key, b"pt", b"").unwrap_err();
        assert!(matches!(err, UprivError::VaultStoreInvalid { .. }));
    }
}
