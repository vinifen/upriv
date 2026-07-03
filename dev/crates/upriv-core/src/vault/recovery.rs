//! Vault recovery: detect `.7z` ↔ store divergence and resolve (RF-48 / RF-57).

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::config::{
    load_app_settings, load_vault_config, PersistenceState, StorageMode, VaultConfig,
    VaultPersistence,
};
use crate::encrypted_dir::{sync_archive_from_store, sync_store_from_archive};
use crate::error::{Result, UprivError};
use crate::paths::VaultRoot;
use crate::plain::wipe_workspace;
use crate::seven_zip::SevenZip;
use crate::store::compute_store_hash;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecoveryAction {
    UseStore,
    ReimportArchive,
    DiscardWorkspace,
}

/// Recovery assessment returned to the UI (compare view + list status).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryInfo {
    pub needs_recovery: bool,
    pub manifest_archive_hash: String,
    pub actual_archive_hash: String,
    pub manifest_store_hash: Option<String>,
    pub actual_store_hash: Option<String>,
    pub last_close_ok_at: Option<String>,
    pub last_store_write_at: Option<String>,
    pub sync_generation: u64,
    pub orphan_workspace: bool,
    pub archive_hash_mismatch: bool,
    pub store_hash_mismatch: bool,
    pub store_ahead_of_close: bool,
}

/// True when the vault should show `session: recovery` in the list (vault not open).
pub fn needs_recovery(root: &VaultRoot, vault_id: &str) -> Result<bool> {
    Ok(assess_recovery(root, vault_id)?.needs_recovery)
}

pub fn assess_recovery(root: &VaultRoot, vault_id: &str) -> Result<RecoveryInfo> {
    let config = load_vault_config(root, vault_id)?;
    let settings = load_app_settings(root)?;
    let persistence = load_persistence(root, vault_id, &config);
    let is_open = root.runtime_lock_path(vault_id).is_file();

    let workspace = root.workspace_dir(&settings, &config.vault.display_name);
    let orphan_workspace = !is_open && workspace_is_nonempty(&workspace)?;

    if is_open {
        return Ok(RecoveryInfo {
            needs_recovery: false,
            manifest_archive_hash: persistence.archive_hash.clone(),
            actual_archive_hash: sha256_file_if_exists(&root.vault_archive_path(&config))
                .unwrap_or_default(),
            manifest_store_hash: persistence.store_hash.clone(),
            actual_store_hash: store_hash_if_present(root, &config),
            last_close_ok_at: persistence.last_close_ok_at.clone(),
            last_store_write_at: persistence.last_store_write_at.clone(),
            sync_generation: persistence.sync_generation,
            orphan_workspace,
            archive_hash_mismatch: false,
            store_hash_mismatch: false,
            store_ahead_of_close: false,
        });
    }

    match config.storage.mode {
        StorageMode::Plain => Ok(RecoveryInfo {
            needs_recovery: orphan_workspace,
            manifest_archive_hash: persistence.archive_hash.clone(),
            actual_archive_hash: sha256_file_if_exists(&root.vault_archive_path(&config))
                .unwrap_or_default(),
            manifest_store_hash: None,
            actual_store_hash: None,
            last_close_ok_at: persistence.last_close_ok_at.clone(),
            last_store_write_at: persistence.last_store_write_at.clone(),
            sync_generation: persistence.sync_generation,
            orphan_workspace,
            archive_hash_mismatch: false,
            store_hash_mismatch: false,
            store_ahead_of_close: false,
        }),
        StorageMode::EncryptedDir => assess_encrypted_dir(root, &config, &persistence, orphan_workspace),
    }
}

fn assess_encrypted_dir(
    root: &VaultRoot,
    config: &VaultConfig,
    persistence: &VaultPersistence,
    orphan_workspace: bool,
) -> Result<RecoveryInfo> {
    let archive_path = root.vault_archive_path(config);
    let store_dir = root.vault_store_dir(config);
    let has_archive = archive_path.is_file();
    let has_store = store_dir.join("vault.header").is_file();

    let actual_archive_hash = sha256_file_if_exists(&archive_path).unwrap_or_default();
    let actual_store_hash = store_hash_if_present(root, config);

    let archive_hash_mismatch = has_archive
        && !persistence.archive_hash.is_empty()
        && persistence.archive_hash != actual_archive_hash;

    let store_hash_mismatch = match (&persistence.store_hash, &actual_store_hash) {
        (Some(manifest), Some(actual)) if has_store => manifest != actual,
        _ => false,
    };

    let store_ahead_of_close = match (
        &persistence.last_store_write_at,
        &persistence.last_close_ok_at,
    ) {
        (Some(write), Some(close)) => write > close,
        _ => false,
    };

    // Store without archive, or archive without store while manifest says closed.
    let partial_layout = (has_store && !has_archive)
        || (!has_store
            && has_archive
            && persistence.persistence == PersistenceState::Closed);

    let needs_recovery = orphan_workspace
        || archive_hash_mismatch
        || store_hash_mismatch
        || store_ahead_of_close
        || partial_layout;

    Ok(RecoveryInfo {
        needs_recovery,
        manifest_archive_hash: persistence.archive_hash.clone(),
        actual_archive_hash,
        manifest_store_hash: persistence.store_hash.clone(),
        actual_store_hash,
        last_close_ok_at: persistence.last_close_ok_at.clone(),
        last_store_write_at: persistence.last_store_write_at.clone(),
        sync_generation: persistence.sync_generation,
        orphan_workspace,
        archive_hash_mismatch,
        store_hash_mismatch,
        store_ahead_of_close,
    })
}

pub fn resolve_recovery(
    root: &VaultRoot,
    vault_id: &str,
    password: &str,
    action: RecoveryAction,
    seven_zip: &SevenZip,
) -> Result<()> {
    if root.runtime_lock_path(vault_id).is_file() {
        return Err(UprivError::VaultAlreadyOpen(vault_id.to_string()));
    }

    let config = load_vault_config(root, vault_id)?;

    match action {
        RecoveryAction::UseStore => {
            if config.storage.mode != StorageMode::EncryptedDir {
                return Err(UprivError::StorageModeMismatch {
                    expected: "encrypted_dir".to_string(),
                    actual: format!("{:?}", config.storage.mode),
                });
            }
            sync_archive_from_store(root, vault_id, password, seven_zip)?;
        }
        RecoveryAction::ReimportArchive => {
            if config.storage.mode != StorageMode::EncryptedDir {
                return Err(UprivError::StorageModeMismatch {
                    expected: "encrypted_dir".to_string(),
                    actual: format!("{:?}", config.storage.mode),
                });
            }
            sync_store_from_archive(root, vault_id, password, seven_zip)?;
        }
        RecoveryAction::DiscardWorkspace => {
            discard_orphan_workspace(root, &config)?;
        }
    }
    Ok(())
}

fn discard_orphan_workspace(root: &VaultRoot, config: &VaultConfig) -> Result<()> {
    let settings = load_app_settings(root)?;
    let workspace = root.workspace_dir(&settings, &config.vault.display_name);
    if !workspace.exists() {
        return Ok(());
    }
    match config.storage.mode {
        StorageMode::Plain => wipe_workspace(&workspace, &config.security)?,
        StorageMode::EncryptedDir => {
            fs::remove_dir_all(&workspace)?;
        }
    }
    // Release a stale lock left from a crashed session.
    let lock = root.runtime_lock_path(&config.vault.id);
    if lock.is_file() {
        fs::remove_file(lock)?;
    }
    Ok(())
}

fn load_persistence(root: &VaultRoot, vault_id: &str, config: &VaultConfig) -> VaultPersistence {
    let path = root.vault_persistence_path(vault_id);
    if path.is_file() {
        if let Ok(raw) = std::fs::read_to_string(&path) {
            if let Ok(parsed) = serde_json::from_str::<VaultPersistence>(&raw) {
                return parsed;
            }
        }
    }
    VaultPersistence {
        format_version: 1,
        vault_id: config.vault.id.clone(),
        display_name: config.vault.display_name.clone(),
        sync_generation: 0,
        archive_hash: String::new(),
        last_close_ok_at: None,
        store_hash: None,
        last_store_write_at: None,
        persistence: PersistenceState::Sealed,
    }
}

fn store_hash_if_present(root: &VaultRoot, config: &VaultConfig) -> Option<String> {
    let store_dir = root.vault_store_dir(config);
    if store_dir.join("vault.header").is_file() {
        compute_store_hash(&store_dir).ok()
    } else {
        None
    }
}

fn sha256_file_if_exists(path: &Path) -> Result<String> {
    if !path.is_file() {
        return Ok(String::new());
    }
    let bytes = fs::read(path)?;
    let digest = Sha256::digest(bytes);
    Ok(format!("sha256:{digest:x}"))
}

fn workspace_is_nonempty(path: &Path) -> Result<bool> {
    if !path.is_dir() {
        return Ok(false);
    }
    Ok(fs::read_dir(path)?.next().is_some())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::create_vault;
    use crate::encrypted_dir::{close, open};
    use crate::SevenZip;
    use tempfile::tempdir;

    fn write_settings(root: &std::path::Path) {
        fs::create_dir_all(root.join(".upriv")).unwrap();
        fs::write(
            root.join(".upriv/settings.toml"),
            "[package]\nvaults_dir = \".upriv/vaults\"\nworkspace_dir = \"workspace\"\napp_dir = \".upriv/app\"\n",
        )
        .unwrap();
    }

    fn encrypted_config(id: &str, name: &str) -> VaultConfig {
        let toml = format!(
            "[vault]\nid = \"{id}\"\ndisplay_name = \"{name}\"\nvault_file = \"archive/{name}.7z\"\n\n[storage]\nmode = \"encrypted_dir\"\n"
        );
        toml::from_str(&toml).unwrap()
    }

    fn resolve_7z() -> Option<std::path::PathBuf> {
        let out = std::process::Command::new("which").arg("7z").output().ok()?;
        out.status
            .success()
            .then(|| std::path::PathBuf::from(String::from_utf8_lossy(&out.stdout).trim()))
    }

    #[test]
    #[cfg(debug_assertions)]
    fn orphan_workspace_triggers_recovery() {
        let Some(binary) = resolve_7z() else {
            return;
        };
        let temp = tempdir().unwrap();
        write_settings(temp.path());
        let root = VaultRoot::discover(temp.path()).unwrap();
        let seven_zip = SevenZip::from_binary(&binary);
        create_vault(&root, encrypted_config("notes", "Notes"), "pw", &seven_zip).unwrap();

        let session = open(&root, "notes", "pw", &seven_zip).unwrap();
        close(&root, session, false, &seven_zip).unwrap();

        // Simulate a crash leaving a stale plaintext workspace behind.
        let settings = load_app_settings(&root).unwrap();
        let config = load_vault_config(&root, "notes").unwrap();
        let ws = root.workspace_dir(&settings, &config.vault.display_name);
        fs::create_dir_all(&ws).unwrap();
        fs::write(ws.join("stale.txt"), b"left behind").unwrap();

        let info = assess_recovery(&root, "notes").unwrap();
        assert!(info.orphan_workspace);
        assert!(info.needs_recovery);

        resolve_recovery(
            &root,
            "notes",
            "pw",
            RecoveryAction::DiscardWorkspace,
            &seven_zip,
        )
        .unwrap();
        assert!(!needs_recovery(&root, "notes").unwrap());
    }

    #[test]
    #[cfg(debug_assertions)]
    fn use_store_realigns_archive() {
        let Some(binary) = resolve_7z() else {
            return;
        };
        let temp = tempdir().unwrap();
        write_settings(temp.path());
        let root = VaultRoot::discover(temp.path()).unwrap();
        let config = encrypted_config("notes", "Notes");
        let seven_zip = SevenZip::from_binary(&binary);
        create_vault(&root, config.clone(), "pw", &seven_zip).unwrap();

        let session = open(&root, "notes", "pw", &seven_zip).unwrap();
        close(&root, session, false, &seven_zip).unwrap();

        // Simulate manifest drift (e.g. partial copy).
        let path = root.vault_persistence_path("notes");
        let mut persistence: VaultPersistence =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        persistence.archive_hash = "sha256:deadbeef".into();
        fs::write(path, serde_json::to_string_pretty(&persistence).unwrap()).unwrap();

        assert!(needs_recovery(&root, "notes").unwrap());

        resolve_recovery(
            &root,
            "notes",
            "pw",
            RecoveryAction::UseStore,
            &seven_zip,
        )
        .unwrap();
        assert!(!needs_recovery(&root, "notes").unwrap());
    }
}
