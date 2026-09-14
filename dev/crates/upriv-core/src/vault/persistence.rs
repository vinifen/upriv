//! `vaults/<id>/persistence.json` — closed-only rest metadata.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{Result, UprivError};
use crate::paths;
use crate::time::utc_timestamp_iso_millis;

pub const PERSISTENCE_FILE_NAME: &str = "persistence.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VaultPersistence {
    pub format_version: u32,
    pub vault_id: String,
    pub display_name: String,
    #[serde(default)]
    pub sync_generation: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_close_ok_at: Option<String>,
    pub persistence: String,
}

impl VaultPersistence {
    pub fn closed(vault_id: String, display_name: String, content_hash: Option<String>) -> Self {
        Self {
            format_version: 1,
            vault_id,
            display_name,
            sync_generation: 1,
            content_hash,
            last_close_ok_at: Some(utc_timestamp_iso_millis()),
            persistence: "closed".into(),
        }
    }
}

pub fn persistence_path(vault_dir: impl AsRef<Path>) -> PathBuf {
    vault_dir.as_ref().join(PERSISTENCE_FILE_NAME)
}

pub fn load_vault_persistence(vault_dir: impl AsRef<Path>) -> Result<Option<VaultPersistence>> {
    let path = persistence_path(vault_dir);
    if !path.is_file() {
        return Ok(None);
    }
    let raw = std::fs::read_to_string(&path)?;
    let parsed = serde_json::from_str(&raw).map_err(|error| UprivError::VaultStoreInvalid {
        path: path.clone(),
        detail: format!("invalid persistence.json: {error}"),
    })?;
    Ok(Some(parsed))
}

pub fn save_vault_persistence(
    vault_dir: impl AsRef<Path>,
    persistence: &VaultPersistence,
) -> Result<()> {
    let path = persistence_path(vault_dir);
    let body = serde_json::to_string_pretty(persistence).map_err(|error| {
        UprivError::VaultStoreInvalid {
            path: path.clone(),
            detail: format!("serialize persistence.json: {error}"),
        }
    })?;
    paths::write_bytes_atomic(&path, body.as_bytes())
}
