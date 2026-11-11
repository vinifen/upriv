//! Frozen ciphertext copies of `store/` as Stored zips with no zip password.
//!
//! A vault's backups are in `vaults/<id>/backups/`, or in the folder the person
//! chose ([`super::backup_folder`]), or in both. Each place holds
//! `<stamp>-<id>.zip` and `saves/<stamp>-<id>.zip`, and a backup stays in the
//! place it was written to.
//!
//! A listed backup is a vault zip (`store/header/vault.header`). Two of those
//! files can share a stamp. `name.zip` selects the data folder and
//! `saves/name.zip` its pin; `chosen/name.zip` and `chosen/saves/name.zip`
//! select the chosen folder. A bare stamp selects the only store zip with that
//! stamp. A key is never a path.
//!
//! Upriv deletes on its own only the zips on the list it keeps of what it wrote
//! (`backups_written`), so a person's own files, and a copy of the data folder
//! that shares a chosen folder, are left alone.

#[allow(unused_imports)]
use crate::host_fs::HostFsQuery;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

use super::backup_folder::{
    backup_places, check_chosen_folder, flush_is_unsupported, used_here, zip_bytes_of,
    BackupFolderStatus, BackupPlaces, FolderCheck, BACKUPS_DIR,
};
use super::embedded_settings::snapshot_settings_bytes;
use super::export_folder::{
    check_export_folder, ExportedFile, NumberedExportName, NumberedExportTarget,
};
use super::partial::{discard_partial, PartialWork};
use super::persistence::{load_vault_persistence, update_vault_persistence};
use crate::config::{load_vault_config, VaultBackupMode};
use crate::error::{Result, UprivError};
use crate::failure::classify_write_failure;
use crate::logging::{log_event, LogLevel};
use crate::paths::{ChosenBackupFolder, VaultRoot, SHARED_BACKUPS_FOLDER, STORE_DIR_NAME};
use crate::runtime_state::{refuse_if_held_elsewhere, UnfinishedWork};
use crate::session::{
    ensure_backups_not_exporting, ensure_data_folder_export_idle, remove_backup_unless_exporting,
    with_vault_dir_lock, BackupExportGuard, Job, JobKind,
};
use crate::store::{backup_zip_identity, load_header};
use crate::time::utc_filename_stamp;

const SAVES_DIR: &str = "saves";
const CHOSEN_KEY_PREFIX: &str = "chosen/";
/// Names a finished zip tries when another computer took each one first.
const INSTALL_NAME_TRIES: usize = 8;

/// Which of a vault's two places a backup is in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BackupLocation {
    DataFolder,
    Chosen,
}

impl BackupLocation {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::DataFolder => "data_folder",
            Self::Chosen => "chosen",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackupEntry {
    pub stamp: String,
    /// On-disk name, `YYYYMMDDHHmmss-<id>.zip`.
    pub file_name: String,
    pub created_at: String,
    pub size_bytes: u64,
    pub saved: bool,
    pub location: BackupLocation,
    pub path: PathBuf,
}

impl BackupEntry {
    /// The key that selects this zip.
    pub(crate) fn key(&self) -> String {
        let prefix = match self.location {
            BackupLocation::DataFolder => "",
            BackupLocation::Chosen => CHOSEN_KEY_PREFIX,
        };
        let saves = if self.saved { "saves/" } else { "" };
        format!("{prefix}{saves}{}", self.file_name)
    }
}

/// A vault's chosen backup folder and what it can do right now.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChosenFolderState {
    pub path: PathBuf,
    pub status: BackupFolderStatus,
}

/// Every backup Upriv can see, and the state of the chosen folder when the
/// vault has one. A folder that fails lists what it can, and never fails this.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackupListing {
    pub entries: Vec<BackupEntry>,
    pub chosen: Option<ChosenFolderState>,
}

/// A backup that was just written. `fell_back` says why it is in the data
/// folder when the vault's backups go to a chosen folder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WrittenBackup {
    pub stamp: String,
    pub path: PathBuf,
    pub fell_back: Option<BackupFolderStatus>,
}

/// A save made by Back up now.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SavedBackup {
    pub entry: BackupEntry,
    pub fell_back: Option<BackupFolderStatus>,
}

fn look_at_chosen(
    root: &VaultRoot,
    vault_dir: &Path,
    chosen: &ChosenBackupFolder,
    needed: Option<u64>,
) -> BackupFolderStatus {
    check_chosen_folder(
        root,
        chosen,
        FolderCheck {
            used_here: used_here(vault_dir, &chosen.dir),
            create: false,
            needed,
        },
    )
}

/// A folder in these states has nothing that can be read.
fn folder_is_unreadable(status: BackupFolderStatus) -> bool {
    matches!(
        status,
        BackupFolderStatus::Missing
            | BackupFolderStatus::NotResponding
            | BackupFolderStatus::Reserved
    )
}

pub fn backup_listing(root: &VaultRoot, vault_id: &str) -> Result<BackupListing> {
    let vault_dir = root.vault_dir(vault_id)?;
    if !vault_dir.host_is_dir() {
        return Err(UprivError::VaultNotFound(vault_dir));
    }
    let places = backup_places(root, vault_id, &vault_dir);
    let mut entries = Vec::new();
    collect_backup_place(
        &places.data_folder,
        BackupLocation::DataFolder,
        None,
        &mut entries,
    )?;
    let chosen = places.chosen.as_ref().map(|chosen| {
        let status = look_at_chosen(root, &vault_dir, chosen, zip_bytes_of(&vault_dir));
        if !folder_is_unreadable(status) {
            // A vault whose header is gone cannot tell its zips from another
            // vault's, and that is when it needs them most.
            let identity = load_header(vault_dir.join(STORE_DIR_NAME))
                .ok()
                .map(|header| header.content_identity);
            let read =
                collect_backup_place(&chosen.dir, BackupLocation::Chosen, identity, &mut entries);
            if read.is_err() {
                log_event(
                    LogLevel::Warn,
                    "backup_folder_list_failed",
                    &[("id", vault_id)],
                );
            }
        }
        ChosenFolderState {
            path: chosen.dir.clone(),
            status,
        }
    });
    entries.sort_by(|a, b| {
        b.stamp
            .cmp(&a.stamp)
            .then_with(|| a.file_name.cmp(&b.file_name))
    });
    Ok(BackupListing { entries, chosen })
}

pub fn list_backups(root: &VaultRoot, vault_id: &str) -> Result<Vec<BackupEntry>> {
    backup_listing(root, vault_id).map(|listing| listing.entries)
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

/// [`backup_zips_newest_first`] with the chosen folder's zips too, when it can
/// be read: a rebuild has no time limit, and may need every backup there is.
pub(crate) fn every_backup_zip_newest_first(
    root: &VaultRoot,
    vault_id: &str,
    vault_dir: &Path,
) -> Vec<PathBuf> {
    let places = backup_places(root, vault_id, vault_dir);
    let mut zips = Vec::new();
    zips_named_in(&places.data_folder, &mut zips);
    if let Some(chosen) = &places.chosen {
        if !folder_is_unreadable(look_at_chosen(root, vault_dir, chosen, None)) {
            zips_named_in(&chosen.dir, &mut zips);
        }
    }
    newest_first(zips)
}

fn collect_backup_place(
    place: &Path,
    location: BackupLocation,
    identity: Option<uuid::Uuid>,
    out: &mut Vec<BackupEntry>,
) -> Result<()> {
    collect_backup_dir(&place.join(SAVES_DIR), true, location, identity, out)?;
    collect_backup_dir(place, false, location, identity, out)
}

/// With `identity`, only zips of that vault: a chosen folder can hold another
/// vault's backups under the same name.
fn collect_backup_dir(
    dir: &Path,
    saved: bool,
    location: BackupLocation,
    identity: Option<uuid::Uuid>,
    out: &mut Vec<BackupEntry>,
) -> Result<()> {
    if !dir.host_is_dir() {
        return Ok(());
    }
    for entry in crate::host_fs::read_dir(dir)? {
        let entry = entry?;
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        let Some(stamp) = stamp_from_zip_name(&name) else {
            continue;
        };
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if !kind.host_is_file() {
            continue;
        }
        let path = entry.path();
        let is_this_vaults = match identity {
            Some(identity) => backup_zip_identity(&path) == Some(identity),
            None => super::zip_io::zip_contains_store_header(&path),
        };
        if !is_this_vaults {
            continue;
        }
        let size = match entry.known_len() {
            Some(len) => len,
            None => entry.metadata()?.len(),
        };
        let created_at = stamp_to_iso(&stamp).unwrap_or_default();
        out.push(BackupEntry {
            stamp,
            file_name: name,
            created_at,
            size_bytes: size,
            saved,
            location,
            path,
        });
    }
    Ok(())
}

fn stamp_from_backup_stem(stem: &str) -> Option<String> {
    let (stamp, id) = stem.split_once('-')?;
    if is_backup_stamp(stamp) && crate::paths::slug_id_is_valid(id) {
        Some(stamp.to_string())
    } else {
        None
    }
}

fn stamp_from_zip_name(name: &str) -> Option<String> {
    let stem = name.strip_suffix(".zip")?;
    stamp_from_backup_stem(stem)
}

fn stamp_from_partial_name(name: &str) -> Option<String> {
    let stem = name.strip_suffix(".zip.partial")?;
    stamp_from_backup_stem(stem)
}

/// Stamp, or the on-disk name when the leaf is `<stamp>-<id>.zip`.
pub(crate) fn backup_locator_from_leaf(raw: &str) -> Option<String> {
    if is_backup_stamp(raw) || stamp_from_zip_name(raw).is_some() {
        Some(raw.to_string())
    } else {
        None
    }
}

/// Stamp embedded in `backups/<stamp>-<id>.zip` (UTC `YYYYMMDDHHmmss`).
fn is_backup_stamp(stamp: &str) -> bool {
    stamp.len() == 14 && stamp.bytes().all(|b| b.is_ascii_digit())
}

fn parse_backup_stamp(stamp: &str) -> Result<&str> {
    if is_backup_stamp(stamp) {
        Ok(stamp)
    } else {
        Err(UprivError::VaultPathNotFound(stamp.into()))
    }
}

fn backup_zip_filename(stamp: &str, vault_id: &str) -> Result<String> {
    let stamp = parse_backup_stamp(stamp)?;
    if !crate::paths::slug_id_is_valid(vault_id) {
        return Err(UprivError::VaultPathNotFound(vault_id.into()));
    }
    Ok(format!("{stamp}-{vault_id}.zip"))
}

enum BackupKey {
    /// On-disk name. `saved` selects `backups/saves/` rather than `backups/`.
    File { name: String, saved: bool },
    /// 14-digit stamp. `None` searches both directories and refuses more than one zip.
    Stamp { stamp: String, saved: Option<bool> },
}

fn parse_backup_key(key: &str) -> Result<BackupKey> {
    let (in_saves, rest) = if let Some(rest) = key.strip_prefix("saves/") {
        (true, rest)
    } else {
        (false, key)
    };
    if rest.is_empty() || rest.contains('/') || rest.contains('\\') {
        return Err(UprivError::VaultPathNotFound(key.into()));
    }
    if is_backup_stamp(rest) {
        return Ok(BackupKey::Stamp {
            stamp: rest.to_string(),
            saved: if in_saves { Some(true) } else { None },
        });
    }
    if stamp_from_zip_name(rest).is_some() {
        return Ok(BackupKey::File {
            name: rest.to_string(),
            saved: in_saves,
        });
    }
    Err(UprivError::VaultPathNotFound(key.into()))
}

/// Which place a key selects, and the key inside that place.
fn parse_located_key(key: &str) -> Result<(BackupLocation, BackupKey)> {
    match key.strip_prefix(CHOSEN_KEY_PREFIX) {
        Some(rest) => Ok((BackupLocation::Chosen, parse_backup_key(rest)?)),
        None => Ok((BackupLocation::DataFolder, parse_backup_key(key)?)),
    }
}

fn key_place<'a>(
    places: &'a BackupPlaces,
    location: BackupLocation,
    key: &str,
) -> Result<&'a Path> {
    match location {
        BackupLocation::DataFolder => Ok(&places.data_folder),
        BackupLocation::Chosen => places
            .chosen
            .as_ref()
            .map(|chosen| chosen.dir.as_path())
            .ok_or_else(|| UprivError::VaultPathNotFound(key.into())),
    }
}

fn ambiguous_backup(key: &str) -> UprivError {
    UprivError::VaultStoreInvalid {
        path: PathBuf::from(key),
        detail: "backup stamp matches more than one zip".into(),
    }
}

fn store_zips_in(dir: &Path, pred: impl Fn(&str) -> bool) -> Result<Vec<PathBuf>> {
    if !dir.host_is_dir() {
        return Ok(Vec::new());
    }
    let mut found = Vec::new();
    for entry in crate::host_fs::read_dir(dir)? {
        let entry = entry?;
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if !kind.host_is_file() {
            continue;
        }
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if !pred(&name) {
            continue;
        }
        let path = entry.path();
        if super::zip_io::zip_contains_store_header(&path) {
            found.push(path);
        }
    }
    found.sort();
    Ok(found)
}

fn matching_store_zips(backups: &Path, key: &BackupKey) -> Result<Vec<PathBuf>> {
    let saves = backups.join(SAVES_DIR);
    let named = |dir: &Path, name: &str| store_zips_in(dir, |file| file == name);
    let stamped = |dir: &Path, stamp: &str| {
        store_zips_in(dir, |file| {
            stamp_from_zip_name(file).as_deref() == Some(stamp)
        })
    };
    match key {
        BackupKey::File { name, saved: true } => named(&saves, name),
        BackupKey::File { name, saved: false } => named(backups, name),
        BackupKey::Stamp {
            stamp,
            saved: Some(true),
        } => stamped(&saves, stamp),
        BackupKey::Stamp {
            stamp,
            saved: Some(false),
        } => stamped(backups, stamp),
        BackupKey::Stamp { stamp, saved: None } => {
            let mut found = stamped(&saves, stamp)?;
            found.extend(stamped(backups, stamp)?);
            found.sort();
            Ok(found)
        }
    }
}

fn one_store_zip(backups: &Path, key: &BackupKey, label: &str) -> Result<PathBuf> {
    let mut found = matching_store_zips(backups, key)?;
    match found.len() {
        1 => Ok(found.remove(0)),
        0 => Err(UprivError::VaultPathNotFound(label.into())),
        _ => Err(ambiguous_backup(label)),
    }
}

/// Pin moves a file out of `backups/`. A key that already names `saves/` is not a source.
fn unsaved_key(key: &BackupKey) -> Option<BackupKey> {
    match key {
        BackupKey::File { saved: true, .. }
        | BackupKey::Stamp {
            saved: Some(true), ..
        } => None,
        BackupKey::File { name, saved: false } => Some(BackupKey::File {
            name: name.clone(),
            saved: false,
        }),
        BackupKey::Stamp {
            stamp,
            saved: None | Some(false),
        } => Some(BackupKey::Stamp {
            stamp: stamp.clone(),
            saved: Some(false),
        }),
    }
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

/// True when the zip with `stamp` is still there, or its folder cannot be
/// reached to tell: an unchanged vault writes no new zip while its drive is
/// away. Opens only the zips named with that stamp, so a close with many
/// backups does not read every zip's directory.
pub(crate) fn last_backup_is_kept(root: &VaultRoot, vault_id: &str, stamp: &str) -> bool {
    if !is_backup_stamp(stamp) {
        return false;
    }
    let Ok(vault_dir) = root.vault_dir(vault_id) else {
        return false;
    };
    let key = BackupKey::Stamp {
        stamp: stamp.to_string(),
        saved: None,
    };
    let holds_it =
        |place: &Path| matching_store_zips(place, &key).is_ok_and(|zips| !zips.is_empty());
    let places = backup_places(root, vault_id, &vault_dir);
    if holds_it(&places.data_folder) {
        return true;
    }
    let Some(chosen) = &places.chosen else {
        return false;
    };
    match look_at_chosen(root, &vault_dir, chosen, None) {
        BackupFolderStatus::NotResponding => true,
        BackupFolderStatus::Missing => !chosen.chosen.host_is_dir(),
        BackupFolderStatus::Reserved => false,
        _ => holds_it(&chosen.dir),
    }
}

pub fn backup_zip_file(root: &VaultRoot, vault_id: &str, stamp: &str) -> Result<PathBuf> {
    locate_backup_zip(root, vault_id, stamp)
}

fn stamp_to_iso(stamp: &str) -> Option<String> {
    crate::time::filename_stamp_to_iso(stamp)
}

/// Write this vault's close backup where its backups go, then apply retention.
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
    let places = backup_places(root, vault_id, &vault_dir);
    let written = job.settle(write_where_backups_go(
        root,
        vault_id,
        &vault_dir,
        &places,
        BackupDir::Standard,
        job,
    ))?;
    let chosen_reachable = written.fell_back.is_none();
    if let Err(error) = apply_retention(
        &vault_dir,
        vault_id,
        &places,
        chosen_reachable,
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
            let places = backup_places(root, vault_id, &hold.vault_dir);
            let written = job.settle(write_where_backups_go(
                root,
                vault_id,
                &hold.vault_dir,
                &places,
                BackupDir::Saves,
                job,
            ))?;
            let location = if written.path.starts_with(&places.data_folder) {
                BackupLocation::DataFolder
            } else {
                BackupLocation::Chosen
            };
            Ok(SavedBackup {
                entry: BackupEntry {
                    created_at: stamp_to_iso(&written.stamp).unwrap_or_default(),
                    size_bytes: crate::host_fs::metadata(&written.path)?.len(),
                    file_name: backup_zip_filename(&written.stamp, vault_id)?,
                    stamp: written.stamp,
                    saved: true,
                    location,
                    path: written.path,
                },
                fell_back: written.fell_back,
            })
        })
    })
}

/// `id` for a log line, only when it is a vault folder id: a request may carry
/// anything there.
pub(crate) fn vault_id_log_field(vault_id: &str) -> Option<(&'static str, &str)> {
    crate::paths::slug_id_is_valid(vault_id).then_some(("id", vault_id))
}

/// Where a safety zip goes: the data folder, so the work it protects never
/// waits on another drive, and the chosen folder only when the data folder has
/// no room for it. `Err` holds the free bytes when neither can take it.
fn safety_zip_place(
    root: &VaultRoot,
    vault_id: &str,
    vault_dir: &Path,
    needed: u64,
) -> std::result::Result<PathBuf, u64> {
    let places = backup_places(root, vault_id, vault_dir);
    let Some(available) = crate::host_fs::free_bytes(&places.data_folder) else {
        return Ok(places.data_folder);
    };
    if available >= needed {
        return Ok(places.data_folder);
    }
    if let Some(chosen) = &places.chosen {
        let status = check_chosen_folder(
            root,
            chosen,
            FolderCheck {
                used_here: used_here(vault_dir, &chosen.dir),
                create: true,
                needed: Some(needed),
            },
        );
        if status == BackupFolderStatus::Ok {
            return Ok(chosen.dir.clone());
        }
    }
    Err(available)
}

/// One zip of the current `store/`, to protect a password or unlock-RAM
/// change, even when backups are off or a close would skip because the file
/// tree is unchanged. Written as part of `job`, so its stop ends the zip.
/// Regular backups stay as they are: [`remove_safety_zip`] takes this one away
/// once the change is committed, a failed change keeps it, and a stopped one
/// removes it. Returns the zip.
pub(crate) fn backup_before_rewrap(root: &VaultRoot, vault_id: &str, job: &Job) -> Result<PathBuf> {
    let vault_dir = root.vault_dir(vault_id)?;
    // A broken config fails before a zip is written.
    load_vault_config(&vault_dir)?;
    let needed = zip_bytes_of(&vault_dir).unwrap_or(0);
    let place = safety_zip_place(root, vault_id, &vault_dir, needed)
        .map_err(|_| UprivError::VaultBackupFailed)?;
    let (_, zip) = write_backup_zip(&vault_dir, vault_id, &place, BackupDir::Standard, job)?;
    Ok(zip)
}

/// The change this zip protected is committed: it has served its purpose.
pub(crate) fn remove_safety_zip(vault_dir: &Path, vault_id: &str, zip: &Path) -> Result<()> {
    if !remove_backup_unless_exporting(vault_dir, zip)? {
        // An export reads it. It stays on the list and ages out with the rest.
        return Ok(());
    }
    let Some(name) = zip.file_name().and_then(|name| name.to_str()) else {
        return Ok(());
    };
    update_vault_persistence(vault_dir, vault_id, |persistence| {
        persistence.backups_written.retain(|kept| kept != name);
    })
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

/// Pin a copy of `store/` as it is before a rebuild of its index
/// ([`super::rebuild`]): a save, which retention never rotates, kept until the
/// person deletes it, because a rebuild is a best guess and this copy is the
/// way back. It goes in the data folder, and in the chosen folder only when
/// the data folder has no room. Refused with
/// [`UprivError::VaultRebuildSpaceShort`], and nothing written, when neither
/// has.
pub(crate) fn pin_before_rebuild(root: &VaultRoot, vault_id: &str, job: &Job) -> Result<PathBuf> {
    let vault_dir = root.vault_dir(vault_id)?;
    // A broken config fails before a zip is written.
    load_vault_config(&vault_dir)?;
    crate::host_fs::create_dir_all(vault_dir.join(BACKUPS_DIR))?;
    let store = vault_dir.join(STORE_DIR_NAME);
    let needed = super::zip_io::store_zip_bytes(&store)?;
    let place = safety_zip_place(root, vault_id, &vault_dir, needed)
        .map_err(|available| UprivError::VaultRebuildSpaceShort { needed, available })?;
    let (_, zip) = write_backup_zip(&vault_dir, vault_id, &place, BackupDir::RebuildPin, job)?;
    Ok(zip)
}

/// Where a new zip goes in its place, and what its check asks of its index files.
#[derive(Clone, Copy)]
enum BackupDir {
    /// The place itself, rotated by retention.
    Standard,
    /// `saves/`, kept until the person deletes it.
    Saves,
    /// `saves/`, before a rebuild: its index files do not open, so the check
    /// that they hold one tree is left out. A vault made from it is rebuilt
    /// the same way.
    RebuildPin,
}

/// Write a zip where this vault's backups go. A problem with a chosen folder
/// writes it to the data folder instead, and says why; a stop writes nothing.
fn write_where_backups_go(
    root: &VaultRoot,
    vault_id: &str,
    vault_dir: &Path,
    places: &BackupPlaces,
    into: BackupDir,
    job: &Job,
) -> Result<WrittenBackup> {
    let mut fell_back = None;
    if let Some(chosen) = &places.chosen {
        match write_to_chosen(root, vault_id, vault_dir, chosen, into, job) {
            Ok((stamp, path)) => {
                return Ok(WrittenBackup {
                    stamp,
                    path,
                    fell_back: None,
                });
            }
            Err(ChosenFailure::Stopped) => return Err(UprivError::JobCancelled),
            Err(ChosenFailure::Folder(status)) => fell_back = Some(status),
        }
        let reason = fell_back.map_or("", BackupFolderStatus::as_str);
        log_event(
            LogLevel::Warn,
            "vault_backup_fell_back",
            &[("id", vault_id), ("reason", reason)],
        );
        job.start_over();
    }
    let (stamp, path) = write_backup_zip(vault_dir, vault_id, &places.data_folder, into, job)?;
    Ok(WrittenBackup {
        stamp,
        path,
        fell_back,
    })
}

enum ChosenFailure {
    Stopped,
    Folder(BackupFolderStatus),
}

fn write_to_chosen(
    root: &VaultRoot,
    vault_id: &str,
    vault_dir: &Path,
    chosen: &ChosenBackupFolder,
    into: BackupDir,
    job: &Job,
) -> std::result::Result<(String, PathBuf), ChosenFailure> {
    let status = check_chosen_folder(
        root,
        chosen,
        FolderCheck {
            used_here: used_here(vault_dir, &chosen.dir),
            create: true,
            needed: zip_bytes_of(vault_dir),
        },
    );
    if status != BackupFolderStatus::Ok {
        return Err(ChosenFailure::Folder(status));
    }
    discard_listed_partials(vault_dir, &chosen.dir);
    let written = write_backup_zip(vault_dir, vault_id, &chosen.dir, into, job);
    let (stamp, path) = match written {
        Ok(written) => written,
        Err(_) if job.is_stopped() => return Err(ChosenFailure::Stopped),
        Err(UprivError::JobCancelled) => return Err(ChosenFailure::Stopped),
        Err(error) => {
            return Err(ChosenFailure::Folder(BackupFolderStatus::of_failure(
                &error,
            )))
        }
    };
    let used = update_vault_persistence(vault_dir, vault_id, |persistence| {
        persistence
            .backup_folder_id
            .get_or_insert_with(|| vault_id.to_string());
        persistence.this_host_record_mut().chosen_dir =
            Some(chosen.dir.to_string_lossy().into_owned());
    });
    if used.is_err() {
        log_event(
            LogLevel::Warn,
            "vault_backup_unrecorded",
            &[("id", vault_id)],
        );
    }
    Ok((stamp, path))
}

/// Remove this vault's unfinished zips from a chosen folder. Only names on its
/// own list: a `.partial` of a copy of this data folder may still be in use.
fn discard_listed_partials(vault_dir: &Path, place: &Path) {
    let Ok(Some(saved)) = load_vault_persistence(vault_dir) else {
        return;
    };
    let names: HashSet<&str> = saved.backups_written.iter().map(String::as_str).collect();
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
/// always has its entry. An unsaved list leaves the zip for the person to delete.
fn list_written_zip(vault_dir: &Path, vault_id: &str, name: &str) {
    let listed = update_vault_persistence(vault_dir, vault_id, |persistence| {
        if !persistence.backups_written.iter().any(|kept| kept == name) {
            persistence.backups_written.push(name.to_string());
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
    let dir = match into {
        BackupDir::Standard => backups.to_path_buf(),
        BackupDir::Saves | BackupDir::RebuildPin => backups.join(SAVES_DIR),
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
        match into {
            BackupDir::RebuildPin => {
                super::zip_io::verify_store_zip_entries(&partial, job)?;
            }
            BackupDir::Standard | BackupDir::Saves => {
                super::zip_io::verify_store_zip_copies(&partial, job)?;
            }
        }
        match into {
            BackupDir::Saves => job.final_step(),
            BackupDir::Standard | BackupDir::RebuildPin => job.ensure_running(),
        }
    })();
    let work = match into {
        BackupDir::Standard => PartialWork::Backup,
        BackupDir::Saves | BackupDir::RebuildPin => PartialWork::BackupSave,
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
    if matches!(into, BackupDir::Saves | BackupDir::RebuildPin) {
        // `saves/` itself may be new.
        sync_dir(backups)?;
    }
    let event = match into {
        BackupDir::Standard => "vault_backup_created",
        BackupDir::Saves | BackupDir::RebuildPin => "vault_backup_saved",
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

/// Where a zip on this vault's list is now.
enum WrittenZip {
    /// In a place, rotated by retention.
    Standard(PathBuf),
    /// In `saves/`, kept until the person deletes it.
    Saved,
    /// Its folder cannot be reached to tell.
    Unknown,
    Gone,
}

fn find_written_zip(places: &BackupPlaces, chosen_reachable: bool, name: &str) -> WrittenZip {
    let in_place = |place: &Path| {
        let standard = place.join(name);
        if standard.host_is_file() {
            Some(WrittenZip::Standard(standard))
        } else if place.join(SAVES_DIR).join(name).host_is_file() {
            Some(WrittenZip::Saved)
        } else {
            None
        }
    };
    if let Some(found) = in_place(&places.data_folder) {
        return found;
    }
    match &places.chosen {
        None => WrittenZip::Gone,
        Some(_) if !chosen_reachable => WrittenZip::Unknown,
        Some(chosen) => in_place(&chosen.dir).unwrap_or(WrittenZip::Gone),
    }
}

/// Keep the newest `keep_last` zips on this vault's list and delete the rest,
/// in the order they were written, so a clock that runs behind never makes a
/// new zip look old. A zip that cannot be checked does not count: a reachable
/// zip is never deleted on the strength of one Upriv cannot see. Call only
/// after the newest zip is durable. A failed delete keeps its entry, so the
/// next backup tries again.
fn apply_retention(
    vault_dir: &Path,
    vault_id: &str,
    places: &BackupPlaces,
    chosen_reachable: bool,
    mode: VaultBackupMode,
    keep_last: u32,
) -> Result<()> {
    if mode != VaultBackupMode::KeepLast {
        return Ok(());
    }
    let Some(saved) = load_vault_persistence(vault_dir)? else {
        return Ok(());
    };
    let keep = keep_last.max(1) as usize;
    let mut kept = 0usize;
    let mut failure = None;
    let mut removed_from: Vec<PathBuf> = Vec::new();
    let mut remaining = Vec::with_capacity(saved.backups_written.len());
    for name in saved.backups_written.iter().rev() {
        match find_written_zip(places, chosen_reachable, name) {
            WrittenZip::Gone => {}
            WrittenZip::Saved | WrittenZip::Unknown => remaining.push(name.clone()),
            WrittenZip::Standard(_) if kept < keep => {
                kept += 1;
                remaining.push(name.clone());
            }
            WrittenZip::Standard(path) => match remove_backup_unless_exporting(vault_dir, &path) {
                Ok(true) => {
                    if let Some(folder) = path.parent() {
                        if !removed_from.iter().any(|seen| seen == folder) {
                            removed_from.push(folder.to_path_buf());
                        }
                    }
                }
                Ok(false) => remaining.push(name.clone()),
                Err(error) => {
                    remaining.push(name.clone());
                    failure = Some(error);
                }
            },
        }
    }
    remaining.reverse();
    if remaining != saved.backups_written {
        update_vault_persistence(vault_dir, vault_id, |persistence| {
            persistence.backups_written = remaining;
        })?;
    }
    // Only a folder a zip left needs its entry written down.
    for folder in &removed_from {
        sync_dir(folder)?;
    }
    failure.map_or(Ok(()), Err)
}

/// Delete and pin run under the vault's directory lock and refuse while the
/// data folder is being exported. The export copies each vault under the same
/// lock, so its zip holds every backup once, before or after the change. A
/// backup export takes its zips under that lock too, and each refuses a zip it
/// holds. They also refuse while the core of an app that went away still
/// holds the vault, since its close writes and prunes these zips. That check
/// runs under the directory lock, which an open of this process holds until
/// its session is in: the open's own vault lock is never taken for another's.
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

pub fn delete_backups(root: &VaultRoot, vault_id: &str, stamps: &[String]) -> Result<()> {
    with_backups_settled(root, vault_id, |vault_dir| {
        let places = backup_places(root, vault_id, vault_dir);
        let mut paths = Vec::new();
        let mut seen = std::collections::BTreeSet::new();
        for key in stamps {
            let Ok((location, parsed)) = parse_located_key(key) else {
                continue;
            };
            let path = one_store_zip(key_place(&places, location, key)?, &parsed, key)?;
            if seen.insert(path.clone()) {
                paths.push(path);
            }
        }
        ensure_backups_not_exporting(vault_dir, &paths)?;
        for path in paths {
            crate::host_fs::remove_file(path)?;
        }
        Ok(())
    })
}

pub fn promote_backup_save(root: &VaultRoot, vault_id: &str, stamp: &str) -> Result<()> {
    with_backups_settled(root, vault_id, |vault_dir| {
        let places = backup_places(root, vault_id, vault_dir);
        let (location, parsed) = parse_located_key(stamp)?;
        promote_backup_save_in(
            vault_dir,
            key_place(&places, location, stamp)?,
            &parsed,
            stamp,
        )
    })
}

/// The person says to use this vault's chosen folder again, after its folder
/// there went away. The next backup makes it.
pub fn reuse_backup_folder(root: &VaultRoot, vault_id: &str) -> Result<()> {
    with_backups_settled(root, vault_id, |vault_dir| {
        update_vault_persistence(vault_dir, vault_id, |persistence| {
            persistence.this_host_record_mut().chosen_dir = None;
        })
    })
}

/// A vault's backups outside the data folder, read before a delete takes the
/// record of them away.
pub(crate) struct OutsideZips {
    chosen: ChosenBackupFolder,
    names: Vec<String>,
}

pub(crate) fn outside_zips(
    root: &VaultRoot,
    vault_id: &str,
    vault_dir: &Path,
) -> Option<OutsideZips> {
    let saved = load_vault_persistence(vault_dir).ok().flatten()?;
    if !saved.has_outside_backups() {
        return None;
    }
    let chosen = backup_places(root, vault_id, vault_dir).chosen?;
    Some(OutsideZips {
        chosen,
        names: saved.backups_written,
    })
}

impl OutsideZips {
    pub(crate) fn folder(&self) -> &Path {
        &self.chosen.dir
    }

    /// Remove the zips this vault wrote there, and each folder of Upriv's that
    /// is left empty. False when the folder cannot be reached or a zip stayed.
    pub(crate) fn remove(&self, root: &VaultRoot) -> bool {
        let status = check_chosen_folder(
            root,
            &self.chosen,
            FolderCheck {
                used_here: false,
                create: false,
                needed: None,
            },
        );
        if status != BackupFolderStatus::Ok || !self.chosen.dir.host_is_dir() {
            return false;
        }
        let saves = self.chosen.dir.join(SAVES_DIR);
        let mut removed_all = true;
        for name in &self.names {
            for place in [&self.chosen.dir, &saves] {
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
        let _ = crate::host_fs::remove_dir(&self.chosen.dir);
        if let Some(shared) = self.chosen.dir.parent() {
            if shared.file_name() == Some(std::ffi::OsStr::new(SHARED_BACKUPS_FOLDER)) {
                let _ = crate::host_fs::remove_dir(shared);
            }
        }
        removed_all
    }
}

/// A pin renames within the place the zip is in.
fn promote_backup_save_in(
    vault_dir: &Path,
    backups: &Path,
    parsed: &BackupKey,
    stamp: &str,
) -> Result<()> {
    let saves = backups.join(SAVES_DIR);
    crate::host_fs::create_dir_all(&saves)?;
    let Some(source) = unsaved_key(parsed) else {
        return Err(UprivError::VaultPathNotFound(stamp.into()));
    };
    let src = one_store_zip(backups, &source, stamp)?;
    ensure_backups_not_exporting(vault_dir, std::slice::from_ref(&src))?;
    let file_name = src
        .file_name()
        .ok_or_else(|| UprivError::VaultPathNotFound(stamp.into()))?
        .to_os_string();
    let dest = saves.join(&file_name);
    if !dest.starts_with(&saves) {
        return Err(UprivError::VaultPathNotFound(stamp.into()));
    }
    match crate::host_fs::symlink_metadata(&dest) {
        Ok(meta) if meta.file_type().host_is_file() => {
            if !super::zip_io::zip_contains_store_header(&dest) {
                return Err(UprivError::VaultStoreInvalid {
                    path: dest,
                    detail: "backup pin name is already taken".into(),
                });
            }
            crate::host_fs::remove_file(&src)?;
            return Ok(());
        }
        Ok(_) => {
            return Err(UprivError::VaultPathNotFound(stamp.into()));
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    crate::host_fs::rename(&src, &dest)?;
    Ok(())
}

fn locate_backup_zip(root: &VaultRoot, vault_id: &str, stamp: &str) -> Result<PathBuf> {
    let (location, key) = parse_located_key(stamp)?;
    let vault_dir = root.vault_dir(vault_id)?;
    let places = backup_places(root, vault_id, &vault_dir);
    one_store_zip(key_place(&places, location, stamp)?, &key, stamp)
}

/// Copy backups of this vault into `dest_dir` as the job `job_id`. One keeps
/// its own file name; several go into one Stored zip, `upriv-backups-<id>.zip`.
/// A name already in the folder is never replaced: the file takes the next
/// free number (`upriv-backups-<id>-2.zip`) and the export logs
/// `backup_export_numbered`. A stopped or failed export leaves no file.
///
/// Backups are frozen files, so this vault may be open and every other export
/// stays free. Until the export ends, delete and rename of this vault refuse,
/// delete and pin of the chosen backups refuse (`backup_exporting`), and
/// retention leaves them for a later close.
pub fn export_backups(
    root: &VaultRoot,
    vault_id: &str,
    stamps: &[String],
    dest_dir: &Path,
    job_id: &str,
) -> Result<ExportedFile> {
    let written = Job::run(job_id, JobKind::BackupExport, Some(vault_id), |job| {
        write_backup_export(root, vault_id, stamps, dest_dir, job)
    });
    log_backup_export_numbered(vault_id, &written);
    written
}

fn write_backup_export(
    root: &VaultRoot,
    vault_id: &str,
    stamps: &[String],
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
        let sources = backup_export_sources(root, vault_id, stamps)?;
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

/// One backup to export, before it has its name in the bundle.
struct ExportRow {
    name: String,
    saved: bool,
    chosen: bool,
    path: PathBuf,
}

/// Each backup to export once, with the name it takes in a bundle. Zips that
/// share a file name are told apart: `saves-<file name>` for a pin, `chosen-`
/// for a zip in the chosen folder.
fn backup_export_sources(
    root: &VaultRoot,
    vault_id: &str,
    stamps: &[String],
) -> Result<Vec<(String, PathBuf)>> {
    if stamps.is_empty() {
        return Err(UprivError::VaultPathNotFound(vault_id.into()));
    }
    let mut seen = std::collections::BTreeSet::new();
    let mut rows: Vec<ExportRow> = Vec::new();
    for stamp in stamps {
        let path = locate_backup_zip(root, vault_id, stamp)?;
        if !seen.insert(path.clone()) {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|file_name| file_name.to_str())
            .ok_or_else(|| UprivError::VaultPathNotFound(stamp.clone()))?
            .to_string();
        let saved = path
            .parent()
            .and_then(|parent| parent.file_name())
            .is_some_and(|parent| parent == SAVES_DIR);
        rows.push(ExportRow {
            name,
            saved,
            chosen: stamp.starts_with(CHOSEN_KEY_PREFIX),
            path,
        });
    }
    // The zips that keep their plain name come first.
    rows.sort_by_key(|row| (row.chosen, row.saved));
    let mut used = std::collections::BTreeSet::new();
    let mut entries: Vec<(String, PathBuf)> = Vec::new();
    for row in rows {
        let prefixes: &[&str] = match (row.chosen, row.saved) {
            (false, false) => &[""],
            (false, true) => &["", "saves-"],
            (true, false) => &["", "chosen-"],
            (true, true) => &["", "saves-", "chosen-saves-"],
        };
        let Some(entry_name) = prefixes
            .iter()
            .map(|prefix| format!("{prefix}{}", row.name))
            .find(|candidate| !used.contains(candidate))
        else {
            return Err(UprivError::VaultStoreInvalid {
                path: row.path,
                detail: "two backups share an export name".into(),
            });
        };
        used.insert(entry_name.clone());
        entries.push((entry_name, row.path));
    }
    Ok(entries)
}

fn next_stamp(stamp: &str) -> String {
    let n = stamp.parse::<u64>().unwrap_or(0).saturating_add(1);
    format!("{n:014}")
}

/// The stamps on this vault's list: a zip in its other place holds one too, so
/// a name is never on the list for two zips.
fn listed_stamps(vault_dir: &Path) -> HashSet<String> {
    load_vault_persistence(vault_dir)
        .ok()
        .flatten()
        .map(|saved| {
            saved
                .backups_written
                .iter()
                .filter_map(|name| stamp_from_zip_name(name))
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
    use crate::test_support::{test_job_id, vault_root_with};
    use crate::vault::create_vault;

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
        for bad in ["../store", "/etc", "saves/../store", "2026/01"] {
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
        promote_backup_save(&root, "notes", &stamp).unwrap();
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
        assert_eq!(backup_zip_file(&root, "notes", &stamp).unwrap(), saved);
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
        let zip = backup_zip_file(&root, "notes", &saved.stamp).unwrap();
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

        delete_backups(&root, "notes", std::slice::from_ref(&saved.stamp)).unwrap();
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
    fn a_save_refuses_a_stop_once_its_zip_is_in_and_a_safety_zip_still_takes_one() {
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

        // The safety zip of a password change is one step of that change.
        let id = test_job_id();
        let rewrapping = Job::start(&id).unwrap();
        write_backup_zip(
            &vault_dir,
            "notes",
            &backups,
            BackupDir::Standard,
            &rewrapping,
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
        let found = backup_zip_file(&root, "notes", &format!("{stamp}-other.zip")).unwrap();
        assert_eq!(found, other);
        let err = backup_zip_file(&root, "notes", &stamp).unwrap_err();
        assert!(matches!(err, UprivError::VaultStoreInvalid { .. }));
        delete_backups(&root, "notes", &[format!("{stamp}-other.zip")]).unwrap();
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
        assert!(matches!(
            backup_zip_file(&root, "notes", &stamp).unwrap_err(),
            UprivError::VaultStoreInvalid { .. }
        ));
        let found = backup_zip_file(&root, "notes", &format!("saves/{name}")).unwrap();
        assert_eq!(found, pinned);
        let bundle_dir = tempfile::tempdir().unwrap();
        let bundle = export_backups(
            &root,
            "notes",
            &[name.clone(), format!("saves/{name}")],
            bundle_dir.path(),
            &test_job_id(),
        )
        .unwrap();
        assert_eq!(
            zip_entry_names(&bundle.path),
            vec![name.clone(), format!("saves-{name}")]
        );
        delete_backups(&root, "notes", &[name.clone(), name.clone()]).unwrap();
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
        let err = promote_backup_save(&root, "notes", &name).unwrap_err();
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
        assert!(backup_zip_file(&root, "notes", &name).is_err());
        let out = tempfile::tempdir().unwrap();
        assert!(export_backups(&root, "notes", &[name], out.path(), &test_job_id()).is_err());
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

    /// A vault `notes` with two standard backups, and their file names.
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
            format!("{first}-notes.zip"),
            format!("{second}-notes.zip"),
        )
    }

    #[test]
    fn one_backup_is_copied_under_its_own_name() {
        let (_tmp, root, name, _) = vault_with_two_backups();
        let out = tempfile::tempdir().unwrap();
        let stamps = std::slice::from_ref(&name);
        let written = export_backups(&root, "notes", stamps, out.path(), &test_job_id()).unwrap();
        assert_eq!(written.path, out.path().join(&name));
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
        assert_eq!(written.path, out.path().join(&name));
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
            let source = backup_zip_file(&root, "notes", entry.name()).unwrap();
            assert_eq!(body, crate::host_fs::read(&source).unwrap());
            names.push(entry.name().to_string());
        }
        names.sort();
        let mut expected = vec![first, second];
        expected.sort();
        assert_eq!(names, expected);
    }

    #[test]
    fn a_taken_name_gets_the_next_free_number_and_nothing_is_replaced() {
        let (_tmp, root, first, second) = vault_with_two_backups();
        let out = tempfile::tempdir().unwrap();
        let older = out.path().join(&first);
        crate::host_fs::write(&older, b"older").unwrap();
        let stamps = std::slice::from_ref(&first);
        let written = export_backups(&root, "notes", stamps, out.path(), &test_job_id()).unwrap();
        let stem = first.strip_suffix(".zip").unwrap();
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
            crate::vault::delete_vault(&root, "notes", false),
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
            crate::vault::delete_vault(&root, "notes", false),
            Err(UprivError::VaultConfigBusy { .. })
        ));
        drop(second);
        crate::vault::delete_vault(&root, "notes", false).unwrap();
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
        let places = backup_places(&root, "notes", &vault_dir);
        let retain = || {
            apply_retention(
                &vault_dir,
                "notes",
                &places,
                true,
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
        crate::vault::delete_vault(&root, "notes", false).unwrap();
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
    use crate::paths::{
        BackupFolderRow, BackupPlace, VaultBackupFolderRow, VaultBackupPlace, WorkspaceSystem,
    };
    use crate::vault::{close_vault, open_vault};

    const PASSWORD: &[u8] = b"pass-word-ok";

    fn own_folder(path: &Path) -> VaultBackupFolderRow {
        VaultBackupFolderRow {
            place: VaultBackupPlace::Custom,
            path: path.to_string_lossy().into_owned(),
        }
    }

    fn set_every_row(config: &mut crate::config::VaultConfig, row: VaultBackupFolderRow) {
        config.backup.linux = row.clone();
        config.backup.windows = row.clone();
        config.backup.macos = row;
    }

    /// A vault `notes` whose backups go to its own folder in `drive`.
    fn vault_with_folder(drive: &Path, keep_last: u32) -> (tempfile::TempDir, VaultRoot) {
        let (tmp, root) = vault_root_with(&[]);
        let mut config = sample_config("notes", "Notes");
        config.backup.keep_last = keep_last;
        config.backup.skip_unchanged = false;
        set_every_row(&mut config, own_folder(drive));
        create_vault(&root, config, PASSWORD, KdfUnlockPreset::M32).unwrap();
        (tmp, root)
    }

    fn close_backup(root: &VaultRoot) -> WrittenBackup {
        backup_on_close(root, "notes", &Job::untracked())
            .unwrap()
            .expect("a backup")
    }

    fn zips_in(dir: &Path) -> Vec<String> {
        let Ok(entries) = crate::host_fs::read_dir(dir) else {
            return Vec::new();
        };
        let mut names: Vec<String> = entries
            .flatten()
            .filter(|entry| entry.path().is_file())
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    fn data_folder(root: &VaultRoot) -> PathBuf {
        root.vault_dir("notes").unwrap().join(BACKUPS_DIR)
    }

    #[test]
    fn a_vaults_own_folder_takes_its_backups_and_lists_them() {
        let drive = tempfile::tempdir().unwrap();
        let (_tmp, root) = vault_with_folder(drive.path(), 1);
        let written = close_backup(&root);
        assert_eq!(written.fell_back, None);

        let dir = drive.path().join("upriv-notes-backups");
        assert_eq!(
            written.path,
            dir.join(format!("{}-notes.zip", written.stamp))
        );
        assert!(written.path.host_is_file());
        assert!(zips_in(&data_folder(&root)).is_empty());

        let listing = backup_listing(&root, "notes").unwrap();
        assert_eq!(listing.entries.len(), 1);
        assert_eq!(listing.entries[0].location, BackupLocation::Chosen);
        assert_eq!(listing.entries[0].path, written.path);
        assert_eq!(
            listing.chosen,
            Some(ChosenFolderState {
                path: dir,
                status: BackupFolderStatus::Ok,
            })
        );
    }

    #[test]
    fn a_vault_that_inherits_uses_the_app_default() {
        let drive = tempfile::tempdir().unwrap();
        let (_tmp, root) = vault_root_with(&[]);
        let mut loaded = crate::config::load_app_settings_at(root.root()).unwrap();
        let row = BackupFolderRow {
            place: BackupPlace::Custom,
            path: drive.path().to_string_lossy().into_owned(),
        };
        loaded.settings.backups.linux = row.clone();
        loaded.settings.backups.windows = row.clone();
        loaded.settings.backups.macos = row;
        crate::config::save_app_settings(root.root(), &loaded.settings).unwrap();
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            PASSWORD,
            KdfUnlockPreset::M32,
        )
        .unwrap();

        let written = close_backup(&root);
        assert!(written
            .path
            .starts_with(drive.path().join("upriv-backups").join("notes")));
    }

    #[test]
    fn a_folder_that_is_gone_falls_back_and_is_never_made() {
        let tmp = tempfile::tempdir().unwrap();
        let unplugged = tmp.path().join("unplugged");
        let (_keep, root) = vault_with_folder(&unplugged, 1);
        let written = close_backup(&root);
        assert_eq!(written.fell_back, Some(BackupFolderStatus::Missing));
        assert!(written.path.starts_with(data_folder(&root)));
        assert!(!unplugged.host_exists());

        // The selection stays, and says what is wrong.
        let vault_dir = root.vault_dir("notes").unwrap();
        let config = load_vault_config(&vault_dir).unwrap();
        assert_eq!(
            config.backup.folder_row(WorkspaceSystem::current()),
            Some(&own_folder(&unplugged))
        );
        let listing = backup_listing(&root, "notes").unwrap();
        assert_eq!(listing.entries.len(), 1);
        assert_eq!(listing.entries[0].location, BackupLocation::DataFolder);
        assert_eq!(
            listing.chosen.map(|state| state.status),
            Some(BackupFolderStatus::Missing)
        );
    }

    #[test]
    fn a_folder_this_machine_used_is_not_made_again_until_the_person_says_so() {
        let drive = tempfile::tempdir().unwrap();
        let (_tmp, root) = vault_with_folder(drive.path(), 1);
        let dir = drive.path().join("upriv-notes-backups");
        close_backup(&root);
        crate::host_fs::remove_dir_all(&dir).unwrap();

        let fallen = close_backup(&root);
        assert_eq!(fallen.fell_back, Some(BackupFolderStatus::Missing));
        assert!(!dir.host_exists());

        reuse_backup_folder(&root, "notes").unwrap();
        let again = close_backup(&root);
        assert_eq!(again.fell_back, None);
        assert!(again.path.starts_with(&dir));
    }

    #[cfg(unix)]
    #[test]
    fn a_read_only_folder_falls_back_and_says_why() {
        use std::os::unix::fs::PermissionsExt;
        if unsafe { libc::geteuid() } == 0 {
            return;
        }
        let drive = tempfile::tempdir().unwrap();
        let (_tmp, root) = vault_with_folder(drive.path(), 1);
        std::fs::set_permissions(drive.path(), std::fs::Permissions::from_mode(0o500)).unwrap();
        let written = close_backup(&root);
        std::fs::set_permissions(drive.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        assert_eq!(written.fell_back, Some(BackupFolderStatus::NoPermission));
        assert!(written.path.starts_with(data_folder(&root)));
    }

    #[test]
    fn a_folder_with_no_usable_write_fails_to_the_data_folder_and_a_stop_writes_nothing() {
        let drive = tempfile::tempdir().unwrap();
        let (_tmp, root) = vault_with_folder(drive.path(), 1);
        let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true));
        let stopped = backup_on_close(&root, "notes", &Job::stopped_by(stop));
        assert!(matches!(stopped, Err(UprivError::JobCancelled)));
        assert!(zips_in(&data_folder(&root)).is_empty());
        assert!(zips_in(&drive.path().join("upriv-notes-backups")).is_empty());
    }

    #[test]
    fn a_save_goes_to_saves_in_the_chosen_folder_and_is_pinned_there() {
        let drive = tempfile::tempdir().unwrap();
        let (_tmp, root) = vault_with_folder(drive.path(), 1);
        let dir = drive.path().join("upriv-notes-backups");

        let saved = save_backup_now(&root, "notes", &test_job_id()).unwrap();
        assert_eq!(saved.fell_back, None);
        assert_eq!(saved.entry.location, BackupLocation::Chosen);
        assert!(saved.entry.path.starts_with(dir.join(SAVES_DIR)));

        let written = close_backup(&root);
        let name = format!("{}-notes.zip", written.stamp);
        promote_backup_save(&root, "notes", &format!("chosen/{name}")).unwrap();
        assert!(dir.join(SAVES_DIR).join(&name).host_is_file());
        assert!(!dir.join(&name).host_exists());
        assert!(zips_in(&data_folder(&root)).is_empty());
    }

    #[test]
    fn keys_of_the_chosen_folder_select_its_zips_and_nothing_else() {
        let drive = tempfile::tempdir().unwrap();
        let (_tmp, root) = vault_with_folder(drive.path(), 1);
        let written = close_backup(&root);
        let name = format!("{}-notes.zip", written.stamp);
        let key = format!("chosen/{name}");
        assert_eq!(backup_zip_file(&root, "notes", &key).unwrap(), written.path);
        assert!(backup_zip_file(&root, "notes", &name).is_err());
        for bad in ["chosen/../x.zip", "chosen//etc/passwd", "chosen/chosen/x"] {
            assert!(backup_zip_file(&root, "notes", bad).is_err(), "{bad}");
        }

        delete_backups(&root, "notes", std::slice::from_ref(&key)).unwrap();
        assert!(!written.path.host_exists());
    }

    #[test]
    fn a_chosen_key_needs_a_chosen_folder() {
        let (_tmp, root, name, _) = vault_with_two_backups();
        assert!(matches!(
            backup_zip_file(&root, "notes", &format!("chosen/{name}")),
            Err(UprivError::VaultPathNotFound(_))
        ));
    }

    #[test]
    fn a_new_zip_stays_when_the_clock_is_behind_the_last_one() {
        let drive = tempfile::tempdir().unwrap();
        let (_tmp, root) = vault_with_folder(drive.path(), 1);
        let dir = drive.path().join("upriv-notes-backups");
        let vault_dir = root.vault_dir("notes").unwrap();
        let first = close_backup(&root);

        // The last backup has a date far ahead of this machine's clock.
        let future = dir.join("29991231235959-notes.zip");
        crate::host_fs::rename(&first.path, &future).unwrap();
        update_vault_persistence(&vault_dir, "notes", |persistence| {
            persistence.backups_written = vec!["29991231235959-notes.zip".into()];
        })
        .unwrap();

        let newest = close_backup(&root);
        assert!(newest.path.host_is_file(), "the zip just written stays");
        assert!(!future.host_exists(), "the one written before it goes");
    }

    #[test]
    fn retention_never_touches_a_zip_upriv_did_not_write() {
        let drive = tempfile::tempdir().unwrap();
        let (_tmp, root) = vault_with_folder(drive.path(), 1);
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

    #[test]
    fn a_zip_that_cannot_be_checked_does_not_count_or_cost_a_reachable_one() {
        let tmp = tempfile::tempdir().unwrap();
        let drive = tmp.path().join("drive");
        let away = tmp.path().join("away");
        crate::host_fs::create_dir_all(&drive).unwrap();
        let (_keep, root) = vault_with_folder(&drive, 1);
        let on_drive = close_backup(&root);

        crate::host_fs::rename(&drive, &away).unwrap();
        let first_here = close_backup(&root);
        assert!(first_here.fell_back.is_some());
        let second_here = close_backup(&root);
        assert!(!first_here.path.host_exists(), "keep last rotates here");
        assert!(second_here.path.host_is_file());
        let saved = load_vault_persistence(root.vault_dir("notes").unwrap())
            .unwrap()
            .unwrap();
        assert_eq!(
            saved.backups_written.len(),
            2,
            "the drive's zip stays listed"
        );

        crate::host_fs::rename(&away, &drive).unwrap();
        let back = close_backup(&root);
        assert_eq!(back.fell_back, None);
        assert!(!second_here.path.host_exists(), "older zips age out");
        assert!(!on_drive.path.host_exists());
        assert!(back.path.host_is_file());
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
        let places = backup_places(&root, "notes", &vault_dir);
        let retain = || {
            apply_retention(
                &vault_dir,
                "notes",
                &places,
                true,
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
        let (_a, first) = vault_with_folder(drive.path(), 1);
        let (_b, second) = vault_with_folder(drive.path(), 1);
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
        let (_a, other) = vault_with_folder(drive.path(), 1);
        let (_b, root) = vault_with_folder(drive.path(), 1);
        close_backup(&other);
        close_backup(&root);

        let header = root.vault_store_dir("notes").unwrap().join("header");
        crate::host_fs::remove_dir_all(&header).unwrap();
        assert_eq!(list_backups(&root, "notes").unwrap().len(), 2);
    }

    #[test]
    fn an_unchanged_vault_writes_nothing_while_its_drive_is_away() {
        let tmp = tempfile::tempdir().unwrap();
        let drive = tmp.path().join("drive");
        let away = tmp.path().join("away");
        crate::host_fs::create_dir_all(&drive).unwrap();
        let (_keep, root) = vault_root_with(&[]);
        let mut config = sample_config("notes", "Notes");
        set_every_row(&mut config, own_folder(&drive));
        create_vault(&root, config, PASSWORD, KdfUnlockPreset::M32).unwrap();

        open_vault(&root, "notes", PASSWORD).unwrap();
        close_vault(&root, "notes").unwrap();
        let on_drive = zips_in(&drive.join("upriv-notes-backups"));
        assert_eq!(on_drive.len(), 1);

        crate::host_fs::rename(&drive, &away).unwrap();
        open_vault(&root, "notes", PASSWORD).unwrap();
        let outcome = close_vault(&root, "notes").unwrap();
        assert_eq!(outcome.backup_fallback, None);
        assert!(zips_in(&data_folder(&root)).is_empty());
        crate::host_fs::rename(&away, &drive).unwrap();

        // Once its folder answers, a zip that really is gone is written again.
        crate::host_fs::remove_file(drive.join("upriv-notes-backups").join(&on_drive[0])).unwrap();
        open_vault(&root, "notes", PASSWORD).unwrap();
        close_vault(&root, "notes").unwrap();
        assert_eq!(zips_in(&drive.join("upriv-notes-backups")).len(), 1);
    }

    #[test]
    fn a_changed_vault_falls_back_with_its_drive_away_and_says_why() {
        let tmp = tempfile::tempdir().unwrap();
        let (_keep, root) = vault_with_folder(&tmp.path().join("unplugged"), 1);
        open_vault(&root, "notes", PASSWORD).unwrap();
        crate::vault::fs_write_file(&root, "notes", "/a.txt", b"one").unwrap();
        let outcome = close_vault(&root, "notes").unwrap();
        assert!(!outcome.backup_failed);
        assert_eq!(outcome.backup_fallback, Some("missing"));
        assert_eq!(zips_in(&data_folder(&root)).len(), 1);
    }

    #[test]
    fn each_machine_tracks_its_own_last_backup() {
        let drive = tempfile::tempdir().unwrap();
        let (_keep, root) = vault_root_with(&[]);
        let mut config = sample_config("notes", "Notes");
        set_every_row(&mut config, own_folder(drive.path()));
        create_vault(&root, config, PASSWORD, KdfUnlockPreset::M32).unwrap();
        open_vault(&root, "notes", PASSWORD).unwrap();
        close_vault(&root, "notes").unwrap();

        // Another machine recorded a different last backup; this one's stands.
        let vault_dir = root.vault_dir("notes").unwrap();
        update_vault_persistence(&vault_dir, "notes", |persistence| {
            persistence.backup_hosts.insert(
                "another-machine".into(),
                crate::vault::persistence::BackupHostRecord {
                    chosen_dir: Some("/somewhere/else".into()),
                    index_hash: Some("other".into()),
                    stamp: Some("20200101000000".into()),
                },
            );
        })
        .unwrap();
        let dir = drive.path().join("upriv-notes-backups");
        let before = zips_in(&dir);
        open_vault(&root, "notes", PASSWORD).unwrap();
        close_vault(&root, "notes").unwrap();
        assert_eq!(zips_in(&dir), before, "unchanged here, so no new zip");
    }

    #[test]
    fn a_renamed_vault_keeps_finding_its_folder() {
        let drive = tempfile::tempdir().unwrap();
        let (_tmp, root) = vault_with_folder(drive.path(), 2);
        close_backup(&root);
        crate::vault::rename_vault(&root, "notes", "Journal").unwrap();

        let listed = list_backups(&root, "journal").unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].location, BackupLocation::Chosen);
        assert!(listed[0]
            .path
            .starts_with(drive.path().join("upriv-notes-backups")));
    }

    #[test]
    fn a_bundle_tells_apart_zips_with_one_name_in_two_places() {
        let drive = tempfile::tempdir().unwrap();
        let (_tmp, root) = vault_with_folder(drive.path(), 2);
        let written = close_backup(&root);
        let name = format!("{}-notes.zip", written.stamp);
        let here = data_folder(&root);
        crate::host_fs::create_dir_all(&here).unwrap();
        crate::host_fs::copy(&written.path, here.join(&name)).unwrap();

        let out = tempfile::tempdir().unwrap();
        let bundle = export_backups(
            &root,
            "notes",
            &[format!("chosen/{name}"), name.clone()],
            out.path(),
            &test_job_id(),
        )
        .unwrap();
        assert_eq!(
            zip_entry_names(&bundle.path),
            vec![name.clone(), format!("chosen-{name}")]
        );
    }

    #[test]
    fn delete_with_the_switch_on_removes_only_what_the_vault_wrote() {
        use crate::vault::{delete_vault, OutsideBackups};

        let drive = tempfile::tempdir().unwrap();
        let (_tmp, root) = vault_with_folder(drive.path(), 2);
        let dir = drive.path().join("upriv-notes-backups");
        let written = close_backup(&root);
        let saved = save_backup_now(&root, "notes", &test_job_id()).unwrap();
        let theirs = dir.join("my-file.txt");
        crate::host_fs::write(&theirs, b"mine").unwrap();

        let outcome = delete_vault(&root, "notes", true).unwrap();
        assert_eq!(outcome.outside, OutsideBackups::Removed);
        assert_eq!(outcome.folder.as_deref(), Some(dir.as_path()));
        assert!(!written.path.host_exists());
        assert!(!saved.entry.path.host_exists());
        assert!(theirs.host_is_file(), "a folder with anything else stays");
    }

    #[test]
    fn delete_with_the_switch_on_leaves_no_empty_folder() {
        use crate::vault::{delete_vault, OutsideBackups};

        let drive = tempfile::tempdir().unwrap();
        let (_tmp, root) = vault_with_folder(drive.path(), 1);
        close_backup(&root);
        let outcome = delete_vault(&root, "notes", true).unwrap();
        assert_eq!(outcome.outside, OutsideBackups::Removed);
        assert_eq!(crate::host_fs::read_dir(drive.path()).unwrap().count(), 0);
    }

    #[test]
    fn delete_with_the_switch_off_leaves_the_folder_alone() {
        use crate::vault::{delete_vault, OutsideBackups};

        let drive = tempfile::tempdir().unwrap();
        let (_tmp, root) = vault_with_folder(drive.path(), 1);
        let written = close_backup(&root);
        let outcome = delete_vault(&root, "notes", false).unwrap();
        assert_eq!(outcome.outside, OutsideBackups::Kept);
        assert!(written.path.host_is_file());
    }

    #[test]
    fn delete_goes_ahead_when_the_folder_cannot_be_reached() {
        use crate::vault::{delete_vault, OutsideBackups};

        let tmp = tempfile::tempdir().unwrap();
        let drive = tmp.path().join("drive");
        crate::host_fs::create_dir_all(&drive).unwrap();
        let (_keep, root) = vault_with_folder(&drive, 1);
        let written = close_backup(&root);
        let away = tmp.path().join("away");
        crate::host_fs::rename(&drive, &away).unwrap();

        let vault_dir = root.vault_dir("notes").unwrap();
        let outcome = delete_vault(&root, "notes", true).unwrap();
        assert_eq!(outcome.outside, OutsideBackups::Failed);
        assert!(!vault_dir.host_exists());
        crate::host_fs::rename(&away, &drive).unwrap();
        assert!(written.path.host_is_file());
    }

    #[test]
    fn the_list_shows_outside_backups_only_once_one_is_written() {
        let drive = tempfile::tempdir().unwrap();
        let (_tmp, root) = vault_with_folder(drive.path(), 1);
        let listed = || crate::vault::list_vaults(&root).unwrap()[0].outside_backups;
        assert!(!listed());
        close_backup(&root);
        assert!(listed());
    }

    #[test]
    fn a_partial_this_vault_listed_is_cleared_and_no_other_file_is() {
        let drive = tempfile::tempdir().unwrap();
        let (_tmp, root) = vault_with_folder(drive.path(), 5);
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
