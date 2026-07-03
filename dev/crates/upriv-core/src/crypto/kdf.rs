use argon2::{Algorithm, Argon2, Params, Version};
use serde::{Deserialize, Serialize};

use crate::error::{Result, UprivError};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KdfParams {
    pub algorithm: String,
    pub salt_b64: String,
    pub memory_kib: u32,
    pub iterations: u32,
    pub parallelism: u32,
}

impl Default for KdfParams {
    fn default() -> Self {
        Self {
            algorithm: "argon2id".to_string(),
            salt_b64: String::new(),
            memory_kib: 131_072,
            iterations: 3,
            parallelism: 1,
        }
    }
}

pub fn derive_kek(password: &str, params: &KdfParams) -> Result<[u8; 32]> {
    if params.algorithm != "argon2id" {
        return Err(UprivError::Crypto(format!(
            "unsupported KDF: {}",
            params.algorithm
        )));
    }

    let salt = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        params.salt_b64.trim(),
    )
    .map_err(|err| UprivError::Crypto(format!("invalid salt_b64: {err}")))?;

    let argon_params = Params::new(
        params.memory_kib,
        params.iterations,
        params.parallelism,
        Some(32),
    )
    .map_err(|err| UprivError::Crypto(err.to_string()))?;

    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, argon_params);
    let mut out = [0u8; 32];
    argon
        .hash_password_into(password.as_bytes(), &salt, &mut out)
        .map_err(|err| UprivError::Crypto(err.to_string()))?;
    Ok(out)
}
