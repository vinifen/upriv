//! Portable export: `.zip` of `store/` (ciphertext). `.7z` is Plan B.
//!
//! An export writes `{display_name}.zip` or `{display_name}.7z` into the
//! folder the person chose. It never replaces a file already using that name:
//! it takes the next free number instead (`{display_name} 2.zip`) and logs
//! `vault_export_numbered`. Each export runs as a job the UI can stop by its id
//! (`job_cancel`); a stopped or failed export removes the file it was writing
//! and returns the error ([`UprivError::JobCancelled`] for a stop).

use std::path::{Path, PathBuf};

use crate::config::load_vault_config;
use crate::config::vault_config::VaultSevenZipSection;
use crate::config::VaultConfig;
use crate::error::{Result, UprivError};
#[allow(unused_imports)]
use crate::host_fs::HostFsQuery;
use crate::logging::{log_event, LogLevel};
use crate::paths::{seven_zip_outer_folder, vault_export_file_stem, VaultRoot};
use crate::session::{
    check_unlock_allowed, ensure_vault_session_closed, is_vault_closing_at, is_vault_open_at,
    record_unlock_failure, record_unlock_success, with_unlock_lock, with_vault_dir_lock, Job,
    PreparingGuard,
};
use crate::store::{is_reserved_logical, open_store, VaultHeader, VaultIndex};
use crate::time::utc_filename_stamp;

use super::backup::{log_job_error, vault_id_log_field};
use super::embedded_settings::snapshot_settings_bytes;
use super::export_folder::{
    check_export_folder, unreachable_folder_as_io, ExportFile, NumberedExportName,
};
use super::partial::{discard_partial, PartialWork};
use super::seven_zip_pack::{
    pack_logical_seven_zip_to_writer, plan_seven_zip_pack, LogicalSevenZipSource, PackLimits,
};
use super::zip_io::zip_store_with_config_to_path;

fn closed_vault_paths(root: &VaultRoot, vault_id: &str) -> Result<(PathBuf, PathBuf)> {
    let vault_dir = root.vault_dir(vault_id)?;
    if !vault_dir.host_is_dir() {
        return Err(UprivError::VaultNotFound(vault_dir));
    }
    let _ = load_vault_config(&vault_dir)?;
    ensure_vault_session_closed(&vault_dir)?;
    let store = vault_dir.join(crate::paths::STORE_DIR_NAME);
    Ok((vault_dir, store))
}

/// Closed vault plus the exclusive hold that refuses open until the export
/// or save that took it returns.
pub(super) struct ClosedVaultHold {
    pub(super) vault_dir: PathBuf,
    pub(super) store: PathBuf,
    _preparing: PreparingGuard,
}

pub(super) fn hold_closed_vault(root: &VaultRoot, vault_id: &str) -> Result<ClosedVaultHold> {
    let (vault_dir, store) = closed_vault_paths(root, vault_id)?;
    let preparing = PreparingGuard::enter_exclusive(&vault_dir)?;
    Ok(ClosedVaultHold {
        vault_dir,
        store,
        _preparing: preparing,
    })
}

/// Read the closed vault while holding its directory lock. Delete and rename
/// take the same lock and re-check the preparing mark, so they cannot wipe or
/// move `store/` under this read.
pub(super) fn with_held_vault<T>(
    hold: &ClosedVaultHold,
    f: impl FnOnce() -> Result<T>,
) -> Result<T> {
    with_vault_dir_lock(&hold.vault_dir, || {
        if !hold.vault_dir.host_is_dir() {
            return Err(UprivError::VaultNotFound(hold.vault_dir.clone()));
        }
        if is_vault_open_at(&hold.vault_dir) || is_vault_closing_at(&hold.vault_dir) {
            return Err(UprivError::VaultMustBeClosed);
        }
        f()
    })
}

fn unlock_closed_store<T>(
    vault_dir: &Path,
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

/// The file a vault export wrote.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VaultExportFile {
    pub path: PathBuf,
    pub size: u64,
    /// `1` for `{display_name}.zip`; higher when that name was taken and the
    /// file got this number (`{display_name} 2.zip`).
    pub number: u32,
}

/// Zip of `store/` plus `README.md` and `config.toml` (no zip password),
/// written into `dest_dir` as `{display_name}.zip` by the job `job_id`. This
/// vault must be closed.
pub fn export_store_zip(
    root: &VaultRoot,
    vault_id: &str,
    dest_dir: &Path,
    job_id: &str,
) -> Result<VaultExportFile> {
    let written = (|| {
        let job = Job::start(job_id)?;
        let (_, target) = export_target(root, vault_id, dest_dir, "zip")?;
        let hold = hold_closed_vault(root, vault_id)?;
        write_export_file(root, &target, &job, |partial| {
            with_held_vault(&hold, || {
                crate::store::ensure_danger_notice(&hold.store)?;
                let settings = snapshot_settings_bytes(&hold.vault_dir, &hold.store)?;
                zip_store_with_config_to_path(
                    &hold.store,
                    &settings,
                    &utc_filename_stamp(),
                    partial,
                    &job,
                )
            })
        })
    })();
    log_export_outcome(vault_id, "zip", &written);
    written
}

/// Where an export goes: the first free numbered name in the chosen folder,
/// and the partial it is written as.
struct ExportTarget {
    dir: PathBuf,
    name: NumberedExportName,
    number: u32,
    partial: PathBuf,
}

/// This vault's settings and where its export would go in `dest_dir`.
fn export_target(
    root: &VaultRoot,
    vault_id: &str,
    dest_dir: &Path,
    extension: &str,
) -> Result<(VaultConfig, ExportTarget)> {
    let vault_dir = root.vault_dir(vault_id)?;
    if !vault_dir.host_is_dir() {
        return Err(UprivError::VaultNotFound(vault_dir));
    }
    let config = load_vault_config(&vault_dir)?;
    check_export_folder(root, dest_dir)?;
    let name = NumberedExportName::new(
        &vault_export_file_stem(&config.vault.display_name),
        extension,
    );
    let number = name.first_free(dest_dir, 1)?;
    let partial = ExportFile::new(dest_dir, &name.file_name(number)).partial;
    let target = ExportTarget {
        dir: dest_dir.to_path_buf(),
        name,
        number,
        partial,
    };
    Ok((config, target))
}

/// Write the export into its partial with `write`, then move it to its free
/// name. On any failure the partial is removed; a failure after a stop reads
/// as the stop.
fn write_export_file(
    root: &VaultRoot,
    target: &ExportTarget,
    job: &Job,
    write: impl FnOnce(&Path) -> Result<u64>,
) -> Result<VaultExportFile> {
    let installed = (|| {
        let size = job.settle(write(&target.partial))?;
        job.ensure_running()?;
        let (path, number) = target
            .name
            .install(&target.dir, &target.partial, target.number)?;
        Ok(VaultExportFile { path, size, number })
    })();
    installed.map_err(|error| {
        discard_partial(&target.partial, PartialWork::VaultExport);
        unreachable_folder_as_io(error, root)
    })
}

/// `vault_export_numbered` when the name was taken and the file got a number;
/// `vault_export_cancelled` or `vault_export_failed` for an export that ended
/// without its file. No path or name goes to the log.
fn log_export_outcome(vault_id: &str, format: &str, written: &Result<VaultExportFile>) {
    let mut fields = vec![("format", format)];
    fields.extend(vault_id_log_field(vault_id));
    match written {
        Ok(file) if file.number > 1 => {
            let number = file.number.to_string();
            fields.push(("number", number.as_str()));
            log_event(LogLevel::Info, "vault_export_numbered", &fields);
        }
        Ok(_) => {}
        Err(error) => log_job_error(
            "vault_export_cancelled",
            "vault_export_failed",
            &fields,
            error,
        ),
    }
}

fn pack_logical_seven_zip_to_path(
    source: LogicalSevenZipSource<'_>,
    index: &VaultIndex,
    archive_password: &[u8],
    opts: &VaultSevenZipSection,
    outer: &str,
    dest: &Path,
    job: &Job,
) -> Result<u64> {
    job.ensure_running()?;
    let plan = plan_seven_zip_pack(
        index,
        opts,
        outer,
        is_reserved_logical,
        PackLimits::current(),
    )?;
    let file = crate::host_fs::File::create(dest)?;
    let file =
        pack_logical_seven_zip_to_writer(file, source, archive_password, opts, outer, &plan, job)?;
    Ok(file.metadata()?.len())
}

fn with_logical_store<T>(
    root: &VaultRoot,
    vault_id: &str,
    archive_password: &[u8],
    f: impl FnOnce(&Path, &VaultHeader, &[u8; 32], &VaultIndex) -> Result<T>,
) -> Result<T> {
    let hold = hold_closed_vault(root, vault_id)?;
    with_held_vault(&hold, || {
        let opened = unlock_closed_store(&hold.vault_dir, archive_password, || {
            open_store(&hold.store, archive_password)
        })?;
        f(
            &hold.store,
            &opened.header,
            &opened.content_key,
            &opened.index,
        )
    })
}

/// Logical `.7z` of vault files (never `.enc` blobs), written into `dest_dir`
/// as `{display_name}.7z` by the job `job_id`. Plaintext stays in RAM; the file
/// is 7-Zip AES ciphertext. This vault must be closed; the password unlocks
/// `store/` for the read.
pub fn export_logical_seven_zip(
    root: &VaultRoot,
    vault_id: &str,
    archive_password: &[u8],
    options: Option<&VaultSevenZipSection>,
    dest_dir: &Path,
    job_id: &str,
) -> Result<VaultExportFile> {
    let written = (|| {
        let job = Job::start(job_id)?;
        let (config, target) = export_target(root, vault_id, dest_dir, "7z")?;
        let opts = options.cloned().unwrap_or(config.seven_zip);
        write_export_file(root, &target, &job, |partial| {
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
                        },
                        index,
                        archive_password,
                        &opts,
                        &seven_zip_outer_folder(&config.vault.display_name),
                        partial,
                        &job,
                    )
                },
            )
        })
    })();
    log_export_outcome(vault_id, "7z", &written);
    written
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::VaultConfig;
    use crate::error::UprivError;
    #[allow(unused_imports)]
    use crate::host_fs::HostFsQuery;
    use crate::session::cancel_job;
    use crate::store::{KdfUnlockPreset, SEED_LOGICAL_PATH};
    use crate::test_support::{test_job_id, vault_root_with};
    use crate::vault::create::create_vault;
    use crate::vault::fs::{fs_list_tree, fs_mkdir, fs_write_file};
    use crate::vault::open_close::{close_vault, open_vault};
    use crate::vault::seven_zip::{import_logical_seven_zip, probe_logical_seven_zip};

    /// The store zip a fresh export job writes.
    fn store_zip(root: &VaultRoot, vault_id: &str) -> Result<Vec<u8>> {
        let out = tempfile::tempdir().unwrap();
        let file = export_store_zip(root, vault_id, out.path(), &test_job_id())?;
        let bytes = crate::host_fs::read(&file.path).unwrap();
        assert_eq!(file.size as usize, bytes.len());
        Ok(bytes)
    }

    /// The `.7z` a fresh export job writes.
    fn seven_zip(root: &VaultRoot, vault_id: &str, password: &[u8]) -> Result<Vec<u8>> {
        let out = tempfile::tempdir().unwrap();
        let file =
            export_logical_seven_zip(root, vault_id, password, None, out.path(), &test_job_id())?;
        Ok(crate::host_fs::read(&file.path).unwrap())
    }

    fn notes_root() -> (tempfile::TempDir, VaultRoot) {
        let (tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "My notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        (tmp, root)
    }

    fn entry_names(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = crate::host_fs::read_dir(dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn the_export_is_named_after_the_vault_in_the_chosen_folder() {
        let (_tmp, root) = notes_root();
        let out = tempfile::tempdir().unwrap();
        let zip = export_store_zip(&root, "notes", out.path(), &test_job_id()).unwrap();
        assert_eq!(zip.path, out.path().join("My notes.zip"));
        assert_eq!(zip.number, 1);
        let seven = export_logical_seven_zip(
            &root,
            "notes",
            b"pass-word-ok",
            None,
            out.path(),
            &test_job_id(),
        )
        .unwrap();
        assert_eq!(seven.path, out.path().join("My notes.7z"));
        assert_eq!(entry_names(out.path()), ["My notes.7z", "My notes.zip"]);
    }

    #[test]
    fn a_taken_name_gets_the_next_free_number_and_nothing_is_replaced() {
        let (_tmp, root) = notes_root();
        let out = tempfile::tempdir().unwrap();
        let older = out.path().join("My notes.zip");
        crate::host_fs::write(&older, b"older export").unwrap();
        let zip = export_store_zip(&root, "notes", out.path(), &test_job_id()).unwrap();
        assert_eq!(zip.path, out.path().join("My notes 2.zip"));
        assert_eq!(zip.number, 2);
        assert_eq!(crate::host_fs::read(&older).unwrap(), b"older export");
        assert_eq!(&crate::host_fs::read(&zip.path).unwrap()[..2], b"PK");

        // A .7z still being written under the name holds it too.
        let writing = out.path().join("My notes.7z.upriv-part");
        crate::host_fs::write(&writing, b"another export").unwrap();
        let seven = export_logical_seven_zip(
            &root,
            "notes",
            b"pass-word-ok",
            None,
            out.path(),
            &test_job_id(),
        )
        .unwrap();
        assert_eq!(seven.path, out.path().join("My notes 2.7z"));
        assert_eq!(crate::host_fs::read(&writing).unwrap(), b"another export");
        assert_eq!(
            entry_names(out.path()),
            [
                "My notes 2.7z",
                "My notes 2.zip",
                "My notes.7z.upriv-part",
                "My notes.zip"
            ]
        );
    }

    #[test]
    fn an_export_cannot_go_inside_a_upriv_folder() {
        let (_tmp, root) = notes_root();
        let inside = root.root().join(".upriv/app");
        crate::host_fs::create_dir_all(&inside).unwrap();
        assert!(matches!(
            export_store_zip(&root, "notes", &inside, &test_job_id()),
            Err(UprivError::ExportDestinationReserved(_))
        ));
        assert!(entry_names(&inside).is_empty());
    }

    #[test]
    fn a_failed_export_leaves_no_file() {
        let (_tmp, root) = notes_root();
        let out = tempfile::tempdir().unwrap();
        assert!(matches!(
            export_logical_seven_zip(&root, "notes", b"wrong", None, out.path(), &test_job_id()),
            Err(UprivError::WrongPassword)
        ));
        assert!(entry_names(out.path()).is_empty());
    }

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
        close_vault(&root, "notes").unwrap();
        let zip = store_zip(&root, "notes").unwrap();
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
        let zip = store_zip(&root, "notes").unwrap();
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
    fn zip_export_carries_the_vault_settings() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        let bytes = store_zip(&root, "notes").unwrap();
        let on_disk = store_zip(&root, "notes").unwrap();
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
    fn wrong_seven_zip_passwords_count_toward_the_unlock_limit() {
        let (_tmp, root) = notes_root();
        let notes = root.vault_dir("notes").unwrap();
        crate::session::clear_throttle_key_for_tests(&notes);
        let out = tempfile::tempdir().unwrap();
        let export = |password: &[u8]| {
            export_logical_seven_zip(&root, "notes", password, None, out.path(), &test_job_id())
        };
        for attempt in 0..5 {
            assert!(
                matches!(export(b"not-the-password"), Err(UprivError::WrongPassword)),
                "attempt {attempt}"
            );
        }
        assert!(matches!(
            export(b"pass-word-ok"),
            Err(UprivError::VaultUnlockBlocked { .. })
        ));
        assert!(entry_names(out.path()).is_empty());
        crate::session::clear_throttle_key_for_tests(&notes);
        export(b"pass-word-ok").unwrap();
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
        let err = seven_zip(&root, "notes", b"").unwrap_err();
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
        close_vault(&root, "notes").unwrap();
        let bytes = seven_zip(&root, "notes", b"pass-word-ok").expect("in-RAM .7z export");
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
            None,
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
        close_vault(&root, &imported).unwrap();
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
        let bytes = seven_zip(&root, "notes", b"pass-word-ok").unwrap();
        let imported = import_logical_seven_zip(
            &root,
            sample_config("notes-7z", "Notes 7z"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
            &bytes,
            b"pass-word-ok",
            None,
        )
        .unwrap();
        open_vault(&root, &imported, b"pass-word-ok").unwrap();
        let listed = fs_list_tree(&root, &imported).unwrap();
        assert!(listed.children.unwrap().is_empty());
        close_vault(&root, &imported).unwrap();
    }

    #[test]
    fn seven_zip_reimport_keeps_one_readme() {
        let (_tmp, root) = vault_root_with(&[]);
        let first = crate::vault::VaultWelcome {
            readme: "# First note\n",
            workspace: "{\"format_version\":1}\n",
        };
        crate::vault::create_vault_with_welcome(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
            Some(first),
        )
        .unwrap();
        let bytes = seven_zip(&root, "notes", b"pass-word-ok").unwrap();
        let second = crate::vault::VaultWelcome {
            readme: "# Second note\n",
            workspace: "{\"format_version\":1,\"openTabs\":[\"/README.md\"]}\n",
        };
        let imported = import_logical_seven_zip(
            &root,
            sample_config("notes-7z", "Notes 7z"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
            &bytes,
            b"pass-word-ok",
            Some(second),
        )
        .unwrap();
        open_vault(&root, &imported, b"pass-word-ok").unwrap();
        let names: Vec<String> = fs_list_tree(&root, &imported)
            .unwrap()
            .children
            .unwrap_or_default()
            .into_iter()
            .map(|child| child.name)
            .collect();
        assert_eq!(names, vec!["README.md".to_string()]);
        let readme = crate::vault::fs::fs_read_file(&root, &imported, "/README.md").unwrap();
        assert_eq!(readme, b"# First note\n");
        let layout =
            crate::vault::fs::fs_read_file(&root, &imported, "/.upriv-workspace.json").unwrap();
        assert_ne!(layout, second.workspace.as_bytes());
        close_vault(&root, &imported).unwrap();
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
        close_vault(&root, "notes").unwrap();
        let bytes = seven_zip(&root, "notes", b"pass-word-ok").unwrap();
        let imported = import_logical_seven_zip(
            &root,
            sample_config("notes-7z", "Notes 7z"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
            &bytes,
            b"pass-word-ok",
            None,
        )
        .unwrap();
        open_vault(&root, &imported, b"pass-word-ok").unwrap();
        let json = serde_json::to_string(&fs_list_tree(&root, &imported).unwrap()).unwrap();
        for name in ["empty", "only", "inner", "blank", "hi.txt"] {
            assert!(json.contains(name), "{json}");
        }
        close_vault(&root, &imported).unwrap();
    }

    #[test]
    fn export_refuses_while_the_vault_is_held() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        let vault_dir = root.vault_dir("notes").unwrap();
        let _held = PreparingGuard::enter(&vault_dir).unwrap();
        let err = store_zip(&root, "notes").unwrap_err();
        assert!(matches!(err, UprivError::VaultBusy));
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
        let err = store_zip(&root, "notes").unwrap_err();
        assert!(matches!(err, UprivError::VaultMustBeClosed));
        let err = seven_zip(&root, "notes", b"pass-word-ok").unwrap_err();
        assert!(matches!(err, UprivError::VaultMustBeClosed));
        close_vault(&root, "notes").unwrap();
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
        let zip = store_zip(&root, "notes").unwrap();
        assert_eq!(&zip[..2], b"PK");
        close_vault(&root, "other").unwrap();
    }

    #[test]
    fn a_stopped_export_writes_nothing_and_frees_the_vault() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        let out = tempfile::tempdir().unwrap();
        let job = test_job_id();
        cancel_job(&job);
        assert!(matches!(
            export_store_zip(&root, "notes", out.path(), &job),
            Err(UprivError::JobCancelled)
        ));

        let job = test_job_id();
        cancel_job(&job);
        assert!(matches!(
            export_logical_seven_zip(&root, "notes", b"pass-word-ok", None, out.path(), &job),
            Err(UprivError::JobCancelled)
        ));
        assert!(entry_names(out.path()).is_empty());

        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn a_stop_during_the_pack_ends_it() {
        let (tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        fs_write_file(&root, "notes", "/docs/hi.txt", b"hello-export").unwrap();
        close_vault(&root, "notes").unwrap();
        let vault_dir = root.vault_dir("notes").unwrap();
        let store = vault_dir.join(crate::paths::STORE_DIR_NAME);
        let opened = open_store(&store, b"pass-word-ok").unwrap();
        let dest = tmp.path().join("Notes.7z");
        let id = test_job_id();
        let job = Job::start(&id).unwrap();
        cancel_job(&id);
        let packed = pack_logical_seven_zip_to_path(
            LogicalSevenZipSource {
                store_dir: &store,
                header: &opened.header,
                content_key: &opened.content_key,
            },
            &opened.index,
            b"pass-word-ok",
            &VaultSevenZipSection::default(),
            "Notes",
            &dest,
            &job,
        );
        assert!(matches!(job.settle(packed), Err(UprivError::JobCancelled)));
    }
}
