//! Argon2id unlock presets (SECURITY-CRYPTO). Chosen at create; stored in the header.

use argon2::{Algorithm, Argon2, Block, Params, Version};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::error::{Result, UprivError};

/// Fallible Argon2 working buffer (~`m` bytes). Avoids `vec![]` abort on OOM so
/// create/open can return `InsufficientRam` instead of killing the process.
fn try_alloc_argon2_blocks(block_count: usize) -> Result<Vec<Block>> {
    let mut blocks = Vec::new();
    if blocks.try_reserve_exact(block_count).is_err() {
        return Err(UprivError::InsufficientRam);
    }
    // Touch pages so overcommit hosts fail here (when possible) before derive.
    blocks.resize(block_count, Block::default());
    Ok(blocks)
}

/// Shipping unlock-cost ids — keep in sync with TS `KdfUnlockPreset`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum KdfUnlockPreset {
    #[serde(rename = "32mib")]
    M32,
    #[serde(rename = "64mib")]
    M64,
    #[serde(rename = "128mib")]
    M128,
    #[serde(rename = "256mib")]
    M256,
    #[serde(rename = "1gib")]
    G1,
    #[serde(rename = "2gib")]
    G2,
}

impl KdfUnlockPreset {
    pub const DEFAULT: Self = Self::M256;

    pub fn memory_kib(self) -> u32 {
        match self {
            Self::M32 => 32 * 1024,
            Self::M64 => 64 * 1024,
            Self::M128 => 128 * 1024,
            Self::M256 => 256 * 1024,
            Self::G1 => 1024 * 1024,
            Self::G2 => 2048 * 1024,
        }
    }

    pub fn time_cost(self) -> u32 {
        match self {
            Self::M32 | Self::M64 | Self::M128 | Self::M256 => 3,
            Self::G1 | Self::G2 => 1,
        }
    }

    pub fn parallelism(self) -> u32 {
        1
    }

    pub fn from_params(memory_kib: u32, time_cost: u32, parallelism: u32) -> Option<Self> {
        if parallelism != 1 {
            return None;
        }
        [
            Self::M32,
            Self::M64,
            Self::M128,
            Self::M256,
            Self::G1,
            Self::G2,
        ]
        .into_iter()
        .find(|preset| preset.memory_kib() == memory_kib && preset.time_cost() == time_cost)
    }
}

pub const KEK_LEN: usize = 32;
pub const SALT_LEN: usize = 16;

/// Shipping min `m` (32 MiB preset). Smaller header values are refuse-closed (not a cheaper wrap).
pub const MIN_KDF_MEMORY_KIB: u32 = 32 * 1024;
/// Shipping max `m` (2 GiB preset). Larger header values are treated as DoS, not a cheaper wrap.
pub const MAX_KDF_MEMORY_KIB: u32 = 2048 * 1024;
/// Cap `t` so a malicious header cannot spin forever. Shipping presets use 1 or 3.
pub const MAX_KDF_TIME_COST: u32 = 16;

pub fn kdf_params_in_bounds(memory_kib: u32, time_cost: u32, parallelism: u32) -> bool {
    (MIN_KDF_MEMORY_KIB..=MAX_KDF_MEMORY_KIB).contains(&memory_kib)
        && time_cost > 0
        && time_cost <= MAX_KDF_TIME_COST
        && parallelism == 1
}

/// Derive the wrap KEK. Password bytes are used **exactly as given** (no trim).
pub fn derive_kek(
    password: &[u8],
    salt: &[u8],
    memory_kib: u32,
    time_cost: u32,
    p: u32,
) -> Result<Zeroizing<[u8; KEK_LEN]>> {
    if !kdf_params_in_bounds(memory_kib, time_cost, p) {
        return Err(UprivError::VaultStoreInvalid {
            path: std::path::PathBuf::from("header/vault.header"),
            detail: "KDF parameters out of bounds".into(),
        });
    }
    let params = Params::new(memory_kib, time_cost, p, Some(KEK_LEN)).map_err(|error| {
        UprivError::VaultStoreInvalid {
            path: std::path::PathBuf::from("header/vault.header"),
            detail: format!("invalid Argon2id params: {error}"),
        }
    })?;
    // Version 0x13 is hardcoded, not in header/AAD. Putting it in AAD is a format bump.
    let block_count = params.block_count();
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut blocks = try_alloc_argon2_blocks(block_count)?;
    let mut kek = Zeroizing::new([0u8; KEK_LEN]);
    match argon2.hash_password_into_with_memory(password, salt, kek.as_mut(), &mut blocks) {
        Ok(()) => Ok(kek),
        Err(argon2::Error::MemoryTooLittle) | Err(argon2::Error::MemoryTooMuch) => {
            Err(UprivError::InsufficientRam)
        }
        Err(error) => Err(UprivError::VaultStoreInvalid {
            path: std::path::PathBuf::from("header/vault.header"),
            detail: format!("Argon2id failed: {error}"),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn argon2_version_is_hardcoded_0x13() {
        assert_eq!(Version::V0x13 as u32, 0x13);
    }

    #[test]
    fn derive_kek_rejects_out_of_bounds_params_before_argon2() {
        let salt = [0u8; SALT_LEN];
        assert!(derive_kek(b"x", &salt, 8 * 1024, 3, 1).is_err());
        assert!(derive_kek(b"x", &salt, 4096 * 1024, 3, 1).is_err());
        assert!(derive_kek(b"x", &salt, 32 * 1024, 3, 2).is_err());
        assert!(derive_kek(b"x", &salt, 32 * 1024, 0, 1).is_err());
        assert!(derive_kek(b"x", &salt, 32 * 1024, 17, 1).is_err());
    }

    #[test]
    fn try_alloc_argon2_blocks_maps_reserve_failure_to_insufficient_ram() {
        assert!(matches!(
            try_alloc_argon2_blocks(usize::MAX / Block::SIZE),
            Err(UprivError::InsufficientRam)
        ));
    }

    #[test]
    fn derive_kek_round_trips_smallest_shipping_preset() {
        let salt = [7u8; SALT_LEN];
        let kek = derive_kek(b"pass-word-ok", &salt, 32 * 1024, 3, 1).expect("32 MiB derive");
        let again = derive_kek(b"pass-word-ok", &salt, 32 * 1024, 3, 1).expect("again");
        assert_eq!(kek.as_ref(), again.as_ref());
    }
}
