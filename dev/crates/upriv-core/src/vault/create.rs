//! Create a new vault directory + `config.toml` + seeded `store/`.

use std::io::ErrorKind;

use crate::config::{save_vault_config, VaultConfig, VaultStorageMode};
use crate::error::{Result, UprivError};
use crate::logging::{log_event, LogLevel};
use crate::paths::VaultRoot;
use crate::session::{
    with_unlock_lock, with_vault_dir_lock, with_vault_registry_lock, PreparingGuard,
};
use crate::store::{content_hash_hex, create_seeded_store, KdfUnlockPreset};

use super::persistence::{save_vault_persistence, VaultPersistence};

/// Scratch create: registry + Argon2id header + seed chunk. Import/copy is later.
pub fn create_vault(
    root: &VaultRoot,
    mut config: VaultConfig,
    password: &[u8],
    preset: KdfUnlockPreset,
) -> Result<()> {
    if password.is_empty() {
        return Err(UprivError::WrongPassword);
    }
    if config.storage_mode() == VaultStorageMode::UprivPlain {
        return Err(UprivError::UprivPlainUnavailable);
    }
    // Folder is `vaults/<trimmed>/` (`vault_id_component`). Persist that same id
    // so list does not skip the row (`[vault].id` must match the directory name).
    let id = config.vault.id.trim().to_string();
    config.vault.id = id.clone();
    config.vault.display_name = crate::config::vault_config::normalize_and_validate_display_name(
        &config.vault.display_name,
    )?;
    let dest = root.vault_dir(&id)?;
    std::fs::create_dir_all(root.vaults_dir())?;
    // Registry lock only around `create_dir` so Argon2 does not block rename.
    with_vault_registry_lock(|| {
        with_vault_dir_lock(&dest, || match std::fs::create_dir(&dest) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == ErrorKind::AlreadyExists => {
                Err(UprivError::VaultAlreadyExists(dest.clone()))
            }
            Err(error) => Err(error.into()),
        })
    })?;
    // After mkdir so `rename_vault` of this id refuses during Argon2 seed.
    let _preparing = match PreparingGuard::enter(&dest) {
        Ok(guard) => guard,
        Err(error) => {
            let _ = std::fs::remove_dir_all(&dest);
            return Err(error);
        }
    };
    with_vault_dir_lock(&dest, || {
        let created: Result<()> = (|| {
            save_vault_config(&dest, &config)?;
            let store = dest.join(crate::paths::STORE_DIR_NAME);
            // Same process-wide Argon2 gate as `open_vault` — never two KDFs at once.
            with_unlock_lock(|| create_seeded_store(&store, password, preset))?;
            std::fs::create_dir_all(dest.join("backups"))?;
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
        if created.is_err() {
            let _ = std::fs::remove_dir_all(&dest);
        }
        created
    })?;
    log_event(LogLevel::Info, "vault_created", &[("id", id.as_str())]);
    if config.vault.hidden {
        log_event(LogLevel::Info, "vault_hidden", &[]);
    }
    Ok(())
}
