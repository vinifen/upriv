//! Plain-text `.zip` export: the vault's readable files at the zip's root, so
//! `Notes.zip` unpacks to `Notes/` with the files directly inside. It is the
//! person's way to take their data out with no app and no password.
//!
//! This is the one export that puts readable vault bytes on ordinary disk, by
//! the person's own choice and only behind the vault password. Each file is
//! decrypted one chunk at a time straight into the zip; nothing is staged.
//! The file is written owner-only. Until it is complete it is a `.upriv-part`
//! with a record in `state.json`: a stop or a failure overwrites it and removes
//! it, and a later launch does the same for what a crash left behind
//! (`super::unfinished`).

use std::io::Write;
use std::path::Path;

use zip::write::FileOptions;
use zip::{CompressionMethod, ZipWriter};

use crate::error::Result;
use crate::host_fs::{File, OpenOptions};
use crate::session::Job;
use crate::store::{is_reserved_logical, read_file_chunks_keeping, VaultIndex};

use super::config_folder::ConfigFile;
use super::files_zip::PLAIN_ZIP_COMMENT;
use super::seven_zip_pack::{
    archive_member_name, export_dir_nodes, export_file_nodes, file_size, LogicalSource,
    ReadableExport,
};
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
/// `job` is asked to stop; its progress counts the logical bytes written. A
/// file whose data is missing or damaged goes in with zeros in those parts,
/// so it keeps its place and size, and is named in the result.
pub(super) fn write_plain_zip(
    source: LogicalSource<'_>,
    index: &VaultIndex,
    config_files: &[ConfigFile],
    dest: &Path,
    job: &Job,
) -> Result<ReadableExport> {
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
    let mut unreadable = Vec::new();
    for node in files {
        job.ensure_running()?;
        let name = archive_member_name(&node.path)?;
        let large = file_size(node) >= u64::from(u32::MAX);
        zip.start_file(name, options.large_file(large))
            .map_err(|e| zip_err(dest, e))?;
        let problem = read_file_chunks_keeping(
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
        if problem.is_some() {
            unreadable.push(node.path.clone());
        }
    }
    Ok(ReadableExport {
        size: finish_zip_file(zip, dest)?,
        unreadable,
    })
}
