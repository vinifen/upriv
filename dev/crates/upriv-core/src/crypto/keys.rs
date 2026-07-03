use aes_siv::{
    aead::{generic_array::GenericArray, Aead, KeyInit},
    Aes256SivAead,
};
use chacha20poly1305::{aead::Aead as _, KeyInit as _, XChaCha20Poly1305, XNonce};
use hkdf::Hkdf;
use rand::RngCore;
use sha2::Sha256;
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::error::{Result, UprivError};

#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct MasterKey([u8; 32]);

impl MasterKey {
    pub fn generate() -> Self {
        let mut key = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut key);
        Self(key)
    }

    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct ContentKey([u8; 32]);

impl ContentKey {
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct IndexKey([u8; 64]);

impl IndexKey {
    pub fn as_bytes(&self) -> &[u8; 64] {
        &self.0
    }
}

pub fn derive_subkeys(master: &MasterKey) -> (ContentKey, IndexKey) {
    let hkdf = Hkdf::<Sha256>::new(None, master.as_bytes());
    let mut content = [0u8; 32];
    let mut index = [0u8; 64];
    hkdf.expand(b"upriv-content-v1", &mut content)
        .expect("hkdf expand content");
    hkdf.expand(b"upriv-index-v1", &mut index)
        .expect("hkdf expand index");
    (ContentKey(content), IndexKey(index))
}

pub fn wrap_master_key(kek: &[u8; 32], master: &MasterKey) -> Result<String> {
    let cipher = XChaCha20Poly1305::new_from_slice(kek)
        .map_err(|err| UprivError::Crypto(err.to_string()))?;
    let mut nonce_bytes = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = XNonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, master.as_bytes().as_ref())
        .map_err(|err| UprivError::Crypto(err.to_string()))?;
    let mut blob = Vec::with_capacity(24 + ciphertext.len());
    blob.extend_from_slice(&nonce_bytes);
    blob.extend_from_slice(&ciphertext);
    Ok(base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        blob,
    ))
}

pub fn unwrap_master_key(kek: &[u8; 32], wrapped_b64: &str) -> Result<MasterKey> {
    let blob = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        wrapped_b64.trim(),
    )
    .map_err(|err| UprivError::Crypto(format!("invalid wrapped_master_key_b64: {err}")))?;
    if blob.len() < 24 + 16 {
        return Err(UprivError::Crypto(
            "wrapped master key blob is too short".to_string(),
        ));
    }
    let (nonce_bytes, ciphertext) = blob.split_at(24);
    let cipher = XChaCha20Poly1305::new_from_slice(kek)
        .map_err(|err| UprivError::Crypto(err.to_string()))?;
    let nonce = XNonce::from_slice(nonce_bytes);
    let plain = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| UprivError::Crypto("wrong password or corrupt wrapped master key".into()))?;
    if plain.len() != 32 {
        return Err(UprivError::Crypto("invalid master key length".into()));
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(&plain);
    Ok(MasterKey(key))
}

pub fn encrypt_index(key: &IndexKey, plaintext: &[u8]) -> Result<Vec<u8>> {
    let cipher = Aes256SivAead::new_from_slice(key.as_bytes())
        .map_err(|err| UprivError::Crypto(err.to_string()))?;
    let nonce = GenericArray::from_slice(&[0u8; 16]);
    cipher
        .encrypt(nonce, plaintext)
        .map_err(|err| UprivError::Crypto(err.to_string()))
}

pub fn decrypt_index(key: &IndexKey, ciphertext: &[u8]) -> Result<Vec<u8>> {
    let cipher = Aes256SivAead::new_from_slice(key.as_bytes())
        .map_err(|err| UprivError::Crypto(err.to_string()))?;
    let nonce = GenericArray::from_slice(&[0u8; 16]);
    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| UprivError::Crypto("corrupt encrypted index".into()))
}

pub fn encrypt_chunk(key: &ContentKey, plaintext: &[u8]) -> Result<Vec<u8>> {
    let cipher = XChaCha20Poly1305::new_from_slice(key.as_bytes())
        .map_err(|err| UprivError::Crypto(err.to_string()))?;
    let mut nonce_bytes = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = XNonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|err| UprivError::Crypto(err.to_string()))?;
    let mut blob = Vec::with_capacity(24 + ciphertext.len());
    blob.extend_from_slice(&nonce_bytes);
    blob.extend_from_slice(&ciphertext);
    Ok(blob)
}

pub fn decrypt_chunk(key: &ContentKey, blob: &[u8]) -> Result<Vec<u8>> {
    if blob.len() < 24 + 16 {
        return Err(UprivError::Crypto("chunk blob is too short".into()));
    }
    let (nonce_bytes, ciphertext) = blob.split_at(24);
    let cipher = XChaCha20Poly1305::new_from_slice(key.as_bytes())
        .map_err(|err| UprivError::Crypto(err.to_string()))?;
    let nonce = XNonce::from_slice(nonce_bytes);
    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| UprivError::Crypto("corrupt chunk ciphertext".into()))
}
