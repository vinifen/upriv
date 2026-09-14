//! Create a new vault directory + `config.toml` + seeded `contents/`.

use std::io::ErrorKind;

use crate::config::{save_vault_config, VaultConfig, VaultStorageMode};
use crate::contents::{content_hash_hex, create_seeded_store, KdfUnlockPreset};
use crate::error::{Result, UprivError};
use crate::logging::{log_event, LogLevel};
use crate::paths::VaultRoot;
use crate::session::{with_unlock_lock, with_vault_dir_lock};

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
    let dest = root.vault_dir(&id)?;
    std::fs::create_dir_all(root.vaults_dir())?;
    with_vault_dir_lock(&dest, || {
        match std::fs::create_dir(&dest) {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::AlreadyExists => {
                return Err(UprivError::VaultAlreadyExists(dest.clone()));
            }
            Err(error) => return Err(error.into()),
        }
        let created: Result<()> = (|| {
            save_vault_config(&dest, &config)?;
            let contents = dest.join("contents");
            // Same process-wide Argon2 gate as `open_vault` — never two KDFs at once.
            with_unlock_lock(|| create_seeded_store(&contents, password, preset))?;
            std::fs::create_dir_all(dest.join("backups"))?;
            let hash = content_hash_hex(&contents)?;
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
