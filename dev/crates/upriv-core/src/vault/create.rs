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

/// Registry + Argon2id header + seed chunk. Import paths call this, stream
/// content in, then add the welcome note with [`super::welcome::seal_welcome_if_absent`].
pub fn create_vault(
    root: &VaultRoot,
    config: VaultConfig,
    password: &[u8],
    preset: KdfUnlockPreset,
) -> Result<()> {
    create_vault_with_welcome(root, config, password, preset, None)
}

/// Scratch create as the job `job_id`. The Argon2id wrap cannot be cut short:
/// a stop that arrives while it runs removes the new vault once it is made.
/// `for_import` keeps the vault recorded as unfinished until the import
/// session that fills it finishes ([`super::finish_import_session`]); a crash
/// before that deletes it at the next launch.
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
    Job::run(job_id, JobKind::VaultCreate, Some(&id), |job| {
        create_vault_with_welcome(root, config, password, preset, welcome)?;
        let kept = (|| {
            if for_import {
                record_import(root, &id)?;
            }
            job.final_step()
        })();
        kept.map_err(|error| abandon_failed_import(root, &id, error))
    })
}

/// Scratch create. `welcome` is sealed in the same pass as the seed chunk.
pub(super) fn create_vault_with_welcome(
    root: &VaultRoot,
    mut config: VaultConfig,
    password: &[u8],
    preset: KdfUnlockPreset,
    welcome: Option<VaultWelcome<'_>>,
) -> Result<()> {
    if password.is_empty() {
        return Err(UprivError::WrongPassword);
    }
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
            with_unlock_lock(|| create_seeded_store(&store, password, preset, &initial_files))?;
            crate::host_fs::create_dir_all(dest.join("backups"))?;
            let hash = content_hash_hex(&store)?;
            save_vault_persistence(
                &dest,
                &VaultPersistence::closed(
                    id.clone(),
                    config.vault.display_name.clone(),
                    Some(hash),
                ),
            )?;
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
pub(super) fn claim_new_vault_dir(root: &VaultRoot, dest: &Path) -> Result<PreparingGuard> {
    with_vault_registry_lock(|| {
        ensure_data_folder_export_idle(root.root())?;
        with_vault_dir_lock(dest, || match crate::host_fs::create_dir(dest) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == ErrorKind::AlreadyExists => {
                Err(UprivError::VaultAlreadyExists(dest.to_path_buf()))
            }
            Err(error) => Err(error.into()),
        })?;
        // The mark makes `rename_vault` of this id refuse during Argon2 seed.
        PreparingGuard::enter(dest).inspect_err(|_| {
            let _ = crate::host_fs::remove_dir_all(dest);
        })
    })
}
