//! Portable export: `.zip` of `store/` (ciphertext). `.7z` is Plan B. A
//! plain-text `.zip` takes the data out readable, not encrypted at all.
//!
//! An export writes `{display_name}-upriv.zip`, `{display_name}-sevenzip.7z`,
//! or `{display_name}-plain-text.zip` into the folder the person chose. Each
//! holds its package (`super::package`): one folder named like the file,
//! holding one folder named after the vault's id. An import names the vault
//! from the settings the file carries, so the file can be renamed. It never
//! replaces a file already using that name: it takes the next free number
//! instead (`{display_name}-upriv-2.zip`, with the package folder named the
//! same) and logs `vault_export_numbered`. Each
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
use crate::paths::VaultRoot;
use crate::runtime_state::{refuse_if_held_elsewhere, UnfinishedWork};
use crate::session::{
    check_unlock_allowed, ensure_vault_session_closed, is_vault_closing_at, is_vault_open_at,
    record_unlock_failure, record_unlock_success, with_unlock_lock, with_vault_dir_lock, Job,
    JobKind, PreparingGuard,
};
use crate::store::{is_reserved_logical, open_store, VaultIndex};
use crate::time::utc_filename_stamp;

use super::backup::vault_id_log_field;
use super::config_folder::{config_folder_files, ExportInclude};
use super::embedded_settings::snapshot_settings_bytes;
use super::export_folder::{
    check_export_folder, ExportedFile, NumberedExportName, NumberedExportTarget,
};
use super::package::{export_stem, Package, PackageKind};
use super::partial::{wipe_partial_behind, PartialWork};
use super::plain_zip::write_plain_zip;
use super::seven_zip_pack::{
    pack_logical_seven_zip_to_writer, plan_seven_zip_pack, ArchiveLayout, LogicalSource,
    PackLimits, ReadableExport,
};
use super::wipe::WipeOptions;
use super::zip_io::{zip_store_with_config_to_path, PacedFile, StoreEnvelope};

fn closed_vault_paths(root: &VaultRoot, vault_id: &str) -> Result<(PathBuf, PathBuf)> {
    let vault_dir = root.vault_dir(vault_id)?;
    if !vault_dir.host_is_dir() {
        return Err(UprivError::VaultNotFound(vault_dir));
    }
    let _ = load_vault_config(&vault_dir)?;
    ensure_vault_session_closed(&vault_dir)?;
    refuse_if_held_elsewhere(root, vault_id)?;
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
/// written into `dest_dir` as `{display_name}-upriv.zip` by the job `job_id`,
/// in its package (`{display_name}-upriv/{vault_id}/`). This vault must be
/// closed.
pub fn export_store_zip(
    root: &VaultRoot,
    vault_id: &str,
    dest_dir: &Path,
    job_id: &str,
) -> Result<ExportedFile> {
    let written = Job::run(job_id, JobKind::VaultExport, Some(vault_id), |job| {
        let plan = export_target(root, vault_id, dest_dir, PackageKind::Store)?;
        let hold = hold_closed_vault(root, vault_id)?;
        plan.target.write(
            root,
            job,
            UnfinishedWork::VaultExport,
            Some(vault_id),
            |partial| {
                with_held_vault(&hold, || {
                    crate::store::ensure_danger_notice(&hold.store)?;
                    let settings = snapshot_settings_bytes(&hold.vault_dir, &hold.store)?;
                    zip_store_with_config_to_path(
                        &hold.store,
                        &StoreEnvelope::export(plan.package.clone()),
                        &settings,
                        &utc_filename_stamp(),
                        partial,
                        job,
                    )
                })
            },
        )
    });
    log_export_numbered(vault_id, "zip", &written);
    written
}

/// Where an export of this vault as `kind` goes in `dest_dir`, and the
/// package it holds, named like that free file name.
struct ExportPlan {
    config: VaultConfig,
    target: NumberedExportTarget,
    package: Package,
}

fn export_target(
    root: &VaultRoot,
    vault_id: &str,
    dest_dir: &Path,
    kind: PackageKind,
) -> Result<ExportPlan> {
    // The id as its folder in `vaults/` has it, which also names the package's vault folder.
    let vault_id = crate::paths::vault_id_component(vault_id)?;
    let vault_dir = root.vault_dir(vault_id)?;
    if !vault_dir.host_is_dir() {
        return Err(UprivError::VaultNotFound(vault_dir));
    }
    let config = load_vault_config(&vault_dir)?;
    check_export_folder(root, dest_dir)?;
    let display_name = &config.vault.display_name;
    let name = NumberedExportName::new(&export_stem(display_name, kind), kind.extension());
    let target = NumberedExportTarget::new(dest_dir, name)?;
    let package = Package::new(&target.stem(), vault_id);
    Ok(ExportPlan {
        config,
        target,
        package,
    })
}

/// `vault_export_numbered` when the name was taken and the file got a number.
/// How the export ended is the job's own log. No path or name goes to the log.
fn log_export_numbered(vault_id: &str, format: &str, written: &Result<ExportedFile>) {
    let Ok(file) = written else {
        return;
    };
    if file.number <= 1 {
        return;
    }
    let number = file.number.to_string();
    let mut fields = vec![("format", format), ("number", number.as_str())];
    fields.extend(vault_id_log_field(vault_id));
    log_event(LogLevel::Info, "vault_export_numbered", &fields);
}

fn pack_logical_seven_zip_to_path(
    source: LogicalSource<'_>,
    index: &VaultIndex,
    archive_password: &[u8],
    opts: &VaultSevenZipSection,
    layout: ArchiveLayout<'_>,
    dest: &Path,
    job: &Job,
) -> Result<ReadableExport> {
    job.ensure_running()?;
    let plan = plan_seven_zip_pack(
        index,
        opts,
        layout.vault_folder,
        is_reserved_logical,
        PackLimits::current(),
    )?;
    let file = PacedFile::new(crate::host_fs::File::create(dest)?);
    let (file, unreadable) =
        pack_logical_seven_zip_to_writer(file, source, archive_password, opts, layout, &plan, job)?;
    Ok(ReadableExport {
        size: file.into_file().metadata()?.len(),
        unreadable,
    })
}

/// Name in the log how many files a readable export kept with zeros. The
/// names go to the person only.
fn log_export_unreadable(vault_id: &str, written: &Result<ExportedFile>) {
    let Ok(file) = written else {
        return;
    };
    if file.unreadable.is_empty() {
        return;
    }
    let count = file.unreadable.len().to_string();
    let mut fields = vec![("count", count.as_str())];
    fields.extend(vault_id_log_field(vault_id));
    log_event(LogLevel::Warn, "vault_export_kept_unreadable", &fields);
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
/// as `{display_name}-sevenzip.7z` by the job `job_id`, in its package
/// (`{display_name}-sevenzip/{vault_id}/`), with `.upriv-config/` beside
/// the vault folder carrying what `include` asks for. Plaintext stays in RAM;
/// the file is 7-Zip AES ciphertext. This vault must be closed; the password unlocks `store/` for
/// the read. Every file goes in: one whose data is missing or damaged keeps
/// its readable parts, with zeros for the rest, and is named in
/// [`ExportedFile::unreadable`].
pub fn export_logical_seven_zip(
    root: &VaultRoot,
    vault_id: &str,
    archive_password: &[u8],
    options: Option<&VaultSevenZipSection>,
    include: ExportInclude,
    dest_dir: &Path,
    job_id: &str,
) -> Result<ExportedFile> {
    let mut unreadable = Vec::new();
    let written = Job::run(job_id, JobKind::VaultExport, Some(vault_id), |job| {
        let plan = export_target(root, vault_id, dest_dir, PackageKind::SevenZip)?;
        let opts = options.cloned().unwrap_or(plan.config.seven_zip);
        let vault_folder = plan.package.root();
        plan.target.write(
            root,
            job,
            UnfinishedWork::VaultExport,
            Some(vault_id),
            |partial| {
                with_logical_store(
                    root,
                    vault_id,
                    archive_password,
                    |vault_dir, source, index| {
                        let config_files = config_folder_files(vault_dir, source, index, include)?;
                        let layout = ArchiveLayout {
                            package_folder: &plan.package.outer,
                            vault_folder: &vault_folder,
                            config_files: &config_files,
                        };
                        let packed = pack_logical_seven_zip_to_path(
                            source,
                            index,
                            archive_password,
                            &opts,
                            layout,
                            partial,
                            job,
                        )?;
                        unreadable = packed.unreadable;
                        Ok(packed.size)
                    },
                )
            },
        )
    });
    let written = written.map(|file| ExportedFile { unreadable, ..file });
    log_export_numbered(vault_id, "7z", &written);
    log_export_unreadable(vault_id, &written);
    written
}

/// Readable `.zip` of vault files, written into `dest_dir` as
/// `{display_name}-plain-text.zip` by the job `job_id`, in its package
/// (`{display_name}-plain-text/{vault_id}/`), with `.upriv-config/` beside
/// the vault folder carrying what `include` asks for. **Not encrypted:**
/// anyone who gets the file reads the vault. This vault must be closed; the password unlocks
/// `store/` for the read. A stop or a failure answers at once and overwrites
/// the unfinished file behind it ([`wipe_partial_behind`]).
/// Every file goes in: one whose data is missing or damaged keeps its
/// readable parts, with zeros for the rest, and is named in
/// [`ExportedFile::unreadable`].
pub fn export_plain_zip(
    root: &VaultRoot,
    vault_id: &str,
    password: &[u8],
    include: ExportInclude,
    dest_dir: &Path,
    job_id: &str,
) -> Result<ExportedFile> {
    let mut unreadable = Vec::new();
    let written = Job::run(job_id, JobKind::VaultExport, Some(vault_id), |job| {
        let plan = export_target(root, vault_id, dest_dir, PackageKind::PlainText)?;
        let wipe = WipeOptions::from_vault_config(&plan.config);
        plan.target.write_clearing(
            root,
            job,
            UnfinishedWork::PlainExport,
            Some(vault_id),
            |partial| {
                with_logical_store(root, vault_id, password, |vault_dir, source, index| {
                    let config_files = config_folder_files(vault_dir, source, index, include)?;
                    let written =
                        write_plain_zip(source, index, &plan.package, &config_files, partial, job)?;
                    unreadable = written.unreadable;
                    Ok(written.size)
                })
            },
            // The stop answers now; the record goes once the wipe is done. A
            // file never made, such as after a wrong password, needs none.
            |partial| {
                if !partial.host_exists() {
                    return true;
                }
                wipe_partial_behind(root, partial, PartialWork::VaultExport, wipe);
                false
            },
        )
    });
    let written = written.map(|file| ExportedFile { unreadable, ..file });
    log_export_numbered(vault_id, "plain_zip", &written);
    log_export_unreadable(vault_id, &written);
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
    use crate::test_support::{test_job_id, vault_root_with, write_with_folders};
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
        assert_eq!(zip.path, out.path().join("My notes-upriv.zip"));
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
        assert_eq!(seven.path, out.path().join("My notes-sevenzip.7z"));
        // An id with spaces around it names the same vault folder.
        let padded = export_store_zip(&root, " notes ", out.path(), &test_job_id()).unwrap();
        let members = zip_members(&padded.path);
        assert_eq!(members[1], "My notes-upriv-2/notes/");
        crate::host_fs::remove_file(&padded.path).unwrap();
        let plain = export_plain_zip(
            &root,
            "notes",
            b"pass-word-ok",
            EVERYTHING,
            out.path(),
            &test_job_id(),
        )
        .unwrap();
        assert_eq!(plain.path, out.path().join("My notes-plain-text.zip"));
        assert_eq!(
            entry_names(out.path()),
            [
                "My notes-plain-text.zip",
                "My notes-sevenzip.7z",
                "My notes-upriv.zip"
            ]
        );
    }

    /// The members of the zip at `path`, in its order.
    fn zip_members(path: &Path) -> Vec<String> {
        let mut archive = zip::ZipArchive::new(crate::host_fs::File::open(path).unwrap()).unwrap();
        (0..archive.len())
            .map(|index| archive.by_index(index).unwrap().name().to_string())
            .collect()
    }

    #[test]
    fn a_taken_name_gets_the_next_free_number_and_nothing_is_replaced() {
        let (_tmp, root) = notes_root();
        let out = tempfile::tempdir().unwrap();
        let older = out.path().join("My notes-upriv.zip");
        crate::host_fs::write(&older, b"older export").unwrap();
        let zip = export_store_zip(&root, "notes", out.path(), &test_job_id()).unwrap();
        assert_eq!(zip.path, out.path().join("My notes-upriv-2.zip"));
        assert_eq!(zip.number, 2);
        assert_eq!(crate::host_fs::read(&older).unwrap(), b"older export");
        // The package folder is named like the file; the vault folder is the
        // vault's id.
        let members = zip_members(&zip.path);
        assert_eq!(
            members[..2],
            ["My notes-upriv-2/", "My notes-upriv-2/notes/"]
        );
        assert!(members.contains(&"My notes-upriv-2/notes/store/header/vault.header".into()));

        // A .7z still being written under the name holds it too.
        let writing = out.path().join("My notes-sevenzip.7z.upriv-part");
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
        assert_eq!(seven.path, out.path().join("My notes-sevenzip-2.7z"));
        assert_eq!(crate::host_fs::read(&writing).unwrap(), b"another export");
        assert_eq!(
            entry_names(out.path()),
            [
                "My notes-sevenzip-2.7z",
                "My notes-sevenzip.7z.upriv-part",
                "My notes-upriv-2.zip",
                "My notes-upriv.zip"
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

    /// The package an export zip holds.
    fn zip_package(bytes: &[u8]) -> Package {
        let archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        Package::find_in_zip(archive.file_names()).expect("an export holds its package")
    }

    /// Each entry of an export zip's vault folder and its bytes, named as a
    /// path under that folder (a folder ends with `/`).
    fn zip_bodies(bytes: &[u8]) -> Vec<(String, Vec<u8>)> {
        zip_bodies_in(bytes, Package::inside)
    }

    /// Each file of the `.upriv-config/` beside an export zip's vault folder
    /// and its bytes, named as a path under that folder.
    fn config_bodies(bytes: &[u8]) -> Vec<(String, Vec<u8>)> {
        zip_bodies_in(bytes, Package::config)
    }

    fn config_names(bytes: &[u8]) -> Vec<String> {
        let mut names: Vec<String> = config_bodies(bytes).into_iter().map(|(n, _)| n).collect();
        names.sort();
        names
    }

    fn zip_bodies_in(
        bytes: &[u8],
        place: for<'a> fn(&Package, &'a str) -> Option<&'a str>,
    ) -> Vec<(String, Vec<u8>)> {
        let package = zip_package(bytes);
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        let mut entries = Vec::new();
        for index in 0..archive.len() {
            let mut file = archive.by_index(index).unwrap();
            let Some(rest) = place(&package, file.name()) else {
                continue;
            };
            let name = if file.is_dir() {
                format!("{rest}/")
            } else {
                rest.to_string()
            };
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
        // The export's vault folder names the vault.
        let carried = crate::vault::read_import_zip_bytes_settings(&bytes).unwrap();
        assert_eq!(carried.vault_name.as_deref(), Some("Notes"));
        let parsed = carried.settings.expect("config.toml");
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
        // Four failures already counted; the export's own wrong password is
        // the fifth, so the block that follows comes from it. Few real unlocks
        // keep the five inside the limit's window under a busy test run.
        for _ in 0..4 {
            crate::session::record_unlock_failure(&notes).unwrap();
        }
        assert!(matches!(
            export(b"not-the-password"),
            Err(UprivError::WrongPassword)
        ));
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
        write_with_folders(&root, "notes", "/docs/hi.txt", b"hello-export");
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
        probe_logical_seven_zip(&bytes, b"pass-word-ok", &test_job_id())
            .expect("in-process .7z probe");
        assert!(matches!(
            probe_logical_seven_zip(&bytes, b"not-the-password", &test_job_id()),
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
            &test_job_id(),
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
            &test_job_id(),
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
        crate::vault::create::create_vault_with_welcome(
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
            &test_job_id(),
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
            &test_job_id(),
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
        write_with_folders(&root, "notes", "/docs/hi.txt", b"hello-export");
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
            zip_package(&zip),
            Package::new("My notes-plain-text", "notes")
        );
        // The vault folder holds the vault's files; what the export carries
        // about the vault sits beside it.
        assert_eq!(zip_names(&zip), ["docs/", "docs/hi.txt", "empty/"]);
        assert_eq!(
            config_names(&zip),
            ["README.md", "config.toml", "workspace.json"]
        );
        let names: Vec<String> = zip::ZipArchive::new(std::io::Cursor::new(zip.as_slice()))
            .unwrap()
            .file_names()
            .map(str::to_string)
            .collect();
        assert!(names.contains(&"My notes-plain-text/.upriv-config/config.toml".to_string()));
        let bodies = zip_bodies(&zip);
        let configs = config_bodies(&zip);
        let body = |name: &str| {
            let found = bodies
                .iter()
                .chain(&configs)
                .find(|(entry, _)| entry == name);
            found.expect("entry").1.clone()
        };
        assert_eq!(body("docs/hi.txt"), b"hello-export");
        assert_eq!(body("workspace.json"), LAYOUT);
        let settings = body("config.toml");
        let parsed = crate::vault::embedded_settings::parse_embedded_settings(&settings).unwrap();
        assert_eq!(parsed.config.vault.display_name, "My notes");
        assert_eq!(parsed.unlock_preset, Some(KdfUnlockPreset::M32));
    }

    #[test]
    fn with_the_toggles_off_an_export_holds_only_the_vault_files() {
        let (_tmp, root) = vault_with_a_layout();
        let bare = plain_zip(&root, "notes", VAULT_FILES_ONLY).unwrap();
        assert_eq!(zip_names(&bare), ["docs/", "docs/hi.txt", "empty/"]);
        assert!(config_names(&bare).is_empty());
        let only_settings = ExportInclude {
            workspace: false,
            settings: true,
        };
        let zip = plain_zip(&root, "notes", only_settings).unwrap();
        assert_eq!(zip_names(&zip), ["docs/", "docs/hi.txt", "empty/"]);
        assert_eq!(config_names(&zip), ["README.md", "config.toml"]);
    }

    #[test]
    fn a_vault_with_no_layout_exports_no_layout_file() {
        let (_tmp, root) = notes_root();
        let only_layout = ExportInclude {
            workspace: true,
            settings: false,
        };
        // An empty vault is its package's two folders.
        let zip = plain_zip(&root, "notes", only_layout).unwrap();
        assert_eq!(zip_names(&zip), Vec::<String>::new());
        assert_eq!(
            zip_package(&zip),
            Package::new("My notes-plain-text", "notes")
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
        assert_eq!(first.path, out.path().join("My notes-plain-text.zip"));
        let second = export();
        assert_eq!(second.path, out.path().join("My notes-plain-text-2.zip"));
        let package = zip_package(&crate::host_fs::read(&second.path).unwrap());
        assert_eq!(package, Package::new("My notes-plain-text-2", "notes"));
        // The encrypted export has a name of its own.
        let encrypted = export_store_zip(&root, "notes", out.path(), &test_job_id()).unwrap();
        assert_eq!(encrypted.path, out.path().join("My notes-upriv.zip"));
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
        // Four failures already counted; the export's own wrong password is
        // the fifth, so the block that follows comes from it. Few real unlocks
        // keep the five inside the limit's window under a busy test run.
        for _ in 0..4 {
            crate::session::record_unlock_failure(&notes).unwrap();
        }
        assert!(matches!(
            export(b"not-the-password"),
            Err(UprivError::WrongPassword)
        ));
        assert!(matches!(
            export(b"pass-word-ok"),
            Err(UprivError::VaultUnlockBlocked { .. })
        ));
        assert!(entry_names(out.path()).is_empty());
        let state = crate::runtime_state::load_runtime_state(&root).unwrap();
        assert!(state.unfinished_files.is_empty());
        crate::session::clear_throttle_key_for_tests(&notes);
    }

    /// Write `/a.txt` and `/b.txt` into the closed vault `notes`, and return
    /// the blob of `b.txt`.
    fn two_files(root: &VaultRoot) -> PathBuf {
        open_vault(root, "notes", b"pass-word-ok").unwrap();
        fs_write_file(root, "notes", "/a.txt", b"written first").unwrap();
        fs_write_file(root, "notes", "/b.txt", b"second file").unwrap();
        let blob =
            crate::session::with_open_session(&root.vault_dir("notes").unwrap(), |session| {
                let (file_id, _, _) = session
                    .index
                    .find("b.txt")
                    .and_then(|node| node.as_file())
                    .expect("b.txt");
                crate::store::blob_path(root.vault_store_dir("notes").unwrap(), file_id)
            })
            .unwrap();
        close_vault(root, "notes").unwrap();
        blob
    }

    #[test]
    fn a_plain_text_export_keeps_a_damaged_file_with_zeros_and_names_it() {
        let (_tmp, root) = notes_root();
        let blob = two_files(&root);
        let mut bytes = crate::host_fs::read(&blob).unwrap();
        // Past the nonce, inside the blob's one chunk.
        bytes[30] ^= 0x01;
        crate::host_fs::write(&blob, &bytes).unwrap();

        let out = tempfile::tempdir().unwrap();
        let file = export_plain_zip(
            &root,
            "notes",
            b"pass-word-ok",
            VAULT_FILES_ONLY,
            out.path(),
            &test_job_id(),
        )
        .unwrap();
        assert_eq!(file.unreadable, ["b.txt"]);
        let bodies = zip_bodies(&crate::host_fs::read(&file.path).unwrap());
        let body = |name: &str| {
            bodies
                .iter()
                .find(|(entry, _)| entry == name)
                .map(|(_, body)| body.clone())
                .unwrap()
        };
        assert_eq!(body("a.txt"), b"written first");
        assert_eq!(body("b.txt"), vec![0u8; b"second file".len()]);
    }

    #[test]
    fn a_plain_text_export_that_fails_leaves_no_file_and_no_record() {
        let (_tmp, root) = notes_root();
        two_files(&root);
        // An index entry whose blob id is not a UUID cannot be served at all,
        // so the export fails after it has started writing.
        let store = root.vault_store_dir("notes").unwrap();
        let opened = crate::store::open_store(&store, b"pass-word-ok").unwrap();
        let mut index = opened.index.clone();
        let node = index.find("b.txt").unwrap().clone();
        let (_, size, versions) = node.as_file().unwrap();
        let broken = crate::store::VaultNode::file(
            "b.txt",
            "not-a-uuid".into(),
            size,
            versions.to_vec(),
            node.chunk_offsets().unwrap().to_vec(),
        );
        index.put(broken);
        let sealed =
            crate::store::sealed_index_bytes(&opened.header, &opened.index_key, &index).unwrap();
        let index_dir = store.join(crate::store::INDEX_DIR_NAME);
        crate::host_fs::write(index_dir.join(crate::store::INDEX_FILE_NAME), &sealed).unwrap();
        crate::host_fs::write(index_dir.join(crate::store::INDEX_COPY_FILE_NAME), &sealed).unwrap();

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
        // The failure answered at once; the wipe behind it finishes the job.
        crate::vault::wait_for_partial_wipes();
        assert!(entry_names(out.path()).is_empty());
        let state = crate::runtime_state::load_runtime_state(&root).unwrap();
        assert!(state.unfinished_files.is_empty());
    }

    #[test]
    fn a_stopped_plain_text_export_writes_nothing_and_frees_the_vault() {
        let (_tmp, root) = notes_root();
        let out = tempfile::tempdir().unwrap();
        let job = test_job_id();
        cancel_job(&job).unwrap();
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

    /// A vault with `files` files of `size` bytes no coder can shrink.
    fn vault_of_noise(files: usize, size: usize) -> (tempfile::TempDir, VaultRoot) {
        let (tmp, root) = notes_root();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        let mut state: u64 = 0x2545_f491_4f6c_dd1d;
        for file in 0..files {
            let body: Vec<u8> = (0..size)
                .map(|_| {
                    state ^= state << 13;
                    state ^= state >> 7;
                    state ^= state << 17;
                    state as u8
                })
                .collect();
            fs_write_file(&root, "notes", &format!("/noise-{file}.bin"), &body).unwrap();
        }
        close_vault(&root, "notes").unwrap();
        (tmp, root)
    }

    #[test]
    fn a_stop_in_the_middle_of_any_export_ends_it_and_leaves_the_vault_usable() {
        let (_tmp, root) = vault_of_noise(6, 4 * 1024 * 1024);
        for format in ["zip", "7z", "plain"] {
            let out = tempfile::tempdir().unwrap();
            let id = test_job_id();
            // Stop the export once it has written something.
            let stopper = {
                let id = id.clone();
                std::thread::spawn(move || {
                    let started = std::time::Instant::now();
                    while started.elapsed() < std::time::Duration::from_secs(60) {
                        if crate::session::job_status(&id).is_some_and(|s| s.bytes_done > 0) {
                            cancel_job(&id).unwrap();
                            return;
                        }
                        std::thread::sleep(std::time::Duration::from_millis(2));
                    }
                })
            };
            let started = std::time::Instant::now();
            let written = match format {
                "zip" => export_store_zip(&root, "notes", out.path(), &id),
                "7z" => export_logical_seven_zip(
                    &root,
                    "notes",
                    b"pass-word-ok",
                    None,
                    EVERYTHING,
                    out.path(),
                    &id,
                ),
                _ => export_plain_zip(&root, "notes", b"pass-word-ok", EVERYTHING, out.path(), &id),
            };
            stopper.join().unwrap();
            assert!(
                matches!(written, Err(UprivError::JobCancelled)),
                "{format}: {written:?}"
            );
            assert!(
                started.elapsed() < std::time::Duration::from_secs(30),
                "{format} took {:?} to stop",
                started.elapsed()
            );
            // A plain-text file is overwritten behind the stop.
            crate::vault::wait_for_partial_wipes();
            assert!(entry_names(out.path()).is_empty(), "{format} left a file");
            let state = crate::runtime_state::load_runtime_state(&root).unwrap();
            assert!(state.unfinished_files.is_empty(), "{format} left a record");
            // Nothing the export held stays held.
            open_vault(&root, "notes", b"pass-word-ok").unwrap();
            close_vault(&root, "notes").unwrap();
        }
    }

    #[test]
    fn a_stop_while_the_zip_is_written_ends_it() {
        let (tmp, root) = vault_with_a_layout();
        let store = root.vault_store_dir("notes").unwrap();
        let opened = open_store(&store, b"pass-word-ok").unwrap();
        let dest = tmp.path().join("Notes plain text.zip.upriv-part");
        let id = test_job_id();
        let job = Job::start(&id).unwrap();
        cancel_job(&id).unwrap();
        let written = write_plain_zip(
            LogicalSource {
                store_dir: &store,
                header: &opened.header,
                content_key: &opened.content_key,
            },
            &opened.index,
            &Package::new("Notes-plain-text", "Notes"),
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
        // The new vault takes the name as it was typed, which the settings hold.
        assert_eq!(probe.vault_name.as_deref(), Some("My notes"));
        let bare = probe_import_zip_bytes(&plain_zip(&root, "notes", VAULT_FILES_ONLY).unwrap());
        let bare = bare.unwrap();
        assert!(bare.settings.is_none());
        assert!(!bare.workspace);
        // With none, the vault folder: the id of the vault it came from.
        assert_eq!(bare.vault_name.as_deref(), Some("notes"));
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
            &test_job_id(),
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
            &test_job_id(),
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
            &test_job_id(),
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
        write_with_folders(&root, "notes", "/docs/hi.txt", b"hello");
        close_vault(&root, "notes").unwrap();
        let zip = plain_zip(&root, "notes", VAULT_FILES_ONLY).unwrap();
        let id = import_logical_files_zip(
            &root,
            sample_config("copy", "Copy"),
            b"new-password",
            KdfUnlockPreset::M32,
            &zip,
            NO_EXTRAS,
            &test_job_id(),
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
        write_with_folders(&root, "notes", "/store/header/vault.header", b"a document");
        close_vault(&root, "notes").unwrap();
        let zip = plain_zip(&root, "notes", VAULT_FILES_ONLY).unwrap();
        let id = import_logical_files_zip(
            &root,
            sample_config("copy", "Copy"),
            b"new-password",
            KdfUnlockPreset::M32,
            &zip,
            NO_EXTRAS,
            &test_job_id(),
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
        let probe = probe_logical_seven_zip(&bytes, b"pass-word-ok", &test_job_id()).unwrap();
        // The settings it carries name the vault.
        assert_eq!(probe.vault_name, "My notes");
        let settings = probe.settings.expect("settings");
        assert_eq!(settings.config.vault.display_name, "My notes");
        assert_eq!(settings.unlock_preset, Some(KdfUnlockPreset::M32));
        assert!(matches!(
            probe_logical_seven_zip(&bytes, b"not-the-password", &test_job_id()),
            Err(UprivError::WrongPassword)
        ));
    }

    #[test]
    fn a_seven_zip_of_root_files_finds_its_vault_folder_from_every_member() {
        // No folder in the vault: the settings beside the vault folder are the
        // archive's first member, and they do not name that folder.
        let (_tmp, root) = notes_root();
        let bytes = seven_zip(&root, "notes", b"pass-word-ok").unwrap();
        let probe = probe_logical_seven_zip(&bytes, b"pass-word-ok", &test_job_id()).unwrap();
        assert_eq!(probe.vault_name, "My notes");
        assert!(probe.settings.is_some());
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
            assert!(
                probe_logical_seven_zip(&bytes, b"pass-word-ok", &test_job_id())
                    .unwrap()
                    .settings
                    .is_some()
            );
            assert!(matches!(
                probe_logical_seven_zip(&bytes, b"not-the-password", &test_job_id()),
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
        assert!(
            probe_logical_seven_zip(&bytes, b"pass-word-ok", &test_job_id())
                .unwrap()
                .settings
                .is_some()
        );
        let id = import_logical_seven_zip(
            &root,
            sample_config("copy", "Copy"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
            &bytes,
            b"pass-word-ok",
            KEEP_LAYOUT,
            &test_job_id(),
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
            &test_job_id(),
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
        // With no settings carried, the vault folder names it: the id of the
        // vault it came from.
        let probe = probe_logical_seven_zip(&bytes, b"pass-word-ok", &test_job_id()).unwrap();
        assert!(probe.settings.is_none());
        assert_eq!(probe.vault_name, "notes");
        let id = import_logical_seven_zip(
            &root,
            sample_config("copy", "Copy"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
            &bytes,
            b"pass-word-ok",
            KEEP_LAYOUT,
            &test_job_id(),
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
        // The folder is there, so the name alone refuses the file.
        fs_mkdir(&root, "notes", "/docs").unwrap();
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
        let _held = PreparingGuard::enter(&vault_dir);
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
        cancel_job(&job).unwrap();
        assert!(matches!(
            export_store_zip(&root, "notes", out.path(), &job),
            Err(UprivError::JobCancelled)
        ));

        let job = test_job_id();
        cancel_job(&job).unwrap();
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
        write_with_folders(&root, "notes", "/docs/hi.txt", b"hello-export");
        close_vault(&root, "notes").unwrap();
        let vault_dir = root.vault_dir("notes").unwrap();
        let store = vault_dir.join(crate::paths::STORE_DIR_NAME);
        let opened = open_store(&store, b"pass-word-ok").unwrap();
        let dest = tmp.path().join("Notes.7z");
        let id = test_job_id();
        let job = Job::start(&id).unwrap();
        cancel_job(&id).unwrap();
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
                package_folder: "Notes-sevenzip",
                vault_folder: "Notes-sevenzip/Notes",
                config_files: &[],
            },
            &dest,
            &job,
        );
        assert!(matches!(job.settle(packed), Err(UprivError::JobCancelled)));
    }

    /// Export timings on this machine, by format, beside a decrypt of the
    /// same files and a plain write of as many bytes. Needs about 3 GiB free
    /// in the temp dir:
    /// `cargo test --release -p upriv-core --lib export_cost_report -- --ignored --nocapture`
    /// With `TMPDIR=/dev/shm` the vault is in RAM; `UPRIV_EXPORT_COST_OUT`
    /// then puts only the exports on the drive under test.
    #[test]
    #[ignore]
    fn export_cost_report() {
        use std::io::Write;
        let (_tmp, root) = notes_root();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        let piece: Vec<u8> = (0..4 * 1024 * 1024).map(|i| (i * 7 % 251) as u8).collect();
        for file in 0..8 {
            for at in 0..16u64 {
                let path = format!("/big{file}.bin");
                crate::vault::fs_write_range(&root, "notes", &path, at * 4 * 1024 * 1024, &piece)
                    .unwrap();
            }
        }
        fs_mkdir(&root, "notes", "/small").unwrap();
        for i in 0..2000 {
            fs_write_file(&root, "notes", &format!("/small/{i}.txt"), &piece[..4096]).unwrap();
        }
        close_vault(&root, "notes").unwrap();
        let out = match std::env::var_os("UPRIV_EXPORT_COST_OUT") {
            Some(dir) => tempfile::tempdir_in(dir),
            None => tempfile::tempdir(),
        }
        .unwrap();
        let timed = |label: &str, run: &dyn Fn()| {
            let started = std::time::Instant::now();
            run();
            eprintln!("{label}: {:?}", started.elapsed());
        };

        timed("decrypt only", &|| {
            let mut bytes = 0u64;
            with_logical_store(&root, "notes", b"pass-word-ok", |_, source, index| {
                for node in super::super::seven_zip_pack::export_file_nodes(
                    index,
                    &crate::store::is_reserved_logical,
                ) {
                    crate::store::read_file_chunks_keeping(
                        source.store_dir,
                        source.header,
                        source.content_key,
                        node,
                        |chunk| {
                            bytes += chunk.len() as u64;
                            Ok(())
                        },
                    )?;
                }
                Ok(())
            })
            .unwrap();
            eprintln!("  {bytes} bytes");
        });
        timed("write and fsync 520 MiB", &|| {
            let path = out.path().join("raw.bin");
            let mut file = std::fs::File::create(&path).unwrap();
            for _ in 0..130 {
                file.write_all(&piece).unwrap();
            }
            file.sync_all().unwrap();
            std::fs::remove_file(path).unwrap();
        });
        timed("store zip", &|| {
            export_store_zip(&root, "notes", out.path(), &test_job_id()).unwrap();
        });
        timed("plain-text zip", &|| {
            export_plain_zip(
                &root,
                "notes",
                b"pass-word-ok",
                EVERYTHING,
                out.path(),
                &test_job_id(),
            )
            .unwrap();
        });
        timed(".7z", &|| {
            export_logical_seven_zip(
                &root,
                "notes",
                b"pass-word-ok",
                None,
                EVERYTHING,
                out.path(),
                &test_job_id(),
            )
            .unwrap();
        });
        crate::vault::wait_for_partial_wipes();
    }
}
