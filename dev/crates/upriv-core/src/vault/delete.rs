//! Delete vault, as a job (`vault_delete`, no time limit).
//!
//! 1. The delete is recorded in `config.toml` (`[deleting]`, with the
//!    outside-backups choice) and flushed. From then the vault's row is
//!    `deleting` and nothing opens or changes it ([`UprivError::VaultDeleting`]).
//! 2. For each blob in `data/` and `held/`, its key copy is overwritten with
//!    the vault's wipe setting and flushed, and the blob is removed. Every
//!    blob holds the wrapped keys, so the wipe reaches each one, and what is
//!    left on disk is what is left to do.
//! 3. The header and index files are wiped, and the rest of `store/`,
//!    `held/`, and `backups/` removed. Then the backups outside the data
//!    folder when the switch was on, then `persistence.json`, then
//!    `config.toml`, then the empty folder.
//!
//! `config.toml` goes last: at every point a crash or a quit can stop the
//! delete, the row is there, as `deleting`, and starting the delete again
//! goes on from what is left, with the choice it began with. Delete now
//! ([`hurry_delete`], or `now`) ends it early: the blobs not reached are
//! removed with no overwrite, and step 3 runs. A quit stops a running delete
//! where it is; nothing goes on by itself at launch.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use crate::config::{
    load_app_settings_at, load_vault_config, remove_vault_from_groups, save_vault_config,
    update_app_settings, vault_config_path, VaultConfig,
};
use crate::error::{Result, UprivError};
use crate::folder_list::backup::DATA_FOLDER_BACKUPS_DIR;
#[allow(unused_imports)]
use crate::host_fs::HostFsQuery;
use crate::logging::{log_event, LogLevel};
use crate::paths::{VaultRoot, HELD_DIR_NAME, STORE_DIR_NAME};
use crate::session::{
    hurry_close_at, is_vault_backup_export_at, is_vault_closing_at, is_vault_open_at,
    is_vault_preparing_at, record_unlock_success, with_vault_dir_lock, ClosingGuard, Job, JobKind,
    JobStep,
};
use crate::store::{held_blob_paths, list_blobs, HEADER_DIR_NAME, INDEX_DIR_NAME, KEY_COPY_LEN};

use super::wipe::{overwrite_contents, secure_wipe_path, WipeOptions};

fn refuse_if_busy(vault_dir: &Path) -> Result<()> {
    if is_vault_open_at(vault_dir)
        || is_vault_closing_at(vault_dir)
        || is_vault_preparing_at(vault_dir)
        || is_vault_backup_export_at(vault_dir)
    {
        return Err(UprivError::VaultConfigBusy {
            target: "action.delete".into(),
        });
    }
    Ok(())
}

/// Refused with [`UprivError::VaultDeleting`] once a delete of the vault at
/// `vault_dir` started: its `config.toml` holds `[deleting]`.
pub(crate) fn refuse_deleting(vault_dir: &Path) -> Result<()> {
    if is_deleting(vault_dir) {
        return Err(UprivError::VaultDeleting);
    }
    Ok(())
}

/// True once a delete of the vault at `vault_dir` started.
pub(crate) fn is_deleting(vault_dir: &Path) -> bool {
    load_vault_config(vault_dir).is_ok_and(|config| config.deleting.is_some())
}

fn clear_last_opened(root: &VaultRoot, vault_id: &str) -> Result<()> {
    let loaded = match load_app_settings_at(root.root()) {
        Ok(loaded) => loaded,
        Err(UprivError::VaultRootNotFound(_)) | Err(UprivError::VaultRootIncomplete { .. }) => {
            return Ok(());
        }
        Err(error) => return Err(error),
    };
    if loaded.settings.app.last_opened_vault.trim() != vault_id {
        return Ok(());
    }
    update_app_settings(root.root(), |settings| {
        if settings.app.last_opened_vault.trim() == vault_id {
            settings.app.last_opened_vault.clear();
        }
    })
}

/// What a delete did with the backups the vault keeps outside the data folder.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutsideBackups {
    /// The vault keeps none.
    None,
    /// The person left them, so they stay where they were created.
    Kept,
    Removed,
    /// The person asked, and a folder could not be reached or a zip stayed.
    Failed,
}

impl OutsideBackups {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Kept => "kept",
            Self::Removed => "removed",
            Self::Failed => "failed",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VaultDeleteOutcome {
    pub outside: OutsideBackups,
    /// The folders whose backups stay: every one when the person kept them,
    /// those that could not be reached or kept a zip otherwise.
    pub folders: Vec<std::path::PathBuf>,
}

/// Delete the closed vault `vault_id`, as the job `job_id`, by the steps of
/// the module documentation. `remove_outside_backups` takes the zips it wrote
/// to folders outside the data folder too: only zips on its own list, and
/// only the folders that end up empty; a folder that cannot be reached keeps
/// them. A delete that did not finish goes on with the choice it began with.
/// `now` is Delete now from the start.
pub fn delete_vault(
    root: &VaultRoot,
    vault_id: &str,
    remove_outside_backups: bool,
    now: bool,
    job_id: &str,
) -> Result<VaultDeleteOutcome> {
    let vault_id = vault_id.trim();
    Job::run(job_id, JobKind::VaultDelete, Some(vault_id), |job| {
        delete_as(root, vault_id, remove_outside_backups, now, job)
    })
}

/// Remove a vault an import made and could not finish, with what it holds:
/// the delete of [`delete_vault`], run as part of the import's own work.
pub(crate) fn delete_unfinished_import(root: &VaultRoot, vault_id: &str) -> Result<()> {
    delete_as(root, vault_id, false, false, &Job::untracked()).map(|_| ())
}

fn delete_as(
    root: &VaultRoot,
    vault_id: &str,
    remove_outside_backups: bool,
    now: bool,
    job: &Job,
) -> Result<VaultDeleteOutcome> {
    let vault_dir = root.vault_dir(vault_id)?;
    if !vault_dir.host_is_dir() {
        return Err(UprivError::VaultNotFound(vault_dir));
    }
    refuse_if_busy(&vault_dir)?;
    let closing = ClosingGuard::enter(&vault_dir);
    if now {
        closing.hurry().store(true, Ordering::Relaxed);
    }
    with_vault_dir_lock(&vault_dir, || {
        if is_vault_open_at(&vault_dir)
            || is_vault_preparing_at(&vault_dir)
            || is_vault_backup_export_at(&vault_dir)
        {
            return Err(UprivError::VaultConfigBusy {
                target: "action.delete".into(),
            });
        }
        super::plain::refuse_if_elsewhere(root, vault_id)?;
        let config = load_vault_config(&vault_dir)?;
        let opts = WipeOptions::from_vault_config(&config);
        release_vault(root, vault_id)?;
        let lock_path = root.runtime_lock_path(vault_id)?;
        // Hold the cross-process lock for the wipe. A live flock means
        // another Upriv still has this vault open. Every refusal comes before
        // the delete is recorded, so a refused delete leaves no mark.
        let _lock = crate::lockfile::acquire_vault_lock(lock_path)?;
        let remove_outside = mark_deleting(&vault_dir, config, remove_outside_backups)?;
        super::plain::clear_for_delete(root, vault_id, &vault_dir)?;
        let _ = crate::runtime_state::forget_vault(root, vault_id);
        record_unlock_success(&vault_dir);
        overwrite_blobs(&vault_dir, &opts, job, closing.hurry())?;
        // The removal of `persistence.json` takes the record of them away.
        let outside = super::backup::outside_zips(&vault_dir);
        remove_store(&vault_dir, &opts)?;
        let outcome = match outside {
            None => VaultDeleteOutcome {
                outside: OutsideBackups::None,
                folders: Vec::new(),
            },
            Some(zips) => {
                let (settled, folders) = if !remove_outside {
                    (OutsideBackups::Kept, zips.folders())
                } else {
                    let kept = zips.remove();
                    let settled = if kept.is_empty() {
                        OutsideBackups::Removed
                    } else {
                        OutsideBackups::Failed
                    };
                    (settled, kept)
                };
                log_event(
                    LogLevel::Info,
                    "vault_deleted_outside_backups",
                    &[("id", vault_id), ("outcome", settled.as_str())],
                );
                VaultDeleteOutcome {
                    outside: settled,
                    folders,
                }
            }
        };
        remove_vault_folder(&vault_dir, &opts)?;
        let _ = remove_vault_from_groups(root, vault_id);
        let _ = clear_last_opened(root, vault_id);
        let hurried = if closing.hurry().load(Ordering::Relaxed) {
            "now"
        } else {
            "overwritten"
        };
        log_event(
            LogLevel::Info,
            "vault_deleted",
            &[("id", vault_id), ("blobs", hurried)],
        );
        Ok(outcome)
    })
}

/// Delete now for the delete running on `vault_id`: the blobs not reached
/// are removed with no overwrite. False when no delete of it runs.
pub fn hurry_delete(root: &VaultRoot, vault_id: &str) -> Result<bool> {
    let vault_dir = root.vault_dir(vault_id.trim())?;
    Ok(is_deleting(&vault_dir) && hurry_close_at(&vault_dir))
}

/// Record the delete in `config.toml` and flush it, unless a delete that did
/// not finish recorded it already. Returns the outside-backups choice the
/// delete goes on with: the one it began with.
fn mark_deleting(vault_dir: &Path, mut config: VaultConfig, remove_outside: bool) -> Result<bool> {
    if let Some(deleting) = &config.deleting {
        return Ok(deleting.outside_backups);
    }
    config.deleting = Some(crate::config::vault_config::VaultDeletingSection {
        outside_backups: remove_outside,
    });
    save_vault_config(vault_dir, &config)?;
    Ok(remove_outside)
}

/// Release what this process still holds of the vault: a recorded mount.
fn release_vault(root: &VaultRoot, vault_id: &str) -> Result<()> {
    if let Some(mount) = crate::runtime_state::load_runtime_state(root)
        .ok()
        .and_then(|state| state.vaults.get(vault_id).cloned())
        .and_then(|entry| entry.mount_point)
    {
        let path = std::path::PathBuf::from(mount);
        if crate::mount::force_unmount(&path).is_ok() {
            let _ = crate::host_fs::remove_dir(&path);
        }
    }
    Ok(())
}

/// Step 2: overwrite each blob's key copy with `opts` and flush it, then
/// remove the blob. Once `hurry` is set, the blobs left are removed with no
/// overwrite. A stop ends it where it is, with what is left still on disk.
fn overwrite_blobs(
    vault_dir: &Path,
    opts: &WipeOptions,
    job: &Job,
    hurry: &AtomicBool,
) -> Result<()> {
    let store = vault_dir.join(STORE_DIR_NAME);
    let blobs: Vec<std::path::PathBuf> = list_blobs(&store)?
        .into_iter()
        .map(|(path, _)| path)
        .chain(held_blob_paths(&store))
        .collect();
    job.set_step(JobStep::Overwriting);
    job.set_total(blobs.len() as u64 * KEY_COPY_LEN);
    let never = AtomicBool::new(false);
    for blob in blobs {
        job.ensure_running()?;
        if hurry.load(Ordering::Relaxed) {
            job.set_step(JobStep::Removing);
        } else {
            overwrite_key_copy(&blob, opts, &never)?;
        }
        match crate::host_fs::remove_file(&blob) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        job.advance(KEY_COPY_LEN);
    }
    job.set_step(JobStep::Removing);
    Ok(())
}

/// Overwrite the key copy at the start of the blob at `path` and flush it. A
/// blob that is already gone holds nothing to overwrite.
fn overwrite_key_copy(path: &Path, opts: &WipeOptions, stop: &AtomicBool) -> Result<()> {
    let mut file = match crate::paths::open_nofollow(path, crate::paths::NofollowMode::ReadWrite) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    let len = file.metadata()?.len().min(KEY_COPY_LEN);
    overwrite_contents(&mut file, len, opts, stop)?;
    Ok(())
}

/// Step 3, up to the outside backups: the header and index files wiped,
/// then the rest of `store/`, `held/`, and `backups/` removed.
fn remove_store(vault_dir: &Path, opts: &WipeOptions) -> Result<()> {
    let store = vault_dir.join(STORE_DIR_NAME);
    secure_wipe_path(&store.join(HEADER_DIR_NAME), opts)?;
    secure_wipe_path(&store.join(INDEX_DIR_NAME), opts)?;
    for dir in [
        store,
        vault_dir.join(HELD_DIR_NAME),
        vault_dir.join(DATA_FOLDER_BACKUPS_DIR),
    ] {
        match crate::host_fs::remove_dir_all(&dir) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

/// The end of step 3: `persistence.json` wiped, anything else left in the
/// folder removed, then `config.toml` wiped, then the empty folder.
fn remove_vault_folder(vault_dir: &Path, opts: &WipeOptions) -> Result<()> {
    secure_wipe_path(&super::persistence::persistence_path(vault_dir), opts)?;
    let config = vault_config_path(vault_dir);
    for entry in crate::host_fs::read_dir(vault_dir)? {
        let path = entry?.path();
        if path == config {
            continue;
        }
        let removed = if path.host_is_dir() {
            crate::host_fs::remove_dir_all(&path)
        } else {
            crate::host_fs::remove_file(&path)
        };
        match removed {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    secure_wipe_path(&config, opts)?;
    crate::host_fs::remove_dir(vault_dir)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[allow(unused_imports)]
    use crate::host_fs::HostFsQuery;
    use crate::store::KdfUnlockPreset;
    use crate::test_support::{quiet_config, test_job_id, vault_root_with};
    use crate::vault::{close_vault, create_vault, fs_write_file, open_vault};

    const PW: &[u8] = b"pass-word-ok";

    /// A data folder with the closed vault `notes` holding two files.
    fn notes() -> (tempfile::TempDir, VaultRoot) {
        let (tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            quiet_config("notes", "Notes"),
            PW,
            KdfUnlockPreset::M32,
        )
        .unwrap();
        open_vault(&root, "notes", PW).unwrap();
        fs_write_file(&root, "notes", "/a.txt", b"first").unwrap();
        fs_write_file(&root, "notes", "/b.txt", b"second").unwrap();
        close_vault(&root, "notes").unwrap();
        (tmp, root)
    }

    fn delete(root: &VaultRoot, now: bool) -> Result<VaultDeleteOutcome> {
        delete_vault(root, "notes", false, now, &test_job_id())
    }

    #[test]
    fn delete_removes_the_closed_vault_and_its_folder() {
        let (_tmp, root) = notes();
        let dir = root.vault_dir("notes").unwrap();
        crate::host_fs::write(dir.join("leftover.bin"), vec![7u8; 4096]).unwrap();
        let outcome = delete(&root, false).unwrap();
        assert_eq!(outcome.outside, OutsideBackups::None);
        assert!(!dir.host_exists());
        assert!(crate::vault::list_vaults(&root).unwrap().is_empty());
    }

    /// A second name for each blob of `notes`, outside the vault, so a test
    /// sees what the delete left in each blob's bytes.
    #[cfg(unix)]
    fn linked_blobs(root: &VaultRoot, into: &Path) -> Vec<std::path::PathBuf> {
        let store = root.vault_store_dir("notes").unwrap();
        crate::store::list_blobs(&store)
            .unwrap()
            .into_iter()
            .enumerate()
            .map(|(at, (blob, _))| {
                let link = into.join(format!("{at}.blob"));
                std::fs::hard_link(&blob, &link).unwrap();
                link
            })
            .collect()
    }

    #[cfg(unix)]
    #[test]
    fn no_key_copy_reads_after_a_delete() {
        let (tmp, root) = notes();
        let links = linked_blobs(&root, tmp.path());
        assert!(links
            .iter()
            .all(|link| crate::store::read_prefix(link).is_some()));
        delete(&root, false).unwrap();
        for link in links {
            assert!(
                crate::store::read_prefix(&link).is_none(),
                "{}",
                link.display()
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn delete_now_removes_the_blobs_with_no_overwrite() {
        let (tmp, root) = notes();
        let links = linked_blobs(&root, tmp.path());
        delete(&root, true).unwrap();
        assert!(!root.vault_dir("notes").unwrap().host_exists());
        // Only the overwrite is left out: the bytes stay until the disk
        // reuses the space.
        assert!(links
            .iter()
            .all(|link| crate::store::read_prefix(link).is_some()));
        assert!(!hurry_delete(&root, "notes").unwrap());
    }

    #[test]
    fn a_delete_cut_short_shows_as_deleting_and_continue_ends_it() {
        let (_tmp, root) = notes();
        let job = test_job_id();
        // The first write a delete makes is its record in `config.toml`; the
        // stop then ends it before the first blob.
        let stop = job.clone();
        let mut calls = 0;
        crate::paths::observe_atomic_writes(Some(Box::new(move || {
            calls += 1;
            if calls == 2 {
                let _ = crate::session::cancel_job(&stop);
            }
        })));
        let stopped = delete_vault(&root, "notes", false, false, &job);
        crate::paths::observe_atomic_writes(None);
        assert!(matches!(stopped, Err(UprivError::JobCancelled)));

        let item = crate::vault::vault_list_item(&root, "notes").unwrap();
        assert_eq!(item.session, Some("deleting"));
        assert!(item.delete_unfinished);
        assert!(matches!(
            open_vault(&root, "notes", PW),
            Err(UprivError::VaultDeleting)
        ));
        assert!(matches!(
            crate::vault::change_vault_password(
                &root,
                "notes",
                PW,
                b"next-pass-ok",
                false,
                &test_job_id()
            ),
            Err(UprivError::VaultDeleting)
        ));
        assert!(matches!(
            crate::vault::rename_vault(&root, "notes", "Other"),
            Err(UprivError::VaultDeleting)
        ));

        delete(&root, false).unwrap();
        assert!(!root.vault_dir("notes").unwrap().host_exists());
    }

    #[test]
    fn an_empty_vault_folder_does_not_block_a_create_of_its_id() {
        let (_tmp, root) = vault_root_with(&[]);
        let dir = root.vault_dir("notes").unwrap();
        crate::host_fs::create_dir_all(&dir).unwrap();
        assert!(!crate::config::known_vault_ids(&root)
            .unwrap()
            .contains("notes"));
        create_vault(
            &root,
            quiet_config("notes", "Notes"),
            PW,
            KdfUnlockPreset::M32,
        )
        .unwrap();
        assert!(crate::config::load_vault_config(&dir).is_ok());
    }

    #[test]
    fn delete_refuses_when_another_process_holds_the_lock_and_leaves_no_mark() {
        let (_tmp, root) = notes();
        let lock_path = root.runtime_lock_path("notes").unwrap();
        let _lock = crate::lockfile::acquire_vault_lock(lock_path).unwrap();
        let err = delete(&root, false).unwrap_err();
        assert!(matches!(err, UprivError::VaultLocked(_)));
        let dir = root.vault_dir("notes").unwrap();
        assert!(dir.host_is_dir());
        assert!(!is_deleting(&dir));
    }

    #[test]
    fn delete_refuses_while_export_or_a_change_holds_the_vault() {
        let (_tmp, root) = notes();
        let dir = root.vault_dir("notes").unwrap();
        let _hold = crate::session::PreparingGuard::enter_exclusive(&dir).expect("hold");
        let err = delete(&root, false).unwrap_err();
        assert!(matches!(err, UprivError::VaultConfigBusy { .. }));
        assert!(dir.host_is_dir());
        assert!(!is_deleting(&dir));
    }

    #[test]
    fn delete_refuses_while_another_device_has_plain_text_of_the_vault() {
        let (_tmp, root) = notes();
        let laptop = crate::device::DeviceId::from_machine_id(b"laptop")
            .as_str()
            .to_string();
        let elsewhere = crate::runtime_state::PlainRecord {
            device: laptop.clone(),
            ..crate::runtime_state::PlainRecord::written_here(
                "/media/usb/upriv-unlocked/Notes".into(),
                false,
                "token".into(),
                "0123456789abcdef0123456789abcdef".into(),
            )
        };
        crate::runtime_state::adopt_plain_record(&root, "notes", elsewhere).unwrap();

        let err = delete(&root, false).unwrap_err();
        assert!(matches!(
            err,
            UprivError::VaultPlainElsewhere { ref device, ref path, .. }
                if *device == laptop && path == "/media/usb/upriv-unlocked/Notes"
        ));
        assert!(root.vault_dir("notes").unwrap().host_is_dir());
        assert_eq!(
            crate::runtime_state::plain_records(&root, "notes")
                .unwrap()
                .len(),
            1
        );
    }
}
