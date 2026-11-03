//! Import a `.zip` of `store/` (ciphertext copy) or unpack `backups/<stamp>-<id>.zip`
//! into a new vault.

use crate::host_fs::File;
#[allow(unused_imports)]
use crate::host_fs::HostFsQuery;
use std::io::{ErrorKind, Read};
use std::path::Path;

use crate::config::{known_vault_ids, save_vault_config, VaultConfig};
use crate::error::{Result, UprivError};
use crate::logging::{log_event, LogLevel};
use crate::paths::{display_name_to_vault_id, VaultRoot};
use crate::session::{with_vault_dir_lock, Job, JobKind};
use crate::store::{content_hash_hex, load_header, INDEX_DIR_NAME};

use super::backup::{backup_locator_from_leaf, backup_zip_file, copy_ciphertext_tree};
use super::create::claim_new_vault_dir;
use super::embedded_settings::{parse_embedded_settings, EmbeddedVaultSettings};
use super::persistence::{save_vault_persistence, VaultPersistence};
use super::seven_zip_pack::{ensure_free_ram, try_vec_with_capacity};
use super::unfinished::{forget_import, record_import};
use super::zip_io::{
    buffered_zip_reader, read_zip_config_toml, unzip_store_bytes, unzip_store_path,
};

pub(crate) fn map_archive_open_error(path: &Path, error: std::io::Error) -> UprivError {
    match crate::paths::nofollow_reject(&error) {
        Some(crate::paths::NofollowReject::Symlink) => UprivError::VaultStoreInvalid {
            path: path.to_path_buf(),
            detail: "refusing a symlink".into(),
        },
        Some(crate::paths::NofollowReject::NonFile) => UprivError::VaultStoreInvalid {
            path: path.to_path_buf(),
            detail: "refusing a non-file".into(),
        },
        None if archive_open_unreadable(&error) => {
            UprivError::ImportArchiveNotFound(path.to_path_buf())
        }
        None => error.into(),
    }
}

/// Missing, denied, or `O_NOFOLLOW` rejected by Android FUSE (Downloads).
/// Those are the chosen archive, not the vault-root data folder (`io_error`).
fn archive_open_unreadable(error: &std::io::Error) -> bool {
    if matches!(
        error.kind(),
        ErrorKind::NotFound | ErrorKind::PermissionDenied
    ) {
        return true;
    }
    #[cfg(unix)]
    {
        matches!(
            error.raw_os_error(),
            Some(libc::ENOENT | libc::EACCES | libc::EPERM)
        )
    }
    #[cfg(not(unix))]
    {
        let _ = error;
        false
    }
}

fn prepare_imported_id(root: &VaultRoot, config: &mut VaultConfig) -> Result<String> {
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

/// Make the new vault and fill its `store/` with `fill_store` while `job`
/// runs. A failure or a stop removes the folder; a crash leaves it recorded as
/// unfinished, and the next launch removes it.
fn materialize_imported_store(
    root: &VaultRoot,
    mut config: VaultConfig,
    job: &Job,
    fill_store: impl FnOnce(&Path) -> Result<()>,
) -> Result<String> {
    let id = prepare_imported_id(root, &mut config)?;
    let dest = root.vault_dir(&id)?;
    crate::host_fs::create_dir_all(root.vaults_dir())?;
    let _preparing = claim_new_vault_dir(root, &dest)?;
    with_vault_dir_lock(&dest, || {
        let created: Result<()> = (|| {
            record_import(root, &id)?;
            save_vault_config(&dest, &config)?;
            let store = dest.join(crate::paths::STORE_DIR_NAME);
            fill_store(&store)?;
            crate::store::ensure_danger_notice(&store)?;
            load_header(&store)?;
            if !store.join(INDEX_DIR_NAME).host_is_dir() {
                return Err(UprivError::VaultStoreInvalid {
                    path: store.clone(),
                    detail: "imported store is missing index/".into(),
                });
            }
            job.final_step()?;
            crate::host_fs::create_dir_all(dest.join("backups"))?;
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
        let folder_gone = created.is_ok() || crate::host_fs::remove_dir_all(&dest).is_ok();
        if folder_gone {
            forget_import(root, &id);
        }
        created
    })?;
    log_event(LogLevel::Info, "vault_imported", &[("id", id.as_str())]);
    Ok(id)
}

/// Create a new vault whose `store/` is a ciphertext copy of the zip payload,
/// as the job `job_id`.
pub fn import_store_zip(
    root: &VaultRoot,
    config: VaultConfig,
    zip_bytes: &[u8],
    job_id: &str,
) -> Result<String> {
    let vault_id = config.vault.id.clone();
    Job::run(job_id, JobKind::VaultImport, Some(&vault_id), |job| {
        materialize_imported_store(root, config, job, |store| {
            unzip_store_bytes(zip_bytes, store, job)
        })
    })
}

/// Same as [`import_store_zip`], reading the archive from disk one entry at a time.
fn import_store_zip_path(
    root: &VaultRoot,
    config: VaultConfig,
    zip_path: &Path,
    job: &Job,
) -> Result<String> {
    if !zip_path.is_absolute() || !zip_path.host_is_file() {
        return Err(UprivError::ImportArchiveNotFound(zip_path.to_path_buf()));
    }
    materialize_imported_store(root, config, job, |store| {
        unzip_store_path(zip_path, store, job)
    })
}

/// Create a new vault by copying an existing ciphertext `store/` (or backup) tree.
fn import_store_tree(
    root: &VaultRoot,
    config: VaultConfig,
    src: &Path,
    job: &Job,
) -> Result<String> {
    if !src.host_is_dir() {
        return Err(UprivError::VaultPathNotFound(src.display().to_string()));
    }
    materialize_imported_store(root, config, job, |store| {
        copy_ciphertext_tree(src, store, job)
    })
}

/// Locator `vaults/<id>/backups/<leaf>` or `…/backups/saves/<leaf>`.
/// The leaf is a stamp or the on-disk name `<stamp>-<id>.zip`. The file name
/// selects one zip when two store zips share a stamp.
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
            let stamp = backup_locator_from_leaf(&raw)?;
            if parts.len() != vaults_idx + 5 {
                return None;
            }
            Some((id, format!("saves/{stamp}")))
        }
        Some(raw) => {
            let stamp = backup_locator_from_leaf(raw)?;
            if parts.len() != vaults_idx + 4 {
                return None;
            }
            Some((id, stamp))
        }
        None => None,
    }
}

/// Public settings inside a store zip or a backup locator. Missing entry is `Ok(None)`.
pub fn read_import_zip_settings(
    root: &VaultRoot,
    archive_path: &str,
) -> Result<Option<EmbeddedVaultSettings>> {
    let zip_path = if let Some((id, stamp)) = parse_backup_import_path(archive_path) {
        backup_zip_file(root, &id, &stamp)?
    } else {
        let path = Path::new(archive_path);
        if !path.is_absolute() || !path.host_is_file() {
            return Err(UprivError::ImportArchiveNotFound(path.to_path_buf()));
        }
        path.to_path_buf()
    };
    let file = File::open(&zip_path).map_err(|error| map_archive_open_error(&zip_path, error))?;
    match read_zip_config_toml(buffered_zip_reader(file)?)? {
        Some(bytes) => Ok(Some(parse_embedded_settings(&bytes)?)),
        None => Ok(None),
    }
}

/// Unpack `backups/<stamp>-<id>.zip` into a new vault.
fn import_from_backup(
    root: &VaultRoot,
    source_vault_id: &str,
    stamp: &str,
    config: VaultConfig,
    job: &Job,
) -> Result<String> {
    let zip = backup_zip_file(root, source_vault_id, stamp)?;
    import_store_zip_path(root, config, &zip, job)
}

/// Read a dropped/picked `.zip` or `.7z` from disk. Relative names (a drop
/// filename with no Electron path) must not be resolved against the daemon cwd.
pub fn read_import_archive_bytes(path: &Path) -> Result<Vec<u8>> {
    if !path.is_absolute() {
        return Err(UprivError::ImportArchiveNotFound(path.to_path_buf()));
    }
    let file = match crate::paths::open_nofollow(path, crate::paths::NofollowMode::Read) {
        Ok(file) => file,
        Err(error) => return Err(map_archive_open_error(path, error)),
    };
    let len = file.metadata()?.len();
    // This path copies the archive into a buffer. The decoder's own check is
    // `seven_zip_decode_threads`, separate from this length.
    ensure_free_ram(len)?;
    let mut buf = try_vec_with_capacity(len)?;
    file.take(len).read_to_end(&mut buf)?;
    Ok(buf)
}

/// Zip file, ciphertext directory, or in-root backup locator
/// (`vaults/<id>/backups/<stamp>`), as the job `job_id`.
pub fn import_store_from_archive_path(
    root: &VaultRoot,
    config: VaultConfig,
    archive_path: &str,
    job_id: &str,
) -> Result<String> {
    let vault_id = config.vault.id.clone();
    Job::run(job_id, JobKind::VaultImport, Some(&vault_id), |job| {
        if let Some((source_id, stamp)) = parse_backup_import_path(archive_path) {
            match import_from_backup(root, &source_id, &stamp, config.clone(), job) {
                Ok(id) => return Ok(id),
                Err(error) => {
                    let path = Path::new(archive_path);
                    if path.host_is_dir() && !job.is_stopped() {
                        return import_store_tree(root, config, path, job);
                    }
                    return Err(error);
                }
            }
        }
        let path = Path::new(archive_path);
        if path.host_is_dir() {
            return import_store_tree(root, config, path, job);
        }
        import_store_zip_path(root, config, path, job)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[allow(unused_imports)]
    use crate::host_fs::HostFsQuery;
    use crate::store::KdfUnlockPreset;
    use crate::test_support::{test_job_id, vault_root_with};
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
            parse_backup_import_path("vaults/notes/backups/20260528120000-notes.zip"),
            Some(("notes".into(), "20260528120000-notes.zip".into()))
        );
        assert_eq!(
            parse_backup_import_path("vaults/notes/backups/saves/20260528120000-notes.zip"),
            Some(("notes".into(), "saves/20260528120000-notes.zip".into()))
        );
        assert_eq!(
            parse_backup_import_path("vaults/notes/backups/20260528120000.zip"),
            None
        );
        assert_eq!(
            parse_backup_import_path("/home/u/.upriv/vaults/notes/backups/saves/20260528120000"),
            Some(("notes".into(), "saves/20260528120000".into()))
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
        close_vault(&root, "notes").unwrap();
        let backups = list_backups(&root, "notes").unwrap();
        assert!(!backups.is_empty(), "close should freeze a backup");
        let stamp = backups[0].stamp.clone();
        let new_id = import_from_backup(
            &root,
            "notes",
            &stamp,
            sample_config("notes-backup", "Notes backup"),
            &Job::untracked(),
        )
        .unwrap();
        assert_eq!(new_id, "notes-backup");
        assert!(root.vault_store_dir("notes-backup").unwrap().host_is_dir());
        crate::store::load_header(root.vault_store_dir("notes-backup").unwrap())
            .expect("imported header");
        let notice = crate::store::STORE_DANGER_FILE_NAME;
        assert_eq!(
            crate::host_fs::read(root.vault_store_dir("notes").unwrap().join(notice)).unwrap(),
            crate::host_fs::read(root.vault_store_dir("notes-backup").unwrap().join(notice))
                .unwrap()
        );
    }

    #[test]
    fn a_damaged_blob_restores_the_rest_of_the_vault() {
        let (tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        crate::vault::fs_write_file(&root, "notes", "/a.txt", b"first file").unwrap();
        crate::vault::fs_write_file(&root, "notes", "/b.txt", b"second file").unwrap();
        let a_blob =
            crate::session::with_open_session(&root.vault_dir("notes").unwrap(), |session| {
                let (file_id, _, _) = session
                    .index
                    .find("a.txt")
                    .and_then(|node| node.as_file())
                    .expect("a.txt");
                Ok(format!("{}/{file_id}.blob", &file_id[..2]))
            })
            .unwrap();
        close_vault(&root, "notes").unwrap();
        let stamp = list_backups(&root, "notes").unwrap()[0].stamp.clone();
        let mut bytes =
            crate::host_fs::read(backup_zip_file(&root, "notes", &stamp).unwrap()).unwrap();
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes.clone())).unwrap();
        let blob = (0..archive.len())
            .find(|&index| archive.by_index(index).unwrap().name().ends_with(&a_blob))
            .expect("the blob of a.txt");
        let entry = archive.by_index(blob).unwrap();
        let last = (entry.data_start() + entry.compressed_size() - 1) as usize;
        drop(entry);
        drop(archive);
        // The blob's last byte, inside its AEAD tag: the zip checksum no
        // longer matches either.
        bytes[last] ^= 0x01;
        let damaged = tmp.path().join("damaged.zip");
        crate::host_fs::write(&damaged, &bytes).unwrap();

        let from_file = import_store_zip_path(
            &root,
            sample_config("copy", "Copy"),
            &damaged,
            &Job::untracked(),
        );
        let from_bytes = import_store_zip(
            &root,
            sample_config("copy2", "Copy 2"),
            &bytes,
            &test_job_id(),
        );
        for id in [from_file.unwrap(), from_bytes.unwrap()] {
            open_vault(&root, &id, b"pass-word-ok").unwrap();
            assert!(crate::vault::fs_read_file(&root, &id, "/a.txt").is_err());
            assert_eq!(
                crate::vault::fs_read_file(&root, &id, "/b.txt").unwrap(),
                b"second file"
            );
            close_vault(&root, &id).unwrap();
        }
    }

    #[test]
    fn import_zip_rejects_relative_filename() {
        let (_tmp, root) = vault_root_with(&[]);
        let err = import_store_from_archive_path(
            &root,
            sample_config("x", "X"),
            "Notes.zip",
            &test_job_id(),
        )
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
            &test_job_id(),
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
        let out = tempfile::tempdir().unwrap();
        let exported =
            crate::vault::export_store_zip(&root, "notes", out.path(), &test_job_id()).unwrap();
        let zip = crate::host_fs::read(&exported.path).unwrap();
        open_vault(&root, "other", b"pass-word-ok").unwrap();
        let new_id = import_store_zip(&root, sample_config("copy", "Copy"), &zip, &test_job_id())
            .expect("file import");
        assert_eq!(new_id, "copy");
        close_vault(&root, "other").unwrap();
    }

    #[test]
    fn a_stopped_import_leaves_no_vault_and_no_record() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        let out = tempfile::tempdir().unwrap();
        let exported =
            crate::vault::export_store_zip(&root, "notes", out.path(), &test_job_id()).unwrap();
        let zip = crate::host_fs::read(&exported.path).unwrap();
        let id = test_job_id();
        let job = Job::start(&id).unwrap();
        crate::session::cancel_job(&id).unwrap();
        let err = materialize_imported_store(&root, sample_config("copy", "Copy"), &job, |store| {
            unzip_store_bytes(&zip, store, &job)
        })
        .unwrap_err();
        assert!(matches!(
            job.settle::<()>(Err(err)),
            Err(UprivError::JobCancelled)
        ));
        assert!(!root.vault_dir("copy").unwrap().host_exists());
        let state = crate::runtime_state::load_runtime_state(&root).unwrap();
        assert!(state.unfinished_imports.is_empty());
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
        close_vault(&root, "notes").unwrap();
        let stamp = list_backups(&root, "notes").unwrap()[0].stamp.clone();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        let new_id = import_from_backup(
            &root,
            "notes",
            &stamp,
            sample_config("notes-backup", "Notes backup"),
            &Job::untracked(),
        )
        .unwrap();
        assert_eq!(new_id, "notes-backup");
        close_vault(&root, "notes").unwrap();
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
        close_vault(&root, "notes").unwrap();
        let stamp = list_backups(&root, "notes").unwrap()[0].stamp.clone();
        open_vault(&root, "other", b"pass-word-ok").unwrap();
        let new_id = import_from_backup(
            &root,
            "notes",
            &stamp,
            sample_config("notes-backup", "Notes backup"),
            &Job::untracked(),
        )
        .unwrap();
        assert_eq!(new_id, "notes-backup");
        close_vault(&root, "other").unwrap();
    }
}
