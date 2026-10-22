//! `vaults/<id>/persistence.json` — closed-only rest metadata.

#[allow(unused_imports)]
use crate::host_fs::HostFsQuery;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{Result, UprivError};
use crate::paths;
use crate::time::utc_timestamp_iso_millis;

pub const PERSISTENCE_FILE_NAME: &str = "persistence.json";
/// The only `persistence.json` format.
const PERSISTENCE_FORMAT: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VaultPersistence {
    pub format_version: u32,
    pub vault_id: String,
    pub display_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_hash: Option<String>,
    /// Logical index hash of the last backup that finished, ignoring
    /// `.upriv-workspace.json`. Absent until one does.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backed_up_index_hash: Option<String>,
    /// Stamp of that zip. A later close skips a new zip only while this file is still listed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backed_up_stamp: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_close_ok_at: Option<String>,
    pub persistence: String,
}

impl VaultPersistence {
    pub fn closed(vault_id: String, display_name: String, content_hash: Option<String>) -> Self {
        Self {
            format_version: PERSISTENCE_FORMAT,
            vault_id,
            display_name,
            content_hash,
            backed_up_index_hash: None,
            backed_up_stamp: None,
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
    if !path.host_is_file() {
        return Ok(None);
    }
    let raw = crate::host_fs::read_to_string(&path)?;
    let parsed: VaultPersistence =
        serde_json::from_str(&raw).map_err(|error| UprivError::VaultStoreInvalid {
            path: path.clone(),
            detail: format!("invalid persistence.json: {error}"),
        })?;
    if parsed.format_version != PERSISTENCE_FORMAT {
        return Err(UprivError::VaultStoreInvalid {
            path,
            detail: format!(
                "persistence.json format_version is {}, not {PERSISTENCE_FORMAT}",
                parsed.format_version
            ),
        });
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_persistence_file_of_another_format_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let saved = VaultPersistence::closed("notes".into(), "Notes".into(), None);
        save_vault_persistence(dir.path(), &saved).unwrap();
        assert_eq!(load_vault_persistence(dir.path()).unwrap(), Some(saved));

        let other = r#"{"format_version":2,"vault_id":"notes","display_name":"Notes","persistence":"closed"}"#;
        crate::host_fs::write(persistence_path(dir.path()), other.as_bytes()).unwrap();
        assert!(matches!(
            load_vault_persistence(dir.path()),
            Err(UprivError::VaultStoreInvalid { .. })
        ));
    }
}
