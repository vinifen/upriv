//! Per-vault `vaults/<id>/config.toml` types (subset for list / future open-close).

use serde::{Deserialize, Serialize};

/// Storage mode from `[storage] mode` (TS `StorageMode`).
///
/// - `encrypted_dir` — encrypted store + virtual mount (default; optional `closed` cache)
/// - `store_only` — encrypted store primary; `.7z` on seal/export
/// - `ram_only` — `.7z` + RAM only; lock always seals
/// - `plain` — plaintext workspace + `.7z` while open; lock always seals
/// - `plain_only` — plaintext workspace only while open; lock always seals
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum VaultStorageMode {
    #[default]
    EncryptedDir,
    Plain,
    PlainOnly,
    RamOnly,
    StoreOnly,
}

/// `[vault]` identity section (required for a listable vault).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VaultIdentitySection {
    pub id: String,
    pub display_name: String,
    #[serde(default)]
    pub order: i64,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub hidden: bool,
    #[serde(default)]
    pub password_hint: String,
    #[serde(default)]
    pub vault_file: String,
    #[serde(default)]
    pub store_dir: String,
    #[serde(default)]
    pub backups_dir: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct VaultStorageSection {
    #[serde(default)]
    pub mode: VaultStorageMode,
}

/// Loaded vault config — enough for `vault_list`; more sections land with open/close.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VaultConfig {
    pub vault: VaultIdentitySection,
    #[serde(default)]
    pub storage: VaultStorageSection,
}

impl VaultConfig {
    pub fn id(&self) -> &str {
        &self.vault.id
    }

    pub fn display_name(&self) -> &str {
        &self.vault.display_name
    }

    pub fn storage_mode(&self) -> VaultStorageMode {
        self.storage.mode
    }
}
