//! Portable export: `.zip` of `store/` (ciphertext). `.7z` is Plan B.

use crate::config::load_vault_config;
use crate::config::vault_config::VaultSevenZipSection;
use crate::error::{Result, UprivError};
#[allow(unused_imports)]
use crate::host_fs::HostFsQuery;
use crate::paths::seven_zip_outer_folder;
use crate::paths::VaultRoot;
use crate::session::{
    check_unlock_allowed, ensure_vault_session_closed, record_unlock_failure,
    record_unlock_success, with_unlock_lock,
};
use crate::store::{
    file_name, open_store, probe_store_password, VaultHeader, VaultIndex, INTERNAL_WORKSPACE_FILE,
    SEED_LOGICAL_PATH,
};
use crate::time::utc_filename_stamp;

use super::embedded_settings::snapshot_settings_bytes;
use super::seven_zip_pack::{
    ensure_seven_zip_export_ram, logical_export_size, pack_logical_seven_zip_to_writer,
    seven_zip_archive_vec_budget, seven_zip_pack_budget, try_vec_with_capacity,
    LogicalSevenZipSource, SevenZipSink,
};
use super::zip_io::{zip_store_with_config_to_bytes, zip_store_with_config_to_path};

fn closed_vault_paths(
    root: &VaultRoot,
    vault_id: &str,
) -> Result<(std::path::PathBuf, std::path::PathBuf)> {
    let vault_dir = root.vault_dir(vault_id)?;
    if !vault_dir.host_is_dir() {
        return Err(UprivError::VaultNotFound(vault_dir));
    }
    let _ = load_vault_config(&vault_dir)?;
    ensure_vault_session_closed(&vault_dir)?;
    let store = vault_dir.join(crate::paths::STORE_DIR_NAME);
    Ok((vault_dir, store))
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

/// Zip of `store/` plus `README.md` and `config.toml` (no zip password). This vault must be closed.
pub fn export_store_zip(root: &VaultRoot, vault_id: &str) -> Result<Vec<u8>> {
    let (vault_dir, store) = closed_vault_paths(root, vault_id)?;
    crate::store::ensure_danger_notice(&store)?;
    let settings = snapshot_settings_bytes(&vault_dir, &store)?;
    zip_store_with_config_to_bytes(&store, &settings, &utc_filename_stamp())
}

/// Zip of `store/` plus `README.md` and `config.toml` written to `dest` (no zip password).
pub fn export_store_zip_to_path(
    root: &VaultRoot,
    vault_id: &str,
    dest: &std::path::Path,
) -> Result<u64> {
    let (vault_dir, store) = closed_vault_paths(root, vault_id)?;
    crate::store::ensure_danger_notice(&store)?;
    let settings = snapshot_settings_bytes(&vault_dir, &store)?;
    zip_store_with_config_to_path(&store, &settings, &utc_filename_stamp(), dest)
}

fn skip_export_path(path: &str) -> bool {
    path == SEED_LOGICAL_PATH || file_name(path) == INTERNAL_WORKSPACE_FILE
}

fn pack_logical_seven_zip_to_path(
    source: LogicalSevenZipSource<'_>,
    archive_password: &[u8],
    opts: &VaultSevenZipSection,
    outer: &str,
    dest: &std::path::Path,
) -> Result<u64> {
    let sizes = logical_export_size(source.index, skip_export_path);
    let budget = seven_zip_pack_budget(sizes, opts, SevenZipSink::File);
    ensure_seven_zip_export_ram(budget.ram)?;
    let file = crate::host_fs::File::create(dest)?;
    match pack_logical_seven_zip_to_writer(
        file,
        source,
        archive_password,
        opts,
        outer,
        budget.threads,
        skip_export_path,
    ) {
        Ok(mut file) => {
            use std::io::Write;
            file.flush()?;
            Ok(file.metadata()?.len())
        }
        Err(error) => {
            let _ = crate::host_fs::remove_file(dest);
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
    outer: &str,
) -> Result<Vec<u8>> {
    let sizes = logical_export_size(index, skip_export_path);
    let budget = seven_zip_pack_budget(sizes, opts, SevenZipSink::Memory);
    ensure_seven_zip_export_ram(budget.ram)?;
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
        outer,
        budget.threads,
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
    if !vault_dir.host_is_dir() {
        return Err(UprivError::VaultNotFound(vault_dir));
    }
    let config = load_vault_config(&vault_dir)?;
    let opts = options.cloned().unwrap_or(config.seven_zip);
    with_logical_store(
        root,
        vault_id,
        archive_password,
        |store, header, key, index| {
            pack_logical_seven_zip_in_memory(
                store,
                header,
                key,
                index,
                archive_password,
                &opts,
                &seven_zip_outer_folder(&config.vault.display_name),
            )
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
    if !vault_dir.host_is_dir() {
        return Err(UprivError::VaultNotFound(vault_dir));
    }
    let config = load_vault_config(&vault_dir)?;
    let opts = options.cloned().unwrap_or(config.seven_zip);
    with_logical_store(
        root,
        vault_id,
        archive_password,
        |store, header, key, index| {
            pack_logical_seven_zip_to_path(
                LogicalSevenZipSource {
                    store_dir: store,
                    header,
                    content_key: key,
                    index,
                },
                archive_password,
                &opts,
                &seven_zip_outer_folder(&config.vault.display_name),
                dest,
            )
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::VaultConfig;
    use crate::error::UprivError;
    #[allow(unused_imports)]
    use crate::host_fs::HostFsQuery;
    use crate::store::KdfUnlockPreset;
    use crate::test_support::vault_root_with;
    use crate::vault::create::create_vault;
    use crate::vault::fs::{fs_list_tree, fs_mkdir, fs_write_file};
    use crate::vault::open_close::{close_vault, open_vault};
    use crate::vault::seven_zip::{import_logical_seven_zip, probe_logical_seven_zip};

    fn assert_same_store_payload(left: &[u8], right: &[u8]) {
        let left = zip_bodies(left);
        let right = zip_bodies(right);
        assert_eq!(left.len(), right.len());
        for ((left_name, left_body), (right_name, right_body)) in left.iter().zip(right.iter()) {
            assert_eq!(left_name, right_name);
            if left_name == super::super::embedded_settings::ZIP_README_ENTRY {
                assert!(left_body.windows(9).any(|window| window == b"Created: "));
                assert!(right_body.windows(9).any(|window| window == b"Created: "));
            } else {
                assert_eq!(left_body, right_body);
            }
        }
    }

    fn zip_bodies(bytes: &[u8]) -> Vec<(String, Vec<u8>)> {
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        let mut entries = Vec::new();
        for index in 0..archive.len() {
            let mut file = archive.by_index(index).unwrap();
            let name = file.name().to_string();
            let mut body = Vec::new();
            if !file.is_dir() {
                std::io::Read::read_to_end(&mut file, &mut body).unwrap();
            }
            entries.push((name, body));
        }
        entries
    }

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
    fn zip_export_keeps_the_store_danger_notice() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        let notice = root
            .vault_dir("notes")
            .unwrap()
            .join(crate::paths::STORE_DIR_NAME)
            .join(crate::store::STORE_DANGER_FILE_NAME);
        let bytes = crate::host_fs::read(&notice).unwrap();
        crate::host_fs::remove_file(&notice).unwrap();
        let zip = export_store_zip(&root, "notes").unwrap();
        assert_eq!(crate::host_fs::read(&notice).unwrap(), bytes);
        let name = format!(
            "{}/{}",
            crate::paths::STORE_DIR_NAME,
            crate::store::STORE_DANGER_FILE_NAME
        );
        let packed = zip_bodies(&zip)
            .into_iter()
            .find(|(entry, _)| entry == &name)
            .expect("danger notice in the export zip");
        assert_eq!(packed.1, bytes);
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
        let on_disk = crate::host_fs::read(&dest).unwrap();
        assert_eq!(size as usize, on_disk.len());
        assert_same_store_payload(&bytes, &on_disk);
        let embedded = crate::vault::read_zip_config_toml(std::io::Cursor::new(bytes))
            .unwrap()
            .expect("config.toml");
        let parsed = crate::vault::parse_embedded_settings(&embedded).unwrap();
        assert_eq!(parsed.config.vault.display_name, "Notes");
        assert_eq!(parsed.unlock_preset, Some(KdfUnlockPreset::M32));
        let readme = super::super::zip_io::read_zip_root_entry(
            std::io::Cursor::new(on_disk),
            super::super::embedded_settings::ZIP_README_ENTRY,
        )
        .unwrap()
        .expect("README.md");
        let readme = String::from_utf8(readme).unwrap();
        assert!(readme.contains("Created: "));
        assert!(readme.contains('Z'));
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
        fs_write_file(&root, "notes", "/config.toml", b"user-config").unwrap();
        fs_write_file(
            &root,
            "notes",
            "/.upriv-workspace.json",
            b"{\"format_version\":1}\n",
        )
        .unwrap();
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
        assert!(!json.contains("Notes/files"), "{json}");
        let body = crate::vault::fs::fs_read_file(&root, &imported, "/docs/hi.txt").unwrap();
        assert_eq!(body, b"hello-export");
        let named = crate::vault::fs::fs_read_file(&root, &imported, "/config.toml").unwrap();
        assert_eq!(named, b"user-config");
        let workspace =
            crate::vault::fs::fs_read_file(&root, &imported, "/.upriv-workspace.json").unwrap();
        assert!(workspace.is_empty());
        close_vault(&root, &imported, None).unwrap();
    }

    #[test]
    fn seven_zip_clean_vault_imports_with_no_folders() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        let bytes = export_logical_seven_zip(&root, "notes", b"pass-word-ok", None).unwrap();
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
        let listed = fs_list_tree(&root, &imported).unwrap();
        assert!(listed.children.unwrap().is_empty());
        close_vault(&root, &imported, None).unwrap();
    }

    #[test]
    fn seven_zip_round_trip_keeps_empty_folders() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        fs_mkdir(&root, "notes", "/empty").unwrap();
        fs_mkdir(&root, "notes", "/only").unwrap();
        fs_mkdir(&root, "notes", "/only/inner").unwrap();
        fs_mkdir(&root, "notes", "/docs").unwrap();
        fs_mkdir(&root, "notes", "/docs/blank").unwrap();
        fs_write_file(&root, "notes", "/docs/hi.txt", b"hello-export").unwrap();
        close_vault(&root, "notes", None).unwrap();
        let bytes = export_logical_seven_zip(&root, "notes", b"pass-word-ok", None).unwrap();
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
        let json = serde_json::to_string(&fs_list_tree(&root, &imported).unwrap()).unwrap();
        for name in ["empty", "only", "inner", "blank", "hi.txt"] {
            assert!(json.contains(name), "{json}");
        }
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
