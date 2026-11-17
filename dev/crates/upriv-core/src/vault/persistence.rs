//! `vaults/<id>/persistence.json` — closed-only rest metadata.

#[allow(unused_imports)]
use crate::host_fs::HostFsQuery;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::device::{this_device, DeviceId, DeviceSystem};
use crate::error::{Result, UprivError};
use crate::paths;
use crate::time::utc_timestamp_iso_millis;

pub const PERSISTENCE_FILE_NAME: &str = "persistence.json";
/// The only `persistence.json` format.
const PERSISTENCE_FORMAT: u32 = 1;

/// The reference of the data folder's backups: the same folder on every
/// device, so it names no device.
pub const DATA_FOLDER_REF: &str = "data";

/// A folder outside the data folder that holds zips of this vault.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct BackupFolderRef {
    /// Names the folder in backup keys and in `backups_written`.
    #[serde(rename = "ref")]
    pub reference: String,
    /// The device that wrote there ([`crate::device::ThisDevice::record_key`]),
    /// and its system: with the start of the ID, how the UI names it.
    pub device: String,
    pub system: DeviceSystem,
    /// The folder that holds the zips and `saves/`.
    pub dir: String,
    /// The person selected this folder's row again: the next backup makes the
    /// vault's folder there when it is missing. Without it, a vault folder
    /// missing from a folder this device wrote to means its drive is away.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub reuse: bool,
}

/// A zip Upriv wrote, and the folder it is in.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct WrittenZip {
    pub name: String,
    /// [`DATA_FOLDER_REF`] or a [`BackupFolderRef::reference`].
    pub folder: String,
}

/// What one device knows about its last backup. A data folder on a USB
/// drive moves between devices that do not share a drive.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct BackupDeviceRecord {
    /// Logical index hash of this device's last finished backup, ignoring
    /// `.upriv-workspace.json`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub index_hash: Option<String>,
    /// Stamp of that zip.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stamp: Option<String>,
    /// The folder it is in. A close skips its zip only while this is the
    /// folder in use.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct VaultPersistence {
    pub format_version: u32,
    pub vault_id: String,
    pub display_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_hash: Option<String>,
    /// About what the vault's files hold, in bytes, as the index counts them.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub files_bytes: Option<u64>,
    /// The vault id at its first backup outside the data folder, which names
    /// this vault's folder there. A rename keeps it, so the backups stay
    /// connected.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backup_folder_id: Option<String>,
    /// The folders outside the data folder that hold zips Upriv wrote.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub backup_folders: Vec<BackupFolderRef>,
    /// The zips Upriv wrote, oldest first. Retention, partial cleanup, and
    /// Delete vault touch only these.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub backups_written: Vec<WrittenZip>,
    /// One record per device ID.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub backup_devices: BTreeMap<DeviceId, BackupDeviceRecord>,
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
            files_bytes: None,
            backup_folder_id: None,
            backup_folders: Vec::new(),
            backups_written: Vec::new(),
            backup_devices: BTreeMap::new(),
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

    /// This device's record, when it has one. An unknown device has none.
    pub(super) fn this_device_record(&self) -> Option<&BackupDeviceRecord> {
        self.backup_devices.get(this_device().id.as_ref()?)
    }

    /// This device's record, made when missing. `None` for an unknown
    /// device, which records nothing.
    pub(super) fn this_device_record_mut(&mut self) -> Option<&mut BackupDeviceRecord> {
        let id = this_device().id.clone()?;
        Some(self.backup_devices.entry(id).or_default())
    }

    /// True while zips of this vault are recorded outside the data folder.
    pub fn has_outside_backups(&self) -> bool {
        !self.backup_folders.is_empty()
    }

    /// The folder `reference` names, outside the data folder.
    pub(super) fn folder(&self, reference: &str) -> Option<&BackupFolderRef> {
        self.backup_folders
            .iter()
            .find(|folder| folder.reference == reference)
    }

    /// The reference this device writes to `dir` under, made when missing.
    pub(super) fn folder_ref_for(&mut self, dir: &str) -> String {
        let device = this_device();
        let key = device.record_key();
        if let Some(found) = self
            .backup_folders
            .iter_mut()
            .find(|folder| folder.dir == dir && folder.device == key)
        {
            found.reuse = false;
            return found.reference.clone();
        }
        let next = self
            .backup_folders
            .iter()
            .filter_map(|folder| folder.reference.strip_prefix('f')?.parse::<u32>().ok())
            .max()
            .unwrap_or(0)
            + 1;
        let reference = format!("f{next}");
        self.backup_folders.push(BackupFolderRef {
            reference: reference.clone(),
            device: key,
            system: device.system,
            dir: dir.to_string(),
            reuse: false,
        });
        reference
    }

    /// The written zips in `folder`.
    pub(super) fn written_in<'a>(
        &'a self,
        folder: &'a str,
    ) -> impl Iterator<Item = &'a WrittenZip> + 'a {
        self.backups_written
            .iter()
            .filter(move |written| written.folder == folder)
    }

    /// Drop the references that no written zip names, and each device's
    /// last backup in them.
    pub(super) fn drop_empty_folders(&mut self) {
        let named: std::collections::HashSet<&str> = self
            .backups_written
            .iter()
            .map(|written| written.folder.as_str())
            .collect();
        let gone: Vec<String> = self
            .backup_folders
            .iter()
            .filter(|folder| !named.contains(folder.reference.as_str()))
            .map(|folder| folder.reference.clone())
            .collect();
        self.backup_folders
            .retain(|folder| !gone.contains(&folder.reference));
        for record in self.backup_devices.values_mut() {
            if record
                .folder
                .as_ref()
                .is_some_and(|folder| gone.contains(folder))
            {
                record.folder = None;
            }
        }
    }

    /// The store was rewritten: no zip holds it as it is now.
    fn forget_last_backups(&mut self) {
        for record in self.backup_devices.values_mut() {
            record.index_hash = None;
            record.stamp = None;
            record.folder = None;
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
            let display_name = crate::config::load_vault_config(vault_dir)
                .map(|config| config.vault.display_name)
                .unwrap_or_else(|_| vault_id.to_string());
            VaultPersistence::closed(vault_id.to_string(), display_name, None)
        }
    };
    change(&mut persistence);
    save_vault_persistence(vault_dir, &persistence)
}

/// The header or index files of the closed vault at `vault_dir` were written
/// with its content unchanged: an unlock that repaired a twin file, a pass
/// that sealed its end. The hash they have now is recorded, so the list does
/// not read the write as a change outside Upriv.
pub(crate) fn record_store_hash(vault_dir: &Path, vault_id: &str) -> Result<()> {
    let hash = crate::store::content_hash_hex(vault_dir.join(crate::paths::STORE_DIR_NAME))?;
    update_vault_persistence(vault_dir, vault_id, |persistence| {
        persistence.content_hash = Some(hash);
    })
}

/// After `store/` was written with no session (a password or unlock-RAM
/// change, a rebuild): the store's new content `hash` is recorded, so the list
/// does not read the change as a crash, and every machine's last backup is
/// dropped, so the next close writes a zip of the store as it is now. A
/// rebuild also records what its new tree holds (`files_bytes`).
pub(super) fn record_store_rewritten(
    vault_dir: &Path,
    vault_id: &str,
    display_name: &str,
    hash: &str,
    files_bytes: Option<u64>,
) -> Result<()> {
    update_vault_persistence(vault_dir, vault_id, |persistence| {
        persistence.vault_id = vault_id.to_string();
        persistence.display_name = display_name.to_string();
        persistence.content_hash = Some(hash.to_string());
        if files_bytes.is_some() {
            persistence.files_bytes = files_bytes;
        }
        persistence.forget_last_backups();
        persistence.persistence = "closed".to_string();
    })
}

/// Drop the last-backup records of `devices`: their backup groups were removed.
pub(crate) fn forget_backup_devices(
    vault_dir: &Path,
    vault_id: &str,
    devices: &[DeviceId],
) -> Result<()> {
    let Some(saved) = load_vault_persistence(vault_dir)? else {
        return Ok(());
    };
    if !devices
        .iter()
        .any(|id| saved.backup_devices.contains_key(id))
    {
        return Ok(());
    }
    update_vault_persistence(vault_dir, vault_id, |persistence| {
        persistence
            .backup_devices
            .retain(|id, _| !devices.contains(id));
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn written(name: &str, folder: &str) -> WrittenZip {
        WrittenZip {
            name: name.into(),
            folder: folder.into(),
        }
    }

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
        saved.backups_written = vec![written("20260101000000-notes.zip", DATA_FOLDER_REF)];
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
    fn a_rewritten_store_drops_every_devices_last_backup_and_keeps_the_rest() {
        let dir = tempfile::tempdir().unwrap();
        let mut saved = VaultPersistence::closed("notes".into(), "Notes".into(), None);
        saved.backups_written = vec![written("20260101000000-notes.zip", DATA_FOLDER_REF)];
        for machine in [b"laptop".as_slice(), b"desk"] {
            saved.backup_devices.insert(
                DeviceId::from_machine_id(machine),
                BackupDeviceRecord {
                    index_hash: Some("hash".into()),
                    stamp: Some("20260101000000".into()),
                    folder: Some(DATA_FOLDER_REF.into()),
                },
            );
        }
        save_vault_persistence(dir.path(), &saved).unwrap();

        record_store_rewritten(dir.path(), "notes", "Notes", "new", None).unwrap();

        let loaded = load_vault_persistence(dir.path()).unwrap().unwrap();
        assert_eq!(loaded.content_hash.as_deref(), Some("new"));
        assert_eq!(loaded.backups_written, saved.backups_written);
        assert_eq!(loaded.backup_devices.len(), 2);
        for record in loaded.backup_devices.values() {
            assert_eq!(record, &BackupDeviceRecord::default());
        }
    }

    #[test]
    fn a_folder_gets_one_reference_per_device_and_goes_with_its_last_zip() {
        let mut saved = VaultPersistence::closed("notes".into(), "Notes".into(), None);
        let first = saved.folder_ref_for("/mnt/b/upriv-backups/notes");
        assert_eq!(first, "f1");
        assert_eq!(saved.folder_ref_for("/mnt/b/upriv-backups/notes"), "f1");
        assert_eq!(saved.folder_ref_for("/mnt/c/upriv-notes-backups"), "f2");
        saved.backups_written = vec![written("20260101000000-notes.zip", "f2")];
        saved.drop_empty_folders();
        assert!(saved.folder("f1").is_none());
        assert!(saved.folder("f2").is_some());
        assert_eq!(saved.folder_ref_for("/mnt/b/upriv-backups/notes"), "f3");
    }

    #[test]
    fn a_removed_device_group_drops_its_last_backup() {
        let dir = tempfile::tempdir().unwrap();
        let laptop = DeviceId::from_machine_id(b"laptop");
        let desk = DeviceId::from_machine_id(b"desk");
        let mut saved = VaultPersistence::closed("notes".into(), "Notes".into(), None);
        for id in [&laptop, &desk] {
            saved
                .backup_devices
                .insert(id.clone(), BackupDeviceRecord::default());
        }
        save_vault_persistence(dir.path(), &saved).unwrap();
        forget_backup_devices(dir.path(), "notes", std::slice::from_ref(&laptop)).unwrap();
        let loaded = load_vault_persistence(dir.path()).unwrap().unwrap();
        assert_eq!(
            loaded.backup_devices.keys().collect::<Vec<_>>(),
            vec![&desk]
        );
    }
}
