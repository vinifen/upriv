//! The Storage change of a closed vault: its storage value, sealed in the
//! index with the password, then copied into `config.toml`.
//!
//! In order, as one job:
//!
//! 1. A choice equal to the copy is refused from `config.toml` alone, before
//!    any unlock: the screen starts from the copy.
//! 2. The password unlocks the store under the unlock limit, and blobs no
//!    file names are set aside. Argon2id cannot be cut short: a stop during
//!    it lands right after it, with nothing written.
//! 3. The index is sealed with the chosen value and the store's hash
//!    recorded, then the copy is written: a step a stop cannot enter.
//!
//! No file is converted: `store/` is ciphertext in both modes, and the mode
//! only says where the unlocked files appear while the vault is open. A crash
//! between the two writes leaves the values disagreeing, which the next open
//! resets to encrypted with no unlocked folder: plain text turned off stays
//! off, and plain text turned on is turned on again.

use serde::Serialize;

use crate::config::{load_vault_config, save_vault_config};
use crate::error::{Result, UprivError};
use crate::logging::{log_event, LogLevel};
use crate::paths::VaultRoot;
use crate::session::{with_unlock_lock, Job, JobKind, JobStep};
use crate::store::VaultStorage;

use super::closed_store::{steady, unlock_counted, with_closed_vault};

/// What a Storage change stored.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageChangeResult {
    pub storage: VaultStorage,
}

/// Make `storage` the storage value of the closed vault `vault_id`, as the
/// job `job_id`. `password` is the vault's.
pub fn change_vault_storage(
    root: &VaultRoot,
    vault_id: &str,
    password: &[u8],
    storage: VaultStorage,
    job_id: &str,
) -> Result<StorageChangeResult> {
    Job::run(job_id, JobKind::StorageChange, Some(vault_id), |job| {
        change_storage(root, vault_id, password, storage, job)
    })
}

fn change_storage(
    root: &VaultRoot,
    vault_id: &str,
    password: &[u8],
    storage: VaultStorage,
    job: &Job,
) -> Result<StorageChangeResult> {
    with_closed_vault(root, vault_id, |vault_dir| {
        let mut config = load_vault_config(vault_dir)?;
        if config.storage == storage {
            return Err(UprivError::StorageUnchanged);
        }
        job.set_step(JobStep::Unlocking);
        let mut store = with_unlock_lock(|| {
            unlock_counted(vault_dir, password, |unlocked| {
                steady(vault_dir, vault_id, unlocked)
            })
        })?;
        job.ensure_running()?;
        store.settle()?;
        job.final_step()?;
        job.set_step(JobStep::Finishing);
        store.index.storage = storage;
        store.seal(Vec::new())?;
        config.storage = storage;
        save_vault_config(vault_dir, &config)?;
        log_event(
            LogLevel::Info,
            "vault_storage_changed",
            &[
                ("id", vault_id),
                ("mode", storage.mode.as_str()),
                ("plain_files", storage.plain_files.as_str()),
            ],
        );
        Ok(StorageChangeResult { storage })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::{open_store, KdfUnlockPreset, VaultPlainFiles, VaultStorageMode};
    use crate::test_support::{quiet_config, test_job_id, unlocked_rows, vault_root_with};
    use crate::vault::{close_vault, create_vault, open_vault, StorageReset};

    const PW: &[u8] = b"pass-word-ok";

    const PLAIN_WHOLE: VaultStorage = VaultStorage {
        mode: VaultStorageMode::UprivPlain,
        plain_files: VaultPlainFiles::Whole,
    };

    /// A closed encrypted vault `notes` with an unlocked folder row on this
    /// device, and the folder a plain-text open of it fills.
    fn notes() -> (tempfile::TempDir, VaultRoot, std::path::PathBuf) {
        let (tmp, root) = vault_root_with(&[]);
        let places = tmp.path().join("places");
        crate::host_fs::create_dir_all(&places).unwrap();
        let mut config = quiet_config("notes", "Notes");
        unlocked_rows(&mut config, &[&places]);
        create_vault(&root, config, PW, KdfUnlockPreset::M32).unwrap();
        let folder = places
            .join(crate::folder_list::UNLOCKED_CONTAINER)
            .join("Notes");
        (tmp, root, folder)
    }

    fn change(root: &VaultRoot, password: &[u8], storage: VaultStorage) -> Result<VaultStorage> {
        change_vault_storage(root, "notes", password, storage, &test_job_id())
            .map(|result| result.storage)
    }

    fn copy(root: &VaultRoot) -> VaultStorage {
        load_vault_config(root.vault_dir("notes").unwrap())
            .unwrap()
            .storage
    }

    fn sealed(root: &VaultRoot) -> VaultStorage {
        open_store(root.vault_store_dir("notes").unwrap(), PW)
            .unwrap()
            .index
            .storage
    }

    #[test]
    fn the_chosen_value_is_sealed_and_copied_and_the_next_open_follows_it() {
        let (_tmp, root, folder) = notes();
        assert_eq!(change(&root, PW, PLAIN_WHOLE).unwrap(), PLAIN_WHOLE);
        assert_eq!(copy(&root), PLAIN_WHOLE);
        assert_eq!(sealed(&root), PLAIN_WHOLE);
        let opened = open_vault(&root, "notes", PW).unwrap();
        assert_eq!(opened.storage_reset, None);
        assert!(folder.is_dir());
        close_vault(&root, "notes").unwrap();

        assert_eq!(
            change(&root, PW, VaultStorage::default()).unwrap(),
            VaultStorage::default()
        );
        assert_eq!(copy(&root), VaultStorage::default());
        assert_eq!(sealed(&root), VaultStorage::default());
    }

    #[test]
    fn a_choice_equal_to_the_copy_is_refused_before_the_password_is_checked() {
        let (_tmp, root, _folder) = notes();
        assert!(matches!(
            change(&root, b"not-the-password", VaultStorage::default()),
            Err(UprivError::StorageUnchanged)
        ));
        let dir = root.vault_dir("notes").unwrap();
        crate::session::check_unlock_allowed(&dir).expect("no failed unlock was counted");
    }

    #[test]
    fn a_wrong_password_writes_nothing() {
        let (_tmp, root, _folder) = notes();
        assert!(matches!(
            change(&root, b"not-the-password", PLAIN_WHOLE),
            Err(UprivError::WrongPassword)
        ));
        assert_eq!(copy(&root), VaultStorage::default());
        assert_eq!(sealed(&root), VaultStorage::default());
    }

    #[test]
    fn an_open_vault_is_refused() {
        let (_tmp, root, _folder) = notes();
        open_vault(&root, "notes", PW).unwrap();
        assert!(matches!(
            change(&root, PW, PLAIN_WHOLE),
            Err(UprivError::VaultMustBeClosed)
        ));
        close_vault(&root, "notes").unwrap();
        assert_eq!(copy(&root), VaultStorage::default());
    }

    /// A stop that comes while Argon2id runs lands once it ends, before
    /// anything is written.
    #[test]
    fn a_stop_during_the_unlock_writes_nothing() {
        let (_tmp, root, _folder) = notes();
        let id = test_job_id();
        let job = Job::start(&id).unwrap();
        crate::session::cancel_job(&id).unwrap();
        assert!(matches!(
            change_storage(&root, "notes", PW, PLAIN_WHOLE, &job),
            Err(UprivError::JobCancelled)
        ));
        assert_eq!(copy(&root), VaultStorage::default());
        assert_eq!(sealed(&root), VaultStorage::default());
    }

    #[test]
    fn a_vault_being_deleted_is_refused() {
        let (_tmp, root, _folder) = notes();
        let dir = root.vault_dir("notes").unwrap();
        let mut config = load_vault_config(&dir).unwrap();
        config.deleting = Some(crate::config::vault_config::VaultDeletingSection {
            outside_backups: false,
        });
        save_vault_config(&dir, &config).unwrap();
        assert!(matches!(
            change(&root, PW, PLAIN_WHOLE),
            Err(UprivError::VaultDeleting)
        ));
    }

    /// The password change and the unlock-RAM change reseal the index with
    /// the value it holds, so a plain-text vault still opens plain after both.
    #[test]
    fn the_key_changes_carry_the_storage_value() {
        let (_tmp, root, folder) = notes();
        change(&root, PW, PLAIN_WHOLE).unwrap();
        let next: &[u8] = b"next-pass-ok";
        crate::vault::change_vault_password(&root, "notes", PW, next, false, &test_job_id())
            .unwrap();
        crate::vault::change_vault_kdf(&root, "notes", next, KdfUnlockPreset::M64, &test_job_id())
            .unwrap();
        let opened = open_vault(&root, "notes", next).unwrap();
        assert_eq!(opened.storage_reset, None);
        assert!(folder.is_dir());
        close_vault(&root, "notes").unwrap();
    }

    /// A crash after the index write leaves the copy as it was: the next
    /// open finds the two disagreeing and opens encrypted.
    #[test]
    fn a_crash_between_the_two_writes_leaves_a_disagreement_the_next_open_resets() {
        let (_tmp, root, folder) = notes();
        let dir = root.vault_dir("notes").unwrap();
        let config_path = crate::config::vault_config_path(&dir);
        let before = std::fs::read(&config_path).unwrap();
        change(&root, PW, PLAIN_WHOLE).unwrap();
        std::fs::write(&config_path, before).unwrap();
        assert_eq!(copy(&root), VaultStorage::default());
        assert_eq!(sealed(&root), PLAIN_WHOLE);

        let opened = open_vault(&root, "notes", PW).unwrap();
        assert_eq!(opened.storage_reset, Some(StorageReset::Saved));
        assert!(!folder.exists());
        close_vault(&root, "notes").unwrap();
        assert_eq!(sealed(&root), VaultStorage::default());
    }
}
