//! Encrypted `auth/<vault_id>/.session.enc` for `disk_close` / `disk_open_close` modes (SDD §6.2).
//!
//! Never stores a UTF-8 password in plaintext. The blob holds password bytes encrypted with
//! either a machine-bound key (`disk_open_close`) or a password-derived key (`disk_close`).

use std::fs;
use std::path::PathBuf;

use chacha20poly1305::{aead::Aead, KeyInit, XChaCha20Poly1305, XNonce};
use hkdf::Hkdf;
use rand::RngCore;
use sha2::Sha256;

use crate::config::{load_vault_config, SecurityMode, VaultConfig};
use crate::crypto::{derive_kek, KdfParams};
use crate::error::{Result, UprivError};
use crate::paths::VaultRoot;
use crate::session::SessionPassword;

const MAGIC: &[u8; 4] = b"VHDS";
const VERSION: u8 = 1;
const FLAG_MACHINE_KEY: u8 = 0;
const FLAG_PASSWORD_KEY: u8 = 1;

pub fn session_enc_path(root: &VaultRoot, config: &VaultConfig) -> PathBuf {
    let auth_dir = config
        .vault
        .auth_dir
        .as_deref()
        .unwrap_or("auth");
    let session_file = config
        .vault
        .session_file
        .as_deref()
        .unwrap_or(".session.enc");
    root.vault_dir(&config.vault.id)
        .join(auth_dir)
        .join(session_file)
}

pub fn uses_disk_session(mode: SecurityMode) -> bool {
    matches!(mode, SecurityMode::DiskClose | SecurityMode::DiskOpenClose)
}

pub fn has_disk_session(root: &VaultRoot, vault_id: &str) -> Result<bool> {
    let config = load_vault_config(root, vault_id)?;
    if !uses_disk_session(config.security.mode) {
        return Ok(false);
    }
    Ok(session_enc_path(root, &config).is_file())
}

pub fn delete_disk_session(root: &VaultRoot, vault_id: &str) -> Result<()> {
    let config = load_vault_config(root, vault_id)?;
    let path = session_enc_path(root, &config);
    if path.is_file() {
        fs::remove_file(path)?;
    }
    Ok(())
}

/// Persist password material for disk security modes after a successful unlock.
pub fn persist_disk_session(
    root: &VaultRoot,
    vault_id: &str,
    password: &SessionPassword,
) -> Result<()> {
    let config = load_vault_config(root, vault_id)?;
    let mode = config.security.mode;
    if !uses_disk_session(mode) {
        return Ok(());
    }

    let plain = password
        .as_bytes()
        .to_vec();
    let path = session_enc_path(root, &config);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let blob = match mode {
        SecurityMode::DiskOpenClose => encrypt_machine(&config.vault.id, &plain)?,
        SecurityMode::DiskClose => encrypt_password_derived(&plain)?,
        _ => return Ok(()),
    };
    fs::write(path, blob)?;
    Ok(())
}

/// Read password bytes from disk session.
///
/// - `disk_open_close`: `password` may be `None` (machine key).
/// - `disk_close`: `password` is required to derive the decryption key.
pub fn read_disk_session(
    root: &VaultRoot,
    vault_id: &str,
    password: Option<&str>,
) -> Result<SessionPassword> {
    let config = load_vault_config(root, vault_id)?;
    let path = session_enc_path(root, &config);
    if !path.is_file() {
        return Err(UprivError::Crypto("disk session file not found".into()));
    }

    let blob = fs::read(path)?;
    let plain = match config.security.mode {
        SecurityMode::DiskOpenClose => decrypt_machine(&config.vault.id, &blob)?,
        SecurityMode::DiskClose => {
            let password = password.ok_or_else(|| {
                UprivError::Crypto("password required to read disk_close session".into())
            })?;
            decrypt_password_derived(password, &blob)?
        }
        _ => {
            return Err(UprivError::Crypto(
                "vault security mode does not use disk session".into(),
            ))
        }
    };

    let password_str = std::str::from_utf8(&plain)
        .map_err(|_| UprivError::Crypto("invalid disk session payload".into()))?;
    Ok(SessionPassword::from(password_str))
}

fn machine_kek(vault_id: &str) -> [u8; 32] {
    let host = std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("COMPUTERNAME"))
        .unwrap_or_else(|_| "upriv".to_string());
    let info = format!("upriv-disk-session-v1:{vault_id}");
    let hkdf = Hkdf::<Sha256>::new(Some(host.as_bytes()), info.as_bytes());
    let mut out = [0u8; 32];
    hkdf.expand(b"session-key", &mut out)
        .expect("hkdf expand session-key");
    out
}

fn encrypt_machine(vault_id: &str, plain: &[u8]) -> Result<Vec<u8>> {
    let kek = machine_kek(vault_id);
    encrypt_with_kek(&kek, FLAG_MACHINE_KEY, &[0u8; 16], plain)
}

fn decrypt_machine(vault_id: &str, blob: &[u8]) -> Result<Vec<u8>> {
    let kek = machine_kek(vault_id);
    decrypt_with_kek(&kek, FLAG_MACHINE_KEY, blob)
}

fn encrypt_password_derived(plain: &[u8]) -> Result<Vec<u8>> {
    let mut salt = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut salt);
    let mut params = KdfParams::default();
    params.salt_b64 = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        salt,
    );
    let kek = derive_kek(
        std::str::from_utf8(plain).unwrap_or(""),
        &params,
    )?;
    encrypt_with_kek(&kek, FLAG_PASSWORD_KEY, &salt, plain)
}

fn decrypt_password_derived(password: &str, blob: &[u8]) -> Result<Vec<u8>> {
    if blob.len() < 4 + 1 + 1 + 16 + 24 {
        return Err(UprivError::Crypto("disk session blob too short".into()));
    }
    let flags = blob[5];
    if flags != FLAG_PASSWORD_KEY {
        return Err(UprivError::Crypto("unexpected disk session flags".into()));
    }
    let salt = &blob[6..22];
    let mut params = KdfParams::default();
    params.salt_b64 = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        salt,
    );
    let kek = derive_kek(password, &params)?;
    decrypt_with_kek(&kek, FLAG_PASSWORD_KEY, blob)
}

fn encrypt_with_kek(
    kek: &[u8; 32],
    flags: u8,
    salt: &[u8; 16],
    plain: &[u8],
) -> Result<Vec<u8>> {
    let cipher = XChaCha20Poly1305::new_from_slice(kek)
        .map_err(|err| UprivError::Crypto(err.to_string()))?;
    let mut nonce_bytes = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = XNonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plain)
        .map_err(|err| UprivError::Crypto(err.to_string()))?;

    let mut blob = Vec::with_capacity(4 + 1 + 1 + 16 + 24 + ciphertext.len());
    blob.extend_from_slice(MAGIC);
    blob.push(VERSION);
    blob.push(flags);
    blob.extend_from_slice(salt);
    blob.extend_from_slice(&nonce_bytes);
    blob.extend_from_slice(&ciphertext);
    Ok(blob)
}

fn decrypt_with_kek(kek: &[u8; 32], expected_flags: u8, blob: &[u8]) -> Result<Vec<u8>> {
    if blob.len() < 4 + 1 + 1 + 16 + 24 + 16 {
        return Err(UprivError::Crypto("disk session blob too short".into()));
    }
    if &blob[..4] != MAGIC {
        return Err(UprivError::Crypto("invalid disk session magic".into()));
    }
    if blob[4] != VERSION {
        return Err(UprivError::Crypto("unsupported disk session version".into()));
    }
    if blob[5] != expected_flags {
        return Err(UprivError::Crypto("unexpected disk session flags".into()));
    }

    let (nonce_bytes, ciphertext) = blob[22..].split_at(24);
    let cipher = XChaCha20Poly1305::new_from_slice(kek)
        .map_err(|err| UprivError::Crypto(err.to_string()))?;
    let nonce = XNonce::from_slice(nonce_bytes);
    let plain = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| UprivError::Crypto("wrong password or corrupt disk session".into()))?;
    Ok(plain)
}

