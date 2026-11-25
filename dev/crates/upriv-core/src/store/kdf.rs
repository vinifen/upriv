//! Argon2id unlock presets (SECURITY-CRYPTO). Chosen at create; stored in the header.

use argon2::{Algorithm, Argon2, Block, Params, Version};
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, Zeroizing};

use crate::error::{Result, UprivError};

/// Argon2's working memory (~`m` bytes), wiped when it drops, whether the
/// derive finished, failed, or panicked: its last block is one hash away from
/// the KEK, so leftover bytes would open the vault with no password guess.
///
/// The wipe runs after the derive, one pass over the blocks. It takes nothing
/// from the memory and passes every guess still pays. `Zeroizing<Vec<_>>`
/// would wipe the whole buffer a second time, a byte at a time, as spare
/// capacity once the vector is cleared; this buffer has none to wipe.
struct Argon2Memory(Vec<Block>);

impl Argon2Memory {
    /// Fallible allocation. Avoids `vec![]` abort on OOM so create/open can
    /// return `InsufficientRam` instead of killing the process.
    fn try_new(block_count: usize) -> Result<Self> {
        let mut blocks = Vec::new();
        if blocks.try_reserve_exact(block_count).is_err() {
            return Err(UprivError::InsufficientRam);
        }
        // Touch pages so overcommit hosts fail here (when possible) before derive.
        blocks.resize(block_count, Block::default());
        Ok(Self(blocks))
    }

    fn wipe(&mut self) {
        self.0.iter_mut().zeroize();
    }
}

impl Drop for Argon2Memory {
    fn drop(&mut self) {
        self.wipe();
    }
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
    #[serde(rename = "512mib")]
    M512,
    #[serde(rename = "1gib")]
    G1,
    #[serde(rename = "1536mib")]
    M1536,
    #[serde(rename = "2gib")]
    G2,
    #[serde(rename = "3gib")]
    G3,
    #[serde(rename = "4gib")]
    G4,
}

impl KdfUnlockPreset {
    /// Every preset, from the least RAM to the most.
    pub const ALL: [Self; 10] = [
        Self::M32,
        Self::M64,
        Self::M128,
        Self::M256,
        Self::M512,
        Self::G1,
        Self::M1536,
        Self::G2,
        Self::G3,
        Self::G4,
    ];

    /// The id the wire and `config.toml` comments use (`256mib`).
    pub fn as_str(self) -> &'static str {
        match self {
            Self::M32 => "32mib",
            Self::M64 => "64mib",
            Self::M128 => "128mib",
            Self::M256 => "256mib",
            Self::M512 => "512mib",
            Self::G1 => "1gib",
            Self::M1536 => "1536mib",
            Self::G2 => "2gib",
            Self::G3 => "3gib",
            Self::G4 => "4gib",
        }
    }

    /// The preset an id names; `None` for any other text.
    pub fn from_id(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|preset| preset.as_str() == id)
    }

    pub fn memory_kib(self) -> u32 {
        match self {
            Self::M32 => 32 * 1024,
            Self::M64 => 64 * 1024,
            Self::M128 => 128 * 1024,
            Self::M256 => 256 * 1024,
            Self::M512 => 512 * 1024,
            Self::G1 => 1024 * 1024,
            Self::M1536 => 1536 * 1024,
            Self::G2 => 2048 * 1024,
            Self::G3 => 3072 * 1024,
            Self::G4 => 4096 * 1024,
        }
    }

    /// Passes over the memory: fewer as the memory grows, so the unlock time
    /// grows slower than the RAM.
    pub fn time_cost(self) -> u32 {
        match self {
            Self::M32 | Self::M64 | Self::M128 | Self::M256 => 3,
            Self::M512 => 2,
            Self::G1 | Self::M1536 | Self::G2 | Self::G3 | Self::G4 => 1,
        }
    }

    pub fn parallelism(self) -> u32 {
        1
    }

    pub fn from_params(memory_kib: u32, time_cost: u32, parallelism: u32) -> Option<Self> {
        if parallelism != 1 {
            return None;
        }
        Self::ALL
            .into_iter()
            .find(|preset| preset.memory_kib() == memory_kib && preset.time_cost() == time_cost)
    }
}

pub const KEK_LEN: usize = 32;
pub const SALT_LEN: usize = 16;

/// The key a password derives to lock and open one header block's keyring.
pub type Kek = Zeroizing<[u8; KEK_LEN]>;

/// Shipping min `m` (32 MiB preset). Smaller header values are refuse-closed (not a cheaper wrap).
pub const MIN_KDF_MEMORY_KIB: u32 = 32 * 1024;
/// Shipping max `m` (4 GiB preset). Larger header values are treated as DoS, not a cheaper wrap.
pub const MAX_KDF_MEMORY_KIB: u32 = 4096 * 1024;
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
) -> Result<Kek> {
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
    let mut memory = Argon2Memory::try_new(block_count)?;
    let mut kek = Zeroizing::new([0u8; KEK_LEN]);
    match argon2.hash_password_into_with_memory(
        password,
        salt,
        kek.as_mut(),
        memory.0.as_mut_slice(),
    ) {
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

    /// Every preset reads back from its header params, stays in bounds, and
    /// takes more RAM than the one before it.
    #[test]
    fn presets_grow_and_read_back_from_their_params() {
        for pair in KdfUnlockPreset::ALL.windows(2) {
            assert!(pair[0].memory_kib() < pair[1].memory_kib());
        }
        for preset in KdfUnlockPreset::ALL {
            assert!(kdf_params_in_bounds(
                preset.memory_kib(),
                preset.time_cost(),
                preset.parallelism()
            ));
            assert_eq!(
                KdfUnlockPreset::from_params(
                    preset.memory_kib(),
                    preset.time_cost(),
                    preset.parallelism()
                ),
                Some(preset)
            );
        }
        assert_eq!(
            KdfUnlockPreset::ALL
                .last()
                .map(|preset| preset.memory_kib()),
            Some(MAX_KDF_MEMORY_KIB)
        );
    }

    /// The id the wire uses is the serde name, and reads back.
    #[test]
    fn preset_ids_match_the_wire_and_read_back() {
        for preset in KdfUnlockPreset::ALL {
            assert_eq!(
                serde_json::to_value(preset).unwrap(),
                serde_json::Value::String(preset.as_str().into())
            );
            assert_eq!(KdfUnlockPreset::from_id(preset.as_str()), Some(preset));
        }
        assert_eq!(KdfUnlockPreset::from_id("8gib"), None);
    }

    #[test]
    fn derive_kek_rejects_out_of_bounds_params_before_argon2() {
        let salt = [0u8; SALT_LEN];
        assert!(derive_kek(b"x", &salt, 8 * 1024, 3, 1).is_err());
        assert!(derive_kek(b"x", &salt, MAX_KDF_MEMORY_KIB + 1024, 1, 1).is_err());
        assert!(derive_kek(b"x", &salt, 32 * 1024, 3, 2).is_err());
        assert!(derive_kek(b"x", &salt, 32 * 1024, 0, 1).is_err());
        assert!(derive_kek(b"x", &salt, 32 * 1024, 17, 1).is_err());
    }

    #[test]
    fn argon2_memory_maps_reserve_failure_to_insufficient_ram() {
        assert!(matches!(
            Argon2Memory::try_new(usize::MAX / Block::SIZE),
            Err(UprivError::InsufficientRam)
        ));
    }

    /// What a drop runs: every block of a finished derive goes back to zeros.
    #[test]
    fn argon2_memory_is_all_zeros_after_its_wipe() {
        let params = Params::new(MIN_KDF_MEMORY_KIB, 1, 1, Some(KEK_LEN)).unwrap();
        let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params.clone());
        let mut memory = Argon2Memory::try_new(params.block_count()).unwrap();
        let mut kek = [0u8; KEK_LEN];
        argon2
            .hash_password_into_with_memory(
                b"pass-word-ok",
                &[7u8; SALT_LEN],
                &mut kek,
                memory.0.as_mut_slice(),
            )
            .unwrap();
        let zero = |block: &Block| block.as_ref().iter().all(|word| *word == 0);
        assert!(!memory.0.iter().all(zero), "the derive filled the memory");

        memory.wipe();
        assert_eq!(memory.0.len(), params.block_count());
        assert!(memory.0.iter().all(zero));
    }

    #[test]
    fn derive_kek_round_trips_smallest_shipping_preset() {
        let salt = [7u8; SALT_LEN];
        let kek = derive_kek(b"pass-word-ok", &salt, 32 * 1024, 3, 1).expect("32 MiB derive");
        let again = derive_kek(b"pass-word-ok", &salt, 32 * 1024, 3, 1).expect("again");
        assert_eq!(kek.as_ref(), again.as_ref());
    }
}
