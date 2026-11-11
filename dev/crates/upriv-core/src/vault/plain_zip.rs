//! Plain-text `.zip` export: the vault's readable files in its package, so
//! `My notes-plain-text.zip` unpacks to `My notes-plain-text/my-notes/` with
//! the files directly inside. It is the person's way to take their data out with no app
//! and no password.
//!
//! This is the one export that puts readable vault bytes on ordinary disk, by
//! the person's own choice and only behind the vault password. Each file is
//! decrypted one chunk at a time straight into the zip; nothing is staged. A
//! worker thread decrypts the next chunks while the zip is written, holding at
//! most [`DECRYPT_QUEUE_CHUNKS`] of them in RAM, each wiped once it is used.
//! The file is written owner-only. Until it is complete it is a `.upriv-part`
//! with a record in `state.json`: a stop or a failure overwrites it and removes
//! it, and a later launch does the same for what a crash left behind
//! (`super::unfinished`).

use std::io::{Read, Write};
use std::path::Path;
use std::sync::mpsc::{sync_channel, Receiver};

use zeroize::Zeroizing;

use zip::write::FileOptions;
use zip::{CompressionMethod, ZipWriter};

use crate::error::Result;
use crate::host_fs::{File, OpenOptions};
use crate::session::Job;
use crate::store::{is_reserved_logical, VaultIndex, VaultNode, CHUNK_SIZE};

use super::config_folder::ConfigFile;
use super::files_zip::PLAIN_ZIP_COMMENT;
use super::package::Package;
use super::seven_zip_pack::{
    archive_member_name, decrypt_in_order, export_dir_nodes, export_file_nodes, file_size,
    LogicalSource, QueuedFile, ReadableExport, DECRYPT_QUEUE_CHUNKS,
};
use super::zip_io::{finish_zip_file, job_zip_file, zip_err, PacedFile};

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

/// Stored zip of the vault's logical files in `package` at `dest`. Each
/// write fails once `job` is asked to stop; its progress counts the logical
/// bytes written. A file whose data is missing or damaged goes in with zeros
/// in those parts, so it keeps its place and size, and is named in the result.
pub(super) fn write_plain_zip(
    source: LogicalSource<'_>,
    index: &VaultIndex,
    package: &Package,
    config_files: &[ConfigFile],
    dest: &Path,
    job: &Job,
) -> Result<ReadableExport> {
    job.ensure_running()?;
    let dirs = export_dir_nodes(index, &is_reserved_logical);
    let files = export_file_nodes(index, &is_reserved_logical);
    job.set_total(files.iter().map(|node| file_size(node)).sum());

    let mut zip = ZipWriter::new(job_zip_file(job, PacedFile::new(create_owner_only(dest)?)));
    let options = FileOptions::default().compression_method(CompressionMethod::Stored);
    zip.set_comment(PLAIN_ZIP_COMMENT);
    // The two folders go in first, so even an empty vault is its package.
    for folder in [package.outer.clone(), package.root()] {
        zip.add_directory(format!("{}/", archive_member_name(&folder)?), options)
            .map_err(|e| zip_err(dest, e))?;
    }
    for dir in dirs {
        let name = archive_member_name(&package.member(&dir.path))?;
        zip.add_directory(format!("{name}/"), options)
            .map_err(|e| zip_err(dest, e))?;
    }
    // What the export carries about the vault sits beside its folder.
    for file in config_files {
        zip.start_file(archive_member_name(&package.beside(&file.path()))?, options)
            .map_err(|e| zip_err(dest, e))?;
        zip.write_all(&file.bytes).map_err(|e| zip_err(dest, e))?;
    }
    let (decrypted, queue) = sync_channel(DECRYPT_QUEUE_CHUNKS);
    let files = files.as_slice();
    let unreadable = std::thread::scope(|scope| {
        let worker = std::thread::Builder::new()
            .name("upriv-plain-decrypt".into())
            .spawn_scoped(scope, move || {
                decrypt_in_order(source, files, decrypted, job)
            })?;
        let written = write_files(&mut zip, &queue, files, package, options, dest, job);
        // Without its reader the worker stops at its next chunk.
        drop(queue);
        let read = worker
            .join()
            .unwrap_or_else(|panic| std::panic::resume_unwind(panic));
        // A decrypt failure is the error: it is why the zip ran dry.
        job.settle(read.and_then(|unreadable| written.map(|()| unreadable)))
    })?;
    Ok(ReadableExport {
        size: finish_zip_file(zip, dest)?,
        unreadable,
    })
}

/// Each of `files` into `zip`, its plaintext taken from `queue` in order.
fn write_files<W: Write + std::io::Seek>(
    zip: &mut ZipWriter<W>,
    queue: &Receiver<Zeroizing<Vec<u8>>>,
    files: &[&VaultNode],
    package: &Package,
    options: FileOptions,
    dest: &Path,
    job: &Job,
) -> Result<()> {
    let mut buf = Zeroizing::new(vec![0u8; CHUNK_SIZE as usize]);
    for node in files {
        job.ensure_running()?;
        let name = archive_member_name(&package.member(&node.path))?;
        let large = file_size(node) >= u64::from(u32::MAX);
        zip.start_file(name, options.large_file(large))
            .map_err(|e| zip_err(dest, e))?;
        let mut plaintext = QueuedFile::new(queue, job, file_size(node));
        loop {
            let read = plaintext.read(&mut buf).map_err(|e| zip_err(dest, e))?;
            if read == 0 {
                break;
            }
            zip.write_all(&buf[..read]).map_err(|e| zip_err(dest, e))?;
        }
    }
    Ok(())
}
