//! Portable export: `.zip` of `store/` (ciphertext). `.7z` is Plan B.

use crate::config::load_vault_config;
use crate::config::vault_config::VaultSevenZipSection;
use crate::error::{Result, UprivError};
use crate::paths::VaultRoot;
use crate::session::{
    check_unlock_allowed, ensure_vault_session_closed, record_unlock_failure,
    record_unlock_success, with_unlock_lock,
};
use crate::store::{
    file_name, open_store, probe_store_password, VaultHeader, VaultIndex, INTERNAL_WORKSPACE_FILE,
    SEED_LOGICAL_PATH,
};

use super::seven_zip_pack::{
    ensure_seven_zip_export_ram, logical_export_size, pack_logical_seven_zip_to_writer,
    seven_zip_archive_vec_budget, seven_zip_pack_ram_needed, try_vec_with_capacity,
    LogicalSevenZipSource, SevenZipSink,
};
use super::zip_io::{zip_directory_to_bytes, zip_directory_to_path};

fn closed_vault_paths(
    root: &VaultRoot,
    vault_id: &str,
) -> Result<(std::path::PathBuf, std::path::PathBuf)> {
    let vault_dir = root.vault_dir(vault_id)?;
    if !vault_dir.is_dir() {
        return Err(UprivError::VaultNotFound(vault_dir));
    }
    let _ = load_vault_config(&vault_dir)?;
    ensure_vault_session_closed(&vault_dir)?;
    let store = vault_dir.join(crate::paths::STORE_DIR_NAME);
    Ok((vault_dir, store))
}

fn closed_store_dir(root: &VaultRoot, vault_id: &str) -> Result<std::path::PathBuf> {
    Ok(closed_vault_paths(root, vault_id)?.1)
}

fn unlock_closed_store<T>(
    vault_dir: &std::path::Path,
    password: &[u8],
    f: impl FnOnce() -> Result<T>,
) -> Result<T> {
    if password.is_empty() {
        return Err(UprivError::WrongPassword);
    }
    with_unlock_lock(|| {
        check_unlock_allowed(vault_dir)?;
        match f() {
            Ok(value) => {
                record_unlock_success(vault_dir);
                Ok(value)
            }
            Err(UprivError::WrongPassword) => {
                let _ = record_unlock_failure(vault_dir);
                Err(UprivError::WrongPassword)
            }
            Err(error) => Err(error),
        }
    })
}

/// Zip of `store/` (no zip password). This vault must be closed.
pub fn export_store_zip(root: &VaultRoot, vault_id: &str) -> Result<Vec<u8>> {
    zip_directory_to_bytes(&closed_store_dir(root, vault_id)?)
}

/// Zip of `store/` written to `dest` (no zip password, no NDJSON payload).
pub fn export_store_zip_to_path(
    root: &VaultRoot,
    vault_id: &str,
    dest: &std::path::Path,
) -> Result<u64> {
    zip_directory_to_path(&closed_store_dir(root, vault_id)?, dest)
}

fn skip_export_path(path: &str) -> bool {
    path == SEED_LOGICAL_PATH || file_name(path) == INTERNAL_WORKSPACE_FILE
}

fn pack_logical_seven_zip_to_path(
    store_dir: &std::path::Path,
    header: &VaultHeader,
    content_key: &[u8; 32],
    index: &VaultIndex,
    archive_password: &[u8],
    opts: &VaultSevenZipSection,
    dest: &std::path::Path,
) -> Result<u64> {
    let sizes = logical_export_size(index, skip_export_path);
    ensure_seven_zip_export_ram(seven_zip_pack_ram_needed(sizes, opts, SevenZipSink::File))?;
    let file = std::fs::File::create(dest)?;
    match pack_logical_seven_zip_to_writer(
        file,
        LogicalSevenZipSource {
            store_dir,
            header,
            content_key,
            index,
        },
        archive_password,
        opts,
        skip_export_path,
    ) {
        Ok(mut file) => {
            use std::io::Write;
            file.flush()?;
            Ok(file.metadata()?.len())
        }
        Err(error) => {
            let _ = std::fs::remove_file(dest);
            Err(error)
        }
    }
}

fn pack_logical_seven_zip_in_memory(
    store_dir: &std::path::Path,
    header: &VaultHeader,
    content_key: &[u8; 32],
    index: &VaultIndex,
    archive_password: &[u8],
    opts: &VaultSevenZipSection,
) -> Result<Vec<u8>> {
    let sizes = logical_export_size(index, skip_export_path);
    let needed = seven_zip_pack_ram_needed(sizes, opts, SevenZipSink::Memory);
    ensure_seven_zip_export_ram(needed)?;
    let buf = try_vec_with_capacity(seven_zip_archive_vec_budget(sizes))?;
    let cursor = pack_logical_seven_zip_to_writer(
        std::io::Cursor::new(buf),
        LogicalSevenZipSource {
            store_dir,
            header,
            content_key,
            index,
        },
        archive_password,
        opts,
        skip_export_path,
    )?;
    Ok(cursor.into_inner())
}

fn with_logical_store<T>(
    root: &VaultRoot,
    vault_id: &str,
    archive_password: &[u8],
    f: impl FnOnce(&std::path::Path, &VaultHeader, &[u8; 32], &VaultIndex) -> Result<T>,
) -> Result<T> {
    let (vault_dir, store) = closed_vault_paths(root, vault_id)?;
    let opened = unlock_closed_store(&vault_dir, archive_password, || {
        open_store(&store, archive_password)
    })?;
    f(&store, &opened.header, &opened.content_key, &opened.index)
}

/// Argon2id wrap check for a closed vault. Does not pack a `.7z` or load the index.
pub fn probe_export_password(root: &VaultRoot, vault_id: &str, password: &[u8]) -> Result<()> {
    let (vault_dir, store) = closed_vault_paths(root, vault_id)?;
    unlock_closed_store(&vault_dir, password, || {
        probe_store_password(&store, password)
    })
}

/// Logical `.7z` of vault files (never `.enc` blobs). Packed in RAM with
/// 7-Zip AES; destination ciphertext may sit on disk. This vault must be
/// closed; the password unlocks `store/` for the read.
pub fn export_logical_seven_zip(
    root: &VaultRoot,
    vault_id: &str,
    archive_password: &[u8],
    options: Option<&VaultSevenZipSection>,
) -> Result<Vec<u8>> {
    let vault_dir = root.vault_dir(vault_id)?;
    if !vault_dir.is_dir() {
        return Err(UprivError::VaultNotFound(vault_dir));
    }
    let config = load_vault_config(&vault_dir)?;
    let opts = options.cloned().unwrap_or(config.seven_zip);
    with_logical_store(
        root,
        vault_id,
        archive_password,
        |store, header, key, index| {
            pack_logical_seven_zip_in_memory(store, header, key, index, archive_password, &opts)
        },
    )
}

/// Logical `.7z` written to `dest`. Plaintext stays in RAM; `dest` is ciphertext.
pub fn export_logical_seven_zip_to_path(
    root: &VaultRoot,
    vault_id: &str,
    archive_password: &[u8],
    options: Option<&VaultSevenZipSection>,
    dest: &std::path::Path,
) -> Result<u64> {
    let vault_dir = root.vault_dir(vault_id)?;
    if !vault_dir.is_dir() {
        return Err(UprivError::VaultNotFound(vault_dir));
    }
    let config = load_vault_config(&vault_dir)?;
    let opts = options.cloned().unwrap_or(config.seven_zip);
    with_logical_store(
        root,
        vault_id,
        archive_password,
        |store, header, key, index| {
            pack_logical_seven_zip_to_path(store, header, key, index, archive_password, &opts, dest)
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::VaultConfig;
    use crate::error::UprivError;
    use crate::store::KdfUnlockPreset;
    use crate::test_support::vault_root_with;
    use crate::vault::create::create_vault;
    use crate::vault::fs::fs_write_file;
    use crate::vault::open_close::{close_vault, open_vault};
    use crate::vault::seven_zip::{import_logical_seven_zip, probe_logical_seven_zip};

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
    fn zip_export_contains_ciphertext_not_plaintext() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        fs_write_file(&root, "notes", "/secret.txt", b"plain-secret").unwrap();
        close_vault(&root, "notes", None).unwrap();
        let zip = export_store_zip(&root, "notes").unwrap();
        assert_eq!(&zip[..2], b"PK");
        let as_text = String::from_utf8_lossy(&zip);
        assert!(!as_text.contains("plain-secret"));
    }

    #[test]
    fn zip_export_to_path_matches_bytes() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        let bytes = export_store_zip(&root, "notes").unwrap();
        let dest = _tmp.path().join("Notes.zip");
        let size = export_store_zip_to_path(&root, "notes", &dest).unwrap();
        assert_eq!(size as usize, bytes.len());
        assert_eq!(std::fs::read(&dest).unwrap(), bytes);
    }

    #[test]
    fn probe_export_password_accepts_the_vault_password_only() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        probe_export_password(&root, "notes", b"pass-word-ok").unwrap();
        let wrong = probe_export_password(&root, "notes", b"not-the-password").unwrap_err();
        assert!(matches!(wrong, UprivError::WrongPassword));
        let empty = probe_export_password(&root, "notes", b"").unwrap_err();
        assert!(matches!(empty, UprivError::WrongPassword));
    }

    #[test]
    fn seven_zip_export_rejects_empty_password() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        let err = export_logical_seven_zip(&root, "notes", b"", None).unwrap_err();
        assert!(matches!(err, UprivError::WrongPassword));
    }

    #[test]
    fn seven_zip_export_available_in_process() {
        assert!(crate::seven_zip_export_available());
    }

    #[test]
    fn seven_zip_export_round_trip_hides_seed() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        fs_write_file(&root, "notes", "/docs/hi.txt", b"hello-export").unwrap();
        close_vault(&root, "notes", None).unwrap();
        let bytes = export_logical_seven_zip(&root, "notes", b"pass-word-ok", None)
            .expect("in-RAM .7z export");
        assert_eq!(&bytes[..2], b"7z");
        let name_utf16: Vec<u8> = "docs/hi.txt"
            .encode_utf16()
            .flat_map(|unit| unit.to_le_bytes())
            .collect();
        assert!(
            !bytes
                .windows(name_utf16.len())
                .any(|window| window == name_utf16.as_slice()),
            "encrypted header must not leak member names"
        );
        probe_logical_seven_zip(&bytes, b"pass-word-ok").expect("in-process .7z probe");
        assert!(matches!(
            probe_logical_seven_zip(&bytes, b"not-the-password"),
            Err(UprivError::WrongPassword)
        ));
        let imported = import_logical_seven_zip(
            &root,
            sample_config("notes-7z", "Notes 7z"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
            &bytes,
            b"pass-word-ok",
        )
        .unwrap();
        open_vault(&root, &imported, b"pass-word-ok").unwrap();
        let listed = crate::vault::fs::fs_list_tree(&root, &imported).unwrap();
        let json = serde_json::to_string(&listed).unwrap();
        assert!(json.contains("hi.txt"), "{json}");
        assert!(!json.contains(SEED_LOGICAL_PATH), "{json}");
        let body = crate::vault::fs::fs_read_file(&root, &imported, "/docs/hi.txt").unwrap();
        assert_eq!(body, b"hello-export");
        close_vault(&root, &imported, None).unwrap();
    }

    #[test]
    fn export_refuses_while_this_vault_is_open() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        let err = export_store_zip(&root, "notes").unwrap_err();
        assert!(matches!(err, UprivError::VaultMustBeClosed));
        let err = export_logical_seven_zip(&root, "notes", b"pass-word-ok", None).unwrap_err();
        assert!(matches!(err, UprivError::VaultMustBeClosed));
        close_vault(&root, "notes", None).unwrap();
    }

    #[test]
    fn export_allows_while_another_vault_is_open() {
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
        open_vault(&root, "other", b"pass-word-ok").unwrap();
        let zip = export_store_zip(&root, "notes").unwrap();
        assert_eq!(&zip[..2], b"PK");
        close_vault(&root, "other", None).unwrap();
    }
}
