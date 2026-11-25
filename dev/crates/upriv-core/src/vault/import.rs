//! Import a `.zip` of `store/` (ciphertext copy) or unpack `backups/<stamp>-<id>.zip`
//! into a new vault.

use crate::host_fs::File;
#[allow(unused_imports)]
use crate::host_fs::HostFsQuery;
use std::io::{ErrorKind, Read, Seek};
use std::path::Path;

use crate::config::{known_vault_ids, save_vault_config, VaultConfig};
use crate::error::{Result, UprivError};
use crate::logging::{log_event, LogLevel};
use crate::paths::{display_name_to_vault_id, VaultRoot};
use crate::session::{with_vault_dir_lock, Job, JobKind};
use crate::store::{content_hash_hex, load_header, VaultStorage, INDEX_DIR_NAME};

use super::backup::{backup_zip_file, copy_ciphertext_tree, split_backup_locator};
use super::create::{claim_new_vault_dir, fresh_marks, NewVault};
use super::embedded_settings::{parse_embedded_settings, EmbeddedVaultSettings};
use super::package::imported_vault_name;
use super::persistence::{save_vault_persistence, VaultPersistence};
use super::seven_zip_pack::{ensure_free_ram, try_vec_with_capacity};
use super::unfinished::{forget_import, record_import};
use super::zip_io::{
    buffered_zip_reader, read_store_zip_config, unzip_store_bytes, unzip_store_path, StoreEnvelope,
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
///
/// The copied store keeps the storage value sealed in its index, which only
/// its password could change, so the new `config.toml` holds `carried`, the
/// copy the source carried beside it, whatever `config` says. A copy that
/// disagrees with the sealed value meets a reset at the first open.
fn materialize_imported_store(
    root: &VaultRoot,
    mut config: VaultConfig,
    carried: VaultStorage,
    job: &Job,
    fill_store: impl FnOnce(&Path) -> Result<()>,
) -> Result<String> {
    config.storage = carried;
    // A copied store is whole once its copy lands; until then the record
    // below covers it, and a cut-off copy is removed.
    fresh_marks(&mut config, NewVault::Complete);
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
    let carried = carried_storage(std::io::Cursor::new(zip_bytes));
    Job::run(job_id, JobKind::VaultImport, Some(&vault_id), |job| {
        materialize_imported_store(root, config, carried, job, |store| {
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
    let file = File::open(zip_path).map_err(|error| map_archive_open_error(zip_path, error))?;
    let carried = carried_storage(buffered_zip_reader(file)?);
    materialize_imported_store(root, config, carried, job, |store| {
        unzip_store_path(zip_path, store, job)
    })
}

/// Create a new vault by copying an existing ciphertext `store/` (or backup)
/// tree. A folder carries no settings Upriv reads, so its copy of the storage
/// value is the default.
fn import_store_tree(
    root: &VaultRoot,
    config: VaultConfig,
    src: &Path,
    job: &Job,
) -> Result<String> {
    if !src.host_is_dir() {
        return Err(UprivError::VaultPathNotFound(src.display().to_string()));
    }
    materialize_imported_store(root, config, VaultStorage::default(), job, |store| {
        copy_ciphertext_tree(src, store, job)
    })
}

/// The storage value the `config.toml` beside a store zip's `store/` holds.
/// A zip with no settings, or settings that do not read, carries the default.
fn carried_storage<R: Read + Seek>(reader: R) -> VaultStorage {
    read_store_zip_config(reader)
        .ok()
        .and_then(|(_, config)| config)
        .and_then(|bytes| parse_embedded_settings(&bytes).ok())
        .map(|settings| settings.config.storage)
        .unwrap_or_default()
}

/// Locator `vaults/<id>/backups/<key>`: the backup a new vault is made from,
/// named by its key (`<folder>/<file>` or `<folder>/saves/<file>`).
pub fn parse_backup_import_path(path: &str) -> Option<(String, String)> {
    let normalized = path.replace('\\', "/");
    let parts: Vec<&str> = normalized
        .split('/')
        .filter(|part| !part.is_empty())
        .collect();
    let vaults_idx = parts.iter().rposition(|part| *part == "vaults")?;
    let id = (*parts.get(vaults_idx + 1)?).to_string();
    if !crate::paths::slug_id_is_valid(&id) {
        return None;
    }
    if parts.get(vaults_idx + 2).copied() != Some("backups") {
        return None;
    }
    let key = parts.get(vaults_idx + 3..)?.join("/");
    split_backup_locator(&key).map(|key| (id, key))
}

/// What a store zip carries for the vault made from it.
#[derive(Debug, Clone)]
pub struct StoreZipSettings {
    /// The `config.toml` beside `store/`; `None` when the zip has none.
    pub settings: Option<EmbeddedVaultSettings>,
    /// The name the new vault takes: the name its settings hold, as the
    /// person typed it, or else an export's vault folder, the id of the vault
    /// it came from (`super::package::imported_vault_name`).
    pub vault_name: Option<String>,
}

fn store_zip_settings<R: Read + Seek>(reader: R) -> Result<StoreZipSettings> {
    let (envelope, config) = read_store_zip_config(reader)?;
    let settings = config
        .map(|bytes| parse_embedded_settings(&bytes))
        .transpose()?;
    let carried = settings
        .as_ref()
        .map(|settings| settings.config.vault.display_name.as_str());
    let vault_name = match envelope.as_ref().and_then(StoreEnvelope::package) {
        Some(package) => Some(imported_vault_name(carried, package)),
        None => carried
            .filter(|name| !name.trim().is_empty())
            .map(str::to_string),
    };
    Ok(StoreZipSettings {
        settings,
        vault_name,
    })
}

/// Public settings and the vault's name inside a store zip or a backup
/// locator. A missing `config.toml` is no settings.
pub fn read_import_zip_settings(root: &VaultRoot, archive_path: &str) -> Result<StoreZipSettings> {
    let zip_path = if let Some((id, key)) = parse_backup_import_path(archive_path) {
        backup_zip_file(root, &id, &key)?
    } else {
        let path = Path::new(archive_path);
        if !path.is_absolute() || !path.host_is_file() {
            return Err(UprivError::ImportArchiveNotFound(path.to_path_buf()));
        }
        path.to_path_buf()
    };
    let file = File::open(&zip_path).map_err(|error| map_archive_open_error(&zip_path, error))?;
    store_zip_settings(buffered_zip_reader(file)?)
}

/// [`read_import_zip_settings`] for a store zip already in memory.
pub fn read_import_zip_bytes_settings(zip_bytes: &[u8]) -> Result<StoreZipSettings> {
    store_zip_settings(std::io::Cursor::new(zip_bytes))
}

/// Unpack the backup `key` of `source_vault_id` into a new vault.
fn import_from_backup(
    root: &VaultRoot,
    source_vault_id: &str,
    key: &str,
    config: VaultConfig,
    job: &Job,
) -> Result<String> {
    let zip = backup_zip_file(root, source_vault_id, key)?;
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
        if let Some((source_id, key)) = parse_backup_import_path(archive_path) {
            match import_from_backup(root, &source_id, &key, config.clone(), job) {
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
    fn a_backup_locator_names_a_backup_by_its_key() {
        assert_eq!(
            parse_backup_import_path("vaults/notes/backups/data/20260528120000-notes.zip"),
            Some(("notes".into(), "data/20260528120000-notes.zip".into()))
        );
        assert_eq!(
            parse_backup_import_path(
                "/home/u/.upriv/vaults/notes/backups/f2/saves/20260528120000-notes Trip.zip"
            ),
            Some((
                "notes".into(),
                "f2/saves/20260528120000-notes Trip.zip".into()
            ))
        );
        assert_eq!(
            parse_backup_import_path(
                r"C:\Upriv\.upriv\vaults\notes\backups\use\20260528120000-notes.zip"
            ),
            Some(("notes".into(), "use/20260528120000-notes.zip".into()))
        );
        for refused in [
            "vaults/notes/backups/20260528120000-notes.zip",
            "vaults/notes/backups/data/20260528120000.zip",
            "vaults/notes/backups/elsewhere/20260528120000-notes.zip",
            "vaults/notes/backups/data/saves/saves/20260528120000-notes.zip",
            "vaults/../backups/data/20260528120000-notes.zip",
            "/tmp/Notes.zip",
            "vaults/notes/store",
        ] {
            assert_eq!(parse_backup_import_path(refused), None, "{refused}");
        }
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
        let key = backups[0].key.clone();
        let new_id = import_from_backup(
            &root,
            "notes",
            &key,
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
        let key = list_backups(&root, "notes").unwrap()[0].key.clone();
        let mut bytes =
            crate::host_fs::read(backup_zip_file(&root, "notes", &key).unwrap()).unwrap();
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes.clone())).unwrap();
        let blob = (0..archive.len())
            .find(|&index| archive.by_index(index).unwrap().name().ends_with(&a_blob))
            .expect("the blob of a.txt");
        let entry = archive.by_index(blob).unwrap();
        // Past the key copy and the nonce, inside the blob's one chunk: the
        // zip checksum no longer matches either.
        let in_chunk = (entry.data_start() + crate::store::KEY_COPY_LEN + 30) as usize;
        drop(entry);
        drop(archive);
        bytes[in_chunk] ^= 0x01;
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
        let err = materialize_imported_store(
            &root,
            sample_config("copy", "Copy"),
            VaultStorage::default(),
            &job,
            |store| unzip_store_bytes(&zip, store, &job),
        )
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
        let key = list_backups(&root, "notes").unwrap()[0].key.clone();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        let new_id = import_from_backup(
            &root,
            "notes",
            &key,
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
        let key = list_backups(&root, "notes").unwrap()[0].key.clone();
        open_vault(&root, "other", b"pass-word-ok").unwrap();
        let new_id = import_from_backup(
            &root,
            "notes",
            &key,
            sample_config("notes-backup", "Notes backup"),
            &Job::untracked(),
        )
        .unwrap();
        assert_eq!(new_id, "notes-backup");
        close_vault(&root, "other").unwrap();
    }

    const PLAIN_WHOLE: VaultStorage = VaultStorage {
        mode: crate::store::VaultStorageMode::UprivPlain,
        plain_files: crate::store::VaultPlainFiles::Whole,
    };

    /// A closed plain-text vault `notes` of every file, and the store zip of it.
    fn plain_vault_zip(root: &VaultRoot) -> Vec<u8> {
        let mut config = sample_config("notes", "Notes");
        config.storage = PLAIN_WHOLE;
        create_vault(root, config, b"pass-word-ok", KdfUnlockPreset::M32).unwrap();
        let out = tempfile::tempdir().unwrap();
        let exported =
            crate::vault::export_store_zip(root, "notes", out.path(), &test_job_id()).unwrap();
        crate::host_fs::read(&exported.path).unwrap()
    }

    fn sealed_storage(root: &VaultRoot, vault_id: &str) -> VaultStorage {
        crate::store::open_store(root.vault_store_dir(vault_id).unwrap(), b"pass-word-ok")
            .unwrap()
            .index
            .storage
    }

    #[test]
    fn a_store_zip_copy_keeps_its_sealed_value_and_takes_the_copy_it_carries() {
        let (_tmp, root) = vault_root_with(&[]);
        let zip = plain_vault_zip(&root);
        let asked = sample_config("copy", "Copy");
        assert_eq!(asked.storage, VaultStorage::default());
        let id = import_store_zip(&root, asked, &zip, &test_job_id()).unwrap();
        let config = crate::config::load_vault_config(root.vault_dir(&id).unwrap()).unwrap();
        assert_eq!(config.storage, PLAIN_WHOLE);
        assert_eq!(sealed_storage(&root, &id), PLAIN_WHOLE);
    }

    #[test]
    fn a_backup_copy_takes_the_copy_its_zip_carries() {
        let (_tmp, root) = vault_root_with(&[]);
        let mut config = sample_config("notes", "Notes");
        config.storage = PLAIN_WHOLE;
        config.backup.enabled = true;
        create_vault(&root, config, b"pass-word-ok", KdfUnlockPreset::M32).unwrap();
        let key = crate::vault::save_backup_now(&root, "notes", &test_job_id())
            .unwrap()
            .entry
            .key;
        let id = import_from_backup(
            &root,
            "notes",
            &key,
            sample_config("copy", "Copy"),
            &Job::untracked(),
        )
        .unwrap();
        let config = crate::config::load_vault_config(root.vault_dir(&id).unwrap()).unwrap();
        assert_eq!(config.storage, PLAIN_WHOLE);
        assert_eq!(sealed_storage(&root, &id), PLAIN_WHOLE);
    }

    #[test]
    fn a_store_zip_with_no_settings_carries_the_default() {
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        zip.start_file("store/header/vault.header", Default::default())
            .unwrap();
        std::io::Write::write_all(&mut zip, b"header").unwrap();
        let bytes = zip.finish().unwrap().into_inner();
        assert_eq!(
            carried_storage(std::io::Cursor::new(bytes)),
            VaultStorage::default()
        );
        assert_eq!(
            carried_storage(std::io::Cursor::new(b"not a zip".to_vec())),
            VaultStorage::default()
        );
    }

    #[test]
    fn a_ciphertext_folder_copy_holds_the_default_copy() {
        let (_tmp, root) = vault_root_with(&[]);
        let mut config = sample_config("notes", "Notes");
        config.storage = PLAIN_WHOLE;
        create_vault(&root, config, b"pass-word-ok", KdfUnlockPreset::M32).unwrap();
        let source = root.vault_store_dir("notes").unwrap();
        let id = import_store_from_archive_path(
            &root,
            sample_config("copy", "Copy"),
            &source.display().to_string(),
            &test_job_id(),
        )
        .unwrap();
        let config = crate::config::load_vault_config(root.vault_dir(&id).unwrap()).unwrap();
        assert_eq!(config.storage, VaultStorage::default());
        assert_eq!(sealed_storage(&root, &id), PLAIN_WHOLE);
    }
}
