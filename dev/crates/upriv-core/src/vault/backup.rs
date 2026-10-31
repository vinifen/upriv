//! Frozen ciphertext copies of `store/` as `backups/<stamp>-<id>.zip` (Stored, no zip password).
//!
//! A listed backup is a vault zip (`store/header/vault.header`). Two of those
//! files can share a stamp. `name.zip` selects `backups/`; `saves/name.zip`
//! selects the pin. A bare stamp selects the only store zip with that stamp.

#[allow(unused_imports)]
use crate::host_fs::HostFsQuery;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use super::embedded_settings::snapshot_settings_bytes;
use super::export_folder::{
    check_export_folder, ExportedFile, NumberedExportName, NumberedExportTarget,
};
use super::partial::{discard_partial, PartialWork};
use crate::config::{load_vault_config, VaultBackupMode};
use crate::error::{Result, UprivError};
use crate::logging::{log_event, LogLevel};
use crate::paths::VaultRoot;
use crate::session::{ensure_data_folder_export_idle, with_vault_dir_lock, BackupExportGuard, Job};
use crate::time::utc_filename_stamp;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackupEntry {
    pub stamp: String,
    /// On-disk name, `YYYYMMDDHHmmss-<id>.zip`.
    pub file_name: String,
    pub created_at: String,
    pub size_bytes: u64,
    pub saved: bool,
}

pub fn list_backups(root: &VaultRoot, vault_id: &str) -> Result<Vec<BackupEntry>> {
    let vault_dir = root.vault_dir(vault_id)?;
    if !vault_dir.host_is_dir() {
        return Err(UprivError::VaultNotFound(vault_dir));
    }
    let backups = vault_dir.join("backups");
    let mut entries = Vec::new();
    collect_backup_dir(&backups.join("saves"), true, &mut entries)?;
    collect_backup_dir(&backups, false, &mut entries)?;
    entries.sort_by(|a, b| {
        b.stamp
            .cmp(&a.stamp)
            .then_with(|| a.file_name.cmp(&b.file_name))
    });
    Ok(entries)
}

fn collect_backup_dir(dir: &Path, saved: bool, out: &mut Vec<BackupEntry>) -> Result<()> {
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
        if !super::zip_io::zip_contains_store_header(&entry.path()) {
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
    let saves = backups.join("saves");
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
    dir_has_stamp(backups, stamp) || dir_has_stamp(&backups.join("saves"), stamp)
}

/// True when a store zip with `stamp` is still in `backups/` or `saves/`.
/// Lists both folders and opens only the zips named with that stamp, so a close
/// with many backups does not read every zip's directory.
pub(crate) fn backup_stamp_present(root: &VaultRoot, vault_id: &str, stamp: &str) -> bool {
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
    matching_store_zips(&vault_dir.join("backups"), &key).is_ok_and(|found| !found.is_empty())
}

pub fn backup_zip_file(root: &VaultRoot, vault_id: &str, stamp: &str) -> Result<PathBuf> {
    locate_backup_zip(root, vault_id, stamp)
}

fn stamp_to_iso(stamp: &str) -> Option<String> {
    crate::time::filename_stamp_to_iso(stamp)
}

pub(crate) fn backup_on_close(
    root: &VaultRoot,
    vault_id: &str,
    job: &Job,
) -> Result<Option<String>> {
    let vault_dir = root.vault_dir(vault_id)?;
    let config = load_vault_config(&vault_dir)?;
    if !config.backup.enabled {
        return Ok(None);
    }
    let stamp = job.settle(write_backup_zip(
        &vault_dir,
        vault_id,
        BackupDir::Standard,
        job,
    ))?;
    finish_backup_prune(&vault_dir, config.backup.mode, config.backup.keep_last)?;
    Ok(Some(stamp))
}

/// Zip this closed vault's `store/` straight into `backups/saves/` as the job
/// `job_id`. A save is never pruned and is written even when close backups are
/// off. Open, delete, and rename of this vault wait until the zip is written.
/// A save stopped before its zip is in place leaves no file.
pub fn save_backup_now(root: &VaultRoot, vault_id: &str, job_id: &str) -> Result<BackupEntry> {
    let saved = (|| {
        let job = Job::start(job_id)?;
        let hold = super::export::hold_closed_vault(root, vault_id)?;
        super::export::with_held_vault(&hold, || {
            let stamp = job.settle(write_backup_zip(
                &hold.vault_dir,
                vault_id,
                BackupDir::Saves,
                &job,
            ))?;
            let file_name = backup_zip_filename(&stamp, vault_id)?;
            let path = hold
                .vault_dir
                .join("backups")
                .join("saves")
                .join(&file_name);
            Ok(BackupEntry {
                created_at: stamp_to_iso(&stamp).unwrap_or_default(),
                size_bytes: crate::host_fs::metadata(&path)?.len(),
                stamp,
                file_name,
                saved: true,
            })
        })
    })();
    if let Err(error) = &saved {
        let fields: Vec<_> = vault_id_log_field(vault_id).into_iter().collect();
        log_job_error(
            "vault_backup_save_cancelled",
            "vault_backup_save_failed",
            &fields,
            error,
        );
    }
    saved
}

/// Why a backup, an export, or a file removal failed, without a filesystem path.
///
/// `reason` is `disk_full`, `permission`, or `other`. `kind` names the error
/// (`io`, `store`, `config`, `path`, `other`). `os` is the raw code when one exists.
pub(crate) fn classify_write_failure(error: &UprivError) -> WriteFailureClass {
    let kind = match error {
        UprivError::Io(_) => "io",
        UprivError::VaultStoreInvalid { .. } => "store",
        UprivError::VaultConfigInvalid { .. } => "config",
        UprivError::VaultPathNotFound(_) => "path",
        _ => "other",
    };
    let reason = if failure_is_disk_full(error) {
        "disk_full"
    } else if failure_is_permission(error) {
        "permission"
    } else {
        "other"
    };
    WriteFailureClass {
        reason,
        kind,
        os: failure_os_code(error),
    }
}

pub(crate) struct WriteFailureClass {
    pub reason: &'static str,
    pub kind: &'static str,
    pub os: Option<i32>,
}

/// Log a job that ended without its file: `cancelled` (Info) when it was
/// stopped, `failed` (Warn) with [`classify_write_failure`] otherwise.
pub(crate) fn log_job_error(
    cancelled: &str,
    failed: &str,
    fields: &[(&str, &str)],
    error: &UprivError,
) {
    if matches!(error, UprivError::JobCancelled) {
        log_event(LogLevel::Info, cancelled, fields);
        return;
    }
    let class = classify_write_failure(error);
    let os = class.os.map(|code| code.to_string());
    let mut all = fields.to_vec();
    all.push(("reason", class.reason));
    all.push(("kind", class.kind));
    if let Some(code) = os.as_deref() {
        all.push(("os", code));
    }
    log_event(LogLevel::Warn, failed, &all);
}

/// `id` for a log line, only when it is a vault folder id: a request may carry
/// anything there.
pub(crate) fn vault_id_log_field(vault_id: &str) -> Option<(&'static str, &str)> {
    crate::paths::slug_id_is_valid(vault_id).then_some(("id", vault_id))
}

fn failure_is_disk_full(error: &UprivError) -> bool {
    match error {
        UprivError::Io(io) => io_is_disk_full(io),
        UprivError::VaultStoreInvalid { detail, .. } => text_is_disk_full(detail),
        _ => false,
    }
}

fn failure_is_permission(error: &UprivError) -> bool {
    match error {
        UprivError::Io(io) => io_is_permission(io),
        UprivError::VaultStoreInvalid { detail, .. } => text_is_permission(detail),
        _ => false,
    }
}

fn failure_os_code(error: &UprivError) -> Option<i32> {
    match error {
        UprivError::Io(io) => io.raw_os_error(),
        UprivError::VaultStoreInvalid { detail, .. } => os_code_in_text(detail),
        _ => None,
    }
}

/// This system's codes for a full disk. The same number means something else
/// on another system (Linux 39 is a folder that is not empty).
#[cfg(unix)]
const DISK_FULL_CODES: &[i32] = &[libc::ENOSPC];
/// `ERROR_HANDLE_DISK_FULL`, `ERROR_DISK_FULL`.
#[cfg(windows)]
const DISK_FULL_CODES: &[i32] = &[39, 112];
#[cfg(not(any(unix, windows)))]
const DISK_FULL_CODES: &[i32] = &[];

#[cfg(unix)]
const PERMISSION_CODES: &[i32] = &[libc::EACCES, libc::EPERM];
/// `ERROR_ACCESS_DENIED`.
#[cfg(windows)]
const PERMISSION_CODES: &[i32] = &[5];
#[cfg(not(any(unix, windows)))]
const PERMISSION_CODES: &[i32] = &[];

/// An error that only kept its text names the code as `os error N`.
fn text_names_code(detail: &str, codes: &[i32]) -> bool {
    os_code_in_text(detail).is_some_and(|code| codes.contains(&code))
}

fn io_is_disk_full(error: &std::io::Error) -> bool {
    error.kind() == ErrorKind::StorageFull || text_is_disk_full(&error.to_string())
}

fn io_is_permission(error: &std::io::Error) -> bool {
    error.kind() == ErrorKind::PermissionDenied || text_is_permission(&error.to_string())
}

fn text_is_disk_full(detail: &str) -> bool {
    let lower = detail.to_ascii_lowercase();
    lower.contains("no space left")
        || lower.contains("not enough space")
        || lower.contains("disk full")
        || text_names_code(&lower, DISK_FULL_CODES)
}

fn text_is_permission(detail: &str) -> bool {
    let lower = detail.to_ascii_lowercase();
    lower.contains("permission denied")
        || lower.contains("access is denied")
        || text_names_code(&lower, PERMISSION_CODES)
}

fn os_code_in_text(detail: &str) -> Option<i32> {
    let lower = detail.to_ascii_lowercase();
    let rest = lower.split("os error ").nth(1)?;
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().ok()
}

/// One zip of the current `store/`, even when backups are off or a close would
/// skip because the file tree is unchanged. That skip compares file names, not
/// the header, so an older zip can still be sealed with a previous password.
/// Retention is [`prune_after_rewrap`], after the header commit. A failed
/// rewrap keeps this zip and the older ones.
pub(crate) fn backup_before_rewrap(root: &VaultRoot, vault_id: &str) -> Result<()> {
    let vault_dir = root.vault_dir(vault_id)?;
    // A broken config fails before a zip is written.
    load_vault_config(&vault_dir)?;
    write_backup_zip(&vault_dir, vault_id, BackupDir::Standard, &Job::untracked())?;
    Ok(())
}

/// Apply this vault's backup retention to the safety zip. Call only after the header commit.
/// Disabled backups and `keep_all` leave every zip in place.
pub(crate) fn prune_after_rewrap(root: &VaultRoot, vault_id: &str) -> Result<()> {
    let vault_dir = root.vault_dir(vault_id)?;
    let config = load_vault_config(&vault_dir)?;
    if !config.backup.enabled {
        return Ok(());
    }
    finish_backup_prune(&vault_dir, config.backup.mode, config.backup.keep_last)
}

/// Remove the zips a killed process never finished. The caller holds this
/// vault's lock, so nothing is writing them.
pub(crate) fn discard_unfinished_backups(vault_dir: &Path) {
    let backups = vault_dir.join("backups");
    let saves = backups.join("saves");
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

/// Where a new zip goes: `backups/`, rotated by retention, or `backups/saves/`.
#[derive(Clone, Copy)]
enum BackupDir {
    Standard,
    Saves,
}

/// Write the zip as `<name>.partial`, check it, then rename it into place. A
/// stop from `job` is honored until that rename.
fn write_backup_zip(
    vault_dir: &Path,
    vault_id: &str,
    into: BackupDir,
    job: &Job,
) -> Result<String> {
    let backups = vault_dir.join("backups");
    let dir = match into {
        BackupDir::Standard => backups.clone(),
        BackupDir::Saves => backups.join("saves"),
    };
    crate::host_fs::create_dir_all(&dir)?;
    // One stamp across both folders, so a save never shares a name with a backup.
    let stamp = unused_backup_stamp(&backups, utc_filename_stamp())?;
    let name = backup_zip_filename(&stamp, vault_id)?;
    let partial = dir.join(format!("{name}.partial"));
    let dest = dir.join(&name);
    let store = vault_dir.join(crate::paths::STORE_DIR_NAME);
    crate::store::ensure_danger_notice(&store)?;
    let settings = snapshot_settings_bytes(vault_dir, &store)?;
    let checked = (|| {
        super::zip_io::zip_store_with_config_to_path(&store, &settings, &stamp, &partial, job)?;
        sync_closed_file(&partial)?;
        super::zip_io::verify_store_zip_copies(&partial, job)?;
        job.ensure_running()
    })();
    let work = match into {
        BackupDir::Standard => PartialWork::Backup,
        BackupDir::Saves => PartialWork::BackupSave,
    };
    if let Err(error) = checked {
        discard_partial(&partial, work);
        return Err(error);
    }
    if let Err(error) = crate::host_fs::rename(&partial, &dest) {
        discard_partial(&partial, work);
        return Err(error.into());
    }
    // The new stamp must be durable before `prune_backups` unlinks the previous
    // one. Otherwise a crash can publish the deletion and lose the new copy.
    sync_dir(&dir)?;
    if matches!(into, BackupDir::Saves) {
        // `saves/` itself may be new.
        sync_dir(&backups)?;
    }
    let event = match into {
        BackupDir::Standard => "vault_backup_created",
        BackupDir::Saves => "vault_backup_saved",
    };
    log_event(
        LogLevel::Info,
        event,
        &[("id", vault_id), ("stamp", stamp.as_str())],
    );
    Ok(stamp)
}

fn finish_backup_prune(vault_dir: &Path, mode: VaultBackupMode, keep_last: u32) -> Result<()> {
    let backups = vault_dir.join("backups");
    prune_backups(vault_dir, mode, keep_last)?;
    sync_dir(&backups)
}

/// Delete and pin run under the vault's directory lock and refuse while the
/// data folder is being exported. The export copies each vault under the same
/// lock, so its zip holds every backup once, before or after the change.
fn with_backups_settled<T>(
    root: &VaultRoot,
    vault_dir: &Path,
    f: impl FnOnce() -> Result<T>,
) -> Result<T> {
    ensure_data_folder_export_idle(root.root())?;
    with_vault_dir_lock(vault_dir, || {
        ensure_data_folder_export_idle(root.root())?;
        f()
    })
}

pub fn delete_backups(root: &VaultRoot, vault_id: &str, stamps: &[String]) -> Result<()> {
    let vault_dir = root.vault_dir(vault_id)?;
    with_backups_settled(root, &vault_dir, || {
        let backups = vault_dir.join("backups");
        let mut paths = Vec::new();
        let mut seen = std::collections::BTreeSet::new();
        for key in stamps {
            let Ok(parsed) = parse_backup_key(key) else {
                continue;
            };
            let path = one_store_zip(&backups, &parsed, key)?;
            if seen.insert(path.clone()) {
                paths.push(path);
            }
        }
        for path in paths {
            crate::host_fs::remove_file(path)?;
        }
        Ok(())
    })
}

pub fn promote_backup_save(root: &VaultRoot, vault_id: &str, stamp: &str) -> Result<()> {
    let vault_dir = root.vault_dir(vault_id)?;
    with_backups_settled(root, &vault_dir, || {
        promote_backup_save_in(&vault_dir, stamp)
    })
}

fn promote_backup_save_in(vault_dir: &Path, stamp: &str) -> Result<()> {
    let backups = vault_dir.join("backups");
    let saves = backups.join("saves");
    crate::host_fs::create_dir_all(&saves)?;
    let parsed = parse_backup_key(stamp)?;
    let Some(source) = unsaved_key(&parsed) else {
        return Err(UprivError::VaultPathNotFound(stamp.into()));
    };
    let src = one_store_zip(&backups, &source, stamp)?;
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
    let key = parse_backup_key(stamp)?;
    let vault_dir = root.vault_dir(vault_id)?;
    one_store_zip(&vault_dir.join("backups"), &key, stamp)
}

/// Copy backups of this vault into `dest_dir` as the job `job_id`. One keeps
/// its own file name; several go into one Stored zip, `upriv-backups-<id>.zip`.
/// A name already in the folder is never replaced: the file takes the next
/// free number (`upriv-backups-<id> 2.zip`) and the export logs
/// `backup_export_numbered`. A stopped or failed export leaves no file.
///
/// Backups are frozen files, so this vault may be open and every other export
/// stays free. Delete and rename of this vault refuse until the export ends. A
/// backup deleted or rotated away before its turn fails the export.
pub fn export_backups(
    root: &VaultRoot,
    vault_id: &str,
    stamps: &[String],
    dest_dir: &Path,
    job_id: &str,
) -> Result<ExportedFile> {
    let written = (|| {
        let job = Job::start(job_id)?;
        write_backup_export(root, vault_id, stamps, dest_dir, &job)
    })();
    log_backup_export_outcome(vault_id, &written);
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
    // Under the lock delete and rename hold, so neither is halfway through.
    let _reading = with_vault_dir_lock(&vault_dir, || {
        if !vault_dir.host_is_dir() {
            return Err(UprivError::VaultNotFound(vault_dir.clone()));
        }
        BackupExportGuard::enter(&vault_dir)
    })?;
    check_export_folder(root, dest_dir)?;
    let sources = backup_export_sources(root, vault_id, stamps)?;
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
        PartialWork::BackupExport,
        |partial| match sources.as_slice() {
            [(_, source)] => super::zip_io::copy_file_to_path(source, partial, job),
            bundle => super::zip_io::zip_files_to_path(bundle, partial, job),
        },
    )
}

/// `backup_export_numbered` when the name was taken and the file got a number;
/// `backup_export_cancelled` or `backup_export_failed` for an export that ended
/// without its file. No path or name goes to the log.
fn log_backup_export_outcome(vault_id: &str, written: &Result<ExportedFile>) {
    let mut fields: Vec<_> = vault_id_log_field(vault_id).into_iter().collect();
    match written {
        Ok(file) if file.number > 1 => {
            let number = file.number.to_string();
            fields.push(("number", number.as_str()));
            log_event(LogLevel::Info, "backup_export_numbered", &fields);
        }
        Ok(_) => {}
        Err(error) => log_job_error(
            "backup_export_cancelled",
            "backup_export_failed",
            &fields,
            error,
        ),
    }
}

/// Each backup to export once, with the name it takes in a bundle. A pin that
/// shares its file name with the copy in `backups/` is `saves-<file name>`.
fn backup_export_sources(
    root: &VaultRoot,
    vault_id: &str,
    stamps: &[String],
) -> Result<Vec<(String, PathBuf)>> {
    if stamps.is_empty() {
        return Err(UprivError::VaultPathNotFound(vault_id.into()));
    }
    let mut seen = std::collections::BTreeSet::new();
    let mut rows: Vec<(String, bool, PathBuf)> = Vec::new();
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
            .is_some_and(|parent| parent == "saves");
        rows.push((name, saved, path));
    }
    let plain_names: std::collections::BTreeSet<String> = rows
        .iter()
        .filter(|(_, saved, _)| !saved)
        .map(|(name, _, _)| name.clone())
        .collect();
    let mut used = std::collections::BTreeSet::new();
    let mut entries: Vec<(String, PathBuf)> = Vec::new();
    for (name, saved, path) in rows {
        let entry_name = if saved && plain_names.contains(&name) {
            format!("saves-{name}")
        } else {
            name
        };
        if !used.insert(entry_name.clone()) {
            return Err(UprivError::VaultStoreInvalid {
                path,
                detail: "two backups share an export name".into(),
            });
        }
        entries.push((entry_name, path));
    }
    Ok(entries)
}

fn prune_backups(vault_dir: &Path, mode: VaultBackupMode, keep_last: u32) -> Result<()> {
    if mode != VaultBackupMode::KeepLast {
        return Ok(());
    }
    let backups = vault_dir.join("backups");
    if !backups.host_is_dir() {
        return Ok(());
    }
    let mut files = Vec::new();
    for entry in crate::host_fs::read_dir(&backups)? {
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
        let Some(stamp) = stamp_from_zip_name(&name) else {
            continue;
        };
        let path = entry.path();
        if !super::zip_io::zip_contains_store_header(&path) {
            continue;
        }
        files.push((stamp, name, path));
    }
    files.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)));
    let keep = keep_last.max(1) as usize;
    if files.len() <= keep {
        return Ok(());
    }
    let drop_count = files.len() - keep;
    for (_stamp, _name, path) in files.into_iter().take(drop_count) {
        crate::host_fs::remove_file(path)?;
    }
    Ok(())
}

fn unused_backup_stamp(backups: &Path, mut stamp: String) -> Result<String> {
    for _ in 0..64 {
        if is_backup_stamp(&stamp) && !stamp_is_used(backups, &stamp) {
            return Ok(stamp);
        }
        let n = stamp.parse::<u64>().unwrap_or(0).saturating_add(1);
        stamp = format!("{n:014}");
    }
    Err(UprivError::VaultStoreInvalid {
        path: backups.to_path_buf(),
        detail: "could not allocate a unique backup stamp".into(),
    })
}

pub(crate) fn copy_ciphertext_tree(src: &Path, dst: &Path) -> Result<()> {
    crate::host_fs::create_dir_all(dst)?;
    for entry in crate::host_fs::read_dir(src)? {
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
            copy_ciphertext_tree(&entry.path(), &to)?;
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
    file.sync_all().map_err(Into::into)
}

/// Persist a directory entry. No-op off Unix, where opening a directory for
/// `sync_all` is not the same call. A storage-access directory open is a local
/// stand-in, so syncing it neither publishes the rename nor should fail the
/// write after the provider already returned.
fn sync_dir(path: &Path) -> Result<()> {
    if crate::host_fs::is_bridge_path(path) {
        return Ok(());
    }
    #[cfg(unix)]
    {
        let dir = crate::host_fs::File::open(path)?;
        dir.sync_all()?;
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

    #[cfg(any(unix, windows))]
    #[test]
    fn classifies_a_full_disk_without_a_path() {
        let code = DISK_FULL_CODES[0];
        let io = UprivError::Io(std::io::Error::from_raw_os_error(code));
        let class = classify_write_failure(&io);
        assert_eq!(class.reason, "disk_full");
        assert_eq!(class.kind, "io");
        assert_eq!(class.os, Some(code));

        let wrapped = UprivError::VaultStoreInvalid {
            path: std::path::PathBuf::from("/secret/store/file"),
            detail: format!("write failed (os error {code})"),
        };
        let class = classify_write_failure(&wrapped);
        assert_eq!(class.reason, "disk_full");
        assert_eq!(class.kind, "store");
        assert_eq!(class.os, Some(code));
    }

    #[test]
    fn classifies_permission_and_leaves_other_failures_generic() {
        let denied = UprivError::Io(std::io::Error::from(std::io::ErrorKind::PermissionDenied));
        assert_eq!(classify_write_failure(&denied).reason, "permission");
        let other = UprivError::Io(std::io::Error::from(std::io::ErrorKind::AlreadyExists));
        let class = classify_write_failure(&other);
        assert_eq!(class.reason, "other");
        assert_eq!(class.kind, "io");
    }

    /// The same number is a different error on another system.
    #[cfg(target_os = "linux")]
    #[test]
    fn linux_codes_that_mean_something_else_on_windows_stay_generic() {
        for code in [libc::ENOTEMPTY, libc::EIO] {
            let io = UprivError::Io(std::io::Error::from_raw_os_error(code));
            assert_eq!(classify_write_failure(&io).reason, "other", "errno {code}");
            let wrapped = UprivError::VaultStoreInvalid {
                path: std::path::PathBuf::new(),
                detail: format!("failed (os error {code})"),
            };
            assert_eq!(
                classify_write_failure(&wrapped).reason,
                "other",
                "errno {code}"
            );
        }
        let longer = UprivError::VaultStoreInvalid {
            path: std::path::PathBuf::new(),
            detail: "failed (os error 130)".into(),
        };
        assert_eq!(classify_write_failure(&longer).reason, "other");
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
        copy_ciphertext_tree(&src, &dst).unwrap();
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
            .expect("stamp");
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
        super::super::zip_io::unzip_store_path(&zip, &extracted).unwrap();
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
        let embedded =
            super::super::zip_io::read_zip_config_toml(crate::host_fs::File::open(&zip).unwrap())
                .unwrap()
                .expect("config.toml");
        let parsed = super::super::embedded_settings::parse_embedded_settings(&embedded).unwrap();
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
        let saved = save_backup_now(&root, "notes", &test_job_id()).unwrap();
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
        backup_on_close(&root, "notes", &Job::untracked())
            .unwrap()
            .expect("stamp");
        backup_on_close(&root, "notes", &Job::untracked())
            .unwrap()
            .expect("stamp");
        let listed = list_backups(&root, "notes").unwrap();
        assert_eq!(listed.len(), 2);
        assert!(listed.contains(&saved));

        // Two saves within one second still get their own stamps.
        let again = save_backup_now(&root, "notes", &test_job_id()).unwrap();
        assert_ne!(again.stamp, saved.stamp);
        assert_eq!(list_backups(&root, "notes").unwrap().len(), 3);
    }

    #[test]
    fn save_now_works_with_close_backups_off() {
        let (_tmp, root) = vault_root_with(&[]);
        let mut config = sample_config("notes", "Notes");
        config.backup.enabled = false;
        create_vault(&root, config, b"pass-word-ok", KdfUnlockPreset::M32).unwrap();
        let saved = save_backup_now(&root, "notes", &test_job_id()).unwrap();
        assert_eq!(list_backups(&root, "notes").unwrap(), vec![saved]);
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
        crate::session::cancel_job(&job);
        assert!(matches!(
            save_backup_now(&root, "notes", &job),
            Err(UprivError::JobCancelled)
        ));

        let vault_dir = root.vault_dir("notes").unwrap();
        let id = test_job_id();
        let running = Job::start(&id).unwrap();
        crate::session::cancel_job(&id);
        assert!(matches!(
            running.settle(write_backup_zip(
                &vault_dir,
                "notes",
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
                .saved
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
            .expect("stamp");
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
            .expect("stamp");
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
            .expect("stamp");
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
            .expect("stamp");
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
            .expect("stamp");
        let second = backup_on_close(&root, "notes", &Job::untracked())
            .unwrap()
            .expect("stamp");
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
        assert_eq!(written.path, out.path().join(format!("{stem} 2.zip")));
        assert_eq!(written.number, 2);
        assert_eq!(crate::host_fs::read(&older).unwrap(), b"older");

        crate::host_fs::write(out.path().join("upriv-backups-notes.zip"), b"older").unwrap();
        let bundle =
            export_backups(&root, "notes", &[first, second], out.path(), &test_job_id()).unwrap();
        assert_eq!(bundle.path, out.path().join("upriv-backups-notes 2.zip"));
    }

    #[test]
    fn a_stopped_export_leaves_no_file() {
        let (_tmp, root, first, second) = vault_with_two_backups();
        let out = tempfile::tempdir().unwrap();
        let stopped = test_job_id();
        crate::session::cancel_job(&stopped);
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
            crate::session::cancel_job(&id);
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
        assert_eq!(
            crate::session::job_status(&id),
            Some(crate::session::JobStatus {
                bytes_done: expected,
                bytes_total: expected
            })
        );
    }

    #[test]
    fn delete_and_rename_wait_until_the_export_ends() {
        let (_tmp, root, name, _) = vault_with_two_backups();
        let vault_dir = root.vault_dir("notes").unwrap();
        let reading = BackupExportGuard::enter(&vault_dir).unwrap();
        assert!(matches!(
            crate::vault::delete_vault(&root, "notes"),
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
        let second = BackupExportGuard::enter(&vault_dir).unwrap();
        drop(reading);
        assert!(matches!(
            crate::vault::delete_vault(&root, "notes"),
            Err(UprivError::VaultConfigBusy { .. })
        ));
        drop(second);
        crate::vault::delete_vault(&root, "notes").unwrap();
        assert!(!vault_dir.host_exists());
    }

    #[test]
    fn an_export_ends_its_hold_on_the_vault() {
        let (_tmp, root, name, _) = vault_with_two_backups();
        let out = tempfile::tempdir().unwrap();
        export_backups(&root, "notes", &[name], out.path(), &test_job_id()).unwrap();
        crate::vault::delete_vault(&root, "notes").unwrap();
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
}
