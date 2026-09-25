//! Logical `.7z` **import**: decode members in process (RAM), never a plaintext
//! tree on ordinary disk. Export packing lives in `seven_zip_pack` (same crate).
//!
//! The source `.7z` is ciphertext (user file or already-loaded bytes). Members
//! stream into `store/` through `fs_write_from_reader`.

use std::io::{Cursor, Read};
use std::path::PathBuf;

use sevenz_rust2::{ArchiveEntry, ArchiveReader};

use crate::config::VaultConfig;
use crate::error::{Result, UprivError};
use crate::logging::{log_event, LogLevel};
use crate::paths::VaultRoot;
use crate::session::is_vault_open_at;
use crate::store::{file_name, KdfUnlockPreset, INTERNAL_WORKSPACE_FILE, SEED_LOGICAL_PATH};

use super::create::create_vault;
use super::fs::{fs_ensure_folder, fs_write_from_reader};
use super::open_close::{close_vault, open_vault};
use super::seven_zip_pack::{sevenz_member_name_unsafe, sevenz_password};

fn map_sevenz_read_error(error: sevenz_rust2::Error) -> UprivError {
    match error {
        sevenz_rust2::Error::PasswordRequired
        | sevenz_rust2::Error::MaybeBadPassword(_)
        | sevenz_rust2::Error::ChecksumVerificationFailed
        | sevenz_rust2::Error::NextHeaderCrcMismatch => UprivError::WrongPassword,
        other => UprivError::VaultStoreInvalid {
            path: PathBuf::from("7z"),
            detail: other.to_string(),
        },
    }
}

fn open_archive_reader<'a>(
    archive_bytes: &'a [u8],
    archive_password: &[u8],
) -> Result<ArchiveReader<Cursor<&'a [u8]>>> {
    let password = sevenz_password(archive_password)?;
    ArchiveReader::new(Cursor::new(archive_bytes), password).map_err(map_sevenz_read_error)
}

fn normalize_member_name(name: &str) -> String {
    name.replace('\\', "/").trim_start_matches('/').to_string()
}

fn member_name_forbidden(name: &str) -> bool {
    sevenz_member_name_unsafe(name)
        || name == SEED_LOGICAL_PATH
        || file_name(name) == INTERNAL_WORKSPACE_FILE
}

fn skip_archive_member(entry: &ArchiveEntry) -> bool {
    entry.is_directory()
        || entry.is_anti_item
        || member_name_forbidden(&normalize_member_name(&entry.name))
}

fn ensure_parent_dirs(root: &VaultRoot, vault_id: &str, logical: &str) -> Result<()> {
    let parts: Vec<&str> = logical.split('/').filter(|part| !part.is_empty()).collect();
    if parts.len() < 2 {
        return Ok(());
    }
    let mut parent_ui = "/".to_string();
    for part in &parts[..parts.len() - 1] {
        let (created, _) = fs_ensure_folder(root, vault_id, &parent_ui, part)?;
        parent_ui = created;
    }
    Ok(())
}

fn ingest_archive_member(
    root: &VaultRoot,
    vault_id: &str,
    entry: &ArchiveEntry,
    payload: &mut dyn Read,
) -> Result<()> {
    if skip_archive_member(entry) {
        return Ok(());
    }
    let name = normalize_member_name(&entry.name);
    ensure_parent_dirs(root, vault_id, &name)?;
    fs_write_from_reader(root, vault_id, &format!("/{name}"), payload)?;
    Ok(())
}

/// Open the archive and decode one payload byte so a wrong password fails even
/// when the header is not encrypted.
pub fn probe_logical_seven_zip(archive_bytes: &[u8], archive_password: &[u8]) -> Result<()> {
    let mut reader = open_archive_reader(archive_bytes, archive_password)?;
    reader
        .for_each_entries(|entry, payload| {
            if skip_archive_member(entry) {
                return Ok(true);
            }
            std::io::copy(&mut payload.take(1), &mut std::io::sink())?;
            Ok(false)
        })
        .map_err(map_sevenz_read_error)?;
    Ok(())
}

/// Create a new vault and stream logical files from a `.7z` into `store/`.
pub fn import_logical_seven_zip(
    root: &VaultRoot,
    config: VaultConfig,
    new_password: &[u8],
    preset: KdfUnlockPreset,
    archive_bytes: &[u8],
    archive_password: &[u8],
) -> Result<String> {
    if new_password.is_empty() {
        return Err(UprivError::WrongPassword);
    }
    let mut reader = open_archive_reader(archive_bytes, archive_password)?;
    create_vault(root, config.clone(), new_password, preset)?;
    let id = config.vault.id.trim().to_string();
    let ingest = (|| {
        open_vault(root, &id, new_password)?;
        let mut write_error: Option<UprivError> = None;
        reader
            .for_each_entries(|entry, payload| {
                if write_error.is_some() {
                    return Ok(false);
                }
                match ingest_archive_member(root, &id, entry, payload) {
                    Ok(()) => Ok(true),
                    Err(error) => {
                        write_error = Some(error);
                        Ok(false)
                    }
                }
            })
            .map_err(map_sevenz_read_error)?;
        if let Some(error) = write_error {
            return Err(error);
        }
        Ok(())
    })();
    if let Err(ingest_error) = ingest {
        let dir = root.vault_dir(&id)?;
        if is_vault_open_at(&dir) {
            // Delete refuses a vault that is still open. A failed close must
            // surface here; swallowing it left the partial vault in the session.
            close_vault(root, &id, Some(new_password))?;
        }
        super::delete::delete_vault(root, &id)?;
        return Err(ingest_error);
    }
    close_vault(root, &id, Some(new_password))?;
    log_event(LogLevel::Info, "vault_imported", &[("id", id.as_str())]);
    Ok(id)
}

#[cfg(test)]
mod import_mem_tests {
    use super::*;

    #[test]
    fn skip_dotdot_seed_and_directories() {
        let mut file = ArchiveEntry::new();
        file.name = "docs/hi.txt".into();
        assert!(!skip_archive_member(&file));

        let mut dir = ArchiveEntry::new();
        dir.name = "docs".into();
        dir.is_directory = true;
        assert!(skip_archive_member(&dir));

        let mut traversal = ArchiveEntry::new();
        traversal.name = "../secret.txt".into();
        assert!(skip_archive_member(&traversal));

        let mut seed = ArchiveEntry::new();
        seed.name = SEED_LOGICAL_PATH.into();
        assert!(skip_archive_member(&seed));
    }

    #[test]
    fn file_node_is_not_treated_as_a_parent_directory() {
        let (_tmp, root) = crate::test_support::vault_root_with(&[]);
        let config = toml::from_str(
            r#"
[vault]
id = "notes"
display_name = "Notes"
order = 1
[storage]
mode = "encrypted_dir"
"#,
        )
        .expect("config");
        create_vault(&root, config, b"pass-word-ok", KdfUnlockPreset::M32).unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        crate::vault::fs::fs_create_named_file(&root, "notes", "/", "docs").unwrap();
        let err = ensure_parent_dirs(&root, "notes", "docs/a.txt").unwrap_err();
        assert!(matches!(err, UprivError::VaultPathExists(_)));
        close_vault(&root, "notes", None).unwrap();
    }

    #[test]
    fn probe_rejects_empty_password() {
        let err = probe_logical_seven_zip(b"7z\xbc\xaf'\x1c", b"").unwrap_err();
        assert!(matches!(err, UprivError::WrongPassword));
    }
}
