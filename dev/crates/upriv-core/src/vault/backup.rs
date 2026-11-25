//! Frozen ciphertext copies of `store/` as Stored zips with no zip password.
//!
//! A vault's backups go to the folder its backup list selects on this device:
//! the data folder (`vaults/<id>/backups/`) or a row ([`super::backup_folder`]).
//! When that folder fails, the first choice of the chain that works takes the
//! zip, and the switch is saved. Each folder holds `<stamp>-<id>.zip` and
//! `saves/`; a named backup is `saves/<stamp>-<id> <name>.zip`. A backup
//! stays in the folder it was written to: zips elsewhere stay listed, and only
//! the folder in use rotates.
//!
//! A key names a zip by its folder's reference, never by a path:
//! `<folder>/<name>` or `<folder>/saves/<name>`, with `data` for the data
//! folder and `use` for the folder in use before a zip of this vault is
//! recorded there.
//!
//! Upriv deletes on its own only the zips on the list it keeps of what it
//! wrote (`backups_written`), so a person's own files, and a copy of the data
//! folder that shares a folder, are left alone.

#[allow(unused_imports)]
use crate::host_fs::HostFsQuery;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::backup_folder::{
    check_readable, check_target, targets, zip_bytes_of, BackupTarget, Targets, BACKUPS_DIR,
};
use super::embedded_settings::snapshot_settings_bytes;
use super::export_folder::{
    check_export_folder, ExportedFile, NumberedExportName, NumberedExportTarget,
};
use super::partial::{discard_partial, PartialWork};
use super::persistence::{
    load_vault_persistence, update_vault_persistence, VaultPersistence, WrittenZip, DATA_FOLDER_REF,
};
use crate::config::list_saves::save_backup_switch;
use crate::config::{load_vault_config, VaultBackupMode};
use crate::device::{this_device, DeviceSystem};
use crate::error::{Result, UprivError};
use crate::failure::classify_write_failure;
use crate::folder_list::backup::{selections_taking, switches, BackupSelections};
use crate::folder_list::{fail_over, Failover, Switch, Try};
use crate::folder_probe::{
    flush_is_unsupported, FolderState, FOLDER_STATUS_CHECK_LIMIT, FOLDER_SWITCH_CHECK_LIMIT,
};
use crate::logging::{log_event, LogLevel};
use crate::paths::{VaultRoot, STORE_DIR_NAME};
use crate::runtime_state::{refuse_if_held_elsewhere, UnfinishedWork};
use crate::session::{
    ensure_backups_not_exporting, ensure_data_folder_export_idle, remove_backup_unless_exporting,
    try_with_vault_dir_lock, with_vault_dir_lock, BackupExportGuard, Job, JobKind,
};
use crate::store::{backup_zip_header, load_header};
use crate::time::utc_filename_stamp;

const SAVES_DIR: &str = "saves";
/// The key of the folder in use before a zip of this vault is recorded there.
const IN_USE_KEY: &str = "use";
/// Names a finished zip tries when another computer took each one first.
const INSTALL_NAME_TRIES: usize = 8;
/// Longest name of a backup, in characters.
pub const BACKUP_NAME_MAX_CHARS: usize = 80;

/// One zip.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupEntry {
    /// Selects this zip: `<folder>/<file>` or `<folder>/saves/<file>`.
    pub key: String,
    pub stamp: String,
    /// On-disk name, `<stamp>-<id>.zip` or `<stamp>-<id> <name>.zip`.
    pub file_name: String,
    /// The name the person gave it; empty when it has none.
    pub name: String,
    pub created_at: String,
    pub size_bytes: u64,
    pub saved: bool,
    pub path: PathBuf,
    /// Its header unlocks with less RAM than the vault's does now: someone
    /// who has this zip guesses the password at that lower cost.
    pub lower_unlock_ram: bool,
}

/// Which folder a section of the listing shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SectionKind {
    DataFolder,
    /// The folder this device writes to now, when it is not the data folder.
    InUse,
    /// A folder Upriv no longer writes to or deletes from on its own.
    Other,
}

/// One folder's backups, and what it can do now.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSection {
    /// `data`, a folder reference, or `use`.
    pub folder: String,
    pub kind: SectionKind,
    pub path: PathBuf,
    /// The device that wrote there; none for the data folder.
    pub device: Option<SectionDevice>,
    pub status: FolderState,
    pub entries: Vec<BackupEntry>,
}

/// The device that wrote a folder's zips: its ID
/// ([`crate::device::ThisDevice::record_key`]) and its system, from which
/// the UI names it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SectionDevice {
    pub id: String,
    pub system: DeviceSystem,
}

/// Every backup Upriv can see, one section per folder: the data folder, the
/// folder in use, then the others. Each folder is checked with its own
/// limit, and a folder that fails lists what it can.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupListing {
    pub sections: Vec<BackupSection>,
}

impl BackupListing {
    pub fn entries(&self) -> impl Iterator<Item = &BackupEntry> {
        self.sections
            .iter()
            .flat_map(|section| section.entries.iter())
    }
}

/// A backup that was just written, and the switches its folder needed,
/// not saved yet.
#[derive(Debug, Clone)]
pub(crate) struct WrittenBackup {
    pub stamp: String,
    pub path: PathBuf,
    /// The reference of the folder it is in.
    pub folder: String,
    pub switches: Vec<Switch>,
    taking: BackupSelections,
}

impl WrittenBackup {
    /// Save the switches this backup needed. The caller holds the vault's
    /// directory lock.
    fn save_switches(&mut self, root: &VaultRoot, vault_dir: &Path) {
        if self.switches.is_empty() {
            return;
        }
        let saved = save_backup_switch(root, vault_dir, self.taking);
        for switch in &mut self.switches {
            switch.saved = saved;
            switch.log();
        }
    }
}

/// A save made by Back up now.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SavedBackup {
    pub entry: BackupEntry,
    pub switches: Vec<Switch>,
}

/// A zip name: `<stamp>-<id>.zip`, or `<stamp>-<id> <name>.zip` for a backup
/// the person named. A vault id has no spaces and a stamp is 14 digits, so
/// both read from the name.
#[derive(Debug, Clone, PartialEq, Eq)]
struct ZipName {
    stamp: String,
    name: String,
}

fn parse_zip_name(file: &str) -> Option<ZipName> {
    let stem = file.strip_suffix(".zip")?;
    let (stamp, rest) = stem.split_once('-')?;
    let (id, name) = match rest.split_once(' ') {
        Some((id, name)) if !name.is_empty() && name.trim() == name => (id, name),
        Some(_) => return None,
        None => (rest, ""),
    };
    (is_backup_stamp(stamp) && crate::paths::slug_id_is_valid(id)).then(|| ZipName {
        stamp: stamp.to_string(),
        name: name.to_string(),
    })
}

fn stamp_from_zip_name(name: &str) -> Option<String> {
    parse_zip_name(name).map(|parsed| parsed.stamp)
}

fn stamp_from_partial_name(name: &str) -> Option<String> {
    stamp_from_zip_name(name.strip_suffix(".partial")?)
}

/// Stamp embedded in `backups/<stamp>-<id>.zip` (UTC `YYYYMMDDHHmmss`).
fn is_backup_stamp(stamp: &str) -> bool {
    stamp.len() == 14 && stamp.bytes().all(|b| b.is_ascii_digit())
}

fn backup_zip_filename(stamp: &str, vault_id: &str) -> Result<String> {
    if !is_backup_stamp(stamp) || !crate::paths::slug_id_is_valid(vault_id) {
        return Err(UprivError::VaultPathNotFound(format!("{stamp}-{vault_id}")));
    }
    Ok(format!("{stamp}-{vault_id}.zip"))
}

/// The file name of a backup named `name`: up to [`BACKUP_NAME_MAX_CHARS`]
/// characters, with those a system refuses as `_`. An empty name is the
/// plain name.
fn named_zip_filename(stamp: &str, vault_id: &str, name: &str) -> Result<String> {
    let plain = backup_zip_filename(stamp, vault_id)?;
    let name = crate::paths::normalize_stored_name(name);
    if name.is_empty() {
        return Ok(plain);
    }
    if name.chars().count() > BACKUP_NAME_MAX_CHARS {
        return Err(UprivError::BackupNameInvalid);
    }
    let safe: String = name
        .chars()
        .map(|c| {
            if matches!(c, '/' | '\\' | '<' | '>' | ':' | '"' | '|' | '?' | '*') || c.is_control() {
                '_'
            } else {
                c
            }
        })
        .collect();
    let safe = safe.trim_end_matches(['.', ' ']).to_string();
    if safe.is_empty() {
        return Err(UprivError::BackupNameInvalid);
    }
    Ok(format!("{stamp}-{vault_id} {safe}.zip"))
}

/// A parsed key: the folder, `saves/` or not, and the file.
struct BackupKey<'a> {
    folder: &'a str,
    saved: bool,
    file: &'a str,
}

fn is_folder_key(folder: &str) -> bool {
    folder == DATA_FOLDER_REF
        || folder == IN_USE_KEY
        || folder
            .strip_prefix('f')
            .is_some_and(|number| !number.is_empty() && number.bytes().all(|b| b.is_ascii_digit()))
}

fn parse_backup_key(key: &str) -> Result<BackupKey<'_>> {
    let refused = || UprivError::VaultPathNotFound(key.into());
    let (folder, rest) = key.split_once('/').ok_or_else(refused)?;
    let (saved, file) = match rest.strip_prefix("saves/") {
        Some(file) => (true, file),
        None => (false, rest),
    };
    if !is_folder_key(folder)
        || file.contains('/')
        || file.contains('\\')
        || parse_zip_name(file).is_none()
    {
        return Err(refused());
    }
    Ok(BackupKey {
        folder,
        saved,
        file,
    })
}

/// `vaults/<id>/backups/<key>`: the locator of a backup a new vault is made from.
pub(crate) fn split_backup_locator(rest: &str) -> Option<String> {
    parse_backup_key(rest).ok().map(|_| rest.to_string())
}

fn entry_key(folder: &str, saved: bool, file: &str) -> String {
    if saved {
        format!("{folder}/{SAVES_DIR}/{file}")
    } else {
        format!("{folder}/{file}")
    }
}

/// The folder a key's folder names for this vault.
fn key_dir(
    root: &VaultRoot,
    vault_id: &str,
    vault_dir: &Path,
    saved: Option<&VaultPersistence>,
    folder: &str,
) -> Result<PathBuf> {
    match folder {
        DATA_FOLDER_REF => Ok(vault_dir.join(BACKUPS_DIR)),
        IN_USE_KEY => Ok(targets(root, vault_id, vault_dir).selected.dir),
        reference => saved
            .and_then(|saved| saved.folder(reference))
            .map(|folder| PathBuf::from(&folder.dir))
            .ok_or_else(|| UprivError::VaultPathNotFound(reference.into())),
    }
}

/// The zip a key names: a regular file that holds a vault store.
fn locate_backup_zip(root: &VaultRoot, vault_id: &str, key: &str) -> Result<PathBuf> {
    let parsed = parse_backup_key(key)?;
    let vault_dir = root.vault_dir(vault_id)?;
    let saved = load_vault_persistence(&vault_dir)?;
    let dir = key_dir(root, vault_id, &vault_dir, saved.as_ref(), parsed.folder)?;
    let dir = if parsed.saved {
        dir.join(SAVES_DIR)
    } else {
        dir
    };
    let path = dir.join(parsed.file);
    let is_zip =
        crate::host_fs::symlink_metadata(&path).is_ok_and(|meta| meta.file_type().host_is_file());
    if !is_zip || !super::zip_io::zip_contains_store_header(&path) {
        return Err(UprivError::VaultPathNotFound(key.into()));
    }
    Ok(path)
}

pub fn backup_zip_file(root: &VaultRoot, vault_id: &str, key: &str) -> Result<PathBuf> {
    locate_backup_zip(root, vault_id, key)
}

/// The reference of the folder in use: the data folder, a reference this
/// device or another wrote there under, or `use`.
fn in_use_ref(saved: Option<&VaultPersistence>, target: &BackupTarget) -> String {
    if target.is_data_folder() {
        return DATA_FOLDER_REF.to_string();
    }
    let dir = target.dir.to_string_lossy();
    let key = this_device().record_key();
    let refs = saved
        .map(|saved| saved.backup_folders.as_slice())
        .unwrap_or(&[]);
    refs.iter()
        .find(|folder| folder.dir == dir && folder.device == key)
        .or_else(|| refs.iter().find(|folder| folder.dir == dir))
        .map_or_else(|| IN_USE_KEY.to_string(), |folder| folder.reference.clone())
}

pub fn backup_listing(root: &VaultRoot, vault_id: &str) -> Result<BackupListing> {
    let vault_dir = root.vault_dir(vault_id)?;
    if !vault_dir.host_is_dir() {
        return Err(UprivError::VaultNotFound(vault_dir));
    }
    let saved = load_vault_persistence(&vault_dir)?;
    // A vault whose header is gone cannot tell its zips from another vault's
    // in a folder outside the data folder, and that is when it needs them most.
    let header = load_header(vault_dir.join(STORE_DIR_NAME)).ok();
    let vault = ZipsOf {
        identity: header.as_ref().map(|header| header.content_identity),
        unlock_kib: header.as_ref().map(|header| header.top.kdf.memory_kib),
    };
    let in_use = targets(root, vault_id, &vault_dir).selected;
    let mut sections = vec![section(
        DATA_FOLDER_REF.to_string(),
        SectionKind::DataFolder,
        &vault_dir.join(BACKUPS_DIR),
        None,
        FolderState::Ok,
        vault,
    )];
    let mut shown: HashSet<PathBuf> = HashSet::new();
    shown.insert(vault_dir.join(BACKUPS_DIR));
    if !in_use.is_data_folder() {
        let reference = in_use_ref(saved.as_ref(), &in_use);
        let device = saved
            .as_ref()
            .and_then(|saved| saved.folder(&reference))
            .map_or_else(
                || SectionDevice {
                    id: this_device().record_key(),
                    system: this_device().system,
                },
                |folder| SectionDevice {
                    id: folder.device.clone(),
                    system: folder.system,
                },
            );
        let status = check_target(
            &vault_dir,
            &in_use,
            zip_bytes_of(&vault_dir),
            FOLDER_STATUS_CHECK_LIMIT,
        );
        sections.push(section(
            reference,
            SectionKind::InUse,
            &in_use.dir,
            Some(device),
            status,
            vault,
        ));
        shown.insert(in_use.dir.clone());
    }
    for folder in saved.iter().flat_map(|saved| saved.backup_folders.iter()) {
        let dir = PathBuf::from(&folder.dir);
        if !shown.insert(dir.clone()) {
            continue;
        }
        let status = check_readable(&dir, FOLDER_STATUS_CHECK_LIMIT);
        sections.push(section(
            folder.reference.clone(),
            SectionKind::Other,
            &dir,
            Some(SectionDevice {
                id: folder.device.clone(),
                system: folder.system,
            }),
            status,
            vault,
        ));
    }
    forget_zips_gone(&vault_dir, vault_id, saved.as_ref(), &sections);
    Ok(BackupListing { sections })
}

/// What a listing compares each zip's header with: the vault's own header,
/// when it reads.
#[derive(Debug, Clone, Copy)]
struct ZipsOf {
    identity: Option<uuid::Uuid>,
    /// The RAM the vault's password unlocks with now, in KiB.
    unlock_kib: Option<u32>,
}

fn section(
    folder: String,
    kind: SectionKind,
    dir: &Path,
    device: Option<SectionDevice>,
    status: FolderState,
    vault: ZipsOf,
) -> BackupSection {
    let mut entries = Vec::new();
    let readable = matches!(
        status,
        FolderState::Ok
            | FolderState::NoRoom
            | FolderState::FileTooLarge
            | FolderState::NoPermission
    );
    if readable {
        let checked = match kind {
            SectionKind::DataFolder => ZipsOf {
                identity: None,
                ..vault
            },
            SectionKind::InUse | SectionKind::Other => vault,
        };
        for saved in [true, false] {
            let at = if saved {
                dir.join(SAVES_DIR)
            } else {
                dir.to_path_buf()
            };
            if collect_backup_dir(&at, &folder, saved, checked, &mut entries).is_err() {
                log_event(LogLevel::Warn, "backup_folder_list_failed", &[]);
            }
        }
    }
    entries.sort_by(|a, b| {
        b.stamp
            .cmp(&a.stamp)
            .then_with(|| a.file_name.cmp(&b.file_name))
    });
    BackupSection {
        folder,
        kind,
        path: dir.to_path_buf(),
        device,
        status,
        entries,
    }
}

/// With `vault.identity`, only zips of that vault: a folder outside the data
/// folder can hold another vault's backups under the same name. Without it,
/// every zip that holds a vault store. Each zip's header is read once, which
/// also tells whether it unlocks with less RAM than the vault.
fn collect_backup_dir(
    dir: &Path,
    folder: &str,
    saved: bool,
    vault: ZipsOf,
    out: &mut Vec<BackupEntry>,
) -> Result<()> {
    if !dir.host_is_dir() {
        return Ok(());
    }
    for entry in crate::host_fs::read_dir(dir)? {
        let entry = entry?;
        let Some(file_name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        let Some(parsed) = parse_zip_name(&file_name) else {
            continue;
        };
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if !kind.host_is_file() {
            continue;
        }
        let path = entry.path();
        let header = backup_zip_header(&path);
        let is_this_vaults = match vault.identity {
            Some(identity) => header
                .as_ref()
                .is_some_and(|header| header.content_identity == identity),
            None => header.is_some() || super::zip_io::zip_contains_store_header(&path),
        };
        if !is_this_vaults {
            continue;
        }
        let size = match entry.known_len() {
            Some(len) => len,
            None => entry.metadata()?.len(),
        };
        out.push(BackupEntry {
            key: entry_key(folder, saved, &file_name),
            created_at: crate::time::filename_stamp_to_iso(&parsed.stamp).unwrap_or_default(),
            stamp: parsed.stamp,
            name: parsed.name,
            file_name,
            size_bytes: size,
            saved,
            path,
            lower_unlock_ram: lower_unlock_ram(header.as_ref(), vault.unlock_kib),
        });
    }
    Ok(())
}

/// True when the zip's header unlocks with less RAM than `vault_kib`. A zip or
/// a vault whose header does not read says nothing.
fn lower_unlock_ram(header: Option<&crate::store::VaultHeader>, vault_kib: Option<u32>) -> bool {
    match (header, vault_kib) {
        (Some(header), Some(vault_kib)) => header.top.kdf.memory_kib < vault_kib,
        _ => false,
    }
}

/// References go when their zips are gone: a folder that answers, holds the
/// vault's folder, and no longer has a zip on the list is not asked again.
/// Best effort: a busy vault keeps them for a later listing.
fn forget_zips_gone(
    vault_dir: &Path,
    vault_id: &str,
    saved: Option<&VaultPersistence>,
    sections: &[BackupSection],
) {
    let Some(saved) = saved else {
        return;
    };
    let gone: Vec<&WrittenZip> = saved
        .backups_written
        .iter()
        .filter(|written| {
            sections.iter().any(|section| {
                section.folder == written.folder
                    && section.status == FolderState::Ok
                    && section.path.host_is_dir()
                    && !section
                        .entries
                        .iter()
                        .any(|entry| entry.file_name == written.name)
            })
        })
        .collect();
    if gone.is_empty() {
        return;
    }
    let gone: Vec<WrittenZip> = gone.into_iter().cloned().collect();
    let _ = try_with_vault_dir_lock(vault_dir, || {
        update_vault_persistence(vault_dir, vault_id, |persistence| {
            persistence
                .backups_written
                .retain(|written| !gone.contains(written));
            persistence.drop_empty_folders();
        })
    });
}

pub fn list_backups(root: &VaultRoot, vault_id: &str) -> Result<Vec<BackupEntry>> {
    backup_listing(root, vault_id).map(|listing| listing.entries().cloned().collect())
}

fn zips_named_in(place: &Path, zips: &mut Vec<(String, PathBuf)>) {
    for dir in [place.join(SAVES_DIR), place.to_path_buf()] {
        let Ok(entries) = crate::host_fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            if let Some(stamp) = name.to_str().and_then(stamp_from_zip_name) {
                zips.push((stamp, entry.path()));
            }
        }
    }
}

fn newest_first(mut zips: Vec<(String, PathBuf)>) -> Vec<PathBuf> {
    zips.sort_by(|a, b| b.0.cmp(&a.0));
    zips.into_iter().map(|(_, path)| path).collect()
}

/// The backup zips in the data folder, pins included, newest first, by name
/// alone: nothing is opened. An open reads these, and never waits on a drive.
pub(crate) fn backup_zips_newest_first(vault_dir: &Path) -> Vec<PathBuf> {
    let mut zips = Vec::new();
    zips_named_in(&vault_dir.join(BACKUPS_DIR), &mut zips);
    newest_first(zips)
}

/// [`backup_zips_newest_first`] with the zips of every folder that holds this
/// vault's backups and answers: a rebuild has no time limit, and may need
/// every backup there is.
pub(crate) fn every_backup_zip_newest_first(vault_dir: &Path) -> Vec<PathBuf> {
    let mut zips = Vec::new();
    zips_named_in(&vault_dir.join(BACKUPS_DIR), &mut zips);
    let saved = load_vault_persistence(vault_dir).ok().flatten();
    for folder in saved.iter().flat_map(|saved| saved.backup_folders.iter()) {
        let dir = PathBuf::from(&folder.dir);
        if check_readable(&dir, FOLDER_STATUS_CHECK_LIMIT).is_ok() {
            zips_named_in(&dir, &mut zips);
        }
    }
    newest_first(zips)
}

/// Where this device's last backup, the zip with `stamp` in `folder`, stands
/// against the folder in use: [`LastBackupPlace::Kept`] while it is there, or
/// that folder cannot be reached to tell, and an unchanged vault writes no new
/// zip then. After a switch it is in another folder, and the next close
/// writes one.
fn last_backup_place(
    root: &VaultRoot,
    vault_id: &str,
    vault_dir: &Path,
    stamp: &str,
    folder: &str,
) -> LastBackupPlace {
    if !is_backup_stamp(stamp) {
        return LastBackupPlace::Gone;
    }
    let saved = load_vault_persistence(vault_dir).ok().flatten();
    let in_use = targets(root, vault_id, vault_dir).selected;
    let dir = if folder == DATA_FOLDER_REF {
        vault_dir.join(BACKUPS_DIR)
    } else {
        match saved.as_ref().and_then(|saved| saved.folder(folder)) {
            Some(recorded) => PathBuf::from(&recorded.dir),
            None => return LastBackupPlace::Gone,
        }
    };
    if dir != in_use.dir {
        return LastBackupPlace::OtherFolder;
    }
    if !in_use.is_data_folder()
        && check_readable(&dir, FOLDER_STATUS_CHECK_LIMIT) == FolderState::NotResponding
    {
        return LastBackupPlace::Kept;
    }
    let mut zips = Vec::new();
    zips_named_in(&dir, &mut zips);
    if zips.iter().any(|(found, _)| found == stamp) {
        return LastBackupPlace::Kept;
    }
    let folder_away = !in_use.is_data_folder()
        && !in_use
            .place
            .row_folder()
            .is_some_and(|row| row.host_is_dir());
    if folder_away {
        LastBackupPlace::Kept
    } else {
        LastBackupPlace::Gone
    }
}

/// What the close knows about this device's last backup.
pub(crate) struct LastBackup {
    pub stamp: String,
    pub folder: String,
}

/// Where this device's last backup zip stands, for a close of a vault whose
/// files have not changed since that zip.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LastBackupPlace {
    /// In the folder in use, or that folder cannot be reached to tell: no zip.
    Kept,
    /// Written to another folder than the one in use now.
    OtherFolder,
    /// No longer in the folder in use.
    Gone,
}

/// A close's question: an unchanged vault writes no zip while its last one
/// is in the folder in use.
pub(crate) fn close_backup_place(
    root: &VaultRoot,
    vault_id: &str,
    last: &LastBackup,
) -> LastBackupPlace {
    root.vault_dir(vault_id)
        .map_or(LastBackupPlace::Gone, |vault_dir| {
            last_backup_place(root, vault_id, &vault_dir, &last.stamp, &last.folder)
        })
}

/// Write this vault's close backup where its backups go, then apply
/// retention in that folder. A switch is saved and logged.
pub(crate) fn backup_on_close(
    root: &VaultRoot,
    vault_id: &str,
    job: &Job,
) -> Result<Option<WrittenBackup>> {
    let vault_dir = root.vault_dir(vault_id)?;
    let config = load_vault_config(&vault_dir)?;
    if !config.backup.enabled {
        return Ok(None);
    }
    let mut written = job.settle(write_backup(
        root,
        vault_id,
        &vault_dir,
        BackupDir::Standard,
        job,
    ))?;
    let _ = with_vault_dir_lock(&vault_dir, || {
        written.save_switches(root, &vault_dir);
        Ok(())
    });
    if let Err(error) = apply_retention(
        &vault_dir,
        vault_id,
        &written.folder,
        config.backup.mode,
        config.backup.keep_last,
    ) {
        let class = classify_write_failure(&error);
        log_event(
            LogLevel::Warn,
            "vault_backup_prune_failed",
            &[
                ("id", vault_id),
                ("reason", class.reason),
                ("kind", class.kind),
            ],
        );
    }
    Ok(Some(written))
}

/// Zip this closed vault's `store/` straight into `saves/` where its backups
/// go, as the job `job_id`. A save is never pruned and is written even when
/// close backups are off. Open, delete, and rename of this vault wait until the
/// zip is written. A save stopped before its zip is in place leaves no file.
pub fn save_backup_now(root: &VaultRoot, vault_id: &str, job_id: &str) -> Result<SavedBackup> {
    Job::run(job_id, JobKind::BackupSave, Some(vault_id), |job| {
        let hold = super::export::hold_closed_vault(root, vault_id)?;
        super::export::with_held_vault(&hold, || {
            let mut written = job.settle(write_backup(
                root,
                vault_id,
                &hold.vault_dir,
                BackupDir::Saves,
                job,
            ))?;
            written.save_switches(root, &hold.vault_dir);
            let file_name = backup_zip_filename(&written.stamp, vault_id)?;
            Ok(SavedBackup {
                entry: BackupEntry {
                    key: entry_key(&written.folder, true, &file_name),
                    created_at: crate::time::filename_stamp_to_iso(&written.stamp)
                        .unwrap_or_default(),
                    size_bytes: crate::host_fs::metadata(&written.path)?.len(),
                    file_name,
                    name: String::new(),
                    stamp: written.stamp,
                    saved: true,
                    path: written.path,
                    // A copy of the vault as it is now unlocks as it does.
                    lower_unlock_ram: false,
                },
                switches: written.switches,
            })
        })
    })
}

/// `id` for a log line, only when it is a vault folder id: a request may carry
/// anything there.
pub(crate) fn vault_id_log_field(vault_id: &str) -> Option<(&'static str, &str)> {
    crate::paths::slug_id_is_valid(vault_id).then_some(("id", vault_id))
}

/// Write a zip where this vault's backups go: the selected folder, or the
/// first choice of the chain that works when it fails. A write that fails in
/// a row's folder moves on as well; the data folder ends the chain, and its
/// failure is the backup's.
fn write_backup(
    root: &VaultRoot,
    vault_id: &str,
    vault_dir: &Path,
    into: BackupDir,
    job: &Job,
) -> Result<WrittenBackup> {
    let Targets {
        lists,
        selected,
        chain,
    } = targets(root, vault_id, vault_dir);
    let needed = zip_bytes_of(vault_dir);
    let outcome = fail_over(&selected, &chain, |target| {
        write_to(vault_dir, vault_id, target, needed, into, job)
    });
    let device = this_device();
    let (target, (stamp, path), switched) = match outcome {
        Failover::Kept(written) => (&selected, written, None),
        Failover::Switched {
            link,
            value,
            reason,
        } => (link, value, Some(reason)),
        Failover::Stopped(error) => return Err(error),
        Failover::Unavailable(reason) => return Err(UprivError::BackupUnavailable(reason)),
    };
    let (taking, switches) = match switched {
        Some(reason) => {
            let taking = selections_taking(&lists.app, &lists.vault, device, &target.place);
            let made = switches(&lists.app, &lists.vault, device, vault_id, taking, reason);
            (taking, made)
        }
        None => (BackupSelections::default(), Vec::new()),
    };
    let folder = record_written(vault_dir, vault_id, target, &path);
    Ok(WrittenBackup {
        stamp,
        path,
        folder,
        switches,
        taking,
    })
}

fn write_to(
    vault_dir: &Path,
    vault_id: &str,
    target: &BackupTarget,
    needed: Option<u64>,
    into: BackupDir,
    job: &Job,
) -> Try<(String, PathBuf), UprivError> {
    if job.is_stopped() {
        return Try::Stop(UprivError::JobCancelled);
    }
    let state = check_target(vault_dir, target, needed, FOLDER_SWITCH_CHECK_LIMIT);
    if !state.is_ok() {
        return Try::Fails(state);
    }
    discard_listed_partials(vault_dir, &target.dir);
    match write_backup_zip(vault_dir, vault_id, &target.dir, into, job) {
        Ok(written) => Try::Works(written),
        Err(_) if job.is_stopped() => Try::Stop(UprivError::JobCancelled),
        Err(UprivError::JobCancelled) => Try::Stop(UprivError::JobCancelled),
        Err(error) if target.is_data_folder() => Try::Stop(error),
        Err(error) => {
            log_event(
                LogLevel::Warn,
                "vault_backup_folder_failed",
                &[
                    ("id", vault_id),
                    ("reason", FolderState::of_failure(&error).as_str()),
                ],
            );
            job.start_over();
            Try::Fails(FolderState::of_failure(&error))
        }
    }
}

/// Put the zip at `path` on the list, under its folder's reference, and make
/// it this device's last backup. Returns the reference.
fn record_written(vault_dir: &Path, vault_id: &str, target: &BackupTarget, path: &Path) -> String {
    let mut folder = DATA_FOLDER_REF.to_string();
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let recorded = update_vault_persistence(vault_dir, vault_id, |persistence| {
        if !target.is_data_folder() {
            persistence
                .backup_folder_id
                .get_or_insert_with(|| vault_id.to_string());
            folder = persistence.folder_ref_for(&target.dir.to_string_lossy());
        }
        for written in persistence
            .backups_written
            .iter_mut()
            .filter(|written| written.name == name && written.folder == DATA_FOLDER_REF)
        {
            written.folder = folder.clone();
        }
    });
    if recorded.is_err() {
        log_event(
            LogLevel::Warn,
            "vault_backup_unrecorded",
            &[("id", vault_id)],
        );
    }
    folder
}

/// Where a zip written before a flow changes `store/` goes: the data folder,
/// so the work never waits on another drive, while it holds the zip and the
/// `reserve` the flow itself needs there; else the folder in use, when it
/// holds the zip. `None` when neither has the room.
fn start_backup_place(
    root: &VaultRoot,
    vault_id: &str,
    vault_dir: &Path,
    needed: u64,
    reserve: u64,
) -> Option<BackupTarget> {
    let data = BackupTarget::of(
        crate::folder_list::backup::BackupPlace::DataFolder,
        vault_dir,
        vault_id,
    );
    let Some(available) = crate::host_fs::free_bytes(&data.dir) else {
        return Some(data);
    };
    if available >= needed.saturating_add(reserve) {
        return Some(data);
    }
    let in_use = targets(root, vault_id, vault_dir).selected;
    (!in_use.is_data_folder()
        && check_target(vault_dir, &in_use, Some(needed), FOLDER_SWITCH_CHECK_LIMIT).is_ok())
    .then_some(in_use)
}

/// Why a zip a flow writes before it changes `store/` was not written. The
/// flow goes on without it: no process depends on a backup.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BackupSkip {
    /// The person turned the switch off.
    Off,
    /// Neither the data folder nor the folder in use has room for it.
    NoRoom,
    /// It could not be written.
    Failed,
    /// The person stopped it alone ([`crate::skip_job_backup`]); the flow
    /// went on.
    Stopped,
}

impl BackupSkip {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::NoRoom => "no_room",
            Self::Failed => "failed",
            Self::Stopped => "stopped",
        }
    }
}

/// What became of the zip a flow writes before it changes `store/`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum CopyBefore {
    /// The zip, a save in `saves/`, kept until the person deletes it.
    Written(PathBuf),
    Skipped(BackupSkip),
}

/// What a zip written before a change came to. A stop of the job fails with
/// the stop. A stop of this zip alone (`stopped_alone`), no room, or any other
/// failure skips it, logged as `backup_skipped` with the reason, and the flow
/// goes on.
fn settle_copy_before(
    vault_id: &str,
    saved: std::result::Result<PathBuf, BackupSkip>,
    stopped_alone: bool,
    job: &Job,
) -> Result<CopyBefore> {
    let reason = match saved {
        Ok(zip) => return Ok(CopyBefore::Written(zip)),
        Err(_) if job.is_stopped() => return Err(UprivError::JobCancelled),
        Err(_) if stopped_alone => BackupSkip::Stopped,
        Err(reason) => reason,
    };
    log_event(
        LogLevel::Warn,
        "backup_skipped",
        &[("id", vault_id), ("reason", reason.as_str())],
    );
    Ok(CopyBefore::Skipped(reason))
}

/// A save of `store/` as it is, as part of `job`, before a flow changes it:
/// in the data folder while it holds the zip and `reserve`, else in the
/// folder in use; or why there is none. A write that fails or is stopped
/// removes its partial file.
fn save_zip_before_change(
    root: &VaultRoot,
    vault_id: &str,
    vault_dir: &Path,
    reserve: u64,
    into: BackupDir,
    job: &Job,
) -> std::result::Result<PathBuf, BackupSkip> {
    load_vault_config(vault_dir).map_err(|_| BackupSkip::Failed)?;
    let needed = super::zip_io::store_zip_bytes(&vault_dir.join(STORE_DIR_NAME)).unwrap_or(0);
    let place =
        start_backup_place(root, vault_id, vault_dir, needed, reserve).ok_or(BackupSkip::NoRoom)?;
    let (_, zip) = write_backup_zip(vault_dir, vault_id, &place.dir, into, job)
        .map_err(|_| BackupSkip::Failed)?;
    record_written(vault_dir, vault_id, &place, &zip);
    Ok(zip)
}

/// The save a password change writes at its start when its switch is on: the
/// store as it is, under the password from before the change. `reserve` is
/// what the change itself needs in the data folder. The person may stop this
/// zip alone ([`crate::skip_job_backup`]); the change goes on without it.
pub(crate) fn backup_before_password_change(
    root: &VaultRoot,
    vault_id: &str,
    reserve: u64,
    job: &Job,
) -> Result<CopyBefore> {
    let vault_dir = root.vault_dir(vault_id)?;
    let (saved, stopped_alone) = job.backup_step(|| {
        save_zip_before_change(
            root,
            vault_id,
            &vault_dir,
            reserve,
            BackupDir::ChangeSave,
            job,
        )
    });
    settle_copy_before(vault_id, saved, stopped_alone, job)
}

/// Remove the zips a killed process never finished. The caller holds this
/// vault's lock, so nothing is writing them.
pub(crate) fn discard_unfinished_backups(vault_dir: &Path) {
    let backups = vault_dir.join(BACKUPS_DIR);
    let saves = backups.join(SAVES_DIR);
    for (dir, work) in [
        (&backups, PartialWork::Backup),
        (&saves, PartialWork::BackupSave),
    ] {
        let Ok(entries) = crate::host_fs::read_dir(dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let file_name = entry.file_name();
            let unfinished = file_name
                .to_str()
                .is_some_and(|name| stamp_from_partial_name(name).is_some());
            if unfinished {
                discard_partial(&dir.join(&file_name), work);
            }
        }
    }
}

/// The copy of `store/` a rebuild writes before its tree step
/// ([`super::rebuild`]): a save, which retention never rotates, kept until
/// the person deletes it, because a rebuild is a best guess and this copy is
/// the way back. A rebuild goes on without it only when it does not fit or
/// fails: nothing stops this copy alone.
pub(crate) fn copy_before_rebuild(
    root: &VaultRoot,
    vault_id: &str,
    job: &Job,
) -> Result<CopyBefore> {
    let vault_dir = root.vault_dir(vault_id)?;
    let saved = save_zip_before_change(root, vault_id, &vault_dir, 0, BackupDir::RebuildCopy, job);
    settle_copy_before(vault_id, saved, false, job)
}

/// Where a new zip goes in its folder, what its check asks of its index
/// files, and whether it is the whole of its job.
#[derive(Clone, Copy, PartialEq, Eq)]
enum BackupDir {
    /// The folder itself, rotated by retention.
    Standard,
    /// `saves/`, kept until the person deletes it: Back up now, whose zip is
    /// the whole of its job.
    Saves,
    /// `saves/`, the start of a password change: one step of longer work, so
    /// a stop is still taken after it.
    ChangeSave,
    /// `saves/`, before a rebuild's tree step: its index files do not open,
    /// so the check that they hold one tree is left out. A vault made from it
    /// is rebuilt the same way.
    RebuildCopy,
}

impl BackupDir {
    fn in_saves(self) -> bool {
        self != Self::Standard
    }

    /// The zip is the whole of its job: its rename is the last step.
    fn whole_job(self) -> bool {
        self == Self::Saves
    }

    /// Its check opens the index files to see that they hold one tree.
    fn checks_tree(self) -> bool {
        self != Self::RebuildCopy
    }
}

/// Remove this vault's unfinished zips from a folder. Only names on its own
/// list: a `.partial` of a copy of this data folder may still be in use.
fn discard_listed_partials(vault_dir: &Path, place: &Path) {
    let Ok(Some(saved)) = load_vault_persistence(vault_dir) else {
        return;
    };
    let names: HashSet<&str> = saved
        .backups_written
        .iter()
        .map(|written| written.name.as_str())
        .collect();
    for (dir, work) in [
        (place.to_path_buf(), PartialWork::Backup),
        (place.join(SAVES_DIR), PartialWork::BackupSave),
    ] {
        let Ok(entries) = crate::host_fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let file_name = entry.file_name();
            let listed = file_name
                .to_str()
                .and_then(|name| name.strip_suffix(".partial"))
                .is_some_and(|name| names.contains(name));
            if listed {
                discard_partial(&dir.join(&file_name), work);
            }
        }
    }
}

/// Put `name` on this vault's list before its zip exists: a zip that lands
/// always has its entry. Its folder is the data folder until the zip lands
/// ([`record_written`]). An unsaved list leaves the zip for the person to
/// delete.
fn list_written_zip(vault_dir: &Path, vault_id: &str, name: &str) {
    let listed = update_vault_persistence(vault_dir, vault_id, |persistence| {
        if !persistence
            .backups_written
            .iter()
            .any(|kept| kept.name == name)
        {
            persistence.backups_written.push(WrittenZip {
                name: name.to_string(),
                folder: DATA_FOLDER_REF.to_string(),
            });
        }
    });
    if listed.is_err() {
        log_event(
            LogLevel::Warn,
            "vault_backup_unrecorded",
            &[("id", vault_id)],
        );
    }
}

/// Write the zip as `<name>.partial`, check it, then rename it into `backups`,
/// the place it belongs in. A stop from `job` is honored until that rename. A
/// save is the whole of its job, so from there on its stop is refused rather
/// than taken and then ignored; every other zip is one step of longer work,
/// which a stop still ends after it. Returns its stamp and where it landed.
fn write_backup_zip(
    vault_dir: &Path,
    vault_id: &str,
    backups: &Path,
    into: BackupDir,
    job: &Job,
) -> Result<(String, PathBuf)> {
    let dir = if into.in_saves() {
        backups.join(SAVES_DIR)
    } else {
        backups.to_path_buf()
    };
    crate::host_fs::create_dir_all(&dir)?;
    // One stamp across both folders, so a save never shares a name with a backup.
    let listed = listed_stamps(vault_dir);
    let stamp = unused_backup_stamp(backups, &listed, utc_filename_stamp())?;
    let name = backup_zip_filename(&stamp, vault_id)?;
    list_written_zip(vault_dir, vault_id, &name);
    let partial = dir.join(format!("{name}.partial"));
    let store = vault_dir.join(STORE_DIR_NAME);
    crate::store::ensure_danger_notice(&store)?;
    let settings = snapshot_settings_bytes(vault_dir, &store)?;
    let checked = (|| {
        super::zip_io::zip_store_with_config_to_path(
            &store,
            &super::zip_io::StoreEnvelope::BACKUP,
            &settings,
            &stamp,
            &partial,
            job,
        )?;
        sync_closed_file(&partial)?;
        if into.checks_tree() {
            super::zip_io::verify_store_zip_copies(&partial, job)?;
        } else {
            super::zip_io::verify_store_zip_entries(&partial, job)?;
        }
        if into.whole_job() {
            job.final_step()
        } else {
            job.ensure_running()
        }
    })();
    let work = if into.in_saves() {
        PartialWork::BackupSave
    } else {
        PartialWork::Backup
    };
    if let Err(error) = checked {
        discard_partial(&partial, work);
        return Err(error);
    }
    let target = InstallTarget {
        vault_dir,
        vault_id,
        backups,
        dir: &dir,
        listed: &listed,
    };
    let (stamp, dest) = match install_zip(&target, &partial, stamp) {
        Ok(installed) => installed,
        Err(error) => {
            discard_partial(&partial, work);
            return Err(error);
        }
    };
    // The new name must be durable before retention unlinks the previous one.
    // Otherwise a crash can publish the deletion and lose the new copy.
    sync_dir(&dir)?;
    if into.in_saves() {
        // `saves/` itself may be new.
        sync_dir(backups)?;
    }
    let event = if into.in_saves() {
        "vault_backup_saved"
    } else {
        "vault_backup_created"
    };
    log_event(
        LogLevel::Info,
        event,
        &[("id", vault_id), ("stamp", stamp.as_str())],
    );
    Ok((stamp, dest))
}

/// Where a finished zip is going.
struct InstallTarget<'a> {
    vault_dir: &'a Path,
    vault_id: &'a str,
    backups: &'a Path,
    dir: &'a Path,
    listed: &'a HashSet<String>,
}

/// Rename the finished zip into place without replacing anything: two computers
/// can write to one chosen folder in the same second. A name taken meanwhile
/// moves the zip to the next free stamp.
fn install_zip(
    target: &InstallTarget<'_>,
    partial: &Path,
    mut stamp: String,
) -> Result<(String, PathBuf)> {
    for _ in 0..INSTALL_NAME_TRIES {
        let name = backup_zip_filename(&stamp, target.vault_id)?;
        let dest = target.dir.join(&name);
        match crate::host_fs::rename_no_replace(partial, &dest) {
            Ok(()) => return Ok((stamp, dest)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                stamp = unused_backup_stamp(target.backups, target.listed, next_stamp(&stamp))?;
                list_written_zip(
                    target.vault_dir,
                    target.vault_id,
                    &backup_zip_filename(&stamp, target.vault_id)?,
                );
            }
            Err(error) => return Err(error.into()),
        }
    }
    Err(UprivError::VaultStoreInvalid {
        path: target.backups.to_path_buf(),
        detail: "could not find a free backup name".into(),
    })
}

/// Keep the newest `keep_last` zips this vault wrote in `folder`, the folder
/// in use, and delete the rest, in the order they were written, so a clock
/// that runs behind never makes a new zip look old. A zip counts there when
/// its reference names the same folder, whichever device wrote it. Zips
/// elsewhere are never touched. A zip gone from the folder leaves the list.
/// Call only after the newest zip is durable. A failed delete keeps its
/// entry, so the next backup tries again.
fn apply_retention(
    vault_dir: &Path,
    vault_id: &str,
    folder: &str,
    mode: VaultBackupMode,
    keep_last: u32,
) -> Result<()> {
    let Some(saved) = load_vault_persistence(vault_dir)? else {
        return Ok(());
    };
    let dir = if folder == DATA_FOLDER_REF {
        vault_dir.join(BACKUPS_DIR)
    } else {
        match saved.folder(folder) {
            Some(found) => PathBuf::from(&found.dir),
            None => return Ok(()),
        }
    };
    let dir_text = dir.to_string_lossy();
    let in_folder = |written: &WrittenZip| {
        written.folder == folder
            || saved
                .folder(&written.folder)
                .is_some_and(|found| found.dir == dir_text)
    };
    let keep = keep_last.max(1) as usize;
    let mut kept = 0usize;
    let mut failure = None;
    let mut removed_any = false;
    let mut remaining = Vec::with_capacity(saved.backups_written.len());
    for written in saved.backups_written.iter().rev() {
        if !in_folder(written) {
            remaining.push(written.clone());
            continue;
        }
        let standard = dir.join(&written.name);
        if !standard.host_is_file() {
            if dir.join(SAVES_DIR).join(&written.name).host_is_file() {
                remaining.push(written.clone());
            }
            continue;
        }
        if mode == VaultBackupMode::KeepAll || kept < keep {
            kept += 1;
            remaining.push(written.clone());
            continue;
        }
        match remove_backup_unless_exporting(vault_dir, &standard) {
            Ok(true) => removed_any = true,
            Ok(false) => remaining.push(written.clone()),
            Err(error) => {
                remaining.push(written.clone());
                failure = Some(error);
            }
        }
    }
    remaining.reverse();
    if remaining != saved.backups_written {
        update_vault_persistence(vault_dir, vault_id, |persistence| {
            persistence.backups_written = remaining;
            persistence.drop_empty_folders();
        })?;
    }
    // Only a folder a zip left needs its entry written down.
    if removed_any {
        sync_dir(&dir)?;
    }
    failure.map_or(Ok(()), Err)
}

/// Delete, pin, rename, and forget run under the vault's directory lock and
/// refuse while the data folder is being exported. The export copies each
/// vault under the same lock, so its zip holds every backup once, before or
/// after the change. A backup export takes its zips under that lock too, and
/// each refuses a zip it holds. They also refuse while the core of an app that
/// went away still holds the vault, since its close writes and prunes these
/// zips. That check runs under the directory lock, which an open of this
/// process holds until its session is in: the open's own vault lock is never
/// taken for another's.
fn with_backups_settled<T>(
    root: &VaultRoot,
    vault_id: &str,
    f: impl FnOnce(&Path) -> Result<T>,
) -> Result<T> {
    let vault_dir = root.vault_dir(vault_id)?;
    ensure_data_folder_export_idle(root.root())?;
    with_vault_dir_lock(&vault_dir, || {
        ensure_data_folder_export_idle(root.root())?;
        refuse_if_held_elsewhere(root, vault_id)?;
        f(&vault_dir)
    })
}

pub fn delete_backups(root: &VaultRoot, vault_id: &str, keys: &[String]) -> Result<()> {
    with_backups_settled(root, vault_id, |vault_dir| {
        let mut paths = Vec::new();
        let mut seen = std::collections::BTreeSet::new();
        for key in keys {
            let path = locate_backup_zip(root, vault_id, key)?;
            if seen.insert(path.clone()) {
                paths.push(path);
            }
        }
        ensure_backups_not_exporting(vault_dir, &paths)?;
        let mut removed = Vec::new();
        for path in paths {
            crate::host_fs::remove_file(&path)?;
            if let Some(name) = path.file_name().and_then(|name| name.to_str()) {
                removed.push(name.to_string());
            }
        }
        update_vault_persistence(vault_dir, vault_id, |persistence| {
            persistence
                .backups_written
                .retain(|written| !removed.contains(&written.name));
            persistence.drop_empty_folders();
        })
    })
}

/// Pin a backup: it moves into `saves/` of its folder, where retention never
/// rotates it.
pub fn promote_backup_save(root: &VaultRoot, vault_id: &str, key: &str) -> Result<()> {
    with_backups_settled(root, vault_id, |vault_dir| {
        let parsed = parse_backup_key(key)?;
        if parsed.saved {
            return Err(UprivError::VaultPathNotFound(key.into()));
        }
        let src = locate_backup_zip(root, vault_id, key)?;
        move_into_saves(vault_dir, &src, parsed.file).map(|_| ())
    })
}

/// Move `src` into `saves/` beside it as `file`. A pin whose name is already
/// a vault zip there keeps that one and drops `src`.
fn move_into_saves(vault_dir: &Path, src: &Path, file: &str) -> Result<PathBuf> {
    ensure_backups_not_exporting(vault_dir, &[src.to_path_buf()])?;
    let folder = src
        .parent()
        .ok_or_else(|| UprivError::VaultPathNotFound(file.into()))?;
    let saves = if folder.file_name().is_some_and(|name| name == SAVES_DIR) {
        folder.to_path_buf()
    } else {
        folder.join(SAVES_DIR)
    };
    crate::host_fs::create_dir_all(&saves)?;
    let dest = saves.join(file);
    if dest == src {
        return Ok(dest);
    }
    match crate::host_fs::symlink_metadata(&dest) {
        Ok(meta) if meta.file_type().host_is_file() => {
            if !super::zip_io::zip_contains_store_header(&dest) {
                return Err(UprivError::VaultStoreInvalid {
                    path: dest,
                    detail: "backup pin name is already taken".into(),
                });
            }
            crate::host_fs::remove_file(src)?;
            return Ok(dest);
        }
        Ok(_) => return Err(UprivError::VaultPathNotFound(file.into())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    crate::host_fs::rename_no_replace(src, &dest)?;
    Ok(dest)
}

/// `backup_rename`: name a backup, or take its name away with an empty one.
/// The name follows the vault id in the file name; naming a backup pins it,
/// in one rename into `saves/`. Its entry on the list follows in the same
/// step; a rename cut short only stops that zip from being deleted
/// automatically. Refused while the backup is being exported.
pub fn rename_backup(
    root: &VaultRoot,
    vault_id: &str,
    key: &str,
    name: &str,
) -> Result<BackupEntry> {
    with_backups_settled(root, vault_id, |vault_dir| {
        let parsed = parse_backup_key(key)?;
        let zip =
            parse_zip_name(parsed.file).ok_or_else(|| UprivError::VaultPathNotFound(key.into()))?;
        let src = locate_backup_zip(root, vault_id, key)?;
        let id = parsed
            .file
            .strip_prefix(&format!("{}-", zip.stamp))
            .and_then(|rest| rest.strip_suffix(".zip"))
            .map(|rest| rest.split_once(' ').map_or(rest, |(id, _)| id))
            .ok_or_else(|| UprivError::VaultPathNotFound(key.into()))?
            .to_string();
        let file = named_zip_filename(&zip.stamp, &id, name)?;
        let dest = move_into_saves(vault_dir, &src, &file)?;
        let previous = parsed.file.to_string();
        update_vault_persistence(vault_dir, vault_id, |persistence| {
            for written in persistence
                .backups_written
                .iter_mut()
                .filter(|written| written.name == previous)
            {
                written.name = file.clone();
            }
        })?;
        let size_bytes = crate::host_fs::metadata(&dest)?.len();
        let named = parse_zip_name(&file)
            .map(|parsed| parsed.name)
            .unwrap_or_default();
        let vault_kib = load_header(vault_dir.join(STORE_DIR_NAME))
            .ok()
            .map(|header| header.top.kdf.memory_kib);
        let lower = lower_unlock_ram(backup_zip_header(&dest).as_ref(), vault_kib);
        Ok(BackupEntry {
            key: entry_key(parsed.folder, true, &file),
            created_at: crate::time::filename_stamp_to_iso(&zip.stamp).unwrap_or_default(),
            stamp: zip.stamp,
            file_name: file,
            name: named,
            size_bytes,
            saved: true,
            path: dest,
            lower_unlock_ram: lower,
        })
    })
}

/// `backup_folder_forget`: Upriv stops listing a folder that holds zips of
/// this vault, and forgets the zips it wrote there. The files stay.
pub fn forget_backup_folder(root: &VaultRoot, vault_id: &str, folder: &str) -> Result<()> {
    if folder == DATA_FOLDER_REF || !is_folder_key(folder) {
        return Err(UprivError::VaultPathNotFound(folder.into()));
    }
    with_backups_settled(root, vault_id, |vault_dir| {
        update_vault_persistence(vault_dir, vault_id, |persistence| {
            persistence
                .backups_written
                .retain(|written| written.folder != folder);
            persistence.drop_empty_folders();
        })?;
        log_event(
            LogLevel::Info,
            "backup_folder_forgotten",
            &[("id", vault_id)],
        );
        Ok(())
    })
}

/// The person selected a backup folder: when this device wrote there
/// before, its next backup makes the vault's folder there again if it is
/// missing, rather than reading the absence as a drive that is away.
pub(crate) fn reuse_selected_backup_folder(root: &VaultRoot, vault_id: &str) -> Result<()> {
    let vault_dir = root.vault_dir(vault_id)?;
    let target = targets(root, vault_id, &vault_dir).selected;
    if target.is_data_folder() {
        return Ok(());
    }
    let key = this_device().record_key();
    let dir = target.dir.to_string_lossy();
    let vault_dir = vault_dir.as_path();
    let Some(saved) = load_vault_persistence(vault_dir)? else {
        return Ok(());
    };
    if !saved
        .backup_folders
        .iter()
        .any(|folder| folder.dir == dir && folder.device == key && !folder.reuse)
    {
        return Ok(());
    }
    update_vault_persistence(vault_dir, vault_id, |persistence| {
        for folder in persistence
            .backup_folders
            .iter_mut()
            .filter(|folder| folder.dir == dir && folder.device == key)
        {
            folder.reuse = true;
        }
    })
}

/// A vault's backups outside the data folder, read before a delete takes the
/// record of them away.
pub(crate) struct OutsideZips {
    folders: Vec<(PathBuf, Vec<String>)>,
}

pub(crate) fn outside_zips(vault_dir: &Path) -> Option<OutsideZips> {
    let saved = load_vault_persistence(vault_dir).ok().flatten()?;
    if !saved.has_outside_backups() {
        return None;
    }
    let folders = saved
        .backup_folders
        .iter()
        .map(|folder| {
            let names = saved
                .written_in(&folder.reference)
                .map(|written| written.name.clone())
                .collect();
            (PathBuf::from(&folder.dir), names)
        })
        .collect();
    Some(OutsideZips { folders })
}

impl OutsideZips {
    /// Remove the zips this vault wrote in each folder, and each folder of
    /// Upriv's that is left empty. Returns the folders that kept something:
    /// they could not be reached, or a zip stayed.
    pub(crate) fn remove(&self) -> Vec<PathBuf> {
        let mut kept = Vec::new();
        for (dir, names) in &self.folders {
            if check_readable(dir, FOLDER_STATUS_CHECK_LIMIT) != FolderState::Ok {
                kept.push(dir.clone());
                continue;
            }
            let saves = dir.join(SAVES_DIR);
            let mut removed_all = true;
            for name in names {
                for place in [dir, &saves] {
                    match crate::host_fs::remove_file(place.join(name)) {
                        Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
                            removed_all = false;
                        }
                        _ => {}
                    }
                }
            }
            // A folder that still holds anything refuses, and stays.
            let _ = crate::host_fs::remove_dir(&saves);
            let _ = crate::host_fs::remove_dir(dir);
            if let Some(shared) = dir.parent() {
                if crate::folder_list::names_folder(
                    shared,
                    crate::folder_list::SHARED_BACKUPS_CONTAINER,
                ) {
                    let _ = crate::host_fs::remove_dir(shared);
                }
            }
            if !removed_all {
                kept.push(dir.clone());
            }
        }
        kept
    }

    pub(crate) fn folders(&self) -> Vec<PathBuf> {
        self.folders.iter().map(|(dir, _)| dir.clone()).collect()
    }
}

/// Copy backups of this vault into `dest_dir` as the job `job_id`. One keeps
/// its own file name; several go into one Stored zip, `upriv-backups-<id>.zip`.
/// A name already in the folder is never replaced: the file takes the next
/// free number (`upriv-backups-<id>-2.zip`) and the export logs
/// `backup_export_numbered`. A stopped or failed export leaves no file.
///
/// Backups are frozen files, so this vault may be open and every other export
/// stays free. Until the export ends, delete and rename of this vault refuse,
/// delete, pin, and rename of these backups refuse (`backup_exporting`), and
/// retention leaves them for a later close.
pub fn export_backups(
    root: &VaultRoot,
    vault_id: &str,
    keys: &[String],
    dest_dir: &Path,
    job_id: &str,
) -> Result<ExportedFile> {
    let written = Job::run(job_id, JobKind::BackupExport, Some(vault_id), |job| {
        write_backup_export(root, vault_id, keys, dest_dir, job)
    });
    log_backup_export_numbered(vault_id, &written);
    written
}

fn write_backup_export(
    root: &VaultRoot,
    vault_id: &str,
    keys: &[String],
    dest_dir: &Path,
    job: &Job,
) -> Result<ExportedFile> {
    let vault_dir = root.vault_dir(vault_id)?;
    check_export_folder(root, dest_dir)?;
    // Under the lock delete, pin, and rename hold, so none is halfway through,
    // and an open of this process has its session in.
    let (_reading, sources) = with_vault_dir_lock(&vault_dir, || {
        if !vault_dir.host_is_dir() {
            return Err(UprivError::VaultNotFound(vault_dir.clone()));
        }
        // The close of the core of an app that went away writes and prunes these zips.
        refuse_if_held_elsewhere(root, vault_id)?;
        let sources = backup_export_sources(root, vault_id, keys)?;
        let zips = sources.iter().map(|(_, path)| path.clone()).collect();
        Ok((BackupExportGuard::enter(&vault_dir, zips)?, sources))
    })?;
    let mut total = 0u64;
    for (_, path) in &sources {
        total = total.saturating_add(crate::host_fs::metadata(path)?.len());
    }
    job.set_total(total);
    let stem = match sources.as_slice() {
        [(name, _)] => name.strip_suffix(".zip").unwrap_or(name).to_string(),
        _ => format!("upriv-backups-{vault_id}"),
    };
    let target = NumberedExportTarget::new(dest_dir, NumberedExportName::new(&stem, "zip"))?;
    target.write(
        root,
        job,
        UnfinishedWork::BackupExport,
        Some(vault_id),
        |partial| match sources.as_slice() {
            [(_, source)] => super::zip_io::copy_file_to_path(source, partial, job),
            bundle => super::zip_io::zip_files_to_path(bundle, partial, job),
        },
    )
}

/// `backup_export_numbered` when the name was taken and the file got a number.
/// How the export ended is the job's own log. No path or name goes to the log.
fn log_backup_export_numbered(vault_id: &str, written: &Result<ExportedFile>) {
    let Ok(file) = written else {
        return;
    };
    if file.number <= 1 {
        return;
    }
    let number = file.number.to_string();
    let mut fields = vec![("number", number.as_str())];
    fields.extend(vault_id_log_field(vault_id));
    log_event(LogLevel::Info, "backup_export_numbered", &fields);
}

/// Each backup to export once, with the name it takes in a bundle. Zips that
/// share a file name are told apart by their folder: `saves-<file>` for a
/// pin, `<folder>-<file>` for a zip outside the data folder.
fn backup_export_sources(
    root: &VaultRoot,
    vault_id: &str,
    keys: &[String],
) -> Result<Vec<(String, PathBuf)>> {
    if keys.is_empty() {
        return Err(UprivError::VaultPathNotFound(vault_id.into()));
    }
    let mut seen = std::collections::BTreeSet::new();
    let mut rows: Vec<(String, String, bool, PathBuf)> = Vec::new();
    for key in keys {
        let parsed = parse_backup_key(key)?;
        let path = locate_backup_zip(root, vault_id, key)?;
        if !seen.insert(path.clone()) {
            continue;
        }
        rows.push((
            parsed.file.to_string(),
            parsed.folder.to_string(),
            parsed.saved,
            path,
        ));
    }
    // The zips that keep their plain name come first: the data folder, standard ones.
    rows.sort_by_key(|(_, folder, saved, _)| (folder != DATA_FOLDER_REF, *saved));
    let mut used = std::collections::BTreeSet::new();
    let mut entries: Vec<(String, PathBuf)> = Vec::new();
    for (file, folder, saved, path) in rows {
        let mut candidates = vec![file.clone()];
        if saved {
            candidates.push(format!("saves-{file}"));
        }
        if folder != DATA_FOLDER_REF {
            candidates.push(format!("{folder}-{file}"));
            if saved {
                candidates.push(format!("{folder}-saves-{file}"));
            }
        }
        let Some(entry_name) = candidates
            .into_iter()
            .find(|candidate| !used.contains(candidate))
        else {
            return Err(UprivError::VaultStoreInvalid {
                path,
                detail: "two backups share an export name".into(),
            });
        };
        used.insert(entry_name.clone());
        entries.push((entry_name, path));
    }
    Ok(entries)
}

/// One listing per directory. A stamp is taken by a finished zip or a `.partial`.
fn dir_has_stamp(dir: &Path, stamp: &str) -> bool {
    let Ok(entries) = crate::host_fs::read_dir(dir) else {
        return false;
    };
    for entry in entries.flatten() {
        let file_name = entry.file_name();
        let Some(name) = file_name.to_str() else {
            continue;
        };
        if stamp_from_partial_name(name).as_deref() == Some(stamp) {
            return true;
        }
        if stamp_from_zip_name(name).as_deref() == Some(stamp)
            && entry.file_type().is_ok_and(|kind| kind.host_is_file())
        {
            return true;
        }
    }
    false
}

fn stamp_is_used(backups: &Path, stamp: &str) -> bool {
    dir_has_stamp(backups, stamp) || dir_has_stamp(&backups.join(SAVES_DIR), stamp)
}

fn next_stamp(stamp: &str) -> String {
    let n = stamp.parse::<u64>().unwrap_or(0).saturating_add(1);
    format!("{n:014}")
}

/// The stamps on this vault's list: a zip in another folder holds one too, so
/// a name is never on the list for two zips.
fn listed_stamps(vault_dir: &Path) -> HashSet<String> {
    load_vault_persistence(vault_dir)
        .ok()
        .flatten()
        .map(|saved| {
            saved
                .backups_written
                .iter()
                .filter_map(|written| stamp_from_zip_name(&written.name))
                .collect()
        })
        .unwrap_or_default()
}

fn unused_backup_stamp(
    backups: &Path,
    listed: &HashSet<String>,
    mut stamp: String,
) -> Result<String> {
    for _ in 0..64 {
        if is_backup_stamp(&stamp) && !listed.contains(&stamp) && !stamp_is_used(backups, &stamp) {
            return Ok(stamp);
        }
        stamp = next_stamp(&stamp);
    }
    Err(UprivError::VaultStoreInvalid {
        path: backups.to_path_buf(),
        detail: "could not allocate a unique backup stamp".into(),
    })
}

pub(crate) fn copy_ciphertext_tree(src: &Path, dst: &Path, job: &Job) -> Result<()> {
    crate::host_fs::create_dir_all(dst)?;
    for entry in crate::host_fs::read_dir(src)? {
        job.ensure_running()?;
        let entry = entry?;
        let to = dst.join(entry.file_name());
        let ft = entry.file_type()?;
        if ft.is_symlink() {
            return Err(UprivError::VaultStoreInvalid {
                path: entry.path(),
                detail: "refusing to copy a symlink into a backup".into(),
            });
        }
        if ft.host_is_dir() {
            copy_ciphertext_tree(&entry.path(), &to, job)?;
        } else if ft.host_is_file() {
            copy_regular_nofollow(&entry.path(), &to)?;
        } else {
            return Err(UprivError::VaultStoreInvalid {
                path: entry.path(),
                detail: "refusing to copy a special file into a backup".into(),
            });
        }
    }
    // Children are already durable (each file is synced before this). Syncing
    // the directory publishes their names. Same helper import uses.
    sync_dir(dst)?;
    Ok(())
}

/// `FlushFileBuffers` needs write access. A read-only open syncs on Unix and
/// fails on Windows, which would discard the close backup.
fn sync_closed_file(path: &Path) -> Result<()> {
    #[cfg(windows)]
    let file = crate::host_fs::OpenOptions::new().write(true).open(path)?;
    #[cfg(not(windows))]
    let file = crate::host_fs::File::open(path)?;
    match file.sync_all() {
        Err(error) if !flush_is_unsupported(&error) => Err(error.into()),
        _ => Ok(()),
    }
}

/// Persist a directory entry. No-op off Unix, where opening a directory for
/// `sync_all` is not the same call. A storage-access directory open is a local
/// stand-in, so syncing it neither publishes the rename nor should fail the
/// write after the provider already returned. A file system that offers no
/// folder flush has nothing more to do.
fn sync_dir(path: &Path) -> Result<()> {
    if crate::host_fs::is_bridge_path(path) {
        return Ok(());
    }
    #[cfg(unix)]
    {
        let dir = crate::host_fs::File::open(path)?;
        match dir.sync_all() {
            Err(error) if !flush_is_unsupported(&error) => return Err(error.into()),
            _ => {}
        }
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
    Ok(())
}

fn copy_regular_nofollow(src: &Path, dst: &Path) -> Result<()> {
    #[cfg(unix)]
    let mut input = {
        use std::os::unix::fs::OpenOptionsExt;
        crate::host_fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW)
            .open(src)
            .map_err(|_| UprivError::VaultStoreInvalid {
                path: src.to_path_buf(),
                detail: "refusing to copy a symlink into a backup".into(),
            })?
    };
    #[cfg(not(unix))]
    let mut input = crate::host_fs::File::open(src)?;
    let meta = input.metadata()?;
    if !meta.host_is_file() {
        return Err(UprivError::VaultStoreInvalid {
            path: src.to_path_buf(),
            detail: "refusing to copy a non-regular file into a backup".into(),
        });
    }
    let mut output = crate::host_fs::File::create(dst)?;
    std::io::copy(&mut input, &mut output)?;
    output.sync_all()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[allow(unused_imports)]
    use crate::host_fs::HostFsQuery;
    use crate::store::KdfUnlockPreset;
    use crate::test_support::{backup_rows, test_job_id, vault_root_with};
    use crate::vault::create_vault;

    /// Delete the vault `notes`, with the outside backups when `outside`.
    fn delete_notes(root: &VaultRoot, outside: bool) -> Result<crate::vault::VaultDeleteOutcome> {
        crate::vault::delete_vault(root, "notes", outside, false, &test_job_id())
    }

    fn sample_config(id: &str, name: &str) -> crate::config::VaultConfig {
        toml::from_str(&format!(
            r#"
[vault]
id = "{id}"
display_name = "{name}"
order = 1
[storage]
mode = "encrypted_dir"
"#
        ))
        .expect("config")
    }

    #[test]
    fn a_change_whose_backup_is_stopped_alone_goes_on_with_no_zip_left() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        let job = Job::start(&test_job_id()).unwrap();
        job.stop_backup_alone();
        let copied = backup_before_password_change(&root, "notes", 0, &job).unwrap();
        assert_eq!(copied, CopyBefore::Skipped(BackupSkip::Stopped));
        job.ensure_running().expect("the change goes on");
        let saves = root
            .vault_dir("notes")
            .unwrap()
            .join(BACKUPS_DIR)
            .join(SAVES_DIR);
        let left: Vec<_> = crate::host_fs::read_dir(&saves)
            .map(|entries| entries.flatten().map(|entry| entry.file_name()).collect())
            .unwrap_or_default();
        assert!(left.is_empty(), "{left:?}");

        // The next backup of the same job is not stopped.
        let next = backup_before_password_change(&root, "notes", 0, &job).unwrap();
        assert!(matches!(next, CopyBefore::Written(_)));
    }

    #[test]
    fn nothing_stops_the_copy_before_a_rebuild_alone() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        let job = Job::start(&test_job_id()).unwrap();
        job.stop_backup_alone();
        let copied = copy_before_rebuild(&root, "notes", &job).unwrap();
        assert!(matches!(copied, CopyBefore::Written(_)), "{copied:?}");
    }

    #[test]
    fn stamp_allowlist_rejects_path_escape() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        let vault_dir = root.vault_dir("notes").unwrap();
        let store = vault_dir.join(crate::paths::STORE_DIR_NAME);
        assert!(store.host_is_dir());
        for bad in [
            "../store",
            "/etc",
            "data/../store",
            "data/2026/01",
            "data/saves/../x.zip",
            "f/20260101000000-notes.zip",
            "elsewhere/20260101000000-notes.zip",
            "20260101000000-notes.zip",
        ] {
            assert!(
                promote_backup_save(&root, "notes", bad).is_err(),
                "promote must reject {bad}"
            );
            assert!(
                backup_zip_file(&root, "notes", bad).is_err(),
                "get must reject {bad}"
            );
        }
        assert!(store.host_is_dir());
    }

    #[test]
    fn discards_only_unfinished_backup_zips() {
        let tmp = tempfile::tempdir().unwrap();
        let backups = tmp.path().join("backups");
        let saves = backups.join("saves");
        crate::host_fs::create_dir_all(&saves).unwrap();
        let finished = backups.join("20260101000000-notes.zip");
        let saved = saves.join("20260101000001-notes.zip");
        let other = backups.join("notes.partial");
        for keep in [&finished, &saved, &other] {
            crate::host_fs::write(keep, b"keep").unwrap();
        }
        let unfinished = [
            backups.join("20260101000002-notes.zip.partial"),
            saves.join("20260101000003-notes.zip.partial"),
        ];
        for path in &unfinished {
            crate::host_fs::write(path, b"half").unwrap();
        }

        discard_unfinished_backups(tmp.path());

        assert!(!unfinished[0].host_exists());
        assert!(!unfinished[1].host_exists());
        assert!(finished.host_exists());
        assert!(saved.host_exists());
        assert!(other.host_exists());
    }

    #[test]
    fn discarding_unfinished_backups_needs_no_backups_folder() {
        let tmp = tempfile::tempdir().unwrap();
        discard_unfinished_backups(tmp.path());
    }

    #[test]
    fn copy_ciphertext_tree_preserves_bytes() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("store");
        crate::host_fs::create_dir_all(src.join("header")).unwrap();
        crate::host_fs::create_dir_all(src.join("data")).unwrap();
        crate::host_fs::write(src.join("header").join("vault.header"), b"header-bytes").unwrap();
        crate::host_fs::write(src.join("data").join("a.blob"), b"cipher-bytes").unwrap();
        let dst = tmp.path().join("frozen");
        copy_ciphertext_tree(&src, &dst, &Job::untracked()).unwrap();
        assert_eq!(
            crate::host_fs::read(dst.join("header").join("vault.header")).unwrap(),
            b"header-bytes"
        );
        assert_eq!(
            crate::host_fs::read(dst.join("data").join("a.blob")).unwrap(),
            b"cipher-bytes"
        );
    }

    #[test]
    fn close_backup_is_one_stored_zip() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        let notice = root
            .vault_dir("notes")
            .unwrap()
            .join(crate::paths::STORE_DIR_NAME)
            .join(crate::store::STORE_DANGER_FILE_NAME);
        let notice_bytes = crate::host_fs::read(&notice).unwrap();
        crate::host_fs::remove_file(&notice).unwrap();
        let stamp = backup_on_close(&root, "notes", &Job::untracked())
            .unwrap()
            .expect("stamp")
            .stamp;
        assert_eq!(crate::host_fs::read(&notice).unwrap(), notice_bytes);
        let zip = root
            .vault_dir("notes")
            .unwrap()
            .join("backups")
            .join(format!("{stamp}-notes.zip"));
        assert!(zip.host_is_file());
        let listed = list_backups(&root, "notes").unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].stamp, stamp);
        assert_eq!(listed[0].file_name, format!("{stamp}-notes.zip"));
        assert!(!listed[0].saved);
        let backups = zip.parent().unwrap();
        crate::host_fs::write(backups.join(format!("{stamp}.zip")), b"not-a-backup").unwrap();
        crate::host_fs::write(backups.join(format!("{stamp}-nope.zip")), b"bad-id").unwrap();
        let listed = list_backups(&root, "notes").unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].file_name, format!("{stamp}-notes.zip"));
        let out = tempfile::tempdir().unwrap();
        let extracted = out.path().join("store");
        super::super::zip_io::unzip_store_path(&zip, &extracted, &Job::untracked()).unwrap();
        assert!(extracted.join("header").join("vault.header").host_is_file());
        let notice_name = crate::store::STORE_DANGER_FILE_NAME;
        let packed = format!("{}/{notice_name}", crate::paths::STORE_DIR_NAME);
        let mut archive = zip::ZipArchive::new(crate::host_fs::File::open(&zip).unwrap()).unwrap();
        let mut found = false;
        for index in 0..archive.len() {
            let mut entry = archive.by_index(index).unwrap();
            if entry.name() == packed {
                let mut body = Vec::new();
                std::io::Read::read_to_end(&mut entry, &mut body).unwrap();
                let on_disk = crate::host_fs::read(
                    root.vault_dir("notes")
                        .unwrap()
                        .join(crate::paths::STORE_DIR_NAME)
                        .join(notice_name),
                )
                .unwrap();
                assert_eq!(body, on_disk);
                found = true;
            }
        }
        assert!(found, "backup zip keeps the store danger notice");
        let index = crate::host_fs::read(
            extracted
                .join(crate::store::INDEX_DIR_NAME)
                .join(crate::store::INDEX_FILE_NAME),
        )
        .unwrap();
        assert_eq!(
            crate::host_fs::read(
                extracted
                    .join(crate::store::INDEX_DIR_NAME)
                    .join(crate::store::INDEX_COPY_FILE_NAME),
            )
            .unwrap(),
            index
        );
        assert!(!extracted.join("config.toml").host_exists());
        assert!(!extracted.join("README.md").host_exists());
        let readme = super::super::zip_io::read_zip_root_entry(
            crate::host_fs::File::open(&zip).unwrap(),
            super::super::embedded_settings::ZIP_README_ENTRY,
        )
        .unwrap()
        .expect("README.md");
        let store_bytes = super::super::sum_regular_file_bytes(
            &root
                .vault_dir("notes")
                .unwrap()
                .join(crate::paths::STORE_DIR_NAME),
        )
        .unwrap();
        let expected =
            super::super::embedded_settings::store_zip_readme(&stamp, store_bytes).unwrap();
        assert_eq!(readme, expected.into_bytes());
        // A backup holds its envelope at the zip root; its settings name the vault.
        let carried =
            crate::vault::read_import_zip_bytes_settings(&crate::host_fs::read(&zip).unwrap())
                .unwrap();
        assert_eq!(carried.vault_name.as_deref(), Some("Notes"));
        let parsed = carried.settings.expect("config.toml");
        assert_eq!(parsed.config.vault.display_name, "Notes");
        assert_eq!(parsed.unlock_preset, Some(KdfUnlockPreset::M32));
        promote_backup_save(&root, "notes", &format!("data/{stamp}-notes.zip")).unwrap();
        let saved = root
            .vault_dir("notes")
            .unwrap()
            .join("backups")
            .join("saves")
            .join(format!("{stamp}-notes.zip"));
        assert!(saved.host_is_file());
        assert!(!zip.host_is_file());
        let listed = list_backups(&root, "notes").unwrap();
        assert_eq!(listed.len(), 1);
        assert!(listed[0].saved);
        assert_eq!(listed[0].file_name, format!("{stamp}-notes.zip"));
        assert_eq!(listed[0].key, format!("data/saves/{stamp}-notes.zip"));
        assert_eq!(
            backup_zip_file(&root, "notes", &listed[0].key).unwrap(),
            saved
        );
    }

    #[test]
    fn save_now_pins_a_zip_that_close_retention_keeps() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        let saved = save_backup_now(&root, "notes", &test_job_id())
            .unwrap()
            .entry;
        assert!(saved.saved);
        let zip = root
            .vault_dir("notes")
            .unwrap()
            .join("backups")
            .join("saves")
            .join(&saved.file_name);
        assert!(super::super::zip_io::zip_contains_store_header(&zip));
        let zip_len = crate::host_fs::metadata(&zip).unwrap().len();
        assert_eq!(saved.size_bytes, zip_len);
        assert_eq!(list_backups(&root, "notes").unwrap(), vec![saved.clone()]);

        // `keep_last = 1` rotates standard backups only.
        backup_on_close(&root, "notes", &Job::untracked()).unwrap();
        backup_on_close(&root, "notes", &Job::untracked()).unwrap();
        let listed = list_backups(&root, "notes").unwrap();
        assert_eq!(listed.len(), 2);
        assert!(listed.contains(&saved));

        // Two saves within one second still get their own stamps.
        let again = save_backup_now(&root, "notes", &test_job_id())
            .unwrap()
            .entry;
        assert_ne!(again.stamp, saved.stamp);
        assert_eq!(list_backups(&root, "notes").unwrap().len(), 3);
    }

    #[test]
    fn save_now_works_with_close_backups_off() {
        let (_tmp, root) = vault_root_with(&[]);
        let mut config = sample_config("notes", "Notes");
        config.backup.enabled = false;
        create_vault(&root, config, b"pass-word-ok", KdfUnlockPreset::M32).unwrap();
        let saved = save_backup_now(&root, "notes", &test_job_id())
            .unwrap()
            .entry;
        assert_eq!(list_backups(&root, "notes").unwrap(), vec![saved]);
    }

    #[test]
    fn a_save_holds_the_primary_index_twice_when_a_seal_stopped_between_them() {
        let (_tmp, root) = vault_root_with(&[]);
        let mut config = sample_config("notes", "Notes");
        config.backup.enabled = false;
        create_vault(&root, config, b"pass-word-ok", KdfUnlockPreset::M32).unwrap();
        let index = root
            .vault_store_dir("notes")
            .unwrap()
            .join(crate::store::INDEX_DIR_NAME);
        let primary = crate::host_fs::read(index.join(crate::store::INDEX_FILE_NAME)).unwrap();
        // A seal that wrote its copy and stopped before the primary.
        let copy = index.join(crate::store::INDEX_COPY_FILE_NAME);
        crate::host_fs::write(&copy, b"newer copy").unwrap();

        let saved = save_backup_now(&root, "notes", &test_job_id())
            .unwrap()
            .entry;
        let zip = backup_zip_file(&root, "notes", &saved.key).unwrap();
        let mut archive = zip::ZipArchive::new(crate::host_fs::File::open(zip).unwrap()).unwrap();
        for name in ["store/index/root.idx.enc", "store/index/root.idx.enc.copy"] {
            let mut body = Vec::new();
            std::io::Read::read_to_end(&mut archive.by_name(name).unwrap(), &mut body).unwrap();
            assert_eq!(body, primary, "{name}");
        }
        // The vault keeps its own copy for its next unlock.
        assert_eq!(crate::host_fs::read(&copy).unwrap(), b"newer copy");
    }

    /// An open of this process holds the vault's lock while it unlocks, under
    /// the directory lock. A backup action asked meanwhile waits for that lock
    /// and then sees no other holder, rather than taking the open's lock for
    /// the previous session's.
    #[test]
    fn a_backup_action_during_an_open_here_waits_for_it_and_is_not_refused() {
        let (_tmp, root) = vault_root_with(&[]);
        let mut config = sample_config("notes", "Notes");
        config.backup.enabled = false;
        create_vault(&root, config, b"pass-word-ok", KdfUnlockPreset::M32).unwrap();
        let saved = save_backup_now(&root, "notes", &test_job_id())
            .unwrap()
            .entry;
        let vault_dir = root.vault_dir("notes").unwrap();
        let lock_path = root.runtime_lock_path("notes").unwrap();

        let (unlocking, started) = std::sync::mpsc::channel();
        let open = std::thread::spawn(move || {
            with_vault_dir_lock(&vault_dir, || {
                let _lock = crate::lockfile::acquire_vault_lock(lock_path)?;
                unlocking.send(()).unwrap();
                // Argon2 runs; this unlock then fails and lets go.
                std::thread::sleep(std::time::Duration::from_millis(200));
                Ok(())
            })
        });
        started.recv().unwrap();

        delete_backups(&root, "notes", std::slice::from_ref(&saved.key)).unwrap();
        open.join().unwrap().unwrap();
        assert!(list_backups(&root, "notes").unwrap().is_empty());
    }

    #[test]
    fn a_stopped_save_leaves_no_file() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        let job = test_job_id();
        crate::session::cancel_job(&job).unwrap();
        assert!(matches!(
            save_backup_now(&root, "notes", &job),
            Err(UprivError::JobCancelled)
        ));

        let vault_dir = root.vault_dir("notes").unwrap();
        let id = test_job_id();
        let running = Job::start(&id).unwrap();
        crate::session::cancel_job(&id).unwrap();
        assert!(matches!(
            running.settle(write_backup_zip(
                &vault_dir,
                "notes",
                &vault_dir.join(BACKUPS_DIR),
                BackupDir::Saves,
                &running
            )),
            Err(UprivError::JobCancelled)
        ));
        let saves = vault_dir.join("backups").join("saves");
        assert_eq!(crate::host_fs::read_dir(&saves).unwrap().count(), 0);
        assert!(list_backups(&root, "notes").unwrap().is_empty());
        assert!(
            save_backup_now(&root, "notes", &test_job_id())
                .unwrap()
                .entry
                .saved
        );
    }

    #[test]
    fn a_save_refuses_a_stop_once_its_zip_is_in_and_a_change_start_backup_still_takes_one() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        let vault_dir = root.vault_dir("notes").unwrap();
        let backups = vault_dir.join(BACKUPS_DIR);

        // The rename and the flushes of a save finish its job.
        let id = test_job_id();
        let saving = Job::start(&id).unwrap();
        write_backup_zip(&vault_dir, "notes", &backups, BackupDir::Saves, &saving).unwrap();
        assert!(matches!(
            crate::session::cancel_job(&id),
            Err(UprivError::JobNotStoppable)
        ));

        // The backup at the start of a password change is one step of that change.
        let id = test_job_id();
        let changing = Job::start(&id).unwrap();
        write_backup_zip(
            &vault_dir,
            "notes",
            &backups,
            BackupDir::ChangeSave,
            &changing,
        )
        .unwrap();
        assert_eq!(
            crate::session::cancel_job(&id).unwrap(),
            crate::session::JobStop::Stopping
        );
    }

    #[test]
    fn save_now_refuses_an_open_vault_and_leaves_no_file() {
        use crate::vault::{close_vault, open_vault};

        let (_tmp, root) = vault_root_with(&[]);
        let mut config = sample_config("notes", "Notes");
        config.backup.enabled = false;
        create_vault(&root, config, b"pass-word-ok", KdfUnlockPreset::M32).unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        let err = save_backup_now(&root, "notes", &test_job_id()).unwrap_err();
        assert!(matches!(err, UprivError::VaultMustBeClosed));
        let backups = root.vault_dir("notes").unwrap().join("backups");
        assert!(!backups.join("saves").host_exists());
        assert!(list_backups(&root, "notes").unwrap().is_empty());

        close_vault(&root, "notes").unwrap();
        assert!(
            save_backup_now(&root, "notes", &test_job_id())
                .unwrap()
                .entry
                .saved
        );
    }

    #[test]
    fn each_store_zip_is_listed_by_file_name() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        let stamp = backup_on_close(&root, "notes", &Job::untracked())
            .unwrap()
            .expect("stamp")
            .stamp;
        let backups = root.vault_dir("notes").unwrap().join("backups");
        let original = backups.join(format!("{stamp}-notes.zip"));
        let other = backups.join(format!("{stamp}-other.zip"));
        crate::host_fs::copy(&original, &other).unwrap();
        crate::host_fs::write(backups.join(format!("{stamp}-extra.zip")), b"not-a-vault").unwrap();
        let listed = list_backups(&root, "notes").unwrap();
        let names: Vec<String> = listed.iter().map(|entry| entry.file_name.clone()).collect();
        assert_eq!(
            names,
            vec![format!("{stamp}-notes.zip"), format!("{stamp}-other.zip"),]
        );
        let found = backup_zip_file(&root, "notes", &format!("data/{stamp}-other.zip")).unwrap();
        assert_eq!(found, other);
        delete_backups(&root, "notes", &[format!("data/{stamp}-other.zip")]).unwrap();
        assert!(!other.host_exists());
        assert!(original.host_is_file());
        assert_eq!(list_backups(&root, "notes").unwrap().len(), 1);
    }

    #[test]
    fn same_file_name_in_saves_is_a_separate_backup() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        let stamp = backup_on_close(&root, "notes", &Job::untracked())
            .unwrap()
            .expect("stamp")
            .stamp;
        let backups = root.vault_dir("notes").unwrap().join("backups");
        let name = format!("{stamp}-notes.zip");
        let original = backups.join(&name);
        let saves = backups.join("saves");
        crate::host_fs::create_dir_all(&saves).unwrap();
        let pinned = saves.join(&name);
        crate::host_fs::copy(&original, &pinned).unwrap();
        let listed = list_backups(&root, "notes").unwrap();
        assert_eq!(listed.len(), 2);
        assert_eq!(listed.iter().filter(|entry| entry.saved).count(), 1);
        let found = backup_zip_file(&root, "notes", &format!("data/saves/{name}")).unwrap();
        assert_eq!(found, pinned);
        let bundle_dir = tempfile::tempdir().unwrap();
        let bundle = export_backups(
            &root,
            "notes",
            &[format!("data/{name}"), format!("data/saves/{name}")],
            bundle_dir.path(),
            &test_job_id(),
        )
        .unwrap();
        assert_eq!(
            zip_entry_names(&bundle.path),
            vec![name.clone(), format!("saves-{name}")]
        );
        let key = format!("data/{name}");
        delete_backups(&root, "notes", &[key.clone(), key]).unwrap();
        assert!(!original.host_exists());
        assert!(pinned.host_is_file());
        assert_eq!(list_backups(&root, "notes").unwrap().len(), 1);
        assert!(list_backups(&root, "notes").unwrap()[0].saved);
    }

    #[test]
    fn promote_keeps_the_zip_when_the_pin_name_is_not_a_vault() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        let stamp = backup_on_close(&root, "notes", &Job::untracked())
            .unwrap()
            .expect("stamp")
            .stamp;
        let backups = root.vault_dir("notes").unwrap().join("backups");
        let name = format!("{stamp}-notes.zip");
        let original = backups.join(&name);
        let saves = backups.join("saves");
        crate::host_fs::create_dir_all(&saves).unwrap();
        crate::host_fs::write(saves.join(&name), b"not-a-vault").unwrap();
        let err = promote_backup_save(&root, "notes", &format!("data/{name}")).unwrap_err();
        assert!(matches!(err, UprivError::VaultStoreInvalid { .. }));
        assert!(original.host_is_file());
        assert_eq!(list_backups(&root, "notes").unwrap().len(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn symlink_is_not_a_backup() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        let stamp = backup_on_close(&root, "notes", &Job::untracked())
            .unwrap()
            .expect("stamp")
            .stamp;
        let backups = root.vault_dir("notes").unwrap().join("backups");
        let name = format!("{stamp}-notes.zip");
        let original = backups.join(&name);
        let hold = backups.join("hold.zip");
        crate::host_fs::rename(&original, &hold).unwrap();
        std::os::unix::fs::symlink(&hold, &original).unwrap();
        assert!(list_backups(&root, "notes").unwrap().is_empty());
        let key = format!("data/{name}");
        assert!(backup_zip_file(&root, "notes", &key).is_err());
        let out = tempfile::tempdir().unwrap();
        assert!(export_backups(&root, "notes", &[key], out.path(), &test_job_id()).is_err());
        assert_eq!(crate::host_fs::read_dir(out.path()).unwrap().count(), 0);
    }

    fn zip_entry_names(path: &Path) -> Vec<String> {
        let mut archive = zip::ZipArchive::new(crate::host_fs::File::open(path).unwrap()).unwrap();
        let mut names = Vec::new();
        for index in 0..archive.len() {
            names.push(archive.by_index(index).unwrap().name().to_string());
        }
        names.sort();
        names
    }

    /// A vault `notes` with two standard backups, and their keys.
    fn vault_with_two_backups() -> (tempfile::TempDir, VaultRoot, String, String) {
        let (tmp, root) = vault_root_with(&[]);
        let mut config = sample_config("notes", "Notes");
        config.backup.mode = VaultBackupMode::KeepAll;
        create_vault(&root, config, b"pass-word-ok", KdfUnlockPreset::M32).unwrap();
        let first = backup_on_close(&root, "notes", &Job::untracked())
            .unwrap()
            .expect("stamp")
            .stamp;
        let second = backup_on_close(&root, "notes", &Job::untracked())
            .unwrap()
            .expect("stamp")
            .stamp;
        (
            tmp,
            root,
            format!("data/{first}-notes.zip"),
            format!("data/{second}-notes.zip"),
        )
    }

    /// The file a key names.
    fn file_of(key: &str) -> &str {
        key.rsplit('/').next().unwrap()
    }

    #[test]
    fn one_backup_is_copied_under_its_own_name() {
        let (_tmp, root, name, _) = vault_with_two_backups();
        let out = tempfile::tempdir().unwrap();
        let stamps = std::slice::from_ref(&name);
        let written = export_backups(&root, "notes", stamps, out.path(), &test_job_id()).unwrap();
        assert_eq!(written.path, out.path().join(file_of(&name)));
        assert_eq!(written.number, 1);
        let source = backup_zip_file(&root, "notes", &name).unwrap();
        let bytes = crate::host_fs::read(&written.path).unwrap();
        assert_eq!(bytes, crate::host_fs::read(&source).unwrap());
        assert_eq!(written.size, bytes.len() as u64);
    }

    #[test]
    fn the_same_backup_twice_is_one_file() {
        let (_tmp, root, name, _) = vault_with_two_backups();
        let out = tempfile::tempdir().unwrap();
        let stamps = [name.clone(), name.clone()];
        let written = export_backups(&root, "notes", &stamps, out.path(), &test_job_id()).unwrap();
        assert_eq!(written.path, out.path().join(file_of(&name)));
    }

    #[test]
    fn several_backups_are_one_stored_zip_named_for_the_vault() {
        let (_tmp, root, first, second) = vault_with_two_backups();
        let out = tempfile::tempdir().unwrap();
        let stamps = [first.clone(), second.clone()];
        let written = export_backups(&root, "notes", &stamps, out.path(), &test_job_id()).unwrap();
        assert_eq!(written.path, out.path().join("upriv-backups-notes.zip"));
        assert_eq!(
            written.size,
            crate::host_fs::metadata(&written.path).unwrap().len()
        );

        let mut archive =
            zip::ZipArchive::new(crate::host_fs::File::open(&written.path).unwrap()).unwrap();
        let mut names = Vec::new();
        for index in 0..archive.len() {
            let mut entry = archive.by_index(index).unwrap();
            assert_eq!(entry.compression(), zip::CompressionMethod::Stored);
            let mut body = Vec::new();
            std::io::Read::read_to_end(&mut entry, &mut body).unwrap();
            let source =
                backup_zip_file(&root, "notes", &format!("data/{}", entry.name())).unwrap();
            assert_eq!(body, crate::host_fs::read(&source).unwrap());
            names.push(entry.name().to_string());
        }
        names.sort();
        let mut expected = vec![file_of(&first).to_string(), file_of(&second).to_string()];
        expected.sort();
        assert_eq!(names, expected);
    }

    #[test]
    fn a_taken_name_gets_the_next_free_number_and_nothing_is_replaced() {
        let (_tmp, root, first, second) = vault_with_two_backups();
        let out = tempfile::tempdir().unwrap();
        let older = out.path().join(file_of(&first));
        crate::host_fs::write(&older, b"older").unwrap();
        let stamps = std::slice::from_ref(&first);
        let written = export_backups(&root, "notes", stamps, out.path(), &test_job_id()).unwrap();
        let stem = file_of(&first).strip_suffix(".zip").unwrap();
        assert_eq!(written.path, out.path().join(format!("{stem}-2.zip")));
        assert_eq!(written.number, 2);
        assert_eq!(crate::host_fs::read(&older).unwrap(), b"older");

        crate::host_fs::write(out.path().join("upriv-backups-notes.zip"), b"older").unwrap();
        let bundle =
            export_backups(&root, "notes", &[first, second], out.path(), &test_job_id()).unwrap();
        assert_eq!(bundle.path, out.path().join("upriv-backups-notes-2.zip"));
    }

    #[test]
    fn a_stopped_export_leaves_no_file() {
        let (_tmp, root, first, second) = vault_with_two_backups();
        let out = tempfile::tempdir().unwrap();
        let stopped = test_job_id();
        crate::session::cancel_job(&stopped).unwrap();
        assert!(matches!(
            export_backups(
                &root,
                "notes",
                std::slice::from_ref(&first),
                out.path(),
                &stopped
            ),
            Err(UprivError::JobCancelled)
        ));

        for stamps in [vec![first.clone()], vec![first.clone(), second.clone()]] {
            let id = test_job_id();
            let running = Job::start(&id).unwrap();
            crate::session::cancel_job(&id).unwrap();
            assert!(matches!(
                write_backup_export(&root, "notes", &stamps, out.path(), &running),
                Err(UprivError::JobCancelled)
            ));
        }
        assert_eq!(crate::host_fs::read_dir(out.path()).unwrap().count(), 0);
    }

    #[test]
    fn a_failed_export_leaves_no_file() {
        let (_tmp, root, first, second) = vault_with_two_backups();
        let out = tempfile::tempdir().unwrap();
        let stamps = [first.clone(), second];
        let source = backup_zip_file(&root, "notes", &stamps[1]).unwrap();
        crate::host_fs::remove_file(&source).unwrap();
        assert!(export_backups(&root, "notes", &stamps, out.path(), &test_job_id()).is_err());
        assert!(export_backups(&root, "notes", &[], out.path(), &test_job_id()).is_err());
        assert_eq!(crate::host_fs::read_dir(out.path()).unwrap().count(), 0);
    }

    #[test]
    fn progress_counts_the_bytes_of_the_backups() {
        let (_tmp, root, first, second) = vault_with_two_backups();
        let out = tempfile::tempdir().unwrap();
        let stamps = [first.clone(), second.clone()];
        let id = test_job_id();
        let job = Job::start(&id).unwrap();
        write_backup_export(&root, "notes", &stamps, out.path(), &job).unwrap();
        let expected: u64 = [first, second]
            .iter()
            .map(|name| {
                let path = backup_zip_file(&root, "notes", name).unwrap();
                crate::host_fs::metadata(path).unwrap().len()
            })
            .sum();
        // Every byte is in, so the job is in its last step.
        assert_eq!(
            crate::session::job_status(&id),
            Some(crate::session::JobStatus {
                bytes_done: expected,
                bytes_total: expected,
                stoppable: false,
                step: None,
            })
        );
    }

    #[test]
    fn delete_and_rename_wait_until_the_export_ends() {
        let (_tmp, root, name, _) = vault_with_two_backups();
        let vault_dir = root.vault_dir("notes").unwrap();
        let zip = backup_zip_file(&root, "notes", &name).unwrap();
        let reading = BackupExportGuard::enter(&vault_dir, vec![zip.clone()]).unwrap();
        assert!(matches!(
            delete_notes(&root, false),
            Err(UprivError::VaultConfigBusy { .. })
        ));
        assert!(matches!(
            crate::vault::rename_vault(&root, "notes", "Journal"),
            Err(UprivError::VaultConfigBusy { .. })
        ));
        assert!(backup_zip_file(&root, "notes", &name)
            .unwrap()
            .host_is_file());

        // A second export reads beside the first; the last one out frees the vault.
        let second = BackupExportGuard::enter(&vault_dir, vec![zip]).unwrap();
        drop(reading);
        assert!(matches!(
            delete_notes(&root, false),
            Err(UprivError::VaultConfigBusy { .. })
        ));
        drop(second);
        delete_notes(&root, false).unwrap();
        assert!(!vault_dir.host_exists());
    }

    #[test]
    fn a_backup_being_exported_is_neither_deleted_nor_pinned() {
        let (_tmp, root, exported, other) = vault_with_two_backups();
        let vault_dir = root.vault_dir("notes").unwrap();
        let zip = backup_zip_file(&root, "notes", &exported).unwrap();
        let reading = BackupExportGuard::enter(&vault_dir, vec![zip.clone()]).unwrap();

        assert!(matches!(
            delete_backups(&root, "notes", &[other.clone(), exported.clone()]),
            Err(UprivError::BackupExporting)
        ));
        assert!(matches!(
            promote_backup_save(&root, "notes", &exported),
            Err(UprivError::BackupExporting)
        ));
        assert!(zip.host_is_file());
        assert!(backup_zip_file(&root, "notes", &other)
            .unwrap()
            .host_is_file());

        // The other backup is free, and the exported one is once the export ends.
        delete_backups(&root, "notes", std::slice::from_ref(&other)).unwrap();
        drop(reading);
        delete_backups(&root, "notes", &[exported]).unwrap();
        assert!(!zip.host_exists());
    }

    #[test]
    fn retention_leaves_a_backup_being_exported_for_a_later_close() {
        let (_tmp, root, oldest, newest) = vault_with_two_backups();
        let vault_dir = root.vault_dir("notes").unwrap();
        let zip = backup_zip_file(&root, "notes", &oldest).unwrap();
        let reading = BackupExportGuard::enter(&vault_dir, vec![zip.clone()]).unwrap();
        let retain = || {
            apply_retention(
                &vault_dir,
                "notes",
                DATA_FOLDER_REF,
                VaultBackupMode::KeepLast,
                1,
            )
        };

        retain().unwrap();
        assert!(zip.host_is_file());

        drop(reading);
        retain().unwrap();
        assert!(!zip.host_exists());
        assert!(backup_zip_file(&root, "notes", &newest)
            .unwrap()
            .host_is_file());
    }

    #[test]
    fn an_export_refuses_a_backup_that_is_already_gone() {
        let (_tmp, root, name, _) = vault_with_two_backups();
        let vault_dir = root.vault_dir("notes").unwrap();
        let zip = backup_zip_file(&root, "notes", &name).unwrap();
        crate::host_fs::remove_file(&zip).unwrap();
        assert!(matches!(
            BackupExportGuard::enter(&vault_dir, vec![zip]),
            Err(UprivError::VaultPathNotFound(_))
        ));
        assert!(!crate::session::is_vault_backup_export_at(&vault_dir));
    }

    #[test]
    fn an_export_ends_its_hold_on_the_vault() {
        let (_tmp, root, name, _) = vault_with_two_backups();
        let out = tempfile::tempdir().unwrap();
        export_backups(&root, "notes", &[name], out.path(), &test_job_id()).unwrap();
        delete_notes(&root, false).unwrap();
    }

    #[test]
    fn an_export_into_a_upriv_is_refused_and_an_open_vault_exports() {
        use crate::vault::{close_vault, open_vault};

        let (_tmp, root, name, _) = vault_with_two_backups();
        let inside = root.root().join(".upriv/app");
        crate::host_fs::create_dir_all(&inside).unwrap();
        assert!(matches!(
            export_backups(
                &root,
                "notes",
                std::slice::from_ref(&name),
                &inside,
                &test_job_id()
            ),
            Err(UprivError::ExportDestinationReserved(_))
        ));

        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        let out = tempfile::tempdir().unwrap();
        export_backups(&root, "notes", &[name], out.path(), &test_job_id()).unwrap();
        close_vault(&root, "notes").unwrap();
    }

    use super::super::persistence::load_vault_persistence;
    use crate::folder_list::Selection;
    use crate::vault::{close_vault, open_vault};

    const PASSWORD: &[u8] = b"pass-word-ok";

    /// A vault `notes` whose backups go to its own rows on this device, the
    /// first selected.
    fn vault_with_rows(rows: &[&Path], keep_last: u32) -> (tempfile::TempDir, VaultRoot) {
        let (tmp, root) = vault_root_with(&[]);
        let mut config = sample_config("notes", "Notes");
        config.backup.keep_last = keep_last;
        backup_rows(&mut config, rows);
        create_vault(&root, config, PASSWORD, KdfUnlockPreset::M32).unwrap();
        (tmp, root)
    }

    fn close_backup(root: &VaultRoot) -> WrittenBackup {
        backup_on_close(root, "notes", &Job::untracked())
            .unwrap()
            .expect("a backup")
    }

    fn zips_in(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = crate::host_fs::read_dir(dir)
            .map(|entries| {
                entries
                    .flatten()
                    .filter_map(|entry| entry.file_name().to_str().map(str::to_string))
                    .filter(|name| name.ends_with(".zip"))
                    .collect()
            })
            .unwrap_or_default();
        names.sort();
        names
    }

    fn data_folder(root: &VaultRoot) -> PathBuf {
        root.vault_dir("notes").unwrap().join(BACKUPS_DIR)
    }

    fn selection_here(
        root: &VaultRoot,
    ) -> Selection<crate::folder_list::backup::VaultBackupChoice> {
        let config = load_vault_config(root.vault_dir("notes").unwrap()).unwrap();
        config.backup.devices.selection_here(this_device())
    }

    #[test]
    fn a_selected_row_takes_the_backups_and_lists_them_as_the_folder_in_use() {
        let drive = tempfile::tempdir().unwrap();
        let (_tmp, root) = vault_with_rows(&[drive.path()], 1);
        let written = close_backup(&root);
        let dir = drive.path().join("upriv-notes-backups");
        assert_eq!(written.path.parent().unwrap(), dir);
        assert!(written.switches.is_empty());
        assert!(zips_in(&data_folder(&root)).is_empty());

        let listing = backup_listing(&root, "notes").unwrap();
        let in_use = listing
            .sections
            .iter()
            .find(|section| section.kind == SectionKind::InUse)
            .expect("the folder in use");
        assert_eq!(in_use.path, dir);
        assert_eq!(in_use.status, FolderState::Ok);
        assert_eq!(in_use.entries.len(), 1);
        assert_eq!(
            in_use.entries[0].key,
            format!("{}/{}", in_use.folder, in_use.entries[0].file_name)
        );
        assert_eq!(
            backup_zip_file(&root, "notes", &in_use.entries[0].key).unwrap(),
            written.path
        );
    }

    #[test]
    fn an_app_row_keeps_each_vault_in_its_own_folder() {
        let drive = tempfile::tempdir().unwrap();
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            PASSWORD,
            KdfUnlockPreset::M32,
        )
        .unwrap();
        crate::config::update_app_settings(root.root(), |settings| {
            let device = this_device();
            settings.backups.devices.0.insert(
                device.id.clone().unwrap(),
                crate::folder_list::DeviceGroup {
                    rows: vec![crate::folder_list::Row {
                        number: 1,
                        name: String::new(),
                        path: drive.path().display().to_string(),
                    }],
                    selected: Selection::Row(1),
                    next_number: 2,
                    ..crate::folder_list::DeviceGroup::for_device(device)
                },
            );
        })
        .unwrap();
        let written = close_backup(&root);
        assert_eq!(
            written.path.parent().unwrap(),
            drive.path().join("upriv-backups").join("notes")
        );
    }

    #[test]
    fn an_unplugged_row_hands_over_and_the_switch_is_saved() {
        let tmp = tempfile::tempdir().unwrap();
        let unplugged = tmp.path().join("unplugged");
        let second = tmp.path().join("second");
        crate::host_fs::create_dir_all(&second).unwrap();
        let (_keep, root) = vault_with_rows(&[&unplugged, &second], 1);

        let written = close_backup(&root);
        assert_eq!(
            written.path.parent().unwrap(),
            second.join("upriv-notes-backups")
        );
        assert_eq!(written.switches.len(), 1);
        assert_eq!(written.switches[0].reason, FolderState::Missing);
        assert!(written.switches[0].saved);
        assert!(
            !unplugged.host_exists(),
            "a drive that is not there is never made"
        );
        assert_eq!(selection_here(&root), Selection::Row(2));
    }

    #[test]
    fn with_every_row_gone_the_data_folder_takes_the_zip() {
        let tmp = tempfile::tempdir().unwrap();
        let (_keep, root) = vault_with_rows(&[&tmp.path().join("gone")], 1);
        let written = close_backup(&root);
        assert_eq!(written.path.parent().unwrap(), data_folder(&root));
        assert_eq!(written.folder, DATA_FOLDER_REF);
        assert_eq!(
            selection_here(&root),
            Selection::Fixed(crate::folder_list::backup::VaultBackupChoice::Inherit)
        );
    }

    #[test]
    fn a_folder_this_device_wrote_to_is_away_until_selected_again() {
        let drive = tempfile::tempdir().unwrap();
        let (_tmp, root) = vault_with_rows(&[drive.path()], 1);
        close_backup(&root);
        let dir = drive.path().join("upriv-notes-backups");
        crate::host_fs::remove_dir_all(&dir).unwrap();

        // Another drive at the same path: the vault's folder is not there.
        let written = close_backup(&root);
        assert_eq!(written.path.parent().unwrap(), data_folder(&root));
        assert!(!dir.host_exists());

        let mut config = load_vault_config(root.vault_dir("notes").unwrap()).unwrap();
        backup_rows(&mut config, &[drive.path()]);
        crate::config::save_vault_config(root.vault_dir("notes").unwrap(), &config).unwrap();
        reuse_selected_backup_folder(&root, "notes").unwrap();
        let again = close_backup(&root);
        assert_eq!(again.path.parent().unwrap(), dir);
    }

    #[test]
    fn a_stop_writes_nothing_anywhere() {
        let drive = tempfile::tempdir().unwrap();
        let (_tmp, root) = vault_with_rows(&[drive.path()], 1);
        let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true));
        let stopped = backup_on_close(&root, "notes", &Job::stopped_by(stop));
        assert!(matches!(stopped, Err(UprivError::JobCancelled)));
        assert!(zips_in(&drive.path().join("upriv-notes-backups")).is_empty());
        assert!(zips_in(&data_folder(&root)).is_empty());
    }

    #[test]
    fn rotation_happens_only_in_the_folder_in_use() {
        let tmp = tempfile::tempdir().unwrap();
        let first = tmp.path().join("first");
        let second = tmp.path().join("second");
        crate::host_fs::create_dir_all(&first).unwrap();
        crate::host_fs::create_dir_all(&second).unwrap();
        let (_keep, root) = vault_with_rows(&[&first, &second], 1);
        let on_first = close_backup(&root);

        let mut config = load_vault_config(root.vault_dir("notes").unwrap()).unwrap();
        config
            .backup
            .devices
            .select_here(this_device(), Selection::Row(2));
        crate::config::save_vault_config(root.vault_dir("notes").unwrap(), &config).unwrap();
        let a = close_backup(&root);
        let b = close_backup(&root);
        assert!(!a.path.host_exists(), "keep last rotates the folder in use");
        assert!(b.path.host_is_file());
        assert!(
            on_first.path.host_is_file(),
            "a folder no longer in use is never touched"
        );

        let listing = backup_listing(&root, "notes").unwrap();
        let other = listing
            .sections
            .iter()
            .find(|section| section.kind == SectionKind::Other)
            .expect("the first folder stays listed");
        assert_eq!(other.entries.len(), 1);
    }

    #[test]
    fn a_new_zip_stays_when_the_clock_is_behind_the_last_one() {
        let drive = tempfile::tempdir().unwrap();
        let (_tmp, root) = vault_with_rows(&[drive.path()], 1);
        let dir = drive.path().join("upriv-notes-backups");
        let vault_dir = root.vault_dir("notes").unwrap();
        let first = close_backup(&root);

        // The last backup has a date far ahead of this machine's clock.
        let future = dir.join("29991231235959-notes.zip");
        crate::host_fs::rename(&first.path, &future).unwrap();
        update_vault_persistence(&vault_dir, "notes", |persistence| {
            persistence.backups_written = vec![WrittenZip {
                name: "29991231235959-notes.zip".into(),
                folder: first.folder.clone(),
            }];
        })
        .unwrap();

        let newest = close_backup(&root);
        assert!(newest.path.host_is_file(), "the zip just written stays");
        assert!(!future.host_exists(), "the one written before it goes");
    }

    #[test]
    fn retention_never_touches_a_zip_upriv_did_not_write() {
        let drive = tempfile::tempdir().unwrap();
        let (_tmp, root) = vault_with_rows(&[drive.path()], 1);
        let dir = drive.path().join("upriv-notes-backups");
        let first = close_backup(&root);
        let theirs = dir.join("20000101000000-notes.zip");
        crate::host_fs::copy(&first.path, &theirs).unwrap();
        let own = dir.join("my-holiday-photos.zip");
        crate::host_fs::write(&own, b"not a vault").unwrap();

        close_backup(&root);
        close_backup(&root);

        assert!(theirs.host_is_file(), "another copy's zip stays");
        assert!(own.host_is_file(), "a person's own file stays");
        assert_eq!(zips_in(&dir).len(), 3);
    }

    #[cfg(unix)]
    #[test]
    fn a_delete_that_fails_keeps_its_entry_and_is_tried_again() {
        use std::os::unix::fs::PermissionsExt;
        if unsafe { libc::geteuid() } == 0 {
            return;
        }
        let (_tmp, root, _, _) = vault_with_two_backups();
        let vault_dir = root.vault_dir("notes").unwrap();
        let backups = vault_dir.join(BACKUPS_DIR);
        let retain = || {
            apply_retention(
                &vault_dir,
                "notes",
                DATA_FOLDER_REF,
                VaultBackupMode::KeepLast,
                1,
            )
        };

        std::fs::set_permissions(&backups, std::fs::Permissions::from_mode(0o500)).unwrap();
        let failed = retain();
        std::fs::set_permissions(&backups, std::fs::Permissions::from_mode(0o700)).unwrap();
        assert!(failed.is_err());
        assert_eq!(zips_in(&backups).len(), 2);

        retain().unwrap();
        assert_eq!(zips_in(&backups).len(), 1);
    }

    #[test]
    fn another_vault_with_the_same_id_is_not_listed_or_touched() {
        let drive = tempfile::tempdir().unwrap();
        let (_a, first) = vault_with_rows(&[drive.path()], 1);
        let (_b, second) = vault_with_rows(&[drive.path()], 1);
        let theirs = close_backup(&first);
        let ours = close_backup(&second);

        let listed = list_backups(&second, "notes").unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].path, ours.path);
        assert!(theirs.path.host_is_file());
    }

    #[test]
    fn a_vault_with_a_dead_header_lists_every_zip_in_its_folder() {
        let drive = tempfile::tempdir().unwrap();
        let (_a, other) = vault_with_rows(&[drive.path()], 1);
        let (_b, root) = vault_with_rows(&[drive.path()], 1);
        close_backup(&other);
        close_backup(&root);
        let header = root
            .vault_store_dir("notes")
            .unwrap()
            .join(crate::store::HEADER_DIR_NAME);
        crate::host_fs::remove_dir_all(&header).unwrap();
        assert_eq!(list_backups(&root, "notes").unwrap().len(), 2);
    }

    #[test]
    fn an_unchanged_vault_skips_only_while_its_last_zip_is_in_the_folder_in_use() {
        let tmp = tempfile::tempdir().unwrap();
        let first = tmp.path().join("first");
        let second = tmp.path().join("second");
        crate::host_fs::create_dir_all(&first).unwrap();
        crate::host_fs::create_dir_all(&second).unwrap();
        let (_keep, root) = vault_with_rows(&[&first, &second], 3);
        open_vault(&root, "notes", PASSWORD).unwrap();
        let closed = close_vault(&root, "notes").unwrap();
        assert_eq!(zips_in(&first.join("upriv-notes-backups")).len(), 1);
        assert_eq!(
            closed.backup_reason,
            Some(crate::vault::CloseBackupReason::First),
            "an unchanged vault's first zip says why"
        );
        assert_eq!(
            closed.backup_folder.as_deref(),
            first.join("upriv-notes-backups").to_str()
        );

        open_vault(&root, "notes", PASSWORD).unwrap();
        let closed = close_vault(&root, "notes").unwrap();
        assert_eq!(
            zips_in(&first.join("upriv-notes-backups")).len(),
            1,
            "unchanged: no zip"
        );
        assert_eq!(closed.backup_reason, None);
        assert_eq!(closed.backup_folder, None);

        let mut config = load_vault_config(root.vault_dir("notes").unwrap()).unwrap();
        config
            .backup
            .devices
            .select_here(this_device(), Selection::Row(2));
        crate::config::save_vault_config(root.vault_dir("notes").unwrap(), &config).unwrap();
        open_vault(&root, "notes", PASSWORD).unwrap();
        let closed = close_vault(&root, "notes").unwrap();
        assert_eq!(
            zips_in(&second.join("upriv-notes-backups")).len(),
            1,
            "after a switch the next close writes a zip"
        );
        assert_eq!(
            closed.backup_reason,
            Some(crate::vault::CloseBackupReason::Moved)
        );
    }

    #[test]
    fn an_unchanged_vault_writes_nothing_while_its_drive_does_not_answer_and_is_there() {
        let drive = tempfile::tempdir().unwrap();
        let (_tmp, root) = vault_with_rows(&[drive.path()], 3);
        open_vault(&root, "notes", PASSWORD).unwrap();
        close_vault(&root, "notes").unwrap();
        let dir = drive.path().join("upriv-notes-backups");
        let only = zips_in(&dir);
        assert_eq!(only.len(), 1);
        let saved = load_vault_persistence(root.vault_dir("notes").unwrap())
            .unwrap()
            .unwrap();
        let record = saved.this_device_record().unwrap();
        let last = LastBackup {
            stamp: record.stamp.clone().unwrap(),
            folder: record.folder.clone().unwrap(),
        };
        assert_eq!(
            close_backup_place(&root, "notes", &last),
            LastBackupPlace::Kept
        );
        crate::host_fs::remove_file(dir.join(&only[0])).unwrap();
        assert_eq!(
            close_backup_place(&root, "notes", &last),
            LastBackupPlace::Gone
        );
    }

    #[test]
    fn a_named_backup_is_pinned_and_its_name_reads_from_the_file() {
        let drive = tempfile::tempdir().unwrap();
        let (_tmp, root) = vault_with_rows(&[drive.path()], 1);
        let written = close_backup(&root);
        let key = list_backups(&root, "notes").unwrap()[0].key.clone();
        let named = rename_backup(&root, "notes", &key, " Before the trip ").unwrap();
        assert!(named.saved);
        assert_eq!(named.name, "Before the trip");
        assert_eq!(
            named.file_name,
            format!("{}-notes Before the trip.zip", written.stamp)
        );
        assert!(!written.path.host_exists());
        assert!(named
            .path
            .ends_with(Path::new("saves").join(&named.file_name)));
        let listed = list_backups(&root, "notes").unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "Before the trip");

        // Retention never deletes a backup the person named.
        close_backup(&root);
        close_backup(&root);
        assert!(named.path.host_is_file());

        let cleared = rename_backup(&root, "notes", &named.key, "").unwrap();
        assert_eq!(cleared.file_name, format!("{}-notes.zip", written.stamp));
        assert!(cleared.saved);
        let saved = load_vault_persistence(root.vault_dir("notes").unwrap())
            .unwrap()
            .unwrap();
        assert!(saved
            .backups_written
            .iter()
            .any(|written| written.name == cleared.file_name));
    }

    #[test]
    fn a_backup_name_keeps_what_a_system_can_hold() {
        assert_eq!(
            named_zip_filename("20260101000000", "notes", "a/b: c").unwrap(),
            "20260101000000-notes a_b_ c.zip"
        );
        assert_eq!(
            named_zip_filename("20260101000000", "notes", "   ").unwrap(),
            "20260101000000-notes.zip"
        );
        let long = "x".repeat(BACKUP_NAME_MAX_CHARS + 1);
        assert!(matches!(
            named_zip_filename("20260101000000", "notes", &long),
            Err(UprivError::BackupNameInvalid)
        ));
        assert_eq!(
            parse_zip_name("20260101000000-notes Trip 2.zip"),
            Some(ZipName {
                stamp: "20260101000000".into(),
                name: "Trip 2".into(),
            })
        );
        assert_eq!(parse_zip_name("20260101000000-notes .zip"), None);
    }

    #[test]
    fn forgetting_a_folder_drops_its_zips_from_the_list_and_leaves_the_files() {
        let tmp = tempfile::tempdir().unwrap();
        let first = tmp.path().join("first");
        crate::host_fs::create_dir_all(&first).unwrap();
        let (_keep, root) = vault_with_rows(&[&first], 1);
        let written = close_backup(&root);
        forget_backup_folder(&root, "notes", &written.folder).unwrap();
        let saved = load_vault_persistence(root.vault_dir("notes").unwrap())
            .unwrap()
            .unwrap();
        assert!(saved.backup_folders.is_empty());
        assert!(saved.backups_written.is_empty());
        assert!(written.path.host_is_file());
        assert!(forget_backup_folder(&root, "notes", DATA_FOLDER_REF).is_err());
    }

    #[test]
    fn a_folder_that_cannot_be_read_shows_its_status_and_the_rest_still_list() {
        let tmp = tempfile::tempdir().unwrap();
        let first = tmp.path().join("first");
        let second = tmp.path().join("second");
        crate::host_fs::create_dir_all(&first).unwrap();
        crate::host_fs::create_dir_all(&second).unwrap();
        let (_keep, root) = vault_with_rows(&[&first, &second], 1);
        close_backup(&root);
        let mut config = load_vault_config(root.vault_dir("notes").unwrap()).unwrap();
        config
            .backup
            .devices
            .select_here(this_device(), Selection::Row(2));
        crate::config::save_vault_config(root.vault_dir("notes").unwrap(), &config).unwrap();
        close_backup(&root);
        crate::host_fs::rename(&first, tmp.path().join("away")).unwrap();

        let listing = backup_listing(&root, "notes").unwrap();
        let other = listing
            .sections
            .iter()
            .find(|section| section.kind == SectionKind::Other)
            .unwrap();
        assert_eq!(other.status, FolderState::Missing);
        assert!(other.entries.is_empty());
        let in_use = listing
            .sections
            .iter()
            .find(|section| section.kind == SectionKind::InUse)
            .unwrap();
        assert_eq!(in_use.entries.len(), 1);
        let saved = load_vault_persistence(root.vault_dir("notes").unwrap())
            .unwrap()
            .unwrap();
        assert_eq!(
            saved.backup_folders.len(),
            2,
            "a folder that is away keeps its zips listed"
        );
    }

    #[test]
    fn a_renamed_vault_keeps_finding_its_folder() {
        let drive = tempfile::tempdir().unwrap();
        let (_tmp, root) = vault_with_rows(&[drive.path()], 5);
        let first = close_backup(&root);
        crate::vault::rename_vault(&root, "notes", "Journal").unwrap();
        let written = backup_on_close(&root, "journal", &Job::untracked())
            .unwrap()
            .unwrap();
        assert_eq!(written.path.parent(), first.path.parent());
        assert_eq!(list_backups(&root, "journal").unwrap().len(), 2);
    }

    #[test]
    fn a_bundle_tells_apart_zips_with_one_name_in_two_folders() {
        let drive = tempfile::tempdir().unwrap();
        let (_tmp, root) = vault_with_rows(&[drive.path()], 5);
        let written = close_backup(&root);
        let name = written.path.file_name().unwrap().to_owned();
        let data = data_folder(&root);
        crate::host_fs::create_dir_all(&data).unwrap();
        crate::host_fs::copy(&written.path, data.join(&name)).unwrap();
        let out = tempfile::tempdir().unwrap();
        let name = name.to_string_lossy().into_owned();
        let bundle = export_backups(
            &root,
            "notes",
            &[format!("data/{name}"), format!("{}/{name}", written.folder)],
            out.path(),
            &test_job_id(),
        )
        .unwrap();
        assert_eq!(
            zip_entry_names(&bundle.path),
            vec![name.clone(), format!("{}-{name}", written.folder)]
        );
    }

    #[test]
    fn delete_with_the_switch_on_removes_what_the_vault_wrote_in_every_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let first = tmp.path().join("first");
        let second = tmp.path().join("second");
        crate::host_fs::create_dir_all(&first).unwrap();
        crate::host_fs::create_dir_all(&second).unwrap();
        let (_keep, root) = vault_with_rows(&[&first, &second], 1);
        close_backup(&root);
        let mut config = load_vault_config(root.vault_dir("notes").unwrap()).unwrap();
        config
            .backup
            .devices
            .select_here(this_device(), Selection::Row(2));
        crate::config::save_vault_config(root.vault_dir("notes").unwrap(), &config).unwrap();
        close_backup(&root);
        let theirs = second.join("upriv-notes-backups").join("my-file.txt");
        crate::host_fs::write(&theirs, b"kept").unwrap();

        let outcome = delete_notes(&root, true).unwrap();
        assert!(!first.join("upriv-notes-backups").host_exists());
        assert_eq!(
            zips_in(&second.join("upriv-notes-backups")),
            Vec::<String>::new()
        );
        assert!(
            theirs.host_is_file(),
            "a person's own file keeps its folder"
        );
        assert!(outcome.folders.is_empty());
        assert_eq!(outcome.outside, crate::vault::OutsideBackups::Removed);
    }

    #[test]
    fn delete_with_the_switch_off_leaves_every_folder_alone() {
        let drive = tempfile::tempdir().unwrap();
        let (_tmp, root) = vault_with_rows(&[drive.path()], 1);
        let written = close_backup(&root);
        let outcome = delete_notes(&root, false).unwrap();
        assert_eq!(outcome.outside, crate::vault::OutsideBackups::Kept);
        assert!(written.path.host_is_file());
    }

    #[test]
    fn delete_keeps_the_zips_of_a_folder_that_cannot_be_reached() {
        let tmp = tempfile::tempdir().unwrap();
        let drive = tmp.path().join("drive");
        crate::host_fs::create_dir_all(&drive).unwrap();
        let (_keep, root) = vault_with_rows(&[&drive], 1);
        close_backup(&root);
        crate::host_fs::rename(&drive, tmp.path().join("away")).unwrap();
        let outcome = delete_notes(&root, true).unwrap();
        assert_eq!(outcome.outside, crate::vault::OutsideBackups::Failed);
        assert!(tmp
            .path()
            .join("away")
            .join("upriv-notes-backups")
            .host_is_dir());
    }

    #[test]
    fn the_list_shows_outside_backups_only_once_one_is_written() {
        let drive = tempfile::tempdir().unwrap();
        let (_tmp, root) = vault_with_rows(&[drive.path()], 1);
        let listed = |root: &VaultRoot| crate::vault::vault_list_item(root, "notes").unwrap();
        assert!(!listed(&root).outside_backups);
        close_backup(&root);
        assert!(listed(&root).outside_backups);
    }

    #[test]
    fn a_partial_this_vault_listed_is_cleared_and_no_other_file_is() {
        let drive = tempfile::tempdir().unwrap();
        let (_tmp, root) = vault_with_rows(&[drive.path()], 5);
        let written = close_backup(&root);
        let dir = drive.path().join("upriv-notes-backups");
        let name = format!("{}-notes.zip", written.stamp);
        let listed = dir.join(format!("{name}.partial"));
        let listed_in_saves = dir.join(SAVES_DIR).join(format!("{name}.partial"));
        let theirs = dir.join("20000101000000-notes.zip.partial");
        crate::host_fs::create_dir_all(dir.join(SAVES_DIR)).unwrap();
        for file in [&listed, &listed_in_saves, &theirs] {
            crate::host_fs::write(file, b"unfinished").unwrap();
        }

        discard_listed_partials(&root.vault_dir("notes").unwrap(), &dir);

        assert!(!listed.host_is_file());
        assert!(!listed_in_saves.host_is_file());
        assert!(theirs.host_is_file(), "a partial it did not list stays");
        assert!(written.path.host_is_file());
    }

    #[test]
    fn a_stamp_in_use_anywhere_moves_to_the_next_free_second() {
        let dir = tempfile::tempdir().unwrap();
        let backups = dir.path();
        crate::host_fs::create_dir_all(backups.join(SAVES_DIR)).unwrap();
        crate::host_fs::write(backups.join("20260101000000-notes.zip"), b"zip").unwrap();
        crate::host_fs::write(
            backups.join(SAVES_DIR).join("20260101000001-notes.zip"),
            b"zip",
        )
        .unwrap();
        let listed = HashSet::from(["20260101000002".to_string()]);

        assert_eq!(
            unused_backup_stamp(backups, &listed, "20260101000000".into()).unwrap(),
            "20260101000003"
        );
    }
}
