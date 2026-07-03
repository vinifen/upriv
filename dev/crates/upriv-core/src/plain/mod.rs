mod wipe;

use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use sha2::{Digest, Sha256};

pub use wipe::{secure_wipe_path, wipe_workspace, WipeOptions};

use crate::config::{
    load_app_settings, load_vault_config, PersistenceState, StorageMode, VaultConfig,
    VaultPersistence,
};
use crate::error::{Result, UprivError};
use crate::paths::VaultRoot;
use crate::session::SessionPassword;
use crate::seven_zip::SevenZip;

/// Active `plain` mode session — password stays in RAM until close.
pub struct PlainSession {
    pub vault_id: String,
    pub display_name: String,
    pub workspace_path: PathBuf,
    pub archive_path: PathBuf,
    password: SessionPassword,
}

impl PlainSession {
    pub fn password(&self) -> &SessionPassword {
        &self.password
    }
}

/// Open a `plain` vault: validate archive, extract to `workspace/{display_name}/`.
pub fn open(
    root: &VaultRoot,
    vault_id: &str,
    password: impl Into<SessionPassword>,
    seven_zip: &SevenZip,
) -> Result<PlainSession> {
    let settings = load_app_settings(root)?;
    let config = load_vault_config(root, vault_id)?;
    ensure_plain_mode(&config)?;

    let archive_path = root.vault_archive_path(&config);
    if !archive_path.is_file() {
        return Err(UprivError::ArchiveNotFound(archive_path));
    }

    let workspace_path = root.workspace_dir(&settings, &config.vault.display_name);
    if workspace_path.exists() {
        return Err(UprivError::WorkspaceExists(workspace_path));
    }

    let password = password.into();
    let password_str = password
        .as_str()
        .ok_or_else(|| {
            UprivError::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "vault password must be valid UTF-8",
            ))
        })?;

    seven_zip.test(&archive_path, password_str)?;
    seven_zip.extract(&archive_path, &workspace_path, password_str)?;

    acquire_lock(root, vault_id)?;

    let _ = crate::session::persist_disk_session(root, vault_id, &password);

    Ok(PlainSession {
        vault_id: vault_id.to_string(),
        display_name: config.vault.display_name.clone(),
        workspace_path,
        archive_path,
        password,
    })
}

/// Close an open `plain` vault by id (password must match the open session).
pub fn close_by_id(
    root: &VaultRoot,
    vault_id: &str,
    password: impl Into<SessionPassword>,
    seven_zip: &SevenZip,
) -> Result<()> {
    let settings = load_app_settings(root)?;
    let config = load_vault_config(root, vault_id)?;
    ensure_plain_mode(&config)?;

    let session = PlainSession {
        vault_id: vault_id.to_string(),
        display_name: config.vault.display_name.clone(),
        workspace_path: root.workspace_dir(&settings, &config.vault.display_name),
        archive_path: root.vault_archive_path(&config),
        password: password.into(),
    };

    close(root, session, seven_zip)
}

/// Close a `plain` vault: `7z t` gate → new archive → test → rename → wipe workspace.
pub fn close(root: &VaultRoot, session: PlainSession, seven_zip: &SevenZip) -> Result<()> {
    let config = load_vault_config(root, &session.vault_id)?;
    ensure_plain_mode(&config)?;

    let password_str = session.password.as_str().ok_or_else(|| {
        UprivError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "vault password must be valid UTF-8",
        ))
    })?;

    if !session.workspace_path.is_dir() {
        return Err(UprivError::WorkspaceNotFound(
            session.workspace_path.clone(),
        ));
    }

    let seven_zip = seven_zip.clone().with_vault_options(&config);

    // Gate: existing archive must still match the session password.
    seven_zip.test(&session.archive_path, password_str)?;

    crate::backup::backup_before_replace(root, &config, &session.archive_path)?;

    let new_archive = session.archive_path.with_extension("7z.new");
    seven_zip.create_from_dir(&session.workspace_path, &new_archive, password_str)?;
    seven_zip.test(&new_archive, password_str)?;

    replace_file(&new_archive, &session.archive_path)?;

    wipe_workspace(&session.workspace_path, &config.security)?;

    update_persistence(root, &config, &session.archive_path)?;

    release_lock(root, &session.vault_id)?;

    Ok(())
}

fn ensure_plain_mode(config: &VaultConfig) -> Result<()> {
    if config.storage.mode != StorageMode::Plain {
        return Err(UprivError::StorageModeMismatch {
            expected: "plain".to_string(),
            actual: format!("{:?}", config.storage.mode),
        });
    }
    Ok(())
}

fn acquire_lock(root: &VaultRoot, vault_id: &str) -> Result<()> {
    let lock_path = root.runtime_lock_path(vault_id);
    if let Some(parent) = lock_path.parent() {
        fs::create_dir_all(parent)?;
    }
    if lock_path.exists() {
        return Err(UprivError::Io(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            format!("vault already open: {}", lock_path.display()),
        )));
    }
    let payload = format!(
        "pid={}\nhost={}\nopened_at={}\n",
        std::process::id(),
        hostname(),
        iso8601_now()
    );
    fs::write(&lock_path, payload)?;
    Ok(())
}

fn release_lock(root: &VaultRoot, vault_id: &str) -> Result<()> {
    let lock_path = root.runtime_lock_path(vault_id);
    if lock_path.is_file() {
        fs::remove_file(lock_path)?;
    }
    Ok(())
}

fn replace_file(from: &Path, to: &Path) -> Result<()> {
    if to.exists() {
        fs::remove_file(to)?;
    }
    fs::rename(from, to)?;
    Ok(())
}

fn update_persistence(root: &VaultRoot, config: &VaultConfig, archive_path: &Path) -> Result<()> {
    let path = root.vault_persistence_path(&config.vault.id);
    let mut persistence = if path.is_file() {
        let raw = fs::read_to_string(&path)?;
        serde_json::from_str::<VaultPersistence>(&raw).unwrap_or_else(|_| VaultPersistence {
            format_version: 1,
            vault_id: config.vault.id.clone(),
            display_name: config.vault.display_name.clone(),
            sync_generation: 0,
            archive_hash: String::new(),
            last_close_ok_at: None,
            store_hash: None,
            last_store_write_at: None,
            persistence: PersistenceState::Sealed,
        })
    } else {
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
    };

    persistence.sync_generation = persistence.sync_generation.saturating_add(1);
    persistence.archive_hash = sha256_file(archive_path)?;
    persistence.last_close_ok_at = Some(iso8601_now());
    persistence.persistence = PersistenceState::Sealed;
    persistence.display_name = config.vault.display_name.clone();

    let json = serde_json::to_string_pretty(&persistence)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, json)?;
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

fn hostname() -> String {
    std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("COMPUTERNAME"))
        .unwrap_or_else(|_| "localhost".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::SecuritySection;
    use crate::seven_zip::SevenZip;
    use std::path::Path;
    use tempfile::tempdir;

    fn write_settings(root: &Path) {
        let settings = r#"
[package]
vaults_dir = ".upriv/vaults"
workspace_dir = "workspace"
app_dir = ".upriv/app"
"#;
        fs::create_dir_all(root.join(".upriv")).unwrap();
        fs::write(root.join(".upriv/settings.toml"), settings).unwrap();
    }

    fn write_plain_vault(root: &Path, vault_id: &str, display_name: &str) {
        let vault_dir = root.join(".upriv/vaults").join(vault_id);
        fs::create_dir_all(vault_dir.join("archive")).unwrap();
        let config = format!(
            r#"
[vault]
id = "{vault_id}"
display_name = "{display_name}"
vault_file = "archive/{display_name}.7z"

[storage]
mode = "plain"

[security]
secure_wipe_workspace = true
wipe_passes = 1
wipe_pattern = "zeros"
"#
        );
        fs::write(vault_dir.join("config.toml"), config).unwrap();
    }

    fn resolve_test_seven_zip() -> Option<SevenZip> {
        if let Ok(path) = which_7z() {
            return Some(SevenZip::from_binary(path));
        }
        None
    }

    fn which_7z() -> Result<PathBuf> {
        let output = std::process::Command::new("which")
            .arg("7z")
            .output()?;
        if !output.status.success() {
            return Err(UprivError::SevenZipNotFound);
        }
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(PathBuf::from(path))
    }

    #[test]
    fn plain_open_close_roundtrip() {
        let Some(seven_zip) = resolve_test_seven_zip() else {
            eprintln!("skipping plain_open_close_roundtrip: 7z not found");
            return;
        };

        let temp = tempdir().unwrap();
        let root = VaultRoot::new(temp.path());
        write_settings(temp.path());
        write_plain_vault(temp.path(), "demo", "Demo Vault");

        let config = load_vault_config(&root, "demo").unwrap();
        let archive_path = root.vault_archive_path(&config);
        let settings = load_app_settings(&root).unwrap();

        let workspace = root.workspace_dir(&settings, "Demo Vault");
        fs::create_dir_all(&workspace).unwrap();
        fs::write(workspace.join("note.txt"), b"hello").unwrap();
        seven_zip
            .clone()
            .with_vault_options(&config)
            .create_from_dir(&workspace, &archive_path, "test-pass-123")
            .expect("create initial archive");
        wipe_workspace(&workspace, &SecuritySection::default()).unwrap();

        let session =
            open(&root, "demo", SessionPassword::from("test-pass-123"), &seven_zip).expect("open");
        assert!(session.workspace_path.join("note.txt").is_file());

        fs::write(
            session.workspace_path.join("note.txt"),
            b"hello-updated",
        )
        .unwrap();

        close(&root, session, &seven_zip).expect("close");

        assert!(!workspace.exists());
        assert!(archive_path.is_file());

        let persistence: VaultPersistence = serde_json::from_str(
            &fs::read_to_string(root.vault_persistence_path("demo")).unwrap(),
        )
        .unwrap();
        assert_eq!(persistence.persistence, PersistenceState::Sealed);
        assert!(persistence.sync_generation >= 1);
    }
}
