use std::fs;
use std::path::Path;
use std::time::SystemTime;

use sha2::{Digest, Sha256};

use crate::config::{
    discover_vault_ids, load_app_settings, save_vault_config, PersistenceState, StorageMode,
    VaultConfig, VaultPersistence,
};
use crate::encrypted_dir::initialize_store;
use crate::error::{Result, UprivError};
use crate::paths::VaultRoot;
use crate::seven_zip::SevenZip;
use crate::store::compute_store_hash;

/// Create a new vault from scratch: layout on disk + first encrypted `.7z`.
pub fn create_vault(
    root: &VaultRoot,
    config: VaultConfig,
    password: &str,
    seven_zip: &SevenZip,
) -> Result<()> {
    if password.is_empty() {
        return Err(UprivError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "vault password must not be empty",
        )));
    }

    validate_new_vault(root, &config)?;

    let vault_id = config.vault.id.clone();
    let vault_dir = root.vault_dir(&vault_id);
    fs::create_dir_all(vault_dir.join("archive"))?;
    fs::create_dir_all(vault_dir.join(&config.vault.backups_dir))?;
    if config.storage.mode == StorageMode::EncryptedDir {
        fs::create_dir_all(root.vault_store_dir(&config))?;
    }

    save_vault_config(root, &vault_id, &config)?;

    let archive_path = root.vault_archive_path(&config);
    let staging = tempfile::tempdir()?;
    let welcome = format!(
        "Upriv vault — {}\nCreated by Upriv.\n",
        config.vault.display_name
    );
    fs::write(staging.path().join("README.txt"), &welcome)?;

    if config.storage.mode == StorageMode::EncryptedDir {
        initialize_store(
            &root.vault_store_dir(&config),
            &vault_id,
            password,
            "README.txt",
            welcome.as_bytes(),
        )?;
    }

    let seven_zip = seven_zip.clone().with_vault_options(&config);
    seven_zip.create_from_dir(staging.path(), &archive_path, password)?;
    seven_zip.test(&archive_path, password)?;

    write_initial_persistence(root, &config, &archive_path)?;

    Ok(())
}

fn validate_new_vault(root: &VaultRoot, config: &VaultConfig) -> Result<()> {
    let vault_id = &config.vault.id;
    if config.vault.display_name.trim().is_empty() {
        return Err(UprivError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "vault display_name must not be empty",
        )));
    }

    if root.vault_dir(vault_id).exists() {
        return Err(UprivError::VaultAlreadyExists(vault_id.clone()));
    }

    let ids = discover_vault_ids(root)?;
    if ids.iter().any(|id| id == vault_id) {
        return Err(UprivError::VaultAlreadyExists(vault_id.clone()));
    }

    let settings = load_app_settings(root)?;
    let workspace = root.workspace_dir(&settings, &config.vault.display_name);
    if workspace.exists() {
        return Err(UprivError::WorkspaceExists(workspace));
    }

    Ok(())
}

fn write_initial_persistence(
    root: &VaultRoot,
    config: &VaultConfig,
    archive_path: &Path,
) -> Result<()> {
    let now = iso8601_now();
    let store_hash = if config.storage.mode == StorageMode::EncryptedDir {
        Some(compute_store_hash(&root.vault_store_dir(config))?)
    } else {
        None
    };
    let persistence = VaultPersistence {
        format_version: 1,
        vault_id: config.vault.id.clone(),
        display_name: config.vault.display_name.clone(),
        sync_generation: 1,
        archive_hash: sha256_file(archive_path)?,
        last_close_ok_at: Some(now.clone()),
        store_hash: store_hash.clone(),
        last_store_write_at: store_hash.map(|_| now.clone()),
        persistence: PersistenceState::Sealed,
    };

    let path = root.vault_persistence_path(&config.vault.id);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_string_pretty(&persistence)?)?;
    Ok(())
}

fn sha256_file(path: &Path) -> Result<String> {
    let bytes = fs::read(path)?;
    let digest = Sha256::digest(bytes);
    Ok(format!("sha256:{digest:x}"))
}

fn iso8601_now() -> String {
    let duration = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}Z", duration.as_secs())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::seven_zip::SevenZip;
    use std::path::Path;
    use tempfile::tempdir;

    fn write_minimal_settings(root: &Path) {
        fs::create_dir_all(root.join(".upriv")).unwrap();
        fs::write(
            root.join(".upriv/settings.toml"),
            r#"
[package]
vaults_dir = ".upriv/vaults"
workspace_dir = "workspace"
app_dir = ".upriv/app"
"#,
        )
        .unwrap();
    }

    fn sample_config(vault_id: &str, display_name: &str) -> VaultConfig {
        let toml = format!(
            r#"
[vault]
id = "{vault_id}"
display_name = "{display_name}"
order = 1
vault_file = "archive/{display_name}.7z"

[storage]
mode = "encrypted_dir"

[security]
mode = "session_ram"
"#
        );
        toml::from_str(&toml).unwrap()
    }

    fn resolve_7z() -> Option<std::path::PathBuf> {
        if let Ok(path) = std::env::var("UPRIV_7ZZ_PATH") {
            return Some(path.into());
        }
        which_7z()
    }

    fn which_7z() -> Option<std::path::PathBuf> {
        let output = std::process::Command::new("which")
            .arg("7z")
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        Some(std::path::PathBuf::from(
            String::from_utf8_lossy(&output.stdout).trim(),
        ))
    }

    #[test]
    fn rejects_duplicate_vault_id() {
        let Some(binary) = resolve_7z() else {
            eprintln!("skipping rejects_duplicate_vault_id: 7z not found");
            return;
        };

        let temp = tempdir().unwrap();
        write_minimal_settings(temp.path());
        let root = VaultRoot::discover(temp.path()).unwrap();
        let config = sample_config("notes", "My Notes");
        let seven_zip = SevenZip::from_binary(&binary);

        create_vault(&root, config.clone(), "secret", &seven_zip).unwrap();

        let dup = create_vault(&root, config, "secret", &seven_zip).unwrap_err();
        assert!(matches!(dup, UprivError::VaultAlreadyExists(_)));
    }

    #[test]
    fn creates_vault_layout_and_archive() {
        let Some(binary) = resolve_7z() else {
            eprintln!("skipping creates_vault_layout_and_archive: 7z not found");
            return;
        };

        let temp = tempdir().unwrap();
        write_minimal_settings(temp.path());
        let root = VaultRoot::discover(temp.path()).unwrap();
        let config = sample_config("notes", "My Notes");
        let seven_zip = SevenZip::from_binary(&binary);

        create_vault(&root, config, "secret-pass", &seven_zip).unwrap();

        assert!(root.vault_config_path("notes").is_file());
        assert!(root.vault_persistence_path("notes").is_file());
        let archive = root
            .vault_dir("notes")
            .join("archive")
            .join("My Notes.7z");
        assert!(archive.is_file());
        seven_zip.test(&archive, "secret-pass").unwrap();
    }
}
