//! Plain-text `.zip` export: the vault's readable files at the zip's root, so
//! `Notes.zip` unpacks to `Notes/` with the files directly inside. It is the
//! person's way to take their data out with no app and no password.
//!
//! This is the one export that puts readable vault bytes on ordinary disk, by
//! the person's own choice and only behind the vault password. Each file is
//! decrypted one chunk at a time straight into the zip; nothing is staged.
//! The file is written owner-only. Until it is complete it is a `.upriv-part`
//! with a record in `state.json`: a stop or a failure overwrites it and removes
//! it, and a later launch does the same for what a crash left behind.

use std::io::Write;
use std::path::Path;

use zip::write::FileOptions;
use zip::{CompressionMethod, ZipWriter};

use crate::error::Result;
use crate::host_fs::{export_tree_uri, File, OpenOptions, SAF_EXPORT_ROOT};
use crate::logging::{log_event, LogLevel};
use crate::paths::VaultRoot;
use crate::runtime_state::{
    add_plain_export, plain_exports_here, remove_plain_export, PlainExportRecord,
};
use crate::session::{job_status, Job};
use crate::store::{is_reserved_logical, read_file_chunks, VaultIndex};

use super::config_folder::ConfigFile;
use super::export_folder::PART_SUFFIX;
use super::files_zip::PLAIN_ZIP_COMMENT;
use super::partial::{wipe_partial, PartialWork};
use super::seven_zip_pack::{
    archive_member_name, export_dir_nodes, export_file_nodes, file_size, LogicalSource,
};
use super::wipe::WipeOptions;
use super::zip_io::{buffered_zip_file, finish_zip_file, zip_err};

/// A new file only its owner can read.
fn create_owner_only(dest: &Path) -> std::io::Result<File> {
    let mut opts = OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    opts.open(dest)
}

/// Stored zip of the vault's logical files at `dest`. Each write fails once
/// `job` is asked to stop; its progress counts the logical bytes written.
pub(super) fn write_plain_zip(
    source: LogicalSource<'_>,
    index: &VaultIndex,
    config_files: &[ConfigFile],
    dest: &Path,
    job: &Job,
) -> Result<u64> {
    job.ensure_running()?;
    let dirs = export_dir_nodes(index, &is_reserved_logical);
    let files = export_file_nodes(index, &is_reserved_logical);
    job.set_total(files.iter().map(|node| file_size(node)).sum());

    let mut zip = ZipWriter::new(job.writer(buffered_zip_file(create_owner_only(dest)?)));
    let options = FileOptions::default().compression_method(CompressionMethod::Stored);
    zip.set_comment(PLAIN_ZIP_COMMENT);
    for dir in dirs {
        let name = archive_member_name(&dir.path)?;
        zip.add_directory(format!("{name}/"), options)
            .map_err(|e| zip_err(dest, e))?;
    }
    for file in config_files {
        zip.start_file(archive_member_name(&file.path())?, options)
            .map_err(|e| zip_err(dest, e))?;
        zip.write_all(&file.bytes).map_err(|e| zip_err(dest, e))?;
    }
    for node in files {
        job.ensure_running()?;
        let name = archive_member_name(&node.path)?;
        let large = file_size(node) >= u64::from(u32::MAX);
        zip.start_file(name, options.large_file(large))
            .map_err(|e| zip_err(dest, e))?;
        read_file_chunks(
            source.store_dir,
            source.header,
            source.content_key,
            node,
            |chunk| {
                zip.write_all(&chunk).map_err(|e| zip_err(dest, e))?;
                job.advance(chunk.len() as u64);
                Ok(())
            },
        )?;
    }
    finish_zip_file(zip, dest)
}

/// Record the unfinished file before its first byte, so a crash cannot leave
/// it unknown. Without the record the export does not start.
pub(super) fn record_plain_export(
    root: &VaultRoot,
    vault_id: &str,
    partial: &Path,
    job_id: &str,
) -> Result<()> {
    add_plain_export(
        root,
        PlainExportRecord {
            vault_id: vault_id.to_string(),
            host: String::new(),
            path: partial.to_string_lossy().into_owned(),
            tree: export_tree_uri(partial),
            job: job_id.to_string(),
        },
    )
}

/// The file is gone or installed. A record that stays only means a later launch
/// finds nothing at its path.
pub(super) fn forget_plain_export(root: &VaultRoot, partial: &Path) {
    let _ = remove_plain_export(root, &partial.to_string_lossy());
}

/// Wipe the unfinished plain-text exports a crash left on this computer.
/// Returns the storage-access folders that hold one and are not mounted: mount
/// each as the export folder and sweep again. A file that cannot be wiped keeps
/// its record for the next launch.
pub fn sweep_plain_exports(root: &VaultRoot) -> Result<Vec<String>> {
    let mut folders = Vec::new();
    for record in plain_exports_here(root)? {
        if job_status(&record.job).is_some() {
            continue;
        }
        // `state.json` is only trusted to name a file this app wrote.
        if !record.path.ends_with(PART_SUFFIX) {
            remove_plain_export(root, &record.path)?;
            continue;
        }
        if let Some(tree) = &record.tree {
            let mounted = export_tree_uri(Path::new(SAF_EXPORT_ROOT));
            if mounted.as_deref() != Some(tree.as_str()) {
                folders.push(tree.clone());
                continue;
            }
        }
        let wipe = root
            .vault_dir(&record.vault_id)
            .map(|dir| WipeOptions::for_vault_dir(&dir))?;
        if wipe_partial(Path::new(&record.path), PartialWork::VaultExport, &wipe) {
            remove_plain_export(root, &record.path)?;
            log_event(LogLevel::Info, "plain_export_leftover_wiped", &[]);
        }
    }
    folders.sort();
    folders.dedup();
    Ok(folders)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[allow(unused_imports)]
    use crate::host_fs::HostFsQuery;
    use crate::runtime_state::load_runtime_state;
    use crate::test_support::vault_root_with;

    fn record(path: &Path, tree: Option<&str>, job: &str) -> PlainExportRecord {
        PlainExportRecord {
            vault_id: "notes".into(),
            host: String::new(),
            path: path.to_string_lossy().into_owned(),
            tree: tree.map(str::to_string),
            job: job.into(),
        }
    }

    #[test]
    fn a_sweep_wipes_what_a_crash_left_and_forgets_it() {
        let (tmp, root) = vault_root_with(&[]);
        let partial = tmp.path().join("Notes plain text.zip.upriv-part");
        crate::host_fs::write(&partial, b"readable").unwrap();
        add_plain_export(&root, record(&partial, None, "ended-job")).unwrap();

        assert!(sweep_plain_exports(&root).unwrap().is_empty());
        assert!(!partial.host_exists());
        assert!(load_runtime_state(&root).unwrap().plain_exports.is_empty());
    }

    #[test]
    fn a_sweep_leaves_the_export_still_running() {
        let (tmp, root) = vault_root_with(&[]);
        let partial = tmp.path().join("Notes plain text.zip.upriv-part");
        crate::host_fs::write(&partial, b"readable").unwrap();
        let id = crate::test_support::test_job_id();
        let _job = Job::start(&id).unwrap();
        add_plain_export(&root, record(&partial, None, &id)).unwrap();

        sweep_plain_exports(&root).unwrap();
        assert!(partial.host_exists());
        assert_eq!(load_runtime_state(&root).unwrap().plain_exports.len(), 1);
    }

    #[test]
    fn a_record_only_ever_names_an_unfinished_export() {
        let (tmp, root) = vault_root_with(&[]);
        let someone_elses = tmp.path().join("Notes plain text.zip");
        crate::host_fs::write(&someone_elses, b"finished").unwrap();
        add_plain_export(&root, record(&someone_elses, None, "ended-job")).unwrap();

        sweep_plain_exports(&root).unwrap();
        assert_eq!(crate::host_fs::read(&someone_elses).unwrap(), b"finished");
        assert!(load_runtime_state(&root).unwrap().plain_exports.is_empty());
    }

    #[test]
    fn a_folder_that_is_not_mounted_is_named_once_and_keeps_its_records() {
        let (_tmp, root) = vault_root_with(&[]);
        let tree = "content://tree/primary%3ADownload";
        let first = Path::new(SAF_EXPORT_ROOT).join("A plain text.zip.upriv-part");
        let second = Path::new(SAF_EXPORT_ROOT).join("B plain text.zip.upriv-part");
        add_plain_export(&root, record(&first, Some(tree), "ended-a")).unwrap();
        add_plain_export(&root, record(&second, Some(tree), "ended-b")).unwrap();

        assert_eq!(sweep_plain_exports(&root).unwrap(), vec![tree.to_string()]);
        assert_eq!(load_runtime_state(&root).unwrap().plain_exports.len(), 2);
    }

    #[test]
    fn a_record_from_another_computer_waits_for_that_computer() {
        let (tmp, root) = vault_root_with(&[]);
        let partial = tmp.path().join("Notes plain text.zip.upriv-part");
        crate::host_fs::write(&partial, b"readable").unwrap();
        let mut state = load_runtime_state(&root).unwrap();
        state.plain_exports.push(PlainExportRecord {
            host: "another-computer".into(),
            ..record(&partial, None, "ended-job")
        });
        crate::runtime_state::save_runtime_state(&root, &state).unwrap();

        sweep_plain_exports(&root).unwrap();
        assert!(partial.host_exists());
    }
}
