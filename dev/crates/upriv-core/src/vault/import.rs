//! Import a `.zip` of `store/` (ciphertext copy) or unpack `backups/<stamp>.zip`
//! into a new vault.

use std::fs::File;
use std::io::{ErrorKind, Read};
use std::path::Path;

use crate::config::{known_vault_ids, save_vault_config, VaultConfig, VaultStorageMode};
use crate::error::{Result, UprivError};
use crate::logging::{log_event, LogLevel};
use crate::paths::{display_name_to_vault_id, VaultRoot};
use crate::session::{with_vault_dir_lock, with_vault_registry_lock, PreparingGuard};
use crate::store::{content_hash_hex, load_header, INDEX_DIR_NAME};

use super::backup::{backup_zip_file, copy_ciphertext_tree, is_backup_stamp};
use super::persistence::{save_vault_persistence, VaultPersistence};
use super::seven_zip_pack::{ensure_seven_zip_export_ram, try_vec_with_capacity};
use super::zip_io::{unzip_store_bytes, unzip_store_path};

fn prepare_imported_id(root: &VaultRoot, config: &mut VaultConfig) -> Result<String> {
    if config.storage_mode() == VaultStorageMode::UprivPlain {
        return Err(UprivError::UprivPlainUnavailable);
    }
    config.vault.display_name = crate::config::vault_config::normalize_and_validate_display_name(
        &config.vault.display_name,
    )?;
    let known = known_vault_ids(root)?;
    let mut existing: Vec<String> = known.into_iter().collect();
    existing.sort();
    if config.vault.id.trim().is_empty() {
        config.vault.id = display_name_to_vault_id(&config.vault.display_name, &existing);
    }
    let id = config.vault.id.trim().to_string();
    config.vault.id = id.clone();
    Ok(id)
}

fn materialize_imported_store(
    root: &VaultRoot,
    mut config: VaultConfig,
    fill_store: impl FnOnce(&Path) -> Result<()>,
) -> Result<String> {
    let id = prepare_imported_id(root, &mut config)?;
    let dest = root.vault_dir(&id)?;
    std::fs::create_dir_all(root.vaults_dir())?;
    with_vault_registry_lock(|| {
        with_vault_dir_lock(&dest, || match std::fs::create_dir(&dest) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == ErrorKind::AlreadyExists => {
                Err(UprivError::VaultAlreadyExists(dest.clone()))
            }
            Err(error) => Err(error.into()),
        })
    })?;
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
            fill_store(&store)?;
            load_header(&store)?;
            if !store.join(INDEX_DIR_NAME).is_dir() {
                return Err(UprivError::VaultStoreInvalid {
                    path: store.clone(),
                    detail: "imported store is missing index/".into(),
                });
            }
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
    log_event(LogLevel::Info, "vault_imported", &[("id", id.as_str())]);
    Ok(id)
}

/// Create a new vault whose `store/` is a ciphertext copy of the zip payload.
pub fn import_store_zip(root: &VaultRoot, config: VaultConfig, zip_bytes: &[u8]) -> Result<String> {
    materialize_imported_store(root, config, |store| unzip_store_bytes(zip_bytes, store))
}

/// Same as [`import_store_zip`], reading the archive from disk one entry at a time.
pub fn import_store_zip_path(
    root: &VaultRoot,
    config: VaultConfig,
    zip_path: &Path,
) -> Result<String> {
    if !zip_path.is_absolute() || !zip_path.is_file() {
        return Err(UprivError::ImportArchiveNotFound(zip_path.to_path_buf()));
    }
    materialize_imported_store(root, config, |store| unzip_store_path(zip_path, store))
}

/// Create a new vault by copying an existing ciphertext `store/` (or backup) tree.
pub fn import_store_tree(root: &VaultRoot, config: VaultConfig, src: &Path) -> Result<String> {
    if !src.is_dir() {
        return Err(UprivError::VaultPathNotFound(src.display().to_string()));
    }
    materialize_imported_store(root, config, |store| copy_ciphertext_tree(src, store))
}

/// Locator `vaults/<id>/backups/<stamp>` or `…/backups/saves/<stamp>` (optional `.zip`).
/// On disk the snapshot is always `<stamp>.zip`.
pub fn parse_backup_import_path(path: &str) -> Option<(String, String)> {
    let normalized = path.replace('\\', "/");
    let parts: Vec<&str> = normalized
        .split('/')
        .filter(|part| !part.is_empty())
        .collect();
    let vaults_idx = parts.iter().rposition(|part| *part == "vaults")?;
    let id = (*parts.get(vaults_idx + 1)?).to_string();
    if id.is_empty() || id == ".." {
        return None;
    }
    if parts.get(vaults_idx + 2).copied() != Some("backups") {
        return None;
    }
    match parts.get(vaults_idx + 3).copied() {
        Some("saves") => {
            let raw = (*parts.get(vaults_idx + 4)?).to_string();
            let stamp = raw.strip_suffix(".zip").unwrap_or(&raw);
            if parts.len() != vaults_idx + 5 || !is_backup_stamp(stamp) {
                return None;
            }
            Some((id, stamp.to_string()))
        }
        Some(raw) => {
            let stamp = raw.strip_suffix(".zip").unwrap_or(raw);
            if parts.len() != vaults_idx + 4 || !is_backup_stamp(stamp) {
                return None;
            }
            Some((id, stamp.to_string()))
        }
        None => None,
    }
}

/// Unpack `backups/<stamp>.zip` into a new vault.
pub fn import_from_backup(
    root: &VaultRoot,
    source_vault_id: &str,
    stamp: &str,
    config: VaultConfig,
) -> Result<String> {
    let zip = backup_zip_file(root, source_vault_id, stamp)?;
    import_store_zip_path(root, config, &zip)
}

/// Read a dropped/picked `.zip` or `.7z` from disk. Relative names (a drop
/// filename with no Electron path) must not be resolved against the daemon cwd.
pub fn read_import_archive_bytes(path: &Path) -> Result<Vec<u8>> {
    if !path.is_absolute() {
        return Err(UprivError::ImportArchiveNotFound(path.to_path_buf()));
    }
    let meta = match std::fs::metadata(path) {
        Ok(meta) => meta,
        Err(error)
            if matches!(
                error.kind(),
                ErrorKind::NotFound | ErrorKind::PermissionDenied
            ) =>
        {
            return Err(UprivError::ImportArchiveNotFound(path.to_path_buf()));
        }
        Err(error) => return Err(error.into()),
    };
    if !meta.is_file() {
        return Err(UprivError::ImportArchiveNotFound(path.to_path_buf()));
    }
    ensure_seven_zip_export_ram(meta.len())?;
    let mut buf = try_vec_with_capacity(meta.len())?;
    let file = File::open(path)?;
    file.take(meta.len()).read_to_end(&mut buf)?;
    Ok(buf)
}

/// Zip file, ciphertext directory, or in-root backup locator (`vaults/<id>/backups/<stamp>.zip`).
pub fn import_store_from_archive_path(
    root: &VaultRoot,
    config: VaultConfig,
    archive_path: &str,
) -> Result<String> {
    if let Some((source_id, stamp)) = parse_backup_import_path(archive_path) {
        match import_from_backup(root, &source_id, &stamp, config.clone()) {
            Ok(id) => return Ok(id),
            Err(error) => {
                let path = Path::new(archive_path);
                if path.is_dir() {
                    return import_store_tree(root, config, path);
                }
                return Err(error);
            }
        }
    }
    let path = Path::new(archive_path);
    if path.is_dir() {
        return import_store_tree(root, config, path);
    }
    import_store_zip_path(root, config, path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::KdfUnlockPreset;
    use crate::test_support::vault_root_with;
    use crate::vault::{close_vault, create_vault, list_backups, open_vault};

    fn sample_config(id: &str, name: &str) -> VaultConfig {
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
    fn parse_backup_import_path_accepts_relative_and_absolute() {
        assert_eq!(
            parse_backup_import_path("vaults/notes/backups/20260528120000.zip"),
            Some(("notes".into(), "20260528120000".into()))
        );
        assert_eq!(
            parse_backup_import_path("/home/u/.upriv/vaults/notes/backups/saves/20260528120000"),
            Some(("notes".into(), "20260528120000".into()))
        );
        assert_eq!(parse_backup_import_path("/tmp/Notes.zip"), None);
        assert_eq!(parse_backup_import_path("vaults/notes/store"), None);
        assert_eq!(
            parse_backup_import_path("/tmp/vaults/notes/backups/Notes.zip"),
            None
        );
        assert_eq!(
            parse_backup_import_path("vaults/notes/backups/20260528T120000"),
            None
        );
    }

    #[test]
    fn import_from_backup_copies_ciphertext_into_new_vault() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        close_vault(&root, "notes", None).unwrap();
        let backups = list_backups(&root, "notes").unwrap();
        assert!(!backups.is_empty(), "close should freeze a backup");
        let stamp = backups[0].stamp.clone();
        let new_id = import_from_backup(
            &root,
            "notes",
            &stamp,
            sample_config("notes-backup", "Notes backup"),
        )
        .unwrap();
        assert_eq!(new_id, "notes-backup");
        assert!(root.vault_store_dir("notes-backup").unwrap().is_dir());
        crate::store::load_header(root.vault_store_dir("notes-backup").unwrap())
            .expect("imported header");
    }

    #[test]
    fn import_zip_rejects_relative_filename() {
        let (_tmp, root) = vault_root_with(&[]);
        let err = import_store_from_archive_path(&root, sample_config("x", "X"), "Notes.zip")
            .unwrap_err();
        assert!(matches!(err, UprivError::ImportArchiveNotFound(_)));
    }

    #[test]
    fn import_zip_rejects_missing_absolute_file() {
        let (tmp, root) = vault_root_with(&[]);
        let missing = tmp.path().join("no-such.zip");
        let err = import_store_from_archive_path(
            &root,
            sample_config("x", "X"),
            missing.to_str().expect("utf8 path"),
        )
        .unwrap_err();
        assert!(matches!(err, UprivError::ImportArchiveNotFound(_)));
    }

    #[test]
    fn import_zip_allows_while_another_vault_is_open() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        create_vault(
            &root,
            sample_config("other", "Other"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        let zip = crate::vault::export_store_zip(&root, "notes").unwrap();
        open_vault(&root, "other", b"pass-word-ok").unwrap();
        let new_id =
            import_store_zip(&root, sample_config("copy", "Copy"), &zip).expect("file import");
        assert_eq!(new_id, "copy");
        close_vault(&root, "other", None).unwrap();
    }

    #[test]
    fn import_from_backup_copies_frozen_tree_while_source_is_open() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        close_vault(&root, "notes", None).unwrap();
        let stamp = list_backups(&root, "notes").unwrap()[0].stamp.clone();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        let new_id = import_from_backup(
            &root,
            "notes",
            &stamp,
            sample_config("notes-backup", "Notes backup"),
        )
        .unwrap();
        assert_eq!(new_id, "notes-backup");
        close_vault(&root, "notes", None).unwrap();
    }

    #[test]
    fn import_from_backup_allows_while_another_vault_is_open() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        create_vault(
            &root,
            sample_config("other", "Other"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        close_vault(&root, "notes", None).unwrap();
        let stamp = list_backups(&root, "notes").unwrap()[0].stamp.clone();
        open_vault(&root, "other", b"pass-word-ok").unwrap();
        let new_id = import_from_backup(
            &root,
            "notes",
            &stamp,
            sample_config("notes-backup", "Notes backup"),
        )
        .unwrap();
        assert_eq!(new_id, "notes-backup");
        close_vault(&root, "other", None).unwrap();
    }
}
