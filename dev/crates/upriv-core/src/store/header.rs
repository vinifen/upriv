use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::crypto::{derive_kek, derive_subkeys, unwrap_master_key, wrap_master_key, KdfParams, MasterKey};
use crate::error::{Result, UprivError};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultHeader {
    pub format: String,
    pub version: u32,
    pub vault_id: String,
    pub kdf: KdfParams,
    pub crypto: CryptoParams,
    pub wrapped_master_key_b64: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CryptoParams {
    pub content_cipher: String,
    pub name_cipher: String,
    pub chunk_size: u32,
}

impl VaultHeader {
    pub fn new(vault_id: &str, kdf: KdfParams, wrapped_master_key_b64: String) -> Self {
        Self {
            format: "upriv-encrypted-dir".to_string(),
            version: 1,
            vault_id: vault_id.to_string(),
            kdf,
            crypto: CryptoParams {
                content_cipher: "XChaCha20-Poly1305".to_string(),
                name_cipher: "AES-SIV".to_string(),
                chunk_size: 262_144,
            },
            wrapped_master_key_b64,
            created_at: None,
        }
    }

    pub fn load(path: &Path) -> Result<Self> {
        let raw = std::fs::read_to_string(path)?;
        let header: Self = serde_json::from_str(&raw)?;
        if header.format != "upriv-encrypted-dir" {
            return Err(UprivError::InvalidStore(format!(
                "unsupported store format: {}",
                header.format
            )));
        }
        Ok(header)
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, serde_json::to_string_pretty(self)?)?;
        Ok(())
    }

    pub fn unlock_master_key(&self, password: &str) -> Result<MasterKey> {
        let kek = derive_kek(password, &self.kdf)?;
        unwrap_master_key(&kek, &self.wrapped_master_key_b64)
    }
}

pub fn create_header(vault_id: &str, password: &str) -> Result<(VaultHeader, MasterKey)> {
    let mut salt = [0u8; 16];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut salt);
    let salt_b64 = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        salt,
    );
    let kdf = KdfParams {
        salt_b64,
        ..KdfParams::default()
    };
    let kek = derive_kek(password, &kdf)?;
    let master = MasterKey::generate();
    let wrapped = wrap_master_key(&kek, &master)?;
    Ok((VaultHeader::new(vault_id, kdf, wrapped), master))
}

pub fn store_layout_root(store_dir: &Path) -> PathBuf {
    store_dir.to_path_buf()
}

pub fn index_path(store_dir: &Path) -> PathBuf {
    store_dir.join("index").join("root.idx.enc")
}

pub fn chunk_path(store_dir: &Path, chunk_id: &str) -> PathBuf {
    if chunk_id.len() < 4 {
        return store_dir.join("data").join(chunk_id).join(format!("{chunk_id}.chunk.enc"));
    }
    store_dir
        .join("data")
        .join(&chunk_id[0..2])
        .join(&chunk_id[2..4])
        .join(format!("{chunk_id}.chunk.enc"))
}

pub fn is_demo_blob(bytes: &[u8]) -> bool {
    bytes.starts_with(b"ENCv1:")
}
