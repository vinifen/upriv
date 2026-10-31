//! Portable export: `.zip` of `store/` (ciphertext). `.7z` is Plan B. A
//! plain-text `.zip` takes the data out readable, not encrypted at all.
//!
//! An export writes `{display_name}.zip`, `{display_name}.7z`, or
//! the same `{display_name}.zip` for a plain-text one, into the folder the person
//! chose. It never replaces a file already using that name: it takes the next free number
//! instead (`{display_name} 2.zip`) and logs `vault_export_numbered`. Each
//! export runs as a job the UI can stop by its id (`job_cancel`); a stopped or
//! failed export removes the file it was writing, overwriting a plain-text one
//! first, and returns the error ([`UprivError::JobCancelled`] for a stop).

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
use crate::store::{is_reserved_logical, open_store, VaultIndex};
use crate::time::utc_filename_stamp;

use super::backup::{log_job_error, vault_id_log_field};
use super::config_folder::{config_folder_files, ExportInclude};
use super::embedded_settings::snapshot_settings_bytes;
use super::export_folder::{
    check_export_folder, ExportedFile, NumberedExportName, NumberedExportTarget,
};
use super::partial::{wipe_partial, PartialWork};
use super::plain_zip::{forget_plain_export, record_plain_export, write_plain_zip};
use super::seven_zip_pack::{
    pack_logical_seven_zip_to_writer, plan_seven_zip_pack, ArchiveLayout, LogicalSource, PackLimits,
};
use super::wipe::WipeOptions;
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

/// Zip of `store/` plus `README.md` and `config.toml` (no zip password),
/// written into `dest_dir` as `{display_name}.zip` by the job `job_id`. This
/// vault must be closed.
pub fn export_store_zip(
    root: &VaultRoot,
    vault_id: &str,
    dest_dir: &Path,
    job_id: &str,
) -> Result<ExportedFile> {
    let written = (|| {
        let job = Job::start(job_id)?;
        let (_, target) = export_target(root, vault_id, dest_dir, "zip")?;
        let hold = hold_closed_vault(root, vault_id)?;
        target.write(root, &job, PartialWork::VaultExport, |partial| {
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

/// This vault's settings and where its export would go in `dest_dir`.
fn export_target(
    root: &VaultRoot,
    vault_id: &str,
    dest_dir: &Path,
    extension: &str,
) -> Result<(VaultConfig, NumberedExportTarget)> {
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
    Ok((config, NumberedExportTarget::new(dest_dir, name)?))
}

/// `vault_export_numbered` when the name was taken and the file got a number;
/// `vault_export_cancelled` or `vault_export_failed` for an export that ended
/// without its file. No path or name goes to the log.
fn log_export_outcome(vault_id: &str, format: &str, written: &Result<ExportedFile>) {
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
    source: LogicalSource<'_>,
    index: &VaultIndex,
    archive_password: &[u8],
    opts: &VaultSevenZipSection,
    layout: ArchiveLayout<'_>,
    dest: &Path,
    job: &Job,
) -> Result<u64> {
    job.ensure_running()?;
    let plan = plan_seven_zip_pack(
        index,
        opts,
        layout.outer,
        is_reserved_logical,
        PackLimits::current(),
    )?;
    let file = crate::host_fs::File::create(dest)?;
    let file =
        pack_logical_seven_zip_to_writer(file, source, archive_password, opts, layout, &plan, job)?;
    Ok(file.metadata()?.len())
}

/// Run `f` on the closed vault, unlocked with `password`: its folder, where its
/// logical files are read from, and their index.
fn with_logical_store<T>(
    root: &VaultRoot,
    vault_id: &str,
    password: &[u8],
    f: impl FnOnce(&Path, LogicalSource<'_>, &VaultIndex) -> Result<T>,
) -> Result<T> {
    let hold = hold_closed_vault(root, vault_id)?;
    with_held_vault(&hold, || {
        let opened = unlock_closed_store(&hold.vault_dir, password, || {
            open_store(&hold.store, password)
        })?;
        f(
            &hold.vault_dir,
            LogicalSource {
                store_dir: &hold.store,
                header: &opened.header,
                content_key: &opened.content_key,
            },
            &opened.index,
        )
    })
}

/// Logical `.7z` of vault files (never `.enc` blobs), written into `dest_dir`
/// as `{display_name}.7z` by the job `job_id`, with `.upriv-config/` carrying
/// what `include` asks for. Plaintext stays in RAM; the file is 7-Zip AES
/// ciphertext. This vault must be closed; the password unlocks `store/` for
/// the read.
pub fn export_logical_seven_zip(
    root: &VaultRoot,
    vault_id: &str,
    archive_password: &[u8],
    options: Option<&VaultSevenZipSection>,
    include: ExportInclude,
    dest_dir: &Path,
    job_id: &str,
) -> Result<ExportedFile> {
    let written = (|| {
        let job = Job::start(job_id)?;
        let (config, target) = export_target(root, vault_id, dest_dir, "7z")?;
        let opts = options.cloned().unwrap_or(config.seven_zip);
        let outer = seven_zip_outer_folder(&config.vault.display_name);
        target.write(root, &job, PartialWork::VaultExport, |partial| {
            with_logical_store(
                root,
                vault_id,
                archive_password,
                |vault_dir, source, index| {
                    let config_files = config_folder_files(vault_dir, source, index, include)?;
                    let layout = ArchiveLayout {
                        outer: &outer,
                        config_files: &config_files,
                    };
                    pack_logical_seven_zip_to_path(
                        source,
                        index,
                        archive_password,
                        &opts,
                        layout,
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

/// Readable `.zip` of vault files at its root, written into `dest_dir`
/// as `{display_name}.zip` by the job `job_id`, with `.upriv-config/`
/// carrying what `include` asks for. **Not encrypted:** anyone who gets the
/// file reads the vault. This vault must be closed; the password unlocks
/// `store/` for the read. A stop or a failure overwrites the unfinished file.
pub fn export_plain_zip(
    root: &VaultRoot,
    vault_id: &str,
    password: &[u8],
    include: ExportInclude,
    dest_dir: &Path,
    job_id: &str,
) -> Result<ExportedFile> {
    let written = (|| {
        let job = Job::start(job_id)?;
        let (config, target) = export_target(root, vault_id, dest_dir, "zip")?;
        let wipe = WipeOptions::from_vault_config(&config);
        let mut partial_gone = true;
        let written = target.write_clearing(
            root,
            &job,
            |partial| {
                with_logical_store(root, vault_id, password, |vault_dir, source, index| {
                    let config_files = config_folder_files(vault_dir, source, index, include)?;
                    record_plain_export(root, vault_id, partial, job_id)?;
                    write_plain_zip(source, index, &config_files, partial, &job)
                })
            },
            |partial| partial_gone = wipe_partial(partial, PartialWork::VaultExport, &wipe),
        );
        if partial_gone {
            forget_plain_export(root, target.partial());
        }
        written
    })();
    log_export_outcome(vault_id, "plain_zip", &written);
    if written.is_ok() {
        let fields: Vec<_> = vault_id_log_field(vault_id).into_iter().collect();
        log_event(LogLevel::Info, "vault_exported_plain_text", &fields);
    }
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
    use crate::vault::config_folder::ImportExtras;
    use crate::vault::create::create_vault;
    use crate::vault::files_zip::{import_logical_files_zip, probe_import_zip_bytes};
    use crate::vault::fs::{fs_list_tree, fs_mkdir, fs_write_file};
    use crate::vault::open_close::{close_vault, open_vault};
    use crate::vault::seven_zip::{import_logical_seven_zip, probe_logical_seven_zip};
    use crate::vault::VaultWelcome;

    const EVERYTHING: ExportInclude = ExportInclude {
        workspace: true,
        settings: true,
    };
    const VAULT_FILES_ONLY: ExportInclude = ExportInclude {
        workspace: false,
        settings: false,
    };
    const KEEP_LAYOUT: ImportExtras<'static> = ImportExtras {
        welcome: None,
        keep_workspace: true,
    };
    const NO_EXTRAS: ImportExtras<'static> = ImportExtras {
        welcome: None,
        keep_workspace: false,
    };
    const LAYOUT: &[u8] = b"{\"format_version\":1,\"openTabs\":[\"/docs/hi.txt\"]}\n";

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
        let file = export_logical_seven_zip(
            root,
            vault_id,
            password,
            None,
            EVERYTHING,
            out.path(),
            &test_job_id(),
        )?;
        Ok(crate::host_fs::read(&file.path).unwrap())
    }

    /// The plain-text `.zip` a fresh export job writes.
    fn plain_zip(root: &VaultRoot, vault_id: &str, include: ExportInclude) -> Result<Vec<u8>> {
        let out = tempfile::tempdir().unwrap();
        let file = export_plain_zip(
            root,
            vault_id,
            b"pass-word-ok",
            include,
            out.path(),
            &test_job_id(),
        )?;
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
            EVERYTHING,
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
            EVERYTHING,
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
            export_logical_seven_zip(
                &root,
                "notes",
                b"wrong",
                None,
                EVERYTHING,
                out.path(),
                &test_job_id()
            ),
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
            export_logical_seven_zip(
                &root,
                "notes",
                password,
                None,
                EVERYTHING,
                out.path(),
                &test_job_id(),
            )
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
            NO_EXTRAS,
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
            NO_EXTRAS,
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
        let first = VaultWelcome {
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
        let second = VaultWelcome {
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
            ImportExtras {
                welcome: Some(second),
                keep_workspace: false,
            },
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
            NO_EXTRAS,
        )
        .unwrap();
        open_vault(&root, &imported, b"pass-word-ok").unwrap();
        let json = serde_json::to_string(&fs_list_tree(&root, &imported).unwrap()).unwrap();
        for name in ["empty", "only", "inner", "blank", "hi.txt"] {
            assert!(json.contains(name), "{json}");
        }
        close_vault(&root, &imported).unwrap();
    }

    /// A closed vault `notes` ("My notes") with a file, an empty folder, and a layout.
    fn vault_with_a_layout() -> (tempfile::TempDir, VaultRoot) {
        let (tmp, root) = notes_root();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        fs_write_file(&root, "notes", "/docs/hi.txt", b"hello-export").unwrap();
        fs_mkdir(&root, "notes", "/empty").unwrap();
        fs_write_file(&root, "notes", "/.upriv-workspace.json", LAYOUT).unwrap();
        close_vault(&root, "notes").unwrap();
        (tmp, root)
    }

    fn zip_names(bytes: &[u8]) -> Vec<String> {
        let mut names: Vec<String> = zip_bodies(bytes).into_iter().map(|(n, _)| n).collect();
        names.sort();
        names
    }

    /// Top-level names the file manager shows in an open vault.
    fn root_names(root: &VaultRoot, id: &str) -> Vec<String> {
        let mut names: Vec<String> = fs_list_tree(root, id)
            .unwrap()
            .children
            .unwrap_or_default()
            .into_iter()
            .map(|child| child.name)
            .collect();
        names.sort();
        names
    }

    fn read_layout(root: &VaultRoot, id: &str) -> Vec<u8> {
        crate::vault::fs::fs_read_file(root, id, "/.upriv-workspace.json").unwrap()
    }

    #[test]
    fn a_plain_text_zip_is_one_folder_of_readable_files() {
        let (_tmp, root) = vault_with_a_layout();
        let zip = plain_zip(&root, "notes", EVERYTHING).unwrap();
        assert_eq!(
            zip_names(&zip),
            [
                ".upriv-config/README.md",
                ".upriv-config/config.toml",
                ".upriv-config/workspace.json",
                "docs/hi.txt",
                "empty/",
            ]
        );
        let bodies = zip_bodies(&zip);
        let body = |name: &str| {
            let found = bodies.iter().find(|(entry, _)| entry == name);
            found.expect("entry").1.clone()
        };
        assert_eq!(body("docs/hi.txt"), b"hello-export");
        assert_eq!(body(".upriv-config/workspace.json"), LAYOUT);
        let settings = body(".upriv-config/config.toml");
        let parsed = crate::vault::parse_embedded_settings(&settings).unwrap();
        assert_eq!(parsed.config.vault.display_name, "My notes");
        assert_eq!(parsed.unlock_preset, Some(KdfUnlockPreset::M32));
    }

    #[test]
    fn with_the_toggles_off_an_export_holds_only_the_vault_files() {
        let (_tmp, root) = vault_with_a_layout();
        assert_eq!(
            zip_names(&plain_zip(&root, "notes", VAULT_FILES_ONLY).unwrap()),
            ["docs/hi.txt", "empty/"]
        );
        let only_settings = ExportInclude {
            workspace: false,
            settings: true,
        };
        let names = zip_names(&plain_zip(&root, "notes", only_settings).unwrap());
        assert!(names.contains(&".upriv-config/config.toml".to_string()));
        assert!(!names.iter().any(|name| name.ends_with("workspace.json")));
    }

    #[test]
    fn a_vault_with_no_layout_exports_no_layout_file() {
        let (_tmp, root) = notes_root();
        let only_layout = ExportInclude {
            workspace: true,
            settings: false,
        };
        assert_eq!(
            zip_names(&plain_zip(&root, "notes", only_layout).unwrap()),
            Vec::<String>::new()
        );
    }

    #[test]
    fn a_plain_text_zip_is_named_after_the_vault_and_never_replaces_a_file() {
        let (_tmp, root) = notes_root();
        let out = tempfile::tempdir().unwrap();
        let export = || {
            export_plain_zip(
                &root,
                "notes",
                b"pass-word-ok",
                EVERYTHING,
                out.path(),
                &test_job_id(),
            )
            .unwrap()
        };
        let first = export();
        assert_eq!(first.path, out.path().join("My notes.zip"));
        assert_eq!(export().path, out.path().join("My notes 2.zip"));
        let encrypted = export_store_zip(&root, "notes", out.path(), &test_job_id()).unwrap();
        assert_eq!(encrypted.path, out.path().join("My notes 3.zip"));
    }

    #[cfg(unix)]
    #[test]
    fn only_the_owner_can_read_a_plain_text_zip() {
        use std::os::unix::fs::PermissionsExt;
        let (_tmp, root) = notes_root();
        let out = tempfile::tempdir().unwrap();
        let file = export_plain_zip(
            &root,
            "notes",
            b"pass-word-ok",
            EVERYTHING,
            out.path(),
            &test_job_id(),
        )
        .unwrap();
        let mode = std::fs::metadata(&file.path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    #[test]
    fn a_plain_text_export_needs_the_vault_password_and_writes_nothing_without_it() {
        let (_tmp, root) = notes_root();
        let notes = root.vault_dir("notes").unwrap();
        crate::session::clear_throttle_key_for_tests(&notes);
        let out = tempfile::tempdir().unwrap();
        let export = |password: &[u8]| {
            export_plain_zip(
                &root,
                "notes",
                password,
                EVERYTHING,
                out.path(),
                &test_job_id(),
            )
        };
        assert!(matches!(export(b""), Err(UprivError::WrongPassword)));
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
        let state = crate::runtime_state::load_runtime_state(&root).unwrap();
        assert!(state.plain_exports.is_empty());
        crate::session::clear_throttle_key_for_tests(&notes);
    }

    #[test]
    fn a_plain_text_export_that_fails_leaves_no_file_and_no_record() {
        let (_tmp, root) = notes_root();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        fs_write_file(&root, "notes", "/a.txt", b"written first").unwrap();
        fs_write_file(&root, "notes", "/b.txt", b"fails to decrypt").unwrap();
        let blob =
            crate::session::with_open_session(&root.vault_dir("notes").unwrap(), |session| {
                let (file_id, _, _) = session
                    .index
                    .find("b.txt")
                    .and_then(|node| node.as_file())
                    .expect("b.txt");
                Ok(crate::store::blob_path(
                    root.vault_store_dir("notes").unwrap(),
                    file_id,
                ))
            })
            .unwrap()
            .unwrap();
        close_vault(&root, "notes").unwrap();
        let mut bytes = crate::host_fs::read(&blob).unwrap();
        let last = bytes.len() - 1;
        bytes[last] ^= 0x01;
        crate::host_fs::write(&blob, &bytes).unwrap();

        let out = tempfile::tempdir().unwrap();
        assert!(export_plain_zip(
            &root,
            "notes",
            b"pass-word-ok",
            EVERYTHING,
            out.path(),
            &test_job_id(),
        )
        .is_err());
        assert!(entry_names(out.path()).is_empty());
        let state = crate::runtime_state::load_runtime_state(&root).unwrap();
        assert!(state.plain_exports.is_empty());
    }

    #[test]
    fn a_stopped_plain_text_export_writes_nothing_and_frees_the_vault() {
        let (_tmp, root) = notes_root();
        let out = tempfile::tempdir().unwrap();
        let job = test_job_id();
        cancel_job(&job);
        assert!(matches!(
            export_plain_zip(
                &root,
                "notes",
                b"pass-word-ok",
                EVERYTHING,
                out.path(),
                &job
            ),
            Err(UprivError::JobCancelled)
        ));
        assert!(entry_names(out.path()).is_empty());
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn a_stop_while_the_zip_is_written_ends_it() {
        let (tmp, root) = vault_with_a_layout();
        let store = root.vault_store_dir("notes").unwrap();
        let opened = open_store(&store, b"pass-word-ok").unwrap();
        let dest = tmp.path().join("Notes plain text.zip.upriv-part");
        let id = test_job_id();
        let job = Job::start(&id).unwrap();
        cancel_job(&id);
        let written = write_plain_zip(
            LogicalSource {
                store_dir: &store,
                header: &opened.header,
                content_key: &opened.content_key,
            },
            &opened.index,
            &[],
            &dest,
            &job,
        );
        assert!(matches!(job.settle(written), Err(UprivError::JobCancelled)));
    }

    #[test]
    fn a_plain_text_export_refuses_while_this_vault_is_open() {
        let (_tmp, root) = notes_root();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        assert!(matches!(
            plain_zip(&root, "notes", EVERYTHING),
            Err(UprivError::VaultMustBeClosed)
        ));
        close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn a_plain_text_zip_reports_what_it_carries() {
        let (_tmp, root) = vault_with_a_layout();
        let probe = probe_import_zip_bytes(&plain_zip(&root, "notes", EVERYTHING).unwrap());
        let probe = probe.unwrap();
        assert_eq!(
            probe.settings.map(|found| found.config.vault.display_name),
            Some("My notes".to_string())
        );
        assert!(probe.workspace);
        let bare = probe_import_zip_bytes(&plain_zip(&root, "notes", VAULT_FILES_ONLY).unwrap());
        let bare = bare.unwrap();
        assert!(bare.settings.is_none());
        assert!(!bare.workspace);
    }

    #[test]
    fn a_plain_text_zip_comes_back_with_its_layout_and_without_the_folder() {
        let (_tmp, root) = vault_with_a_layout();
        let zip = plain_zip(&root, "notes", EVERYTHING).unwrap();
        let welcome = VaultWelcome {
            readme: "# Welcome\n",
            workspace: "{\"format_version\":1}\n",
        };
        let id = import_logical_files_zip(
            &root,
            sample_config("copy", "Copy"),
            b"new-password",
            KdfUnlockPreset::M32,
            &zip,
            ImportExtras {
                welcome: Some(welcome),
                keep_workspace: true,
            },
        )
        .unwrap();
        open_vault(&root, &id, b"new-password").unwrap();
        assert_eq!(root_names(&root, &id), ["docs", "empty"]);
        assert_eq!(read_layout(&root, &id), LAYOUT);
        close_vault(&root, &id).unwrap();
    }

    #[test]
    fn turning_the_layout_off_on_import_starts_clean_with_the_welcome() {
        let (_tmp, root) = vault_with_a_layout();
        let zip = plain_zip(&root, "notes", EVERYTHING).unwrap();
        let welcome = VaultWelcome {
            readme: "# Welcome\n",
            workspace: "{\"format_version\":1}\n",
        };
        let id = import_logical_files_zip(
            &root,
            sample_config("copy", "Copy"),
            b"new-password",
            KdfUnlockPreset::M32,
            &zip,
            ImportExtras {
                welcome: Some(welcome),
                keep_workspace: false,
            },
        )
        .unwrap();
        open_vault(&root, &id, b"new-password").unwrap();
        assert_eq!(root_names(&root, &id), ["README.md", "docs", "empty"]);
        assert_eq!(read_layout(&root, &id), welcome.workspace.as_bytes());
        close_vault(&root, &id).unwrap();
    }

    #[test]
    fn an_empty_vault_round_trips_without_a_stray_folder() {
        let (_tmp, root) = notes_root();
        let zip = plain_zip(&root, "notes", VAULT_FILES_ONLY).unwrap();
        let id = import_logical_files_zip(
            &root,
            sample_config("copy", "Copy"),
            b"new-password",
            KdfUnlockPreset::M32,
            &zip,
            NO_EXTRAS,
        )
        .unwrap();
        open_vault(&root, &id, b"new-password").unwrap();
        assert!(root_names(&root, &id).is_empty());
        close_vault(&root, &id).unwrap();
    }

    #[test]
    fn a_vault_with_one_top_folder_keeps_it() {
        let (_tmp, root) = notes_root();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        fs_write_file(&root, "notes", "/docs/hi.txt", b"hello").unwrap();
        close_vault(&root, "notes").unwrap();
        let zip = plain_zip(&root, "notes", VAULT_FILES_ONLY).unwrap();
        let id = import_logical_files_zip(
            &root,
            sample_config("copy", "Copy"),
            b"new-password",
            KdfUnlockPreset::M32,
            &zip,
            NO_EXTRAS,
        )
        .unwrap();
        open_vault(&root, &id, b"new-password").unwrap();
        assert_eq!(root_names(&root, &id), ["docs"]);
        close_vault(&root, &id).unwrap();
    }

    #[test]
    fn a_vault_holding_an_unpacked_store_round_trips_as_files() {
        let (_tmp, root) = notes_root();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        fs_write_file(&root, "notes", "/store/header/vault.header", b"a document").unwrap();
        close_vault(&root, "notes").unwrap();
        let zip = plain_zip(&root, "notes", VAULT_FILES_ONLY).unwrap();
        let id = import_logical_files_zip(
            &root,
            sample_config("copy", "Copy"),
            b"new-password",
            KdfUnlockPreset::M32,
            &zip,
            NO_EXTRAS,
        )
        .unwrap();
        open_vault(&root, &id, b"new-password").unwrap();
        assert_eq!(
            crate::vault::fs::fs_read_file(&root, &id, "/store/header/vault.header").unwrap(),
            b"a document"
        );
        close_vault(&root, &id).unwrap();
    }

    #[test]
    fn a_seven_zip_test_reads_the_settings_without_a_vault_file() {
        let (_tmp, root) = vault_with_a_layout();
        let bytes = seven_zip(&root, "notes", b"pass-word-ok").unwrap();
        let settings = probe_logical_seven_zip(&bytes, b"pass-word-ok")
            .unwrap()
            .expect("settings");
        assert_eq!(settings.config.vault.display_name, "My notes");
        assert_eq!(settings.unlock_preset, Some(KdfUnlockPreset::M32));
        assert!(matches!(
            probe_logical_seven_zip(&bytes, b"not-the-password"),
            Err(UprivError::WrongPassword)
        ));
    }

    #[test]
    fn a_seven_zip_with_visible_names_still_checks_the_password_on_its_settings() {
        let (_tmp, root) = vault_with_a_layout();
        let out = tempfile::tempdir().unwrap();
        for archive_mode in [
            crate::config::vault_config::VaultArchiveMode::EncryptOnly,
            crate::config::vault_config::VaultArchiveMode::CompressEncrypt,
        ] {
            let options = VaultSevenZipSection {
                encrypt_file_names: false,
                archive_mode,
                ..VaultSevenZipSection::default()
            };
            let file = export_logical_seven_zip(
                &root,
                "notes",
                b"pass-word-ok",
                Some(&options),
                EVERYTHING,
                out.path(),
                &test_job_id(),
            )
            .unwrap();
            let bytes = crate::host_fs::read(&file.path).unwrap();
            assert!(probe_logical_seven_zip(&bytes, b"pass-word-ok")
                .unwrap()
                .is_some());
            assert!(matches!(
                probe_logical_seven_zip(&bytes, b"not-the-password"),
                Err(UprivError::WrongPassword)
            ));
        }
    }

    #[test]
    fn a_solid_seven_zip_keeps_the_settings_in_their_own_first_block() {
        let (_tmp, root) = vault_with_a_layout();
        let out = tempfile::tempdir().unwrap();
        let options = VaultSevenZipSection {
            solid: true,
            ..VaultSevenZipSection::default()
        };
        let file = export_logical_seven_zip(
            &root,
            "notes",
            b"pass-word-ok",
            Some(&options),
            EVERYTHING,
            out.path(),
            &test_job_id(),
        )
        .unwrap();
        let bytes = crate::host_fs::read(&file.path).unwrap();
        assert!(probe_logical_seven_zip(&bytes, b"pass-word-ok")
            .unwrap()
            .is_some());
        let id = import_logical_seven_zip(
            &root,
            sample_config("copy", "Copy"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
            &bytes,
            b"pass-word-ok",
            KEEP_LAYOUT,
        )
        .unwrap();
        open_vault(&root, &id, b"pass-word-ok").unwrap();
        assert_eq!(read_layout(&root, &id), LAYOUT);
        close_vault(&root, &id).unwrap();
    }

    #[test]
    fn a_seven_zip_comes_back_with_its_layout_and_without_the_folder() {
        let (_tmp, root) = vault_with_a_layout();
        let bytes = seven_zip(&root, "notes", b"pass-word-ok").unwrap();
        let id = import_logical_seven_zip(
            &root,
            sample_config("copy", "Copy"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
            &bytes,
            b"pass-word-ok",
            KEEP_LAYOUT,
        )
        .unwrap();
        open_vault(&root, &id, b"pass-word-ok").unwrap();
        assert_eq!(root_names(&root, &id), ["docs", "empty"]);
        assert_eq!(read_layout(&root, &id), LAYOUT);
        close_vault(&root, &id).unwrap();
    }

    #[test]
    fn a_seven_zip_with_the_toggles_off_imports_with_nothing_to_read() {
        let (_tmp, root) = vault_with_a_layout();
        let out = tempfile::tempdir().unwrap();
        let file = export_logical_seven_zip(
            &root,
            "notes",
            b"pass-word-ok",
            None,
            VAULT_FILES_ONLY,
            out.path(),
            &test_job_id(),
        )
        .unwrap();
        let bytes = crate::host_fs::read(&file.path).unwrap();
        assert!(probe_logical_seven_zip(&bytes, b"pass-word-ok")
            .unwrap()
            .is_none());
        let id = import_logical_seven_zip(
            &root,
            sample_config("copy", "Copy"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
            &bytes,
            b"pass-word-ok",
            KEEP_LAYOUT,
        )
        .unwrap();
        open_vault(&root, &id, b"pass-word-ok").unwrap();
        assert_eq!(root_names(&root, &id), ["docs", "empty"]);
        assert!(read_layout(&root, &id).is_empty());
        close_vault(&root, &id).unwrap();
    }

    #[test]
    fn a_vault_never_holds_the_config_folder_name() {
        let (_tmp, root) = notes_root();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        assert!(fs_mkdir(&root, "notes", "/.upriv-config").is_err());
        assert!(fs_write_file(&root, "notes", "/.upriv-config/config.toml", b"x").is_err());
        assert!(fs_write_file(&root, "notes", "/docs/.upriv-config", b"x").is_err());
        close_vault(&root, "notes").unwrap();
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
            export_logical_seven_zip(
                &root,
                "notes",
                b"pass-word-ok",
                None,
                EVERYTHING,
                out.path(),
                &job
            ),
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
            LogicalSource {
                store_dir: &store,
                header: &opened.header,
                content_key: &opened.content_key,
            },
            &opened.index,
            b"pass-word-ok",
            &VaultSevenZipSection::default(),
            ArchiveLayout {
                outer: "Notes",
                config_files: &[],
            },
            &dest,
            &job,
        );
        assert!(matches!(job.settle(packed), Err(UprivError::JobCancelled)));
    }
}
