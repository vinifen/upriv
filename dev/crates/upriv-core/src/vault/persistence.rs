//! `vaults/<id>/persistence.json` — closed-only rest metadata.

#[allow(unused_imports)]
use crate::host_fs::HostFsQuery;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{Result, UprivError};
use crate::paths;
use crate::time::utc_timestamp_iso_millis;

pub const PERSISTENCE_FILE_NAME: &str = "persistence.json";
/// The only `persistence.json` format.
const PERSISTENCE_FORMAT: u32 = 1;

/// What one machine knows about the backups it made. A data folder on a USB
/// drive moves between machines that may share an OS row and not a drive.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct BackupHostRecord {
    /// The chosen folder this machine last wrote to. While it matches the
    /// folder a backup resolves to and that folder is gone, the drive is not
    /// there, and a new folder is not made in its place.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chosen_dir: Option<String>,
    /// Logical index hash of this machine's last finished backup, ignoring
    /// `.upriv-workspace.json`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub index_hash: Option<String>,
    /// Stamp of that zip. A later close skips a new zip only while this file is
    /// still there, or its folder cannot be reached to tell.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stamp: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VaultPersistence {
    pub format_version: u32,
    pub vault_id: String,
    pub display_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_hash: Option<String>,
    /// The vault id at the first backup to a chosen folder, which names this
    /// vault's folder there. A rename keeps it, so the backups stay connected.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backup_folder_id: Option<String>,
    /// File names of the zips Upriv wrote, oldest first. Retention, partial
    /// cleanup, and Delete vault touch only these.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub backups_written: Vec<String>,
    /// One record per host name.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub backup_hosts: BTreeMap<String, BackupHostRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_close_ok_at: Option<String>,
    pub persistence: String,
}

/// The key of this machine's record. A machine that cannot read its host name
/// shares the empty key with any other such machine.
fn this_host() -> String {
    crate::lockfile::hostname().unwrap_or_default()
}

impl VaultPersistence {
    pub fn closed(vault_id: String, display_name: String, content_hash: Option<String>) -> Self {
        Self {
            format_version: PERSISTENCE_FORMAT,
            vault_id,
            display_name,
            content_hash,
            backup_folder_id: None,
            backups_written: Vec::new(),
            backup_hosts: BTreeMap::new(),
            last_close_ok_at: Some(utc_timestamp_iso_millis()),
            persistence: "closed".into(),
        }
    }

    /// A close recorded the store as it is now.
    pub(super) fn mark_closed(&mut self, vault_id: String, display_name: String, hash: String) {
        self.vault_id = vault_id;
        self.display_name = display_name;
        self.content_hash = Some(hash);
        self.last_close_ok_at = Some(utc_timestamp_iso_millis());
        self.persistence = "closed".into();
    }

    /// This machine's record, when it has one.
    pub(super) fn this_host_record(&self) -> Option<&BackupHostRecord> {
        self.backup_hosts.get(&this_host())
    }

    pub(super) fn this_host_record_mut(&mut self) -> &mut BackupHostRecord {
        self.backup_hosts.entry(this_host()).or_default()
    }

    /// True once a backup of this vault has gone to a chosen folder.
    pub fn has_outside_backups(&self) -> bool {
        self.backup_folder_id.is_some()
    }

    /// The store was rewritten: no zip holds it as it is now.
    fn forget_last_backups(&mut self) {
        for record in self.backup_hosts.values_mut() {
            record.index_hash = None;
            record.stamp = None;
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

/// Read this vault's record, change it, and write it back. A vault with no
/// record yet gets a closed one.
pub(super) fn update_vault_persistence(
    vault_dir: &Path,
    vault_id: &str,
    change: impl FnOnce(&mut VaultPersistence),
) -> Result<()> {
    let mut persistence = match load_vault_persistence(vault_dir)? {
        Some(saved) => saved,
        None => {
            let display_name = crate::config::load_vault_config_raw(vault_dir)
                .map(|config| config.vault.display_name)
                .unwrap_or_else(|_| vault_id.to_string());
            VaultPersistence::closed(vault_id.to_string(), display_name, None)
        }
    };
    change(&mut persistence);
    save_vault_persistence(vault_dir, &persistence)
}

/// After `store/` was written with no session (a password or unlock-RAM
/// change, a rebuild): the store's new content `hash` is recorded, so the list
/// does not read the change as a crash, and every machine's last backup is
/// dropped, so the next close writes a zip of the store as it is now.
pub(super) fn record_store_rewritten(
    vault_dir: &Path,
    vault_id: &str,
    display_name: &str,
    hash: &str,
) -> Result<()> {
    update_vault_persistence(vault_dir, vault_id, |persistence| {
        persistence.vault_id = vault_id.to_string();
        persistence.display_name = display_name.to_string();
        persistence.content_hash = Some(hash.to_string());
        persistence.forget_last_backups();
        persistence.persistence = "closed".to_string();
    })
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

    #[test]
    fn an_update_keeps_what_it_does_not_change() {
        let dir = tempfile::tempdir().unwrap();
        let mut saved = VaultPersistence::closed("notes".into(), "Notes".into(), None);
        saved.backups_written = vec!["20260101000000-notes.zip".into()];
        saved.backup_folder_id = Some("notes".into());
        save_vault_persistence(dir.path(), &saved).unwrap();

        update_vault_persistence(dir.path(), "notes", |persistence| {
            persistence.content_hash = Some("hash".into());
        })
        .unwrap();

        let loaded = load_vault_persistence(dir.path()).unwrap().unwrap();
        assert_eq!(loaded.content_hash.as_deref(), Some("hash"));
        assert_eq!(loaded.backups_written, saved.backups_written);
        assert_eq!(loaded.backup_folder_id, saved.backup_folder_id);
    }

    #[test]
    fn a_rewritten_store_drops_every_machines_last_backup_and_keeps_the_rest() {
        let dir = tempfile::tempdir().unwrap();
        let mut saved = VaultPersistence::closed("notes".into(), "Notes".into(), None);
        saved.backups_written = vec!["20260101000000-notes.zip".into()];
        for host in ["laptop", "desk"] {
            saved.backup_hosts.insert(
                host.into(),
                BackupHostRecord {
                    chosen_dir: Some("/mnt/drive".into()),
                    index_hash: Some("hash".into()),
                    stamp: Some("20260101000000".into()),
                },
            );
        }
        save_vault_persistence(dir.path(), &saved).unwrap();

        record_store_rewritten(dir.path(), "notes", "Notes", "new").unwrap();

        let loaded = load_vault_persistence(dir.path()).unwrap().unwrap();
        assert_eq!(loaded.content_hash.as_deref(), Some("new"));
        assert_eq!(loaded.backups_written, saved.backups_written);
        for record in loaded.backup_hosts.values() {
            assert_eq!(record.chosen_dir.as_deref(), Some("/mnt/drive"));
            assert!(record.index_hash.is_none());
            assert!(record.stamp.is_none());
        }
    }
}
