//! Rebuild a closed vault whose two index files no longer open, from what
//! still names its blobs: the recovery records they carry, and the vault's
//! backup zips.
//!
//! Only the person starts it, from the unlock that found the index lost
//! ([`UprivError::VaultIndexUnreadable`]). An index that opens is the vault's
//! tree, so a rebuild refuses it ([`UprivError::VaultIndexReadable`]): it
//! would lose what only that index holds.
//!
//! In order: the password unlocks the header, under the unlock throttle an
//! open uses; the index is checked again; a copy of `store/` as it is goes
//! into `saves/` in the data folder, or in the chosen backup folder when the
//! data folder has no room for it ([`UprivError::VaultRebuildSpaceShort`] when
//! neither has), and stays until the person deletes it; every blob is named by
//! the newer of its own newest record and the newest backup that names it, in
//! either place; the tree they describe is sealed into both index files. No
//! blob is moved, rewritten, or deleted. A blob nothing names, or whose path a
//! newer file took, stays in `data/`, and the next open sets it aside in
//! `held/`.
//!
//! A rebuilt file holds the data its record or backup names: the file as the
//! close of the last session that wrote it left it, or as the seal that made
//! it. What a session wrote after that, with no close, is not in it. A part
//! that does not open marks the file on its first read, as any damaged file
//! is marked.
//!
//! A job the person can stop until its seal: a stop removes the copy and
//! leaves the store as it was. The seal refuses a stop ([`Job::final_step`]).

use std::path::Path;

use serde::Serialize;

use crate::config::load_vault_config;
use crate::error::{Result, UprivError};
use crate::host_fs::HostFsQuery;
use crate::logging::{log_event, LogLevel};
use crate::paths::VaultRoot;
use crate::runtime_state::refuse_if_held_elsewhere;
use crate::session::{
    check_unlock_allowed, ensure_vault_session_closed, is_vault_closing_at, is_vault_open_at,
    record_unlock_failure, record_unlock_success, with_unlock_lock, with_vault_dir_lock, Job,
    JobKind, PreparingGuard,
};
use crate::store::{content_hash_hex, unlock_lost_index, LostIndex};

use super::backup::pin_before_rebuild;
use super::partial::{discard_partial, PartialWork};
use super::persistence::record_store_rewritten;

/// What a rebuild put back.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultRebuild {
    /// Files placed in the tree.
    pub files: u64,
    /// Blobs left for the next open to set aside for review: one nothing
    /// names, or whose path a newer file took.
    pub set_aside: u64,
}

/// Rebuild the index of the closed vault `vault_id` from its blobs, as the
/// job `job_id`.
pub fn rebuild_vault(
    root: &VaultRoot,
    vault_id: &str,
    password: &[u8],
    job_id: &str,
) -> Result<VaultRebuild> {
    Job::run(job_id, JobKind::Rebuild, Some(vault_id), |job| {
        rebuild(root, vault_id, password, job)
    })
}

fn rebuild(root: &VaultRoot, vault_id: &str, password: &[u8], job: &Job) -> Result<VaultRebuild> {
    if password.is_empty() {
        return Err(UprivError::WrongPassword);
    }
    let vault_dir = root.vault_dir(vault_id)?;
    if !vault_dir.host_is_dir() {
        return Err(UprivError::VaultNotFound(vault_dir));
    }
    ensure_vault_session_closed(&vault_dir)?;
    refuse_if_held_elsewhere(root, vault_id)?;
    let _preparing = PreparingGuard::enter_exclusive(&vault_dir)?;
    with_vault_dir_lock(&vault_dir, || {
        if is_vault_open_at(&vault_dir) || is_vault_closing_at(&vault_dir) {
            return Err(UprivError::VaultMustBeClosed);
        }
        super::plain::ensure_no_leftover(root, vault_id)?;
        let store = vault_dir.join(crate::paths::STORE_DIR_NAME);
        let lost = with_unlock_lock(|| unlock(&vault_dir, &store, password))?;
        job.ensure_running()?;
        let pin = match pin_before_rebuild(root, vault_id, job) {
            Ok(pin) => pin,
            Err(error @ UprivError::VaultRebuildSpaceShort { .. }) => return Err(error),
            Err(_) if job.is_stopped() => return Err(UprivError::JobCancelled),
            Err(_) => {
                log_event(
                    LogLevel::Warn,
                    "vault_rebuild_backup_failed",
                    &[("id", vault_id)],
                );
                return Err(UprivError::VaultBackupFailed);
            }
        };
        // Until the seal starts, a stop or a failure leaves the store as it
        // was, so the copy goes with it.
        let backup_zips =
            || super::backup::every_backup_zip_newest_first(root, vault_id, &vault_dir);
        let built = lost
            .rebuild_tree(&store, &backup_zips, &mut || job.ensure_running())
            .and_then(|rebuilt| job.final_step().map(|()| rebuilt));
        let mut rebuilt = match built {
            Ok(rebuilt) => rebuilt,
            Err(error) => {
                discard_partial(&pin, PartialWork::BackupSave);
                return Err(error);
            }
        };
        lost.seal(&store, &mut rebuilt.index)?;
        record_rebuild(&vault_dir, vault_id, &store);
        let counts = [
            ("files", rebuilt.placed),
            ("from_backups", rebuilt.from_backups),
            ("left", rebuilt.left),
            ("unnamed", rebuilt.unnamed),
        ]
        .map(|(field, count)| (field, count.to_string()));
        let mut fields = vec![("id", vault_id)];
        fields.extend(counts.iter().map(|(field, count)| (*field, count.as_str())));
        log_event(LogLevel::Warn, "vault_rebuilt", &fields);
        Ok(VaultRebuild {
            files: rebuilt.placed as u64,
            set_aside: (rebuilt.left + rebuilt.unnamed) as u64,
        })
    })
}

/// The header unlock, under the throttle an open uses.
fn unlock(vault_dir: &Path, store: &Path, password: &[u8]) -> Result<LostIndex> {
    check_unlock_allowed(vault_dir)?;
    match unlock_lost_index(store, password) {
        Ok(lost) => {
            record_unlock_success(vault_dir);
            Ok(lost)
        }
        Err(UprivError::WrongPassword) => {
            let _ = record_unlock_failure(vault_dir);
            Err(UprivError::WrongPassword)
        }
        Err(error) => Err(error),
    }
}

/// The store's new hash, so the list does not read the rebuild as a crash.
/// The tree is sealed by then, so a failure here is logged, not returned.
fn record_rebuild(vault_dir: &Path, vault_id: &str, store: &Path) {
    let recorded = load_vault_config(vault_dir).and_then(|config| {
        let hash = content_hash_hex(store)?;
        record_store_rewritten(vault_dir, vault_id, &config.vault.display_name, &hash)
    });
    if recorded.is_err() {
        log_event(
            LogLevel::Warn,
            "vault_rebuild_unrecorded",
            &[("id", vault_id)],
        );
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;
    #[allow(unused_imports)]
    use crate::host_fs::HostFsQuery;
    use crate::paths::{VaultBackupFolderRow, VaultBackupPlace};
    use crate::session::cancel_job;
    use crate::store::{
        open_store, KdfUnlockPreset, CHUNK_SIZE, DATA_DIR_NAME, INDEX_COPY_FILE_NAME,
        INDEX_DIR_NAME, INDEX_FILE_NAME,
    };
    use crate::test_support::{test_job_id, vault_root_with};
    use crate::vault::{
        change_vault_password, close_vault, create_vault, fs_delete, fs_held_list, fs_held_restore,
        fs_list_tree, fs_mkdir, fs_read_file, fs_write_file, list_backups, open_vault,
        BackupLocation,
    };

    const PW: &[u8] = b"pass-word-ok";

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

    fn notes() -> (tempfile::TempDir, VaultRoot) {
        let (tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            PW,
            KdfUnlockPreset::M32,
        )
        .unwrap();
        (tmp, root)
    }

    fn store(root: &VaultRoot) -> PathBuf {
        root.vault_dir("notes")
            .unwrap()
            .join(crate::paths::STORE_DIR_NAME)
    }

    /// Both index files replaced by bytes that do not open.
    fn lose_index(root: &VaultRoot) {
        let index = store(root).join(INDEX_DIR_NAME);
        crate::host_fs::write(index.join(INDEX_FILE_NAME), b"torn primary").unwrap();
        crate::host_fs::write(index.join(INDEX_COPY_FILE_NAME), b"torn copy").unwrap();
    }

    fn blob_of(root: &VaultRoot, path: &str) -> PathBuf {
        let opened = open_store(store(root), PW).unwrap();
        let (file_id, _, _) = opened.index.find(path).unwrap().as_file().unwrap();
        crate::store::blob_path(store(root), file_id).unwrap()
    }

    fn rebuild_now(root: &VaultRoot, password: &[u8]) -> Result<VaultRebuild> {
        rebuild_vault(root, "notes", password, &test_job_id())
    }

    fn saves(root: &VaultRoot) -> usize {
        list_backups(root, "notes")
            .unwrap()
            .iter()
            .filter(|backup| backup.saved)
            .count()
    }

    #[test]
    fn a_lost_index_is_rebuilt_from_the_records_of_its_blobs() {
        let (_tmp, root) = notes();
        open_vault(&root, "notes", PW).unwrap();
        fs_mkdir(&root, "notes", "/docs").unwrap();
        fs_mkdir(&root, "notes", "/docs/deep").unwrap();
        fs_mkdir(&root, "notes", "/empty").unwrap();
        let big: Vec<u8> = (0..CHUNK_SIZE as usize * 2 + 7).map(|n| n as u8).collect();
        fs_write_file(&root, "notes", "/docs/a.txt", b"first").unwrap();
        fs_write_file(&root, "notes", "/docs/deep/big.bin", &big).unwrap();
        fs_write_file(&root, "notes", "/b.txt", b"second").unwrap();
        close_vault(&root, "notes").unwrap();
        let saves_before = saves(&root);
        lose_index(&root);

        assert!(matches!(
            open_vault(&root, "notes", PW),
            Err(UprivError::VaultIndexUnreadable { .. })
        ));
        let rebuilt = rebuild_now(&root, PW).unwrap();
        assert_eq!(rebuilt.set_aside, 0);
        assert!(rebuilt.files >= 3);
        assert_eq!(
            saves(&root),
            saves_before + 1,
            "the copy from before is pinned"
        );

        open_vault(&root, "notes", PW).unwrap();
        assert_eq!(
            fs_read_file(&root, "notes", "/docs/a.txt").unwrap(),
            b"first"
        );
        assert_eq!(
            fs_read_file(&root, "notes", "/docs/deep/big.bin").unwrap(),
            big
        );
        assert_eq!(fs_read_file(&root, "notes", "/b.txt").unwrap(), b"second");
        // An empty folder has no blob, so no record.
        let tree = fs_list_tree(&root, "notes").unwrap();
        let top = tree.children.unwrap_or_default();
        assert!(top.iter().any(|child| child.name == "docs"));
        assert!(!top.iter().any(|child| child.name == "empty"));
        assert!(fs_held_list(&root, "notes").unwrap().is_empty());
        close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn a_lost_index_lists_as_recovery_until_it_is_rebuilt() {
        let session = |root: &VaultRoot| {
            crate::vault::list_vaults(root)
                .unwrap()
                .into_iter()
                .find(|item| item.id == "notes")
                .unwrap()
                .session
        };
        // Both index files torn.
        let (_tmp, root) = notes();
        lose_index(&root);
        assert_eq!(session(&root), Some("recovery"));
        rebuild_now(&root, PW).unwrap();
        assert_eq!(session(&root), None);

        // Both index files gone.
        let (_tmp, root) = notes();
        let index = store(&root).join(INDEX_DIR_NAME);
        crate::host_fs::remove_file(index.join(INDEX_FILE_NAME)).unwrap();
        crate::host_fs::remove_file(index.join(INDEX_COPY_FILE_NAME)).unwrap();
        assert_eq!(session(&root), Some("recovery"));
        rebuild_now(&root, PW).unwrap();
        assert_eq!(session(&root), None);
    }

    #[test]
    fn a_missing_index_is_rebuilt_too() {
        let (_tmp, root) = notes();
        open_vault(&root, "notes", PW).unwrap();
        fs_write_file(&root, "notes", "/a.txt", b"kept").unwrap();
        close_vault(&root, "notes").unwrap();
        let index = store(&root).join(INDEX_DIR_NAME);
        crate::host_fs::remove_file(index.join(INDEX_FILE_NAME)).unwrap();
        crate::host_fs::remove_file(index.join(INDEX_COPY_FILE_NAME)).unwrap();

        rebuild_now(&root, PW).unwrap();
        open_vault(&root, "notes", PW).unwrap();
        assert_eq!(fs_read_file(&root, "notes", "/a.txt").unwrap(), b"kept");
        close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn an_index_that_opens_is_not_rebuilt() {
        let (_tmp, root) = notes();
        let before = saves(&root);
        assert!(matches!(
            rebuild_now(&root, PW),
            Err(UprivError::VaultIndexReadable)
        ));
        assert_eq!(saves(&root), before);
    }

    #[test]
    fn a_wrong_password_or_a_stop_changes_nothing() {
        let (_tmp, root) = notes();
        lose_index(&root);
        let primary = store(&root).join(INDEX_DIR_NAME).join(INDEX_FILE_NAME);
        let before = saves(&root);
        assert!(matches!(
            rebuild_now(&root, b"wrong-password"),
            Err(UprivError::WrongPassword)
        ));
        let id = test_job_id();
        cancel_job(&id).unwrap();
        assert!(matches!(
            rebuild_vault(&root, "notes", PW, &id),
            Err(UprivError::JobCancelled)
        ));
        assert_eq!(saves(&root), before);
        assert_eq!(crate::host_fs::read(&primary).unwrap(), b"torn primary");
    }

    #[test]
    fn the_newer_record_takes_a_path_and_the_older_blob_is_set_aside() {
        let (_tmp, root) = notes();
        open_vault(&root, "notes", PW).unwrap();
        fs_write_file(&root, "notes", "/a.txt", b"older").unwrap();
        close_vault(&root, "notes").unwrap();
        let older = blob_of(&root, "a.txt");
        let older_bytes = crate::host_fs::read(&older).unwrap();
        open_vault(&root, "notes", PW).unwrap();
        fs_write_file(&root, "notes", "/a.txt", b"newer").unwrap();
        close_vault(&root, "notes").unwrap();
        // The older version's blob, as a seal that never flushed would leave it.
        assert!(!older.host_exists());
        crate::host_fs::write(&older, &older_bytes).unwrap();
        lose_index(&root);

        let rebuilt = rebuild_now(&root, PW).unwrap();
        assert_eq!(rebuilt.set_aside, 1);
        open_vault(&root, "notes", PW).unwrap();
        assert_eq!(fs_read_file(&root, "notes", "/a.txt").unwrap(), b"newer");
        // The next open set the older one aside, named by its own record.
        let held = fs_held_list(&root, "notes").unwrap();
        assert_eq!(held.len(), 1);
        assert_eq!(held[0].file.as_ref().unwrap().path, "/a.txt");
        let (restored, _) =
            fs_held_restore(&root, "notes", std::slice::from_ref(&held[0].name)).unwrap();
        assert_eq!(
            fs_read_file(&root, "notes", &restored[0]).unwrap(),
            b"older"
        );
        close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn a_file_where_a_newer_file_stands_on_its_folder_is_set_aside() {
        let (_tmp, root) = notes();
        open_vault(&root, "notes", PW).unwrap();
        fs_mkdir(&root, "notes", "/x").unwrap();
        fs_write_file(&root, "notes", "/x/y.txt", b"under a folder").unwrap();
        close_vault(&root, "notes").unwrap();
        let under = blob_of(&root, "x/y.txt");
        let under_bytes = crate::host_fs::read(&under).unwrap();
        open_vault(&root, "notes", PW).unwrap();
        fs_delete(&root, "notes", "/x").unwrap();
        fs_write_file(&root, "notes", "/x", b"a file now").unwrap();
        close_vault(&root, "notes").unwrap();
        crate::host_fs::write(&under, &under_bytes).unwrap();
        lose_index(&root);

        assert_eq!(rebuild_now(&root, PW).unwrap().set_aside, 1);
        open_vault(&root, "notes", PW).unwrap();
        assert_eq!(fs_read_file(&root, "notes", "/x").unwrap(), b"a file now");
        close_vault(&root, "notes").unwrap();
    }

    /// Cut the records off the blob of the one-chunk file `path`, as a blob
    /// no record was ever written for.
    fn strip_records(root: &VaultRoot, path: &str) {
        let opened = open_store(store(root), PW).unwrap();
        let node = opened.index.find(path).unwrap();
        let (file_id, size, _) = node.as_file().unwrap();
        // Its one chunk: the 24-byte nonce, the bytes, and the 16-byte tag.
        let chunk_end = node.chunk_offsets().unwrap()[0] + 24 + size + 16;
        let blob = crate::store::blob_path(store(root), file_id).unwrap();
        let bytes = crate::host_fs::read(&blob).unwrap();
        assert!(bytes.len() as u64 > chunk_end, "the blob carries a record");
        crate::host_fs::write(&blob, &bytes[..chunk_end as usize]).unwrap();
    }

    #[test]
    fn a_blob_with_no_record_comes_back_from_the_newest_backup() {
        let (_tmp, root) = notes();
        open_vault(&root, "notes", PW).unwrap();
        fs_mkdir(&root, "notes", "/docs").unwrap();
        fs_write_file(&root, "notes", "/docs/a.txt", b"named by a backup").unwrap();
        close_vault(&root, "notes").unwrap();
        strip_records(&root, "docs/a.txt");
        lose_index(&root);

        assert_eq!(rebuild_now(&root, PW).unwrap().set_aside, 0);
        open_vault(&root, "notes", PW).unwrap();
        assert_eq!(
            fs_read_file(&root, "notes", "/docs/a.txt").unwrap(),
            b"named by a backup"
        );
        assert!(fs_held_list(&root, "notes").unwrap().is_empty());
        close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn a_file_renamed_since_its_record_takes_its_name_from_the_backup() {
        let (_tmp, root) = notes();
        open_vault(&root, "notes", PW).unwrap();
        fs_write_file(&root, "notes", "/before.txt", b"one body, two names").unwrap();
        close_vault(&root, "notes").unwrap();
        // A rename writes no record; the close's backup names it anew.
        open_vault(&root, "notes", PW).unwrap();
        crate::vault::fs_rename(&root, "notes", "/before.txt", "after.txt").unwrap();
        close_vault(&root, "notes").unwrap();
        lose_index(&root);

        rebuild_now(&root, PW).unwrap();
        open_vault(&root, "notes", PW).unwrap();
        assert_eq!(
            fs_read_file(&root, "notes", "/after.txt").unwrap(),
            b"one body, two names"
        );
        assert!(fs_read_file(&root, "notes", "/before.txt").is_err());
        close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn a_blob_with_no_record_or_a_cut_tail_still_comes_through() {
        let (_tmp, root) = notes();
        open_vault(&root, "notes", PW).unwrap();
        fs_write_file(&root, "notes", "/a.txt", b"its record is behind a cut").unwrap();
        close_vault(&root, "notes").unwrap();
        // An append a crash cut short.
        let blob = blob_of(&root, "a.txt");
        let mut bytes = crate::host_fs::read(&blob).unwrap();
        bytes.extend_from_slice(&[0x5a; 300]);
        crate::host_fs::write(&blob, &bytes).unwrap();
        // A blob nothing names: no record opens.
        let stray = store(&root)
            .join(DATA_DIR_NAME)
            .join("ab")
            .join("ab000000-0000-4000-8000-000000000001.blob");
        crate::host_fs::create_dir_all(stray.parent().unwrap()).unwrap();
        crate::host_fs::write(&stray, [7u8; 200]).unwrap();
        lose_index(&root);

        let rebuilt = rebuild_now(&root, PW).unwrap();
        assert_eq!(rebuilt.set_aside, 1);
        open_vault(&root, "notes", PW).unwrap();
        assert_eq!(
            fs_read_file(&root, "notes", "/a.txt").unwrap(),
            b"its record is behind a cut"
        );
        let held = fs_held_list(&root, "notes").unwrap();
        assert_eq!(held.len(), 1);
        assert!(held[0].file.is_none());
        close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn records_survive_a_password_change() {
        let (_tmp, root) = notes();
        open_vault(&root, "notes", PW).unwrap();
        fs_write_file(&root, "notes", "/a.txt", b"before the change").unwrap();
        close_vault(&root, "notes").unwrap();
        let next = b"next-pass-ok";
        change_vault_password(&root, "notes", PW, next, &test_job_id()).unwrap();
        lose_index(&root);

        rebuild_now(&root, next).unwrap();
        open_vault(&root, "notes", next).unwrap();
        assert_eq!(
            fs_read_file(&root, "notes", "/a.txt").unwrap(),
            b"before the change"
        );
        close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn the_save_count_goes_on_past_every_record() {
        let (_tmp, root) = notes();
        open_vault(&root, "notes", PW).unwrap();
        fs_write_file(&root, "notes", "/a.txt", b"body").unwrap();
        close_vault(&root, "notes").unwrap();
        let blob = blob_of(&root, "a.txt");
        lose_index(&root);
        rebuild_now(&root, PW).unwrap();

        let opened = open_store(store(&root), PW).unwrap();
        let (file_id, _, _) = opened.index.find("a.txt").unwrap().as_file().unwrap();
        let record =
            crate::store::read_record(&blob, file_id, &opened.header, &opened.record_key, false)
                .unwrap();
        // Records written from now on are newer than any the rebuild read.
        assert!(opened.index.saves > record.save);
    }

    #[test]
    fn a_drive_with_no_room_for_the_copy_refuses_the_rebuild() {
        let (_tmp, root) = notes();
        lose_index(&root);
        let saves_dir = root.vault_dir("notes").unwrap().join("backups");
        let Some(available) = crate::host_fs::free_bytes(&saves_dir) else {
            return;
        };
        // A sparse file the copy would have to hold whole.
        let filler = store(&root).join("filler.bin");
        let file = std::fs::File::create(&filler).unwrap();
        if file.set_len(available.saturating_add(1 << 30)).is_err() {
            return;
        }
        drop(file);
        let before = saves(&root);
        let Err(UprivError::VaultRebuildSpaceShort { needed, available }) = rebuild_now(&root, PW)
        else {
            panic!("the copy does not fit");
        };
        assert!(needed > available);
        assert_eq!(saves(&root), before);
    }

    /// A vault `notes` whose backups go to its own folder in `drive`.
    fn notes_backing_up_to(drive: &std::path::Path) -> (tempfile::TempDir, VaultRoot) {
        let (tmp, root) = vault_root_with(&[]);
        let mut config = sample_config("notes", "Notes");
        let row = VaultBackupFolderRow {
            place: VaultBackupPlace::Custom,
            path: drive.to_string_lossy().into_owned(),
        };
        config.backup.linux = row.clone();
        config.backup.windows = row.clone();
        config.backup.macos = row;
        create_vault(&root, config, PW, KdfUnlockPreset::M32).unwrap();
        (tmp, root)
    }

    #[test]
    fn a_blob_with_no_record_comes_back_from_a_backup_in_the_chosen_folder() {
        let drive = tempfile::tempdir().unwrap();
        let (_tmp, root) = notes_backing_up_to(drive.path());
        open_vault(&root, "notes", PW).unwrap();
        fs_mkdir(&root, "notes", "/docs").unwrap();
        fs_write_file(&root, "notes", "/docs/a.txt", b"named on the drive").unwrap();
        close_vault(&root, "notes").unwrap();
        strip_records(&root, "docs/a.txt");
        lose_index(&root);

        assert_eq!(rebuild_now(&root, PW).unwrap().set_aside, 0);

        open_vault(&root, "notes", PW).unwrap();
        assert_eq!(
            fs_read_file(&root, "notes", "/docs/a.txt").unwrap(),
            b"named on the drive"
        );
        close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn the_copy_before_a_rebuild_stays_in_the_data_folder_as_a_save() {
        let drive = tempfile::tempdir().unwrap();
        let (_tmp, root) = notes_backing_up_to(drive.path());
        lose_index(&root);

        rebuild_now(&root, PW).unwrap();

        let copies: Vec<_> = list_backups(&root, "notes")
            .unwrap()
            .into_iter()
            .filter(|backup| backup.saved)
            .collect();
        assert_eq!(copies.len(), 1);
        assert_eq!(copies[0].location, BackupLocation::DataFolder);
        assert!(copies[0].path.host_is_file());
    }
}
