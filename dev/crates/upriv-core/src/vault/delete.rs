//! Traceless vault delete: unmount, drop session/lock/state, wipe, unlink.

use crate::config::{
    load_app_settings_at, load_vault_config, remove_vault_from_groups, save_app_settings,
    vault_config_path,
};
use crate::error::{Result, UprivError};
use crate::logging::{log_event, LogLevel};
use crate::paths::{VaultRoot, STORE_DIR_NAME};
use crate::session::{
    is_vault_closing_at, is_vault_open_at, is_vault_preparing_at, record_unlock_success,
    with_vault_dir_lock, ClosingGuard,
};
use crate::store::{HEADER_DIR_NAME, INDEX_DIR_NAME};

use super::wipe::{secure_wipe_path, WipeOptions};

fn refuse_if_busy(vault_dir: &std::path::Path) -> Result<()> {
    if is_vault_open_at(vault_dir)
        || is_vault_closing_at(vault_dir)
        || is_vault_preparing_at(vault_dir)
    {
        return Err(UprivError::VaultConfigBusy {
            target: "action.delete".into(),
        });
    }
    Ok(())
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
    let mut settings = loaded.settings;
    settings.app.last_opened_vault.clear();
    save_app_settings(root.root(), &settings)?;
    Ok(())
}

/// Delete `vaults/<id>/` after a secure wipe. Vault must be closed.
pub fn delete_vault(root: &VaultRoot, vault_id: &str) -> Result<()> {
    let vault_id = vault_id.trim();
    let vault_dir = root.vault_dir(vault_id)?;
    if !vault_dir.is_dir() {
        return Err(UprivError::VaultNotFound(vault_dir));
    }
    refuse_if_busy(&vault_dir)?;
    let _closing = ClosingGuard::enter(&vault_dir)?;
    with_vault_dir_lock(&vault_dir, || {
        if is_vault_open_at(&vault_dir) || is_vault_preparing_at(&vault_dir) {
            return Err(UprivError::VaultConfigBusy {
                target: "action.delete".into(),
            });
        }
        let config = load_vault_config(&vault_dir).ok();
        if let Some(mount) = crate::runtime_state::load_runtime_state(root)
            .ok()
            .and_then(|s| s.vaults.get(vault_id).cloned())
            .and_then(|e| e.mount_point)
        {
            let path = std::path::PathBuf::from(mount);
            if crate::mount::force_unmount(&path).is_ok() {
                let _ = std::fs::remove_dir(&path);
            }
        }
        let lock_path = root.runtime_lock_path(vault_id)?;
        // Hold the cross-process lock for the wipe. A live flock means another
        // Upriv still has this vault open; do not unlink that lock file.
        let _lock = crate::lockfile::acquire_vault_lock(lock_path)?;
        let _ = crate::runtime_state::mark_session_closed(root, vault_id);
        record_unlock_success(&vault_dir);

        let opts = config
            .as_ref()
            .map(WipeOptions::from_vault_config)
            .unwrap_or(WipeOptions {
                passes: 1,
                pattern: crate::config::vault_config::VaultWipePattern::Random,
            });
        remove_vault_tree(&vault_dir, &opts)?;
        let _ = remove_vault_from_groups(root, vault_id);
        let _ = clear_last_opened(root, vault_id);
        log_event(LogLevel::Info, "vault_deleted", &[("id", vault_id)]);
        Ok(())
    })
}

/// Overwrite the wrapped key and sealed index, then remove the vault directory.
///
/// Chunk files and backups are ciphertext. Rewriting every one of them is what
/// made delete outlast the settings wait and leave a folder with no
/// `config.toml`. Unlinking the tree after the key material is wiped removes
/// the vault completely.
fn remove_vault_tree(vault_dir: &std::path::Path, opts: &WipeOptions) -> Result<()> {
    let store = vault_dir.join(STORE_DIR_NAME);
    let _ = secure_wipe_path(&store.join(HEADER_DIR_NAME), opts);
    let _ = secure_wipe_path(&store.join(INDEX_DIR_NAME), opts);
    let _ = secure_wipe_path(&vault_config_path(vault_dir), opts);
    let _ = secure_wipe_path(&vault_dir.join("persistence.json"), opts);
    if vault_dir.exists() {
        std::fs::remove_dir_all(vault_dir)?;
    }
    if vault_dir.exists() {
        return Err(UprivError::VaultStoreInvalid {
            path: vault_dir.to_path_buf(),
            detail: "vault directory still exists after delete".into(),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::KdfUnlockPreset;
    use crate::test_support::vault_root_with;
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
    fn delete_wipes_closed_vault() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("gone", "Gone"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        let dir = root.vault_dir("gone").unwrap();
        assert!(dir.is_dir());
        std::fs::write(dir.join("leftover.bin"), vec![7u8; 4096]).unwrap();
        delete_vault(&root, "gone").unwrap();
        assert!(!dir.exists());
    }

    #[test]
    fn delete_refuses_when_another_process_holds_the_lock() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("held", "Held"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        let lock_path = root.runtime_lock_path("held").unwrap();
        let _lock = crate::lockfile::acquire_vault_lock(lock_path).unwrap();
        let err = delete_vault(&root, "held").unwrap_err();
        assert!(matches!(err, UprivError::VaultLocked(_)));
        assert!(root.vault_dir("held").unwrap().is_dir());
    }
}
