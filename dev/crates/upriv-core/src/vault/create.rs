//! Create a new vault directory + `config.toml` + seeded `store/`.

use std::io::ErrorKind;
use std::path::Path;

use crate::config::{save_vault_config, VaultConfig};
use crate::error::{Result, UprivError};
use crate::logging::{log_event, LogLevel};
use crate::paths::VaultRoot;
use crate::session::{
    ensure_data_folder_export_idle, with_unlock_lock, with_vault_dir_lock,
    with_vault_registry_lock, Job, JobKind, PreparingGuard,
};
use crate::store::{content_hash_hex, create_seeded_store, KdfUnlockPreset};

use super::open_close::abandon_failed_import;
use super::persistence::{save_vault_persistence, VaultPersistence};
use super::unfinished::{forget_import, record_import};
use super::welcome::VaultWelcome;

/// Registry + Argon2id header + seed chunk.
pub fn create_vault(
    root: &VaultRoot,
    config: VaultConfig,
    password: &[u8],
    preset: KdfUnlockPreset,
) -> Result<()> {
    create_vault_with_welcome(root, config, password, preset, None, NewVault::Complete)
}

/// Scratch create as the job `job_id`. The Argon2id wrap cannot be cut short:
/// a stop that arrives while it runs removes the new vault once it is made.
/// `for_import` makes it a vault an import session fills: it keeps its
/// `[importing]` mark until that session finishes
/// ([`super::finish_import_session`]).
pub fn create_vault_as_job(
    root: &VaultRoot,
    config: VaultConfig,
    password: &[u8],
    preset: KdfUnlockPreset,
    welcome: Option<VaultWelcome<'_>>,
    for_import: bool,
    job_id: &str,
) -> Result<()> {
    let id = config.vault.id.trim().to_string();
    let made = if for_import {
        NewVault::ForImport
    } else {
        NewVault::Complete
    };
    Job::run(job_id, JobKind::VaultCreate, Some(&id), |job| {
        create_vault_with_welcome(root, config, password, preset, welcome, made)?;
        job.final_step()
            .map_err(|error| abandon_failed_import(root, &id, error))
    })
}

/// What a new vault is once its create ends.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum NewVault {
    /// A vault as it is: every file it holds is in.
    Complete,
    /// A vault an import fills next, marked `[importing]` until it finishes.
    ForImport,
}

/// The marks of what a vault goes through are its own: a create starts with
/// none but the `[importing]` of an import, whatever settings it was given
/// (a backup's or an export's `config.toml` carries the source's marks).
pub(super) fn fresh_marks(config: &mut VaultConfig, made: NewVault) {
    config.deleting = None;
    config.importing = (made == NewVault::ForImport)
        .then(crate::config::vault_config::VaultImportingSection::begun_now);
}

/// Scratch create. `welcome` is sealed in the same pass as the seed chunk.
pub(super) fn create_vault_with_welcome(
    root: &VaultRoot,
    mut config: VaultConfig,
    password: &[u8],
    preset: KdfUnlockPreset,
    welcome: Option<VaultWelcome<'_>>,
    made: NewVault,
) -> Result<()> {
    if password.is_empty() {
        return Err(UprivError::WrongPassword);
    }
    fresh_marks(&mut config, made);
    let initial_files = match welcome {
        Some(welcome) => welcome.files()?.to_vec(),
        None => Vec::new(),
    };
    // Folder is `vaults/<trimmed>/` (`vault_id_component`). Persist that same id
    // so list does not skip the row (`[vault].id` must match the directory name).
    let id = config.vault.id.trim().to_string();
    config.vault.id = id.clone();
    config.vault.display_name = crate::config::vault_config::normalize_and_validate_display_name(
        &config.vault.display_name,
    )?;
    let dest = root.vault_dir(&id)?;
    crate::host_fs::create_dir_all(root.vaults_dir())?;
    let _preparing = claim_new_vault_dir(root, &dest)?;
    with_vault_dir_lock(&dest, || {
        let created: Result<()> = (|| {
            // A crash before the vault is complete leaves this record, and the
            // next launch deletes the folder.
            record_import(root, &id)?;
            save_vault_config(&dest, &config)?;
            let store = dest.join(crate::paths::STORE_DIR_NAME);
            // Same process-wide Argon2 gate as `open_vault` — never two KDFs at once.
            with_unlock_lock(|| {
                create_seeded_store(&store, password, preset, config.storage, &initial_files)
            })?;
            crate::host_fs::create_dir_all(dest.join("backups"))?;
            let hash = content_hash_hex(&store)?;
            let mut persistence =
                VaultPersistence::closed(id.clone(), config.vault.display_name.clone(), Some(hash));
            persistence.files_bytes = Some(
                initial_files
                    .iter()
                    .map(|(_, bytes)| bytes.len() as u64)
                    .fold(0, u64::saturating_add),
            );
            save_vault_persistence(&dest, &persistence)?;
            Ok(())
        })();
        let folder_gone = created.is_ok() || crate::host_fs::remove_dir_all(&dest).is_ok();
        if folder_gone {
            forget_import(root, &id);
        }
        created
    })?;
    log_event(LogLevel::Info, "vault_created", &[("id", id.as_str())]);
    if config.vault.hidden {
        log_event(LogLevel::Info, "vault_hidden", &[]);
    }
    Ok(())
}

/// Make `vaults/<id>/` and mark it preparing in one registry section. The
/// registry lock covers only that, so Argon2 does not block rename. A
/// data-folder export takes the same section: it either sees this vault on
/// its way in, or this create refuses while the export runs.
/// True when `dir` is an empty vault folder no create is setting up: what a
/// delete leaves when it stops between its last two steps. Its id is free.
pub(crate) fn vault_folder_is_free(dir: &Path) -> bool {
    !crate::session::is_vault_preparing_at(dir)
        && crate::host_fs::read_dir(dir).is_ok_and(|mut entries| entries.next().is_none())
}

pub(super) fn claim_new_vault_dir(root: &VaultRoot, dest: &Path) -> Result<PreparingGuard> {
    with_vault_registry_lock(|| {
        ensure_data_folder_export_idle(root.root())?;
        with_vault_dir_lock(dest, || match crate::host_fs::create_dir(dest) {
            Ok(()) => Ok(()),
            Err(error)
                if error.kind() == ErrorKind::AlreadyExists && vault_folder_is_free(dest) =>
            {
                Ok(())
            }
            Err(error) if error.kind() == ErrorKind::AlreadyExists => {
                Err(UprivError::VaultAlreadyExists(dest.to_path_buf()))
            }
            Err(error) => Err(error.into()),
        })?;
        // The mark makes `rename_vault` of this id refuse during Argon2 seed.
        Ok(PreparingGuard::enter(dest))
    })
}
