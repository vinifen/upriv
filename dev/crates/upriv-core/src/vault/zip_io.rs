//! Zip envelope of a ciphertext `store/` tree (no zip password):
//! `README.md`, `config.toml`, and `store/`, at the zip root in a backup and
//! in the vault folder of the package (`super::package`) in an export.

use crate::host_fs::File;
#[allow(unused_imports)]
use crate::host_fs::HostFsQuery;
use std::io::{Cursor, ErrorKind, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use zeroize::{Zeroize, Zeroizing};
use zip::write::FileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::error::{Result, UprivError};
use crate::session::Job;

use super::embedded_settings::{store_zip_readme, ZIP_CONFIG_ENTRY, ZIP_README_ENTRY};
use super::package::Package;
use crate::paths::STORE_DIR_NAME;
use crate::store::{
    HEADER_DIR_NAME, HEADER_FILE_NAME, INDEX_COPY_FILE_NAME, INDEX_DIR_NAME, INDEX_FILE_NAME,
    STORE_DANGER_FILE_NAME,
};

const ZIP_WRITE_BUFFER: usize = 256 * 1024;
/// Bytes an export or backup file writes between two steps of sending it to
/// the disk ([`PacedFile`]). One flush at the end of a large file would hold
/// its last step for minutes on a slow drive.
const PACED_WINDOW_BYTES: u64 = 64 * 1024 * 1024;
/// Bytes moved per read when a file goes into or out of a zip.
const ZIP_COPY_BUFFER: usize = 256 * 1024;
/// What [`SeekBufReader`] reads at a time. A scan of local headers reads at
/// most this much per entry, so a zip of large files is not read through.
const ZIP_READ_WINDOW: usize = 8 * 1024;
/// Bytes a backward seek keeps after its target, so the record read there
/// (an end-of-archive record is 22 bytes) does not run off the window.
const ZIP_READ_BACK_TAIL: usize = 64;

/// Batches small zip headers and stored bytes. A storage-access file pays for
/// each write; seeking flushes first so the zip offsets stay correct. A write
/// as large as the buffer goes straight through. The buffer is wiped each time
/// its bytes go out, and when it goes: a plain-text export's readable files
/// pass through it. Nothing is flushed on drop; a writer that is done flushes.
///
/// Once a write, flush, or seek fails, every later one fails too. The zip
/// writer rewrites each finished entry's header in place: a rewrite that fails
/// after its seek leaves the file inside that header, and the next finish of
/// the entry, which the zip writer's drop runs, would take its size from there
/// and come out below zero.
pub(super) struct SeekBufWriter<W: Write + Seek> {
    inner: W,
    /// Bytes waiting for `inner`, at most [`ZIP_WRITE_BUFFER`].
    buf: Zeroizing<Vec<u8>>,
    failed: bool,
}

pub(super) fn buffered_zip_file<W: Write + Seek>(file: W) -> SeekBufWriter<W> {
    SeekBufWriter {
        inner: file,
        buf: Zeroizing::new(Vec::with_capacity(ZIP_WRITE_BUFFER)),
        failed: false,
    }
}

/// The file a zip of `job` writes: [`buffered_zip_file`] over `file`, with
/// every write refused once the job is asked to stop. The stop sits beneath
/// the buffer, so the write it refuses fails the buffer, and with it every
/// later write, flush, and seek of the zip.
pub(super) fn job_zip_file<'a, W: Write + Seek + 'a>(
    job: &'a Job,
    file: W,
) -> SeekBufWriter<impl Write + Seek + 'a> {
    buffered_zip_file(job.writer(file))
}

impl<W: Write + Seek> SeekBufWriter<W> {
    fn unless_failed<T>(
        &mut self,
        op: impl FnOnce(&mut Self) -> std::io::Result<T>,
    ) -> std::io::Result<T> {
        if self.failed {
            return Err(std::io::Error::other("an earlier write to this zip failed"));
        }
        let result = op(self);
        if result
            .as_ref()
            .is_err_and(|error| error.kind() != ErrorKind::Interrupted)
        {
            self.failed = true;
        }
        result
    }
}

/// An export or backup file that goes to the disk while it is written, one
/// [`PACED_WINDOW_BYTES`] window at a time, so the flush before its rename
/// stays short and a stop is never far behind one.
///
/// On Linux each window starts going out without a wait, after the window
/// before it is waited for: the disk writes while the next window is made, and
/// at most two windows wait in RAM. Elsewhere each window is flushed. Neither
/// reaches the drive's own cache: the export's install flushes the whole file
/// (`sync_file_durable`) before it renames it. A failed send fails the file,
/// and is never tried again.
pub(super) struct PacedFile {
    file: File,
    /// [`PACED_WINDOW_BYTES`], smaller in a test.
    window: u64,
    unsent: u64,
    /// Where the bytes already sent to the disk end.
    #[cfg(target_os = "linux")]
    sent_to: u64,
    /// This file takes ranges ([`send_range`]); one that does not is flushed.
    #[cfg(target_os = "linux")]
    ranges: bool,
}

impl PacedFile {
    pub(super) fn new(file: File) -> Self {
        Self {
            file,
            window: PACED_WINDOW_BYTES,
            unsent: 0,
            #[cfg(target_os = "linux")]
            sent_to: 0,
            #[cfg(target_os = "linux")]
            ranges: true,
        }
    }

    pub(super) fn into_file(self) -> File {
        self.file
    }

    #[cfg(target_os = "linux")]
    fn send_window(&mut self) -> std::io::Result<()> {
        if self.ranges {
            let end = self.file.stream_position()?.max(self.sent_to);
            match send_range(&self.file, self.sent_to, end) {
                Ok(()) => {
                    self.sent_to = end;
                    return Ok(());
                }
                Err(error) if range_unsupported(&error) => self.ranges = false,
                Err(error) => return Err(error),
            }
        }
        self.file.sync_data()
    }

    #[cfg(not(target_os = "linux"))]
    fn send_window(&mut self) -> std::io::Result<()> {
        self.file.sync_data()
    }
}

/// Wait until `..from` of `file` is written, writing what is still dirty
/// there (a header rewritten in place), then start `from..to` without a wait.
#[cfg(target_os = "linux")]
fn send_range(file: &File, from: u64, to: u64) -> std::io::Result<()> {
    use std::os::fd::AsRawFd;
    let range = |offset: u64, len: u64, flags: libc::c_uint| {
        let (Ok(offset), Ok(len)) = (
            libc::off64_t::try_from(offset),
            libc::off64_t::try_from(len),
        ) else {
            return Err(std::io::Error::from(ErrorKind::InvalidInput));
        };
        // SAFETY: the descriptor stays open for the life of `file`, and the
        // call reads no memory of this process.
        match unsafe { libc::sync_file_range(file.as_raw_fd(), offset, len, flags) } {
            0 => Ok(()),
            _ => Err(std::io::Error::last_os_error()),
        }
    };
    if from > 0 {
        range(
            0,
            from,
            libc::SYNC_FILE_RANGE_WAIT_BEFORE
                | libc::SYNC_FILE_RANGE_WRITE
                | libc::SYNC_FILE_RANGE_WAIT_AFTER,
        )?;
    }
    if to > from {
        range(from, to - from, libc::SYNC_FILE_RANGE_WRITE)?;
    }
    Ok(())
}

/// A file system or descriptor that cannot send a range: it is flushed.
#[cfg(target_os = "linux")]
fn range_unsupported(error: &std::io::Error) -> bool {
    matches!(
        error.raw_os_error(),
        Some(libc::ENOSYS | libc::EINVAL | libc::ESPIPE | libc::EOPNOTSUPP)
    )
}

impl Write for PacedFile {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let written = self.file.write(buf)?;
        self.unsent += written as u64;
        if self.unsent >= self.window {
            self.send_window()?;
            self.unsent = 0;
        }
        Ok(written)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.file.flush()
    }
}

impl Seek for PacedFile {
    fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
        self.file.seek(pos)
    }
}

impl<W: Write + Seek> SeekBufWriter<W> {
    /// Write the waiting bytes to the file, then wipe them.
    fn write_out(&mut self) -> std::io::Result<()> {
        if self.buf.is_empty() {
            return Ok(());
        }
        let written = self.inner.write_all(&self.buf);
        self.buf.zeroize();
        written
    }
}

impl<W: Write + Seek> Write for SeekBufWriter<W> {
    fn write(&mut self, data: &[u8]) -> std::io::Result<usize> {
        self.unless_failed(|this| {
            if this.buf.len() + data.len() > ZIP_WRITE_BUFFER {
                this.write_out()?;
            }
            if data.len() >= ZIP_WRITE_BUFFER {
                this.inner.write_all(data)?;
            } else {
                this.buf.extend_from_slice(data);
            }
            Ok(data.len())
        })
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.unless_failed(|this| {
            this.write_out()?;
            this.inner.flush()
        })
    }
}

impl<W: Write + Seek> Seek for SeekBufWriter<W> {
    fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
        self.unless_failed(|this| {
            this.write_out()?;
            this.inner.seek(pos)
        })
    }
}

/// Buffered reads that keep their window when a seek lands inside it.
///
/// The zip reader seeks, then reads two or four bytes at a time, for every
/// entry it opens, and looks for the end of the archive one byte at a time,
/// backward. On a plain file each of those reads is a call, and on a
/// storage-access file a round trip. Here entries next to each other share one
/// read, a seek just before the window reads the window that ends a little
/// past its target, and a read at least as large as the window goes straight
/// to the file.
pub(super) struct SeekBufReader<R: Read + Seek> {
    inner: R,
    buf: Box<[u8]>,
    /// Offset of `buf[0]` in `inner`. `inner` itself sits at `start + filled`.
    start: u64,
    filled: usize,
    pos: usize,
}

/// Buffered reads of `inner`, starting where it is now.
pub(super) fn buffered_zip_reader<R: Read + Seek>(
    mut inner: R,
) -> std::io::Result<SeekBufReader<R>> {
    let start = inner.stream_position()?;
    Ok(SeekBufReader {
        inner,
        buf: vec![0; ZIP_READ_WINDOW].into_boxed_slice(),
        start,
        filled: 0,
        pos: 0,
    })
}

impl<R: Read + Seek> SeekBufReader<R> {
    /// An empty window at `at`, where `inner` now sits.
    fn empty_at(&mut self, at: u64) {
        self.start = at;
        self.filled = 0;
        self.pos = 0;
    }

    /// Read the window that ends [`ZIP_READ_BACK_TAIL`] bytes past `target`
    /// and point at `target`. False when a short read left `target` outside
    /// it. On false or an error, `inner` sits where the window says.
    fn fill_before(&mut self, target: u64) -> std::io::Result<bool> {
        let from = target.saturating_sub((self.buf.len() - ZIP_READ_BACK_TAIL) as u64);
        self.inner.seek(SeekFrom::Start(from))?;
        self.empty_at(from);
        self.filled = self.inner.read(&mut self.buf)?;
        if target - from > self.filled as u64 {
            return Ok(false);
        }
        self.pos = (target - from) as usize;
        Ok(true)
    }
}

impl<R: Read + Seek> Read for SeekBufReader<R> {
    fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
        if out.is_empty() {
            return Ok(0);
        }
        if self.pos == self.filled {
            self.empty_at(self.start + self.filled as u64);
            if out.len() >= self.buf.len() {
                let read = self.inner.read(out)?;
                self.start += read as u64;
                return Ok(read);
            }
            self.filled = self.inner.read(&mut self.buf)?;
        }
        let n = out.len().min(self.filled - self.pos);
        out[..n].copy_from_slice(&self.buf[self.pos..self.pos + n]);
        self.pos += n;
        Ok(n)
    }
}

impl<R: Read + Seek> Seek for SeekBufReader<R> {
    fn seek(&mut self, to: SeekFrom) -> std::io::Result<u64> {
        let target = match to {
            SeekFrom::Start(offset) => offset,
            SeekFrom::Current(delta) => (self.start + self.pos as u64)
                .checked_add_signed(delta)
                .ok_or_else(|| {
                    std::io::Error::new(ErrorKind::InvalidInput, "seek outside the file")
                })?,
            SeekFrom::End(_) => {
                let at = self.inner.seek(to)?;
                self.empty_at(at);
                return Ok(at);
            }
        };
        if target >= self.start && target - self.start <= self.filled as u64 {
            self.pos = (target - self.start) as usize;
            return Ok(target);
        }
        // Reading ahead of a backward step is only a shortcut: when it fails,
        // the seek below still runs.
        let just_before = target < self.start && self.start - target <= self.buf.len() as u64;
        if just_before && matches!(self.fill_before(target), Ok(true)) {
            return Ok(target);
        }
        let at = self.inner.seek(SeekFrom::Start(target))?;
        self.empty_at(at);
        Ok(at)
    }
}

/// `std::io::copy` through `buf`, one read per `buf.len()` bytes rather than
/// its 8 KiB.
fn copy_through(
    reader: &mut impl Read,
    writer: &mut impl Write,
    buf: &mut [u8],
) -> std::io::Result<u64> {
    let mut copied = 0u64;
    loop {
        let read = match reader.read(buf) {
            Ok(0) => return Ok(copied),
            Ok(read) => read,
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        };
        writer.write_all(&buf[..read])?;
        copied += read as u64;
    }
}

pub(super) fn zip_err(path: &Path, error: impl std::fmt::Display) -> UprivError {
    UprivError::VaultStoreInvalid {
        path: path.to_path_buf(),
        detail: error.to_string(),
    }
}

/// A store zip holds `store/header/vault.header` at its root (a backup) or in
/// its package's vault folder (an export, [`StoreEnvelope`]). A symlink at
/// the final component is not one. Reads only the central directory,
/// buffered: one zip of a large vault is a few reads, not a seek per entry.
pub(crate) fn zip_contains_store_header(path: &Path) -> bool {
    let Ok(file) = crate::paths::open_nofollow(path, crate::paths::NofollowMode::Read) else {
        return false;
    };
    let Ok(archive) = ZipArchive::new(std::io::BufReader::new(file)) else {
        return false;
    };
    StoreEnvelope::find(&archive).is_some()
}

/// Require the two sealed index files to be present and byte-identical, after
/// [`verify_store_zip_entries`].
pub(crate) fn verify_store_zip_copies(path: &Path, job: &Job) -> Result<()> {
    match verify_store_zip_entries(path, job)? {
        (Some(primary), Some(copy)) if primary == copy && !primary.is_empty() => Ok(()),
        (Some(_), Some(_)) => Err(zip_err(path, "index copies in the backup zip differ")),
        _ => Err(zip_err(path, "backup zip is missing an index copy")),
    }
}

/// The primary index file and the index copy of a store zip, when it has them.
pub(crate) type ZipIndexFiles = (Option<Vec<u8>>, Option<Vec<u8>>);

/// Read every entry of the store zip at `path` against its checksum, and
/// return its index files.
///
/// Every entry is read through to the end so its checksum is checked before
/// an older backup can be deleted. Skipping bodies on a storage-access folder
/// let a bad persist replace the previous zip.
pub(crate) fn verify_store_zip_entries(path: &Path, job: &Job) -> Result<ZipIndexFiles> {
    let file = buffered_zip_reader(File::open(path)?)?;
    let mut archive = ZipArchive::new(file).map_err(|e| zip_err(path, e))?;
    let envelope = StoreEnvelope::find(&archive)
        .ok_or_else(|| zip_err(path, "zip holds no store/header/vault.header"))?;
    let mut primary = None;
    let mut copy = None;
    for i in 0..archive.len() {
        job.ensure_running()?;
        let mut entry = archive.by_index(i).map_err(|e| zip_err(path, e))?;
        let name = entry.name().replace('\\', "/");
        let keep = envelope.inside(&name).and_then(index_zip_role);
        let bytes = read_zip_entry_checked(path, &mut entry, keep.is_some())?;
        match keep {
            Some(IndexZipRole::Primary) if primary.is_some() => {
                return Err(zip_err(path, "backup zip has two primary index files"));
            }
            Some(IndexZipRole::Primary) => primary = bytes,
            Some(IndexZipRole::Copy) if copy.is_some() => {
                return Err(zip_err(path, "backup zip has two index copies"));
            }
            Some(IndexZipRole::Copy) => copy = bytes,
            None => {}
        }
    }
    Ok((primary, copy))
}

enum IndexZipRole {
    Primary,
    Copy,
}

/// What `rest`, a path in the envelope, is among the index files.
fn index_zip_role(rest: &str) -> Option<IndexZipRole> {
    let name = rest.strip_prefix(&format!("{STORE_DIR_NAME}/"))?;
    let (dir, file) = name.rsplit_once('/')?;
    if dir != INDEX_DIR_NAME {
        return None;
    }
    if file == INDEX_COPY_FILE_NAME {
        Some(IndexZipRole::Copy)
    } else if file == INDEX_FILE_NAME {
        Some(IndexZipRole::Primary)
    } else {
        None
    }
}

fn read_zip_entry_checked(
    path: &Path,
    entry: &mut impl Read,
    keep: bool,
) -> Result<Option<Vec<u8>>> {
    let mut kept = Vec::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = entry.read(&mut buf).map_err(|e| zip_err(path, e))?;
        if n == 0 {
            break;
        }
        if keep {
            kept.extend_from_slice(&buf[..n]);
        }
    }
    Ok(if keep { Some(kept) } else { None })
}

/// An export's package folders, then `README.md` and `config.toml` beside
/// `store/` in `envelope`.
///
/// The warning file already in `store/` is copied with the tree, and each
/// byte copied from `store/` counts toward `job`.
fn write_zip_with_config<W: Write + std::io::Seek>(
    tree: &ZipTree<'_>,
    envelope: &StoreEnvelope,
    config_toml: &[u8],
    readme: &str,
    writer: W,
    job: &Job,
) -> Result<W> {
    let src = tree.root;
    let mut zip = ZipWriter::new(writer);
    let options = FileOptions::default().compression_method(CompressionMethod::Stored);
    for folder in envelope.folders() {
        zip.add_directory(folder, options)
            .map_err(|e| zip_err(src, e))?;
    }
    zip.start_file(envelope.member(ZIP_README_ENTRY), options)
        .map_err(|e| zip_err(src, e))?;
    zip.write_all(readme.as_bytes())
        .map_err(|e| zip_err(src, e))?;
    zip.start_file(envelope.member(ZIP_CONFIG_ENTRY), options)
        .map_err(|e| zip_err(src, e))?;
    zip.write_all(config_toml).map_err(|e| zip_err(src, e))?;
    zip.add_directory(format!("{}/", envelope.member(STORE_DIR_NAME)), options)
        .map_err(|e| zip_err(src, e))?;
    tree.write(&mut zip, options, job)?;
    zip.finish().map_err(|e| zip_err(src, e))
}

/// Zip of `store/` plus `README.md` and `config.toml` in `envelope`, written
/// to `dest`. Each write fails once `job` is asked to stop. Its progress
/// counts the bytes of `store/` copied.
///
/// `created_stamp` is UTC `YYYYMMDDHHmmss` and is written into `README.md`.
pub(super) fn zip_store_with_config_to_path(
    store: &Path,
    envelope: &StoreEnvelope,
    config_toml: &[u8],
    created_stamp: &str,
    dest: &Path,
    job: &Job,
) -> Result<u64> {
    // One listing gives both the size `README.md` records and what to copy.
    let prefix = PathBuf::from(envelope.member(STORE_DIR_NAME));
    let tree = ZipTree::list(store, &prefix)?;
    job.set_total(tree.bytes);
    let readme = store_zip_readme(created_stamp, tree.bytes)?;
    let file = job_zip_file(job, PacedFile::new(File::create(dest)?));
    let mut file = write_zip_with_config(&tree, envelope, config_toml, &readme, file, job)?;
    // Dropping a buffered writer would discard a failed last flush.
    file.flush()?;
    written_len(file, dest)
}

/// End records, zip64 records, and room for small entries written beside a
/// tree, such as `README.md` and `config.toml`, or a log that grows while
/// it is copied.
pub(super) const ZIP_SLACK: u64 = 1024 * 1024;

/// What one entry adds around its bytes: the local header and the central
/// record, each with the name and a zip64 field.
pub(super) fn zip_entry_overhead(name: &str) -> u64 {
    30 + 46 + 2 * 28 + 2 * name.len() as u64
}

/// At most how many bytes [`zip_store_with_config_to_path`] writes for a
/// backup of `store`: its files, what each entry adds, and [`ZIP_SLACK`].
pub(super) fn store_zip_bytes(store: &Path) -> Result<u64> {
    let tree = ZipTree::list(store, Path::new(STORE_DIR_NAME))?;
    let overhead: u64 = tree
        .entries
        .iter()
        .map(|entry| match entry {
            TreeEntry::Dir(rel) | TreeEntry::File(rel) => zip_entry_overhead(&tree.zip_name(rel)),
        })
        .sum();
    Ok(tree
        .bytes
        .saturating_add(overhead)
        .saturating_add(ZIP_SLACK))
}

/// Length of the file `out` wrote to `dest`, from the position on the fd we
/// already hold. A new open would be another storage-access round trip just to
/// read the length.
fn written_len<W: Seek>(mut out: W, dest: &Path) -> Result<u64> {
    match out.stream_position() {
        Ok(len) => Ok(len),
        Err(error) => {
            drop(out);
            crate::host_fs::metadata(dest)
                .map(|meta| meta.len())
                .map_err(|_| error.into())
        }
    }
}

/// Write the end of `zip` and flush it into `dest`. Returns the file's length.
pub(super) fn finish_zip_file<W: Write + Seek>(mut zip: ZipWriter<W>, dest: &Path) -> Result<u64> {
    let mut out = zip.finish().map_err(|e| zip_err(dest, e))?;
    // Dropping a buffered writer would discard a failed last flush.
    out.flush()?;
    written_len(out, dest)
}

/// A store zip's envelope and the `config.toml` beside its `store/`, from one
/// open of the zip. `(None, None)` when the zip holds no store.
pub(crate) fn read_store_zip_config<R: Read + Seek>(
    reader: R,
) -> Result<(Option<StoreEnvelope>, Option<Vec<u8>>)> {
    let mut archive = ZipArchive::new(reader).map_err(|e| zip_err(Path::new("zip"), e))?;
    let Some(envelope) = StoreEnvelope::find(&archive) else {
        return Ok((None, None));
    };
    let config = read_envelope_entry(&mut archive, &envelope, ZIP_CONFIG_ENTRY)?;
    Ok((Some(envelope), config))
}

/// One file beside `store/` in a store zip's envelope (`config.toml` or
/// `README.md`), not a file inside `store/`. `None` when the zip holds no
/// store or lacks that file.
#[cfg(test)]
pub(crate) fn read_zip_root_entry<R: Read + Seek>(
    reader: R,
    entry: &str,
) -> Result<Option<Vec<u8>>> {
    let mut archive = ZipArchive::new(reader).map_err(|e| zip_err(Path::new("zip"), e))?;
    let Some(envelope) = StoreEnvelope::find(&archive) else {
        return Ok(None);
    };
    read_envelope_entry(&mut archive, &envelope, entry)
}

fn read_envelope_entry<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    envelope: &StoreEnvelope,
    entry: &str,
) -> Result<Option<Vec<u8>>> {
    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| zip_err(Path::new("zip"), e))?;
        if envelope.inside(&file.name().replace('\\', "/")) != Some(entry) {
            continue;
        }
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)
            .map_err(|e| zip_err(Path::new(entry), e))?;
        return Ok(Some(bytes));
    }
    Ok(None)
}

/// One folder or file of a tree being zipped, by its path under the tree's
/// root. Only that short path is kept, so a listing of many files stays small.
enum TreeEntry {
    Dir(PathBuf),
    File(PathBuf),
}

/// A folder listed once, in zip order: each folder's entries sorted by name,
/// a folder before what it holds. `bytes` adds up its files.
struct ZipTree<'a> {
    root: &'a Path,
    /// Where the tree sits in the zip.
    prefix: &'a Path,
    entries: Vec<TreeEntry>,
    bytes: u64,
}

impl<'a> ZipTree<'a> {
    /// Everything under `root`, named under `prefix` in the zip. A symlink or
    /// a special file refuses the copy.
    fn list(root: &'a Path, prefix: &'a Path) -> Result<Self> {
        let mut tree = Self {
            root,
            prefix,
            entries: Vec::new(),
            bytes: 0,
        };
        tree.add_dir(Path::new(""))?;
        Ok(tree)
    }

    fn add_dir(&mut self, rel: &Path) -> Result<()> {
        // `join("")` would add a trailing separator to a storage-access path.
        let dir = if rel.as_os_str().is_empty() {
            self.root.to_path_buf()
        } else {
            self.root.join(rel)
        };
        let mut entries: Vec<_> = crate::host_fs::read_dir(&dir)?
            .filter_map(|e| e.ok())
            .collect();
        entries.sort_by_key(|e| e.file_name());
        for entry in entries {
            let child = rel.join(entry.file_name());
            let ft = entry.file_type()?;
            if ft.is_symlink() {
                return Err(UprivError::VaultStoreInvalid {
                    path: entry.path(),
                    detail: "refusing to copy a symlink into a zip".into(),
                });
            }
            if ft.host_is_dir() {
                self.entries.push(TreeEntry::Dir(child.clone()));
                self.add_dir(&child)?;
            } else if ft.host_is_file() {
                // A storage-access listing carries the length; a local entry
                // reads it without following a link.
                let len = match entry.known_len() {
                    Some(len) => len,
                    None => entry.metadata()?.len(),
                };
                self.bytes = self.bytes.saturating_add(len);
                self.entries.push(TreeEntry::File(child));
            } else {
                return Err(UprivError::VaultStoreInvalid {
                    path: entry.path(),
                    detail: "refusing to copy a special file into a zip".into(),
                });
            }
        }
        Ok(())
    }

    /// The zip path of `rel`, with `/` between folders on every system.
    fn zip_name(&self, rel: &Path) -> String {
        self.prefix.join(rel).to_string_lossy().replace('\\', "/")
    }

    /// Where the bytes of `rel` come from. The index copy of a store goes in
    /// as its primary index, the commit: the zip holds the committed tree in
    /// both files, as a backup's check requires, even when a seal stopped
    /// between them. The vault keeps its own copy for its next unlock.
    fn source_of(&self, rel: &Path) -> PathBuf {
        let index = Path::new(INDEX_DIR_NAME);
        if rel == index.join(INDEX_COPY_FILE_NAME) {
            let primary = self.root.join(index).join(INDEX_FILE_NAME);
            if primary.host_is_file() {
                return primary;
            }
        }
        self.root.join(rel)
    }

    /// Each entry into `zip`. A file is opened again without following a
    /// link, so one swapped in since the listing is refused.
    fn write<W: Write + Seek>(
        &self,
        zip: &mut ZipWriter<W>,
        options: FileOptions,
        job: &Job,
    ) -> Result<()> {
        let mut buf = vec![0u8; ZIP_COPY_BUFFER];
        for entry in &self.entries {
            job.ensure_running()?;
            match entry {
                TreeEntry::Dir(rel) => {
                    zip.add_directory(format!("{}/", self.zip_name(rel)), options)
                        .map_err(|e| zip_err(&self.root.join(rel), e))?;
                }
                TreeEntry::File(rel) => {
                    let path = self.source_of(rel);
                    zip.start_file(self.zip_name(rel), options)
                        .map_err(|e| zip_err(&path, e))?;
                    let mut file = job.progress_reader(open_regular_nofollow(&path)?);
                    copy_through(&mut file, zip, &mut buf).map_err(|e| zip_err(&path, e))?;
                }
            }
        }
        Ok(())
    }
}

pub(super) fn open_regular_nofollow(src: &Path) -> Result<File> {
    match crate::paths::open_nofollow(src, crate::paths::NofollowMode::Read) {
        Ok(file) => Ok(file),
        Err(error) => match crate::paths::nofollow_reject(&error) {
            Some(crate::paths::NofollowReject::NonFile) => Err(UprivError::VaultStoreInvalid {
                path: src.to_path_buf(),
                detail: "refusing to copy a non-regular file into a zip".into(),
            }),
            Some(crate::paths::NofollowReject::Symlink) => Err(UprivError::VaultStoreInvalid {
                path: src.to_path_buf(),
                detail: "refusing to copy a symlink into a zip".into(),
            }),
            None => Err(error.into()),
        },
    }
}

/// Copy one regular file to `dest`. Each write fails once `job` is asked to
/// stop; its progress counts the bytes copied.
pub(super) fn copy_file_to_path(src: &Path, dest: &Path, job: &Job) -> Result<u64> {
    let mut input = job.progress_reader(open_regular_nofollow(src)?);
    let mut output = job.writer(PacedFile::new(File::create(dest)?));
    let mut buf = vec![0u8; ZIP_COPY_BUFFER];
    let copied = copy_through(&mut input, &mut output, &mut buf)?;
    output.flush()?;
    Ok(copied)
}

/// Stored zip whose entries are existing files (a bundle of backup `.zip`s).
/// Each write fails once `job` is asked to stop; its progress counts the bytes
/// of those files copied.
pub(super) fn zip_files_to_path(
    entries: &[(String, PathBuf)],
    dest: &Path,
    job: &Job,
) -> Result<u64> {
    let mut zip = ZipWriter::new(job_zip_file(job, PacedFile::new(File::create(dest)?)));
    let options = FileOptions::default().compression_method(CompressionMethod::Stored);
    let mut buf = vec![0u8; ZIP_COPY_BUFFER];
    for (name, src) in entries {
        job.ensure_running()?;
        if name.contains("..") || name.contains('/') || name.contains('\\') {
            return Err(UprivError::VaultStoreInvalid {
                path: src.to_path_buf(),
                detail: "refusing a zip entry name that is not a single file".into(),
            });
        }
        let input = open_regular_nofollow(src)?;
        let large = input.metadata()?.len() >= u64::from(u32::MAX);
        zip.start_file(name, options.large_file(large))
            .map_err(|e| zip_err(src, e))?;
        let mut input = job.progress_reader(input);
        copy_through(&mut input, &mut zip, &mut buf).map_err(|e| zip_err(src, e))?;
    }
    finish_zip_file(zip, dest)
}

/// Extract a `.zip` of `store/` into `dest`. Rejects path escape. Each read
/// fails once `job` is asked to stop.
pub fn unzip_store_bytes(bytes: &[u8], dest: &Path, job: &Job) -> Result<()> {
    let len = bytes.len() as u64;
    job.set_total(len);
    unzip_store_reader(job.progress_reader(Cursor::new(bytes)), dest, len)
}

/// Extract a zip file into `dest`, copying each entry without a second full
/// buffer. Each read fails once `job` is asked to stop.
pub fn unzip_store_path(path: &Path, dest: &Path, job: &Job) -> Result<()> {
    let file =
        File::open(path).map_err(|error| super::import::map_archive_open_error(path, error))?;
    let len = file.metadata()?.len();
    job.set_total(len);
    unzip_store_reader(job.progress_reader(buffered_zip_reader(file)?), dest, len)
}

/// Ciphertext barely compresses. A much larger unpack is a zip bomb, not a store export.
const ZIP_EXPAND_FACTOR: u64 = 8;

fn unzip_store_reader<R: Read + Seek>(reader: R, dest: &Path, source_len: u64) -> Result<()> {
    let expand_limit = source_len.saturating_mul(ZIP_EXPAND_FACTOR);
    crate::host_fs::create_dir_all(dest)?;
    let mut archive = ZipArchive::new(reader).map_err(|e| zip_err(dest, e))?;
    let envelope = StoreEnvelope::find(&archive).ok_or_else(|| UprivError::VaultStoreInvalid {
        path: dest.to_path_buf(),
        detail: "zip holds no store/header/vault.header".into(),
    })?;
    let mut unpacked: u64 = 0;
    let mut buf = vec![0u8; ZIP_COPY_BUFFER];
    for i in 0..archive.len() {
        let file = archive.by_index(i).map_err(|e| zip_err(dest, e))?;
        let name = file.name().replace('\\', "/");
        // An export's package folders, and what a system leaves beside them.
        let Some(rest) = envelope.inside(&name) else {
            continue;
        };
        let Some(enclosed) = enclosed_path(rest) else {
            return Err(UprivError::VaultStoreInvalid {
                path: dest.to_path_buf(),
                detail: "zip entry escapes destination".into(),
            });
        };
        let enclosed = strip_store_envelope(enclosed);
        if skip_store_unpack_entry(&enclosed) {
            continue;
        }
        if !store_entry_allowed(&enclosed) {
            return Err(UprivError::VaultStoreInvalid {
                path: dest.join(&enclosed),
                detail: "zip entry is not part of store/".into(),
            });
        }
        let out = dest.join(&enclosed);
        if !out.starts_with(dest) {
            return Err(UprivError::VaultStoreInvalid {
                path: out,
                detail: "zip entry escapes destination".into(),
            });
        }
        if file.is_dir() {
            crate::host_fs::create_dir_all(&out)?;
            continue;
        }
        let entry_len = file.size();
        if unpacked.saturating_add(entry_len) > expand_limit {
            return Err(UprivError::VaultStoreInvalid {
                path: dest.to_path_buf(),
                detail: "zip expands beyond the archive".into(),
            });
        }
        if let Some(parent) = out.parent() {
            crate::host_fs::create_dir_all(parent)?;
        }
        let mut dest_file = File::create(&out)?;
        // Stated size only, and no zip checksum gate: a damaged blob is
        // copied as it is, so the rest of the vault still comes back. Its own
        // AEAD tag fails that one file when it is read (recovery B).
        let copied = copy_through(&mut file.take(entry_len), &mut dest_file, &mut buf)?;
        unpacked = unpacked.saturating_add(copied);
        if unpacked > expand_limit {
            return Err(UprivError::VaultStoreInvalid {
                path: dest.to_path_buf(),
                detail: "zip expands beyond the archive".into(),
            });
        }
    }
    Ok(())
}

fn strip_store_envelope(path: PathBuf) -> PathBuf {
    let mut parts = path.components();
    if let Some(std::path::Component::Normal(first)) = parts.next() {
        if first == STORE_DIR_NAME {
            return parts.collect();
        }
    }
    path
}

fn store_entry_allowed(path: &Path) -> bool {
    let name = path.to_string_lossy().replace('\\', "/");
    let top = name.split('/').next().unwrap_or("");
    matches!(top, "header" | "index" | "data")
}

/// `README.md` and `config.toml` sit beside `store/`. The warning file is inside
/// the zipped `store/` and is not ciphertext, so unpack leaves it out. Import
/// writes the canonical `DANGER-DO-NOT-EDIT-PERMANENT-DATA-LOSS.md` into the new
/// `store/`, and writes its own `config.toml` outside `store/`.
fn skip_store_unpack_entry(path: &Path) -> bool {
    if path.as_os_str().is_empty() {
        return true;
    }
    let name = path.to_string_lossy().replace('\\', "/");
    name == ZIP_README_ENTRY || name == ZIP_CONFIG_ENTRY || name == STORE_DANGER_FILE_NAME
}

/// Where a store zip keeps `README.md`, `config.toml`, and `store/`: at the
/// zip root in a backup, or in the vault folder of an export's package
/// (`super::package`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct StoreEnvelope {
    package: Option<Package>,
}

impl StoreEnvelope {
    /// A backup's: the zip root.
    pub(crate) const BACKUP: Self = Self { package: None };

    /// An export's: the vault folder of `package`.
    pub(crate) fn export(package: Package) -> Self {
        Self {
            package: Some(package),
        }
    }

    /// The envelope of `archive`, from its central directory.
    pub(crate) fn find<R: Read + Seek>(archive: &ZipArchive<R>) -> Option<Self> {
        Self::find_in(archive.file_names())
    }

    /// The envelope zip entries `names` hold: an export's package whose
    /// vault folder holds `store/header/vault.header`, or that file at the zip
    /// root.
    pub(crate) fn find_in<'a>(names: impl IntoIterator<Item = &'a str>) -> Option<Self> {
        let names: Vec<String> = names
            .into_iter()
            .map(|name| name.replace('\\', "/"))
            .collect();
        let header = format!("{STORE_DIR_NAME}/{HEADER_DIR_NAME}/{HEADER_FILE_NAME}");
        let holds = |member: &str| names.iter().any(|name| name == member);
        if let Some(package) = Package::find_in_zip(names.iter().map(String::as_str)) {
            if holds(&package.member(&header)) {
                return Some(Self::export(package));
            }
        }
        holds(&header).then_some(Self::BACKUP)
    }

    /// An export's package; `None` for a backup.
    pub(crate) fn package(&self) -> Option<&Package> {
        self.package.as_ref()
    }

    /// `rest`, a path in the envelope, as a zip member.
    fn member(&self, rest: &str) -> String {
        match &self.package {
            Some(package) => package.member(rest),
            None => rest.to_string(),
        }
    }

    /// The path in the envelope that the member `name` is. `None` for an
    /// export's two package folders and what a system leaves beside them.
    fn inside<'a>(&self, name: &'a str) -> Option<&'a str> {
        match &self.package {
            Some(package) => package.inside(name),
            None => {
                let rest = name.trim_start_matches('/').trim_end_matches('/');
                (!rest.is_empty()).then_some(rest)
            }
        }
    }

    /// An export's two package folders, as zip folder entries.
    fn folders(&self) -> Vec<String> {
        match &self.package {
            Some(package) => vec![
                format!("{}/", package.outer),
                format!("{}/", package.root()),
            ],
            None => Vec::new(),
        }
    }
}

/// `rest`, a path in the envelope, as a relative path with no part that
/// leaves it.
fn enclosed_path(rest: &str) -> Option<PathBuf> {
    let mut out = PathBuf::new();
    for part in rest.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            return None;
        }
        out.push(part);
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    #[allow(unused_imports)]
    use crate::host_fs::HostFsQuery;
    use std::io::Write;

    use super::*;

    /// Stored zip of `src` with its entries at the zip root.
    fn zip_dir(src: &Path) -> Vec<u8> {
        let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
        let options = FileOptions::default().compression_method(CompressionMethod::Stored);
        ZipTree::list(src, Path::new(""))
            .unwrap()
            .write(&mut zip, options, &Job::untracked())
            .unwrap();
        zip.finish().unwrap().into_inner()
    }

    /// Counts the reads that reach the file and the bytes they return.
    struct CountedReads<R> {
        inner: R,
        reads: usize,
        bytes: usize,
    }

    impl<R> CountedReads<R> {
        fn new(inner: R) -> Self {
            Self {
                inner,
                reads: 0,
                bytes: 0,
            }
        }
    }

    impl<R: Read> Read for CountedReads<R> {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            let read = self.inner.read(buf)?;
            self.reads += 1;
            self.bytes += read;
            Ok(read)
        }
    }

    impl<R: Seek> Seek for CountedReads<R> {
        fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
            self.inner.seek(pos)
        }
    }

    /// Read `size` bytes or up to the end from both readers and compare.
    fn read_both(plain: &mut Cursor<Vec<u8>>, buffered: &mut impl Read, size: usize, step: usize) {
        let mut want = vec![0u8; size];
        let n = plain.read(&mut want).unwrap();
        let mut got = vec![0u8; size];
        let mut filled = 0;
        while filled < n {
            let read = buffered.read(&mut got[filled..n]).unwrap();
            assert!(read > 0, "step {step}: ended early");
            filled += read;
        }
        assert_eq!(got[..n], want[..n], "step {step}, size {size}");
        if n < size {
            assert_eq!(
                buffered.read(&mut got[n..]).unwrap(),
                0,
                "step {step}: past the end"
            );
        }
    }

    #[test]
    fn the_buffered_zip_reader_reads_what_the_file_holds() {
        let data: Vec<u8> = (0..100_000u32).map(|i| (i * 7 % 251) as u8).collect();
        let len = data.len() as u64;
        let window = ZIP_READ_WINDOW as u64;
        let mut plain = Cursor::new(data.clone());
        plain.set_position(1_234);
        let mut inner = Cursor::new(data.clone());
        inner.set_position(1_234);
        let mut buffered = buffered_zip_reader(inner).unwrap();
        let sizes = [
            0,
            1,
            2,
            4,
            30,
            5_000,
            ZIP_READ_WINDOW - 1,
            ZIP_READ_WINDOW,
            40_000,
        ];
        // Fixed pseudo-random steps: seeks of every kind, near the window and
        // far from it, before the start of the data and past its end.
        let mut state: u64 = 0x9e37_79b9_7f4a_7c15;
        let mut next = |bound: u64| {
            state = state
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            (state >> 33) % bound.max(1)
        };
        for step in 0..3_000 {
            let here = plain.position();
            let to = match next(7) {
                0 => SeekFrom::Start(next(len + window)),
                1 => SeekFrom::Current(-(next(window + 2) as i64)),
                2 => SeekFrom::Current(next(window * 3) as i64),
                3 => SeekFrom::Current(-(next(here.min(len) + 1) as i64)),
                4 => SeekFrom::End(-(next(len + 1) as i64)),
                5 => SeekFrom::Start(here.saturating_sub(next(4))),
                _ => SeekFrom::Current(0),
            };
            match (buffered.seek(to), plain.seek(to)) {
                (Ok(got), Ok(want)) => assert_eq!(got, want, "step {step}: {to:?}"),
                // Before the start of the data: both refuse and stay put.
                (Err(_), Err(_)) => {}
                (got, want) => panic!("step {step}: {to:?} gave {got:?}, want {want:?}"),
            }
            read_both(
                &mut plain,
                &mut buffered,
                sizes[next(sizes.len() as u64) as usize],
                step,
            );
            assert_eq!(buffered.stream_position().unwrap(), plain.position());
        }
        let before_start = -(plain.position() as i64) - 1;
        assert!(buffered.seek(SeekFrom::Current(before_start)).is_err());
    }

    #[test]
    fn a_backward_byte_by_byte_scan_reads_what_the_file_holds() {
        let data: Vec<u8> = (0..30_000u32).map(|i| (i * 13 % 241) as u8).collect();
        let mut plain = Cursor::new(data.clone());
        let mut buffered = buffered_zip_reader(Cursor::new(data.clone())).unwrap();
        let end = buffered.seek(SeekFrom::End(0)).unwrap();
        plain.seek(SeekFrom::End(0)).unwrap();
        // The zip reader's search for the end of the archive.
        for (step, at) in (0..end - 22).rev().enumerate() {
            assert_eq!(buffered.seek(SeekFrom::Start(at)).unwrap(), at);
            plain.seek(SeekFrom::Start(at)).unwrap();
            read_both(&mut plain, &mut buffered, 4, step);
        }
    }

    #[test]
    fn the_end_of_a_file_that_is_not_a_zip_is_read_about_once() {
        let mut counted = CountedReads::new(Cursor::new(vec![0xaa; 200_000]));
        assert!(ZipArchive::new(buffered_zip_reader(&mut counted).unwrap()).is_err());
        // The search covers the last 64 KiB + 22 bytes, one byte at a time.
        // Unbuffered that is 65,536 reads; refilling forward, 500 MB.
        assert!(counted.reads <= 16, "{} reads", counted.reads);
        assert!(
            counted.bytes <= 65_557 + 2 * ZIP_READ_WINDOW,
            "{} bytes",
            counted.bytes
        );
    }

    #[test]
    fn a_zip_with_the_longest_comment_opens_in_few_reads() {
        let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
        let options = FileOptions::default().compression_method(CompressionMethod::Stored);
        zip.start_file("store/header/vault.header", options)
            .unwrap();
        zip.write_all(b"header-bytes").unwrap();
        zip.set_comment("c".repeat(u16::MAX as usize));
        let zipped = zip.finish().unwrap().into_inner();
        let mut counted = CountedReads::new(Cursor::new(zipped.clone()));
        let mut archive = ZipArchive::new(buffered_zip_reader(&mut counted).unwrap()).unwrap();
        assert_eq!(archive.comment().len(), u16::MAX as usize);
        let mut body = Vec::new();
        archive.by_index(0).unwrap().read_to_end(&mut body).unwrap();
        assert_eq!(body, b"header-bytes");
        drop(archive);
        // The search reads the comment once and the parser once more.
        assert!(counted.reads <= 24, "{} reads", counted.reads);
        assert!(
            counted.bytes <= 2 * zipped.len() + 4 * ZIP_READ_WINDOW,
            "{} bytes of {}",
            counted.bytes,
            zipped.len()
        );
    }

    #[test]
    fn a_zip_of_small_files_is_read_in_few_calls() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join(crate::paths::STORE_DIR_NAME);
        for dir in 0..20 {
            let data = src.join("data").join(format!("{dir:02x}"));
            crate::host_fs::create_dir_all(&data).unwrap();
            for file in 0..10 {
                crate::host_fs::write(data.join(format!("{file}.blob")), vec![dir; 1_000]).unwrap();
            }
        }
        let zipped = zip_dir(&src);
        let mut counted = CountedReads::new(Cursor::new(zipped));
        let mut archive = ZipArchive::new(buffered_zip_reader(&mut counted).unwrap()).unwrap();
        let entries = archive.len();
        // `data/`, 20 folders, 200 files.
        assert_eq!(entries, 221);
        for index in 0..entries {
            let mut entry = archive.by_index(index).unwrap();
            std::io::copy(&mut entry, &mut std::io::sink()).unwrap();
        }
        drop(archive);
        // Unbuffered, each entry is a dozen reads of a few bytes.
        assert!(counted.reads < entries / 2, "{} reads", counted.reads);
    }

    #[test]
    fn a_store_zip_lists_each_folder_before_its_files_in_name_order() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join(crate::paths::STORE_DIR_NAME);
        crate::host_fs::create_dir_all(src.join("header")).unwrap();
        crate::host_fs::create_dir_all(src.join("data").join("b1")).unwrap();
        crate::host_fs::create_dir_all(src.join("data").join("0c")).unwrap();
        crate::host_fs::write(src.join("header").join("vault.header"), b"h").unwrap();
        crate::host_fs::write(src.join("data").join("b1").join("z.blob"), b"zz").unwrap();
        crate::host_fs::write(src.join("data").join("b1").join("a.blob"), b"aaa").unwrap();
        crate::host_fs::write(src.join("data").join("0c").join("c.blob"), b"c").unwrap();
        crate::host_fs::write(src.join(STORE_DANGER_FILE_NAME), b"notice").unwrap();
        let out = tmp.path().join("store.zip");
        let id = crate::test_support::test_job_id();
        let job = Job::start(&id).unwrap();
        zip_store_with_config_to_path(
            &src,
            &StoreEnvelope::BACKUP,
            b"[vault]\n",
            "20260529120000",
            &out,
            &job,
        )
        .unwrap();
        let status = crate::session::job_status(&id).unwrap();
        assert_eq!(status.bytes_total, 13);
        assert_eq!(status.bytes_done, 13);
        let envelope = [
            "README.md",
            "config.toml",
            "store/",
            &format!("store/{STORE_DANGER_FILE_NAME}"),
            "store/data/",
            "store/data/0c/",
            "store/data/0c/c.blob",
            "store/data/b1/",
            "store/data/b1/a.blob",
            "store/data/b1/z.blob",
            "store/header/",
            "store/header/vault.header",
        ];
        assert_eq!(zip_names(&out), envelope);

        // An export holds the same envelope in its package.
        let package = Package::new("Notes-upriv-2", "Notes");
        zip_store_with_config_to_path(
            &src,
            &StoreEnvelope::export(package),
            b"[vault]\n",
            "20260529120000",
            &out,
            &Job::untracked(),
        )
        .unwrap();
        let mut packaged = vec![
            "Notes-upriv-2/".to_string(),
            "Notes-upriv-2/Notes/".to_string(),
        ];
        packaged.extend(
            envelope
                .iter()
                .map(|name| format!("Notes-upriv-2/Notes/{name}")),
        );
        assert_eq!(zip_names(&out), packaged);
    }

    fn zip_names(path: &Path) -> Vec<String> {
        let mut archive = ZipArchive::new(File::open(path).unwrap()).unwrap();
        (0..archive.len())
            .map(|index| archive.by_index(index).unwrap().name().to_string())
            .collect()
    }

    #[test]
    fn store_zip_progress_counts_the_store_bytes() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join(crate::paths::STORE_DIR_NAME);
        crate::host_fs::create_dir_all(src.join("header")).unwrap();
        crate::host_fs::create_dir_all(src.join("data")).unwrap();
        crate::host_fs::write(src.join("header").join("vault.header"), b"header-bytes").unwrap();
        crate::host_fs::write(src.join("data").join("a.blob"), vec![1u8; 300_000]).unwrap();
        let id = crate::test_support::test_job_id();
        let job = Job::start(&id).unwrap();
        let out = tmp.path().join("store.zip");
        zip_store_with_config_to_path(
            &src,
            &StoreEnvelope::BACKUP,
            b"[vault]\n",
            "20260529120000",
            &out,
            &job,
        )
        .unwrap();
        let status = crate::session::job_status(&id).unwrap();
        assert_eq!(status.bytes_total, 300_012);
        assert_eq!(status.bytes_done, 300_012);
    }

    #[test]
    fn a_backup_and_an_export_both_unzip_to_their_store() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join(crate::paths::STORE_DIR_NAME);
        crate::host_fs::create_dir_all(src.join("header")).unwrap();
        crate::host_fs::create_dir_all(src.join("data")).unwrap();
        crate::host_fs::write(src.join("header").join("vault.header"), b"header-bytes").unwrap();
        crate::host_fs::write(src.join("data").join("a.blob"), b"cipher").unwrap();
        let config = b"[vault]\ndisplay_name = \"Notes\"\n";
        for (envelope, name) in [
            (StoreEnvelope::BACKUP, None),
            (
                StoreEnvelope::export(Package::new("Notes-upriv", "notes")),
                Some("notes"),
            ),
        ] {
            let out = tmp.path().join("store.zip");
            let job = Job::untracked();
            zip_store_with_config_to_path(&src, &envelope, config, "20260529120000", &out, &job)
                .unwrap();
            let zipped = crate::host_fs::read(&out).unwrap();
            let archive = ZipArchive::new(Cursor::new(zipped.as_slice())).unwrap();
            let found = StoreEnvelope::find(&archive).unwrap();
            assert_eq!(found, envelope);
            assert_eq!(found.package().map(|package| package.vault.as_str()), name);
            assert_eq!(
                read_zip_root_entry(Cursor::new(zipped.as_slice()), ZIP_CONFIG_ENTRY)
                    .unwrap()
                    .unwrap(),
                config
            );
            let dest = tmp.path().join(format!("out-{}", name.unwrap_or("backup")));
            unzip_store_bytes(&zipped, &dest, &Job::untracked()).unwrap();
            assert_eq!(
                crate::host_fs::read(dest.join("header").join("vault.header")).unwrap(),
                b"header-bytes"
            );
            assert_eq!(
                crate::host_fs::read(dest.join("data").join("a.blob")).unwrap(),
                b"cipher"
            );
        }
    }

    #[test]
    fn a_store_in_one_folder_is_no_store_zip() {
        let mut cursor = Cursor::new(Vec::new());
        let mut zip = ZipWriter::new(&mut cursor);
        let options = FileOptions::default().compression_method(CompressionMethod::Stored);
        zip.start_file("Notes/store/header/vault.header", options)
            .unwrap();
        zip.write_all(b"header-bytes").unwrap();
        zip.finish().unwrap();
        drop(zip);
        let archive = ZipArchive::new(Cursor::new(cursor.into_inner())).unwrap();
        assert_eq!(StoreEnvelope::find(&archive), None);
    }

    #[test]
    fn store_zip_keeps_config_out_of_the_store_tree() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join(crate::paths::STORE_DIR_NAME);
        crate::host_fs::create_dir_all(src.join("header")).unwrap();
        crate::host_fs::write(src.join("header").join("vault.header"), b"header-bytes").unwrap();
        crate::host_fs::write(src.join(STORE_DANGER_FILE_NAME), b"notice").unwrap();
        let config = b"[vault]\nid = \"notes\"\ndisplay_name = \"Notes\"\nnote = \"kept\"\n";
        let out = tmp.path().join("store.zip");
        zip_store_with_config_to_path(
            &src,
            &StoreEnvelope::BACKUP,
            config,
            "20260529120000",
            &out,
            &Job::untracked(),
        )
        .unwrap();
        let zipped = crate::host_fs::read(&out).unwrap();
        let read = read_zip_root_entry(Cursor::new(zipped.clone()), ZIP_CONFIG_ENTRY)
            .unwrap()
            .unwrap();
        assert_eq!(read, config);
        let mut archive = ZipArchive::new(Cursor::new(zipped.clone())).unwrap();
        let names: Vec<String> = (0..archive.len())
            .map(|index| archive.by_index(index).unwrap().name().to_string())
            .collect();
        let danger = format!("{}/{STORE_DANGER_FILE_NAME}", crate::paths::STORE_DIR_NAME);
        assert_eq!(
            names.iter().filter(|name| name.as_str() == danger).count(),
            1
        );
        assert_eq!(
            names
                .iter()
                .filter(|name| name.as_str() == "config.toml")
                .count(),
            1
        );
        assert_eq!(
            names
                .iter()
                .filter(|name| name.as_str() == "README.md")
                .count(),
            1
        );
        let readme = read_zip_root_entry(Cursor::new(zipped.clone()), "README.md")
            .unwrap()
            .unwrap();
        let readme = String::from_utf8(readme).unwrap();
        assert!(readme.contains("Created: 2026-05-29T12:00:00Z"));
        assert!(readme.contains("Size: 18 B"));
        assert!(readme.contains("The zip file is a little larger."));
        let dest = tmp.path().join("out");
        unzip_store_bytes(&zipped, &dest, &Job::untracked()).unwrap();
        assert!(!dest.join("config.toml").host_exists());
        assert!(!dest.join("README.md").host_exists());
        assert!(!dest.join(STORE_DANGER_FILE_NAME).host_exists());
        assert_eq!(
            crate::host_fs::read(dest.join("header").join("vault.header")).unwrap(),
            b"header-bytes"
        );
    }

    #[test]
    fn unzip_rejects_a_file_outside_the_store_tree() {
        let mut cursor = Cursor::new(Vec::new());
        let mut zip = ZipWriter::new(&mut cursor);
        let options = FileOptions::default().compression_method(CompressionMethod::Stored);
        zip.start_file("store/header/vault.header", options)
            .unwrap();
        zip.write_all(b"header-bytes").unwrap();
        zip.start_file("vault.header", options).unwrap();
        zip.write_all(b"not-under-header").unwrap();
        zip.start_file("notes.txt", options).unwrap();
        zip.write_all(b"nope").unwrap();
        zip.finish().unwrap();
        drop(zip);
        let tmp = tempfile::tempdir().unwrap();
        let err = unzip_store_bytes(
            &cursor.into_inner(),
            &tmp.path().join("out"),
            &Job::untracked(),
        )
        .unwrap_err();
        assert!(matches!(err, UprivError::VaultStoreInvalid { .. }));
    }

    #[test]
    fn unzip_rejects_a_header_at_the_zip_root() {
        for name in ["vault.header", "vault.header.copy"] {
            let mut cursor = Cursor::new(Vec::new());
            let mut zip = ZipWriter::new(&mut cursor);
            let options = FileOptions::default().compression_method(CompressionMethod::Stored);
            zip.start_file(name, options).unwrap();
            zip.write_all(b"not-under-header").unwrap();
            zip.finish().unwrap();
            drop(zip);
            let tmp = tempfile::tempdir().unwrap();
            let err = unzip_store_bytes(
                &cursor.into_inner(),
                &tmp.path().join("out"),
                &Job::untracked(),
            )
            .unwrap_err();
            assert!(
                matches!(err, UprivError::VaultStoreInvalid { .. }),
                "{name}"
            );
        }
    }

    #[test]
    fn unzip_rejects_a_path_that_leaves_the_archive() {
        let mut cursor = Cursor::new(Vec::new());
        let mut zip = ZipWriter::new(&mut cursor);
        let options = FileOptions::default().compression_method(CompressionMethod::Stored);
        zip.start_file("../header/vault.header", options).unwrap();
        zip.write_all(b"outside").unwrap();
        zip.finish().unwrap();
        drop(zip);
        let tmp = tempfile::tempdir().unwrap();
        let dest = tmp.path().join("out");
        let err = unzip_store_bytes(&cursor.into_inner(), &dest, &Job::untracked()).unwrap_err();
        assert!(matches!(err, UprivError::VaultStoreInvalid { .. }));
        assert!(!dest.join("header").join("vault.header").host_exists());
    }

    #[test]
    fn unzip_rejects_an_archive_that_expands_far_past_its_size() {
        let mut cursor = Cursor::new(Vec::new());
        let mut zip = ZipWriter::new(&mut cursor);
        let options = FileOptions::default().compression_method(CompressionMethod::Deflated);
        zip.start_file("data/zeros", options).unwrap();
        zip.write_all(&vec![0u8; 64 * 1024]).unwrap();
        zip.finish().unwrap();
        drop(zip);
        let bytes = cursor.into_inner();
        assert!(bytes.len() < 8 * 1024);
        let tmp = tempfile::tempdir().unwrap();
        let err =
            unzip_store_bytes(&bytes, &tmp.path().join("out"), &Job::untracked()).unwrap_err();
        assert!(matches!(err, UprivError::VaultStoreInvalid { .. }));
    }

    #[test]
    fn verify_requires_identical_index_copies() {
        let tmp = tempfile::tempdir().unwrap();
        let good = tmp.path().join("good.zip");
        write_index_pair(&good, b"sealed", b"sealed");
        let job = Job::untracked();
        verify_store_zip_copies(&good, &job).unwrap();

        let drifted = tmp.path().join("drifted.zip");
        write_index_pair(&drifted, b"sealed", b"other");
        assert!(verify_store_zip_copies(&drifted, &job).is_err());

        let missing = tmp.path().join("missing.zip");
        write_index_pair(&missing, b"sealed", b"");
        assert!(verify_store_zip_copies(&missing, &job).is_err());
    }

    #[test]
    fn verify_ends_at_a_stop() {
        let tmp = tempfile::tempdir().unwrap();
        let good = tmp.path().join("good.zip");
        write_index_pair(&good, b"sealed", b"sealed");
        let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true));
        let stopped = verify_store_zip_copies(&good, &Job::stopped_by(stop));
        assert!(matches!(stopped, Err(UprivError::JobCancelled)));
    }

    fn write_index_pair(path: &Path, primary: &[u8], copy: &[u8]) {
        let file = File::create(path).unwrap();
        let mut zip = ZipWriter::new(file);
        let options = FileOptions::default().compression_method(CompressionMethod::Stored);
        let primary_name = format!(
            "{}/{}/{}",
            crate::paths::STORE_DIR_NAME,
            crate::store::INDEX_DIR_NAME,
            crate::store::INDEX_FILE_NAME
        );
        let copy_name = format!(
            "{}/{}/{}",
            crate::paths::STORE_DIR_NAME,
            crate::store::INDEX_DIR_NAME,
            crate::store::INDEX_COPY_FILE_NAME
        );
        zip.start_file("store/header/vault.header", options)
            .unwrap();
        zip.write_all(b"header").unwrap();
        zip.start_file(&primary_name, options).unwrap();
        zip.write_all(primary).unwrap();
        if !copy.is_empty() {
            zip.start_file(&copy_name, options).unwrap();
            zip.write_all(copy).unwrap();
        }
        zip.start_file("store/data/note.blob", options).unwrap();
        zip.write_all(b"cipher").unwrap();
        zip.finish().unwrap();
    }

    #[test]
    fn a_stop_between_two_entries_ends_the_zip_without_a_panic() {
        let id = crate::test_support::test_job_id();
        let job = Job::start(&id).unwrap();
        let mut zip = ZipWriter::new(job_zip_file(&job, Cursor::new(Vec::new())));
        let options = FileOptions::default().compression_method(CompressionMethod::Stored);
        zip.start_file("a.txt", options).unwrap();
        zip.write_all(b"first entry").unwrap();
        crate::session::cancel_job(&id).unwrap();
        // The next entry first finishes this one, and the stop refuses that.
        assert!(zip.start_file("b.txt", options).is_err());
        // The drop finishes the zip once more: that fails too.
        drop(zip);
    }

    /// A file that fails its `fail_at`-th write, then answers again, as a
    /// drive that drops one write.
    struct DropsOneWrite {
        inner: Cursor<Vec<u8>>,
        writes: usize,
        fail_at: usize,
    }

    impl Write for DropsOneWrite {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.writes += 1;
            if self.writes == self.fail_at {
                return Err(std::io::Error::other("the drive dropped a write"));
            }
            self.inner.write(buf)
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    impl Seek for DropsOneWrite {
        fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
            self.inner.seek(pos)
        }
    }

    #[test]
    fn a_failed_header_rewrite_ends_the_zip_without_a_panic() {
        // The first two writes carry the entry's header and its bytes; the
        // third, that header rewritten in place once the entry's size is known.
        let file = DropsOneWrite {
            inner: Cursor::new(Vec::new()),
            writes: 0,
            fail_at: 3,
        };
        let mut zip = ZipWriter::new(buffered_zip_file(file));
        let options = FileOptions::default().compression_method(CompressionMethod::Stored);
        zip.start_file("a.txt", options).unwrap();
        zip.write_all(b"first entry").unwrap();
        assert!(zip.finish().is_err());
        drop(zip);
    }

    #[test]
    fn a_paced_file_sends_each_window_and_keeps_every_byte() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Notes-upriv.zip.upriv-part");
        let mut file = PacedFile {
            window: 4096,
            ..PacedFile::new(File::create(&path).unwrap())
        };
        let body: Vec<u8> = (0..64 * 1024u32).map(|n| (n % 251) as u8).collect();
        for part in body.chunks(1000) {
            file.write_all(part).unwrap();
        }
        // A header rewritten in place, as the zip writer does, then more bytes.
        file.seek(SeekFrom::Start(10)).unwrap();
        file.write_all(b"header").unwrap();
        file.seek(SeekFrom::End(0)).unwrap();
        file.write_all(&body[..5000]).unwrap();
        #[cfg(target_os = "linux")]
        {
            assert!(file.ranges, "a local file takes ranges");
            assert!(file.sent_to >= 64 * 1024);
        }
        drop(file.into_file());
        crate::paths::sync_file_durable(&path).unwrap();
        let mut want = body.clone();
        want[10..16].copy_from_slice(b"header");
        want.extend_from_slice(&body[..5000]);
        assert_eq!(crate::host_fs::read(&path).unwrap(), want);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn only_a_file_that_cannot_send_a_range_is_flushed_instead() {
        let os = std::io::Error::from_raw_os_error;
        for code in [libc::ENOSYS, libc::EINVAL, libc::ESPIPE, libc::EOPNOTSUPP] {
            assert!(range_unsupported(&os(code)), "{code}");
        }
        // A write error fails the file.
        for code in [libc::EIO, libc::ENOSPC] {
            assert!(!range_unsupported(&os(code)), "{code}");
        }
    }

    #[test]
    fn the_zip_buffer_keeps_every_byte_in_order() {
        let mut out = buffered_zip_file(Cursor::new(Vec::new()));
        let big = vec![7u8; ZIP_WRITE_BUFFER + 1];
        out.write_all(b"small").unwrap();
        out.write_all(&big).unwrap();
        out.seek(SeekFrom::Start(1)).unwrap();
        out.write_all(b"M").unwrap();
        out.seek(SeekFrom::End(0)).unwrap();
        out.write_all(b"tail").unwrap();
        out.flush().unwrap();
        assert!(out.buf.is_empty());
        let mut want = b"sMall".to_vec();
        want.extend_from_slice(&big);
        want.extend_from_slice(b"tail");
        assert_eq!(out.inner.into_inner(), want);
    }
}
