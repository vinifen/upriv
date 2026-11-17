//! The unlock-RAM change of a closed vault: a new cost and salt for the same
//! password, and the same keys.
//!
//! A new key would protect nothing while the password stays: an older copy
//! of the vault lets someone guess that password at the old cost, and the
//! password then opens the vault.
//!
//! In order, as one job:
//!
//! 1. The cost the header already has is refused from the header alone,
//!    before any unlock. A pending password change refuses it; an unfinished
//!    one allows it. The password unlocks, and blobs no file names are set
//!    aside.
//! 2. The header: new salt and cost, the same keys and `since`, a new
//!    generation, sealed under the new KEK; the index sealed under that
//!    block's pair with the pass due. The four writes commit it
//!    ([`super::header_commit`]), a step a stop cannot enter.
//! 3. The pass makes every blob's key copy the new header's
//!    ([`super::key_pass`]), counted from zero so it can be stopped. A stop
//!    there is not a cancel: the job after the next open finishes it.
//!
//! It writes no backup. No state of it can lock anyone out: the password
//! does not change, and a blob with the earlier key copy and one with the
//! later one both open with it. Backups already written keep the unlock RAM
//! they were written with.

use serde::Serialize;

use crate::error::{Result, UprivError};
use crate::logging::{log_event, LogLevel};
use crate::paths::VaultRoot;
use crate::session::{with_unlock_lock, Job, JobKind, JobStep};
use crate::store::{probe_unlock_preset, HeaderKdf, KdfUnlockPreset};

use super::closed_store::{steady, unlock_counted};
use super::header_commit::{next_generation, CommitRecord};
use super::key_pass::{pass_closed, KeyCopies};

/// What an unlock-RAM change did.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnlockRamChangeResult {
    pub key_copies: KeyCopies,
}

/// Change the unlock RAM of the closed vault `vault_id` to `preset`, as the
/// job `job_id`. The password stays `password`.
pub fn change_vault_kdf(
    root: &VaultRoot,
    vault_id: &str,
    password: &[u8],
    preset: KdfUnlockPreset,
    job_id: &str,
) -> Result<UnlockRamChangeResult> {
    Job::run(job_id, JobKind::UnlockRamChange, Some(vault_id), |job| {
        super::closed_store::with_closed_vault(root, vault_id, |vault_dir| {
            let store_dir = vault_dir.join(crate::paths::STORE_DIR_NAME);
            // The header keeps its cost in the clear: the one it has is
            // refused before an unlock that can take seconds.
            if probe_unlock_preset(&store_dir) == Some(preset) {
                return Err(UprivError::UnlockRamUnchanged);
            }
            job.set_step(JobStep::Unlocking);
            let mut store = with_unlock_lock(|| {
                unlock_counted(vault_dir, password, |unlocked| {
                    steady(vault_dir, vault_id, unlocked)
                })
            })?;
            // The header the password opened decides: the other file may
            // hold another cost after a commit a crash cut short.
            if store.header.unlock_preset() == Some(preset) {
                return Err(UprivError::UnlockRamUnchanged);
            }
            job.ensure_running()?;
            store.settle()?;
            let kdf = HeaderKdf::fresh(preset);
            let kek = with_unlock_lock(|| kdf.derive_kek(password))?;
            job.final_step()?;
            job.set_step(JobStep::Finishing);
            let generation = next_generation(&store.store_dir(), &store.header)?;
            let keys = store.keys.draft().seal(generation, kdf, &kek)?;
            store.commit(keys, kek, CommitRecord::Rewritten)?;
            log_event(
                LogLevel::Info,
                "vault_unlock_ram_changed",
                &[("id", vault_id)],
            );
            let key_copies = pass_closed(&mut store, job)?;
            Ok(UnlockRamChangeResult { key_copies })
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::{open_store, read_key_copy, read_prefix, KeyId};
    use crate::test_support::{dir_bytes, quiet_config, test_job_id, vault_root_with};
    use crate::vault::closed_store::{steady, unlock_counted};
    use crate::vault::{
        close_vault, create_vault, fs_read_file, fs_write_file, open_vault, update_key_copies,
    };

    const PW: &[u8] = b"pass-word-ok";

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

    fn blobs(root: &VaultRoot) -> Vec<std::path::PathBuf> {
        crate::store::list_blobs(&root.vault_store_dir("notes").unwrap())
            .unwrap()
            .into_iter()
            .map(|(path, _)| path)
            .collect()
    }

    #[test]
    fn the_cost_changes_the_keys_stay_and_every_key_copy_is_the_headers() {
        let (_tmp, root) = notes();
        let store = root.vault_store_dir("notes").unwrap();
        let before = open_store(&store, PW).unwrap();
        let keys: Vec<KeyId> = before.keys.ids().collect();
        let content = *before.keys.write_content();
        drop(before);

        let result =
            change_vault_kdf(&root, "notes", PW, KdfUnlockPreset::M64, &test_job_id()).unwrap();
        assert_eq!(result.key_copies, KeyCopies::Done);
        let after = open_store(&store, PW).unwrap();
        assert_eq!(after.header.unlock_preset(), Some(KdfUnlockPreset::M64));
        assert_eq!(after.keys.ids().collect::<Vec<_>>(), keys);
        assert_eq!(*after.keys.write_content(), content);
        for blob in blobs(&root) {
            let prefix = read_prefix(&blob).unwrap();
            assert_eq!(prefix.generation, after.header.top.generation);
            assert_eq!(prefix.kdf.unlock_preset(), Some(KdfUnlockPreset::M64));
        }
        // It writes no backup, and the password did not change.
        assert!(crate::vault::list_backups(&root, "notes")
            .unwrap()
            .is_empty());
        let config = crate::config::load_vault_config(root.vault_dir("notes").unwrap()).unwrap();
        assert!(config.security.password_changed_at.is_none());
        drop(after);
        open_vault(&root, "notes", PW).unwrap();
        assert_eq!(fs_read_file(&root, "notes", "/a.txt").unwrap(), b"first");
        close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn the_cost_the_header_has_is_refused_before_any_unlock() {
        let (_tmp, root) = notes();
        let store = root.vault_store_dir("notes").unwrap();
        let before = dir_bytes(&store);
        let refused = change_vault_kdf(
            &root,
            "notes",
            b"not-the-password",
            KdfUnlockPreset::M32,
            &test_job_id(),
        );
        assert!(matches!(refused, Err(UprivError::UnlockRamUnchanged)));
        assert_eq!(dir_bytes(&store), before);
    }

    /// The change made, its pass stopped: both kinds of key copy open with
    /// the password, and the job after the next open finishes the pass.
    #[test]
    fn a_pass_left_by_a_stop_is_finished_by_the_job_after_the_next_open() {
        let (_tmp, root) = notes();
        let store = root.vault_store_dir("notes").unwrap();
        let earlier: Vec<Vec<u8>> = blobs(&root)
            .iter()
            .map(|blob| crate::host_fs::read(blob).unwrap())
            .collect();
        change_vault_kdf(&root, "notes", PW, KdfUnlockPreset::M64, &test_job_id()).unwrap();
        // As a pass that reached no blob leaves them: the earlier key copies.
        for (blob, bytes) in blobs(&root).iter().zip(&earlier) {
            let mut now = crate::host_fs::read(blob).unwrap();
            now[..crate::store::KEY_COPY_LEN as usize]
                .copy_from_slice(&bytes[..crate::store::KEY_COPY_LEN as usize]);
            crate::host_fs::write(blob, &now).unwrap();
        }
        let mut opened = open_store(&store, PW).unwrap();
        opened.index.key_copies_due = true;
        crate::store::flush_index_parts(&store, &opened.keys, &mut opened.index).unwrap();
        let header = opened.header;
        for blob in blobs(&root) {
            let copy = read_key_copy(&blob).unwrap();
            let kek = copy.prefix.kdf.derive_kek(PW).unwrap();
            assert!(copy.open(&kek).is_ok());
            assert!(copy.prefix.generation < header.top.generation);
        }

        open_vault(&root, "notes", PW).unwrap();
        let done = update_key_copies(&root, "notes", &test_job_id()).unwrap();
        assert_eq!(done, KeyCopies::Done);
        // Nothing left: the next call answers at once.
        assert_eq!(
            update_key_copies(&root, "notes", &test_job_id()).unwrap(),
            KeyCopies::Done
        );
        close_vault(&root, "notes").unwrap();
        let after = open_store(&store, PW).unwrap();
        assert!(!after.index.key_copies_due);
        for blob in blobs(&root) {
            assert_eq!(
                read_prefix(&blob).unwrap().generation,
                after.header.top.generation
            );
        }
    }

    #[test]
    fn a_stop_during_the_pass_is_not_a_cancel() {
        let (_tmp, root) = notes();
        let vault_dir = root.vault_dir("notes").unwrap();
        let mut store = with_unlock_lock(|| {
            unlock_counted(&vault_dir, PW, |unlocked| {
                steady(&vault_dir, "notes", unlocked)
            })
        })
        .unwrap();
        store.index.key_copies_due = true;
        let id = test_job_id();
        let job = Job::start(&id).unwrap();
        crate::session::cancel_job(&id).unwrap();
        assert_eq!(pass_closed(&mut store, &job).unwrap(), KeyCopies::Waiting);
        // It stopped before its seal: the index on disk is as it was.
        assert!(store.index.key_copies_due);
        drop(store);
        let on_disk = open_store(root.vault_store_dir("notes").unwrap(), PW).unwrap();
        assert!(!on_disk.index.key_copies_due);
    }

    /// The Backups window marks a backup that unlocks with less RAM than the
    /// vault; the change never touches the backup itself.
    #[test]
    fn a_backup_from_before_a_raise_is_marked_as_unlocking_with_less_ram() {
        let (_tmp, root) = notes();
        let before = crate::vault::save_backup_now(&root, "notes", &test_job_id()).unwrap();
        assert!(!before.entry.lower_unlock_ram);
        let bytes = crate::host_fs::read(&before.entry.path).unwrap();
        change_vault_kdf(&root, "notes", PW, KdfUnlockPreset::M64, &test_job_id()).unwrap();
        let after = crate::vault::save_backup_now(&root, "notes", &test_job_id()).unwrap();

        let listed = crate::vault::list_backups(&root, "notes").unwrap();
        let marked = |key: &str| {
            listed
                .iter()
                .find(|entry| entry.key == key)
                .unwrap()
                .lower_unlock_ram
        };
        assert!(marked(&before.entry.key));
        assert!(!marked(&after.entry.key));
        assert_eq!(crate::host_fs::read(&before.entry.path).unwrap(), bytes);

        // Lowering it back leaves neither marked.
        change_vault_kdf(&root, "notes", PW, KdfUnlockPreset::M32, &test_job_id()).unwrap();
        let lowered = crate::vault::list_backups(&root, "notes").unwrap();
        assert!(lowered.iter().all(|entry| !entry.lower_unlock_ram));
    }

    #[test]
    fn a_blob_whose_key_copy_does_not_flush_is_copied() {
        let (_tmp, root) = notes();
        let before = blobs(&root);
        crate::paths::fail_file_flushes(1);
        let result = change_vault_kdf(&root, "notes", PW, KdfUnlockPreset::M64, &test_job_id());
        crate::paths::fail_file_flushes(0);
        assert_eq!(result.unwrap().key_copies, KeyCopies::Done);
        let after = blobs(&root);
        assert_eq!(
            after.iter().filter(|blob| !before.contains(blob)).count(),
            1,
            "the blob whose flush failed has a copy"
        );
        let header = open_store(root.vault_store_dir("notes").unwrap(), PW)
            .unwrap()
            .header;
        for blob in &after {
            assert_eq!(read_prefix(blob).unwrap().generation, header.top.generation);
        }
        open_vault(&root, "notes", PW).unwrap();
        assert_eq!(fs_read_file(&root, "notes", "/a.txt").unwrap(), b"first");
        assert_eq!(fs_read_file(&root, "notes", "/b.txt").unwrap(), b"second");
        close_vault(&root, "notes").unwrap();
    }
}
