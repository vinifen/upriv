//! Change a vault's password (RF-58).
//!
//! Insight: the store's master key is unchanged — only the **key-wrapping** in the
//! header is re-derived from the new password, so chunks/index stay valid. The portable
//! `.7z` is re-encrypted (extract with old password → recreate with new). The previous
//! `.7z` is snapshotted into `backups/` first (RF-59).

use std::fs;
use std::path::Path;
use std::time::SystemTime;

use crate::backup::backup_before_replace;
use crate::config::{load_vault_config, save_vault_config, StorageMode};
use crate::crypto::{derive_kek, wrap_master_key, KdfParams};
use crate::error::{Result, UprivError};
use crate::paths::VaultRoot;
use crate::seven_zip::SevenZip;
use crate::store::VaultHeader;

pub fn change_password(
    root: &VaultRoot,
    vault_id: &str,
    current_password: &str,
    new_password: &str,
    seven_zip: &SevenZip,
) -> Result<()> {
    if new_password.is_empty() {
        return Err(UprivError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "new password must not be empty",
        )));
    }
    if new_password == current_password {
        return Err(UprivError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "new password must differ from the current password",
        )));
    }

    let config = load_vault_config(root, vault_id)?;
    let archive_path = root.vault_archive_path(&config);
    if !archive_path.is_file() {
        return Err(UprivError::ArchiveNotFound(archive_path));
    }

    let seven_zip = seven_zip.clone().with_vault_options(&config);

    // Gate: current password must open the existing archive.
    seven_zip.test(&archive_path, current_password)?;

    // Re-encrypt the portable archive with the new password.
    let staging = tempfile::tempdir()?;
    seven_zip.extract(&archive_path, staging.path(), current_password)?;
    let new_archive = archive_path.with_extension("7z.new");
    seven_zip.create_from_dir(staging.path(), &new_archive, new_password)?;
    seven_zip.test(&new_archive, new_password)?;

    backup_before_replace(root, &config, &archive_path)?;
    replace_file(&new_archive, &archive_path)?;

    // Re-wrap the store header (encrypted_dir only). Master key is preserved.
    if config.storage.mode == StorageMode::EncryptedDir {
        let header_path = root.vault_store_header_path(&config);
        if header_path.is_file() {
            rewrap_header(&header_path, current_password, new_password)?;
        }
    }

    // Record the change time in config.
    let mut config = config;
    config.security.password_changed_at = Some(iso8601_now());
    save_vault_config(root, vault_id, &config)?;

    let _ = crate::session::delete_disk_session(root, vault_id);

    Ok(())
}

fn rewrap_header(header_path: &Path, current_password: &str, new_password: &str) -> Result<()> {
    let mut header = VaultHeader::load(header_path)?;
    let master = header.unlock_master_key(current_password)?;

    let mut salt = [0u8; 16];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut salt);
    let salt_b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, salt);
    let kdf = KdfParams {
        salt_b64,
        ..KdfParams::default()
    };
    let kek = derive_kek(new_password, &kdf)?;
    let wrapped = wrap_master_key(&kek, &master)?;

    header.kdf = kdf;
    header.wrapped_master_key_b64 = wrapped;
    header.save(header_path)?;
    Ok(())
}

fn replace_file(from: &Path, to: &Path) -> Result<()> {
    if to.exists() {
        fs::remove_file(to)?;
    }
    fs::rename(from, to)?;
    Ok(())
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
    use crate::{create_vault, encrypted_dir_close, encrypted_dir_open, VaultConfig, VaultRoot};

    fn write_settings(root: &Path) {
        fs::create_dir_all(root.join(".upriv")).unwrap();
        fs::write(
            root.join(".upriv/settings.toml"),
            "[package]\nvaults_dir = \".upriv/vaults\"\nworkspace_dir = \"workspace\"\napp_dir = \".upriv/app\"\n",
        )
        .unwrap();
    }

    fn config(id: &str, name: &str) -> VaultConfig {
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
    fn change_password_then_reopen_with_new() {
        let Some(binary) = resolve_7z() else {
            eprintln!("skipping change_password_then_reopen_with_new: 7z not found");
            return;
        };
        let temp = tempfile::tempdir().unwrap();
        write_settings(temp.path());
        let root = VaultRoot::discover(temp.path()).unwrap();
        let seven_zip = SevenZip::from_binary(&binary);
        create_vault(&root, config("notes", "Notes"), "old-pw", &seven_zip).unwrap();

        change_password(&root, "notes", "old-pw", "new-pw", &seven_zip).unwrap();

        // Old password must fail, new must work.
        assert!(encrypted_dir_open(&root, "notes", "old-pw", &seven_zip).is_err());
        let session = encrypted_dir_open(&root, "notes", "new-pw", &seven_zip).unwrap();
        let data = session.read_file("README.txt").unwrap();
        assert!(!data.is_empty());
        encrypted_dir_close(&root, session, false, &seven_zip).unwrap();
    }

    #[test]
    fn wrong_current_password_is_rejected() {
        let Some(binary) = resolve_7z() else {
            eprintln!("skipping wrong_current_password_is_rejected: 7z not found");
            return;
        };
        let temp = tempfile::tempdir().unwrap();
        write_settings(temp.path());
        let root = VaultRoot::discover(temp.path()).unwrap();
        let seven_zip = SevenZip::from_binary(&binary);
        create_vault(&root, config("notes", "Notes"), "old-pw", &seven_zip).unwrap();

        assert!(change_password(&root, "notes", "wrong", "new-pw", &seven_zip).is_err());
        // Original password still valid.
        let session = encrypted_dir_open(&root, "notes", "old-pw", &seven_zip).unwrap();
        encrypted_dir_close(&root, session, false, &seven_zip).unwrap();
    }
}
