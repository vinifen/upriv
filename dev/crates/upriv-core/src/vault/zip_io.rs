//! Zip envelope of a ciphertext `store/` tree (no zip password).

use crate::host_fs::File;
#[allow(unused_imports)]
use crate::host_fs::HostFsQuery;
use std::io::{BufWriter, Cursor, ErrorKind, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use zip::write::FileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::error::{Result, UprivError};
use crate::session::Job;

use super::embedded_settings::{store_zip_readme, ZIP_CONFIG_ENTRY, ZIP_README_ENTRY};
use crate::paths::STORE_DIR_NAME;
use crate::store::{
    HEADER_DIR_NAME, HEADER_FILE_NAME, INDEX_COPY_FILE_NAME, INDEX_DIR_NAME, INDEX_FILE_NAME,
    STORE_DANGER_FILE_NAME,
};

const ZIP_WRITE_BUFFER: usize = 256 * 1024;
/// Bytes a store zip writes between flushes to disk. One flush at the end of a
/// large zip would hold a stop for minutes.
const ZIP_SYNC_BYTES: u64 = 64 * 1024 * 1024;
/// Bytes moved per read when a file goes into or out of a zip.
const ZIP_COPY_BUFFER: usize = 256 * 1024;
/// What [`SeekBufReader`] reads at a time. A scan of local headers reads at
/// most this much per entry, so a zip of large files is not read through.
const ZIP_READ_WINDOW: usize = 8 * 1024;
/// Bytes a backward seek keeps after its target, so the record read there
/// (an end-of-archive record is 22 bytes) does not run off the window.
const ZIP_READ_BACK_TAIL: usize = 64;

/// Batches small zip headers and stored bytes. A storage-access file pays for
/// each write; seeking flushes first so the zip offsets stay correct.
pub(super) struct SeekBufWriter<W: Write + Seek> {
    inner: BufWriter<W>,
}

pub(super) fn buffered_zip_file<W: Write + Seek>(file: W) -> SeekBufWriter<W> {
    SeekBufWriter {
        inner: BufWriter::with_capacity(ZIP_WRITE_BUFFER, file),
    }
}

/// A file flushed to disk every [`ZIP_SYNC_BYTES`], so a job's stop is never
/// further than one such flush away.
struct PacedFile {
    file: File,
    unsynced: u64,
}

impl Write for PacedFile {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let written = self.file.write(buf)?;
        self.unsynced += written as u64;
        if self.unsynced >= ZIP_SYNC_BYTES {
            self.file.sync_data()?;
            self.unsynced = 0;
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

impl<W: Write + Seek> Write for SeekBufWriter<W> {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.inner.write(buf)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.inner.flush()
    }
}

impl<W: Write + Seek> Seek for SeekBufWriter<W> {
    fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
        self.inner.flush()?;
        self.inner.get_mut().seek(pos)
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

/// True when `bytes` is a readable zip (store envelope probe).
pub fn probe_store_zip(bytes: &[u8]) -> Result<()> {
    probe_store_zip_reader(Cursor::new(bytes))
}

fn probe_store_zip_reader<R: Read + Seek>(reader: R) -> Result<()> {
    ZipArchive::new(reader).map_err(|e| zip_err(Path::new("zip"), e))?;
    Ok(())
}

/// A vault zip is recognized by `store/header/vault.header`, including one outer folder.
/// A symlink at the final component is not a vault zip.
/// Reads only the central directory, buffered: one zip of a large vault is a
/// few reads, not a seek per entry.
pub(crate) fn zip_contains_store_header(path: &Path) -> bool {
    let Ok(file) = crate::paths::open_nofollow(path, crate::paths::NofollowMode::Read) else {
        return false;
    };
    let Ok(archive) = ZipArchive::new(std::io::BufReader::new(file)) else {
        return false;
    };
    let found = archive.file_names().any(zip_entry_is_store_header);
    found
}

fn zip_entry_is_store_header(name: &str) -> bool {
    let normalized = name.replace('\\', "/");
    let parts: Vec<&str> = normalized
        .split('/')
        .filter(|part| !part.is_empty())
        .collect();
    let n = parts.len();
    n >= 3
        && parts[n - 3] == STORE_DIR_NAME
        && parts[n - 2] == HEADER_DIR_NAME
        && parts[n - 1] == HEADER_FILE_NAME
}

/// Require the two sealed index files to be present and byte-identical.
///
/// Every entry is read through to the end so its checksum is checked before
/// an older backup can be deleted. Skipping bodies on a storage-access folder
/// let a bad persist replace the previous zip.
pub(crate) fn verify_store_zip_copies(path: &Path, job: &Job) -> Result<()> {
    let file = buffered_zip_reader(File::open(path)?)?;
    let mut archive = ZipArchive::new(file).map_err(|e| zip_err(path, e))?;
    let mut primary = None;
    let mut copy = None;
    for i in 0..archive.len() {
        job.ensure_running()?;
        let mut entry = archive.by_index(i).map_err(|e| zip_err(path, e))?;
        let name = entry.name().replace('\\', "/");
        let keep = index_zip_role(&name);
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
    match (primary, copy) {
        (Some(primary), Some(copy)) if primary == copy && !primary.is_empty() => Ok(()),
        (Some(_), Some(_)) => Err(zip_err(path, "index copies in the backup zip differ")),
        _ => Err(zip_err(path, "backup zip is missing an index copy")),
    }
}

enum IndexZipRole {
    Primary,
    Copy,
}

fn index_zip_role(name: &str) -> Option<IndexZipRole> {
    let name = name.trim_matches('/');
    let name = name
        .strip_prefix(&format!("{STORE_DIR_NAME}/"))
        .unwrap_or(name);
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

/// `README.md` and `config.toml` beside `store/`.
///
/// The warning file already in `store/` is copied with the tree, and each
/// byte copied from `store/` counts toward `job`.
fn write_zip_with_config<W: Write + std::io::Seek>(
    tree: &ZipTree<'_>,
    config_toml: &[u8],
    readme: &str,
    writer: W,
    job: &Job,
) -> Result<W> {
    let src = tree.root;
    let mut zip = ZipWriter::new(writer);
    let options = FileOptions::default().compression_method(CompressionMethod::Stored);
    zip.start_file(ZIP_README_ENTRY, options)
        .map_err(|e| zip_err(src, e))?;
    zip.write_all(readme.as_bytes())
        .map_err(|e| zip_err(src, e))?;
    zip.start_file(ZIP_CONFIG_ENTRY, options)
        .map_err(|e| zip_err(src, e))?;
    zip.write_all(config_toml).map_err(|e| zip_err(src, e))?;
    zip.add_directory(format!("{STORE_DIR_NAME}/"), options)
        .map_err(|e| zip_err(src, e))?;
    tree.write(&mut zip, options, job)?;
    zip.finish().map_err(|e| zip_err(src, e))
}

/// Zip of `store/` plus `README.md` and `config.toml`, written to `dest`.
/// Each write fails once `job` is asked to stop. Its progress counts the
/// bytes of `store/` copied.
///
/// `created_stamp` is UTC `YYYYMMDDHHmmss` and is written into `README.md`.
pub(super) fn zip_store_with_config_to_path(
    store: &Path,
    config_toml: &[u8],
    created_stamp: &str,
    dest: &Path,
    job: &Job,
) -> Result<u64> {
    // One listing gives both the size `README.md` records and what to copy.
    let tree = ZipTree::list(store, Path::new(STORE_DIR_NAME))?;
    job.set_total(tree.bytes);
    let readme = store_zip_readme(created_stamp, tree.bytes)?;
    let file = job.writer(buffered_zip_file(PacedFile {
        file: File::create(dest)?,
        unsynced: 0,
    }));
    let file = write_zip_with_config(&tree, config_toml, &readme, file, job)?;
    written_len(file, dest)
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

/// The root `config.toml`, if this zip carries vault settings.
pub fn read_zip_config_toml<R: Read + Seek>(reader: R) -> Result<Option<Vec<u8>>> {
    read_zip_root_entry(reader, ZIP_CONFIG_ENTRY)
}

/// One file at the zip root (`config.toml` or `README.md`), not a file inside `store/`.
pub(crate) fn read_zip_root_entry<R: Read + Seek>(
    reader: R,
    entry: &str,
) -> Result<Option<Vec<u8>>> {
    let mut archive = ZipArchive::new(reader).map_err(|e| zip_err(Path::new("zip"), e))?;
    let strip = detect_single_root_prefix(&mut archive)?;
    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| zip_err(Path::new("zip"), e))?;
        let Some(enclosed) = enclosed_path(file.name(), strip.as_deref()) else {
            continue;
        };
        if enclosed != Path::new(entry) {
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
                    let path = self.root.join(rel);
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
    let mut output = job.writer(File::create(dest)?);
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
    let mut zip = ZipWriter::new(job.writer(buffered_zip_file(File::create(dest)?)));
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

/// Extract a `.zip` of `store/` into `dest`. Rejects path escape.
pub fn unzip_store_bytes(bytes: &[u8], dest: &Path) -> Result<()> {
    unzip_store_reader(Cursor::new(bytes), dest, bytes.len() as u64)
}

/// Extract a zip file into `dest`, copying each entry without a second full buffer.
pub fn unzip_store_path(path: &Path, dest: &Path) -> Result<()> {
    let file =
        File::open(path).map_err(|error| super::import::map_archive_open_error(path, error))?;
    let len = file.metadata()?.len();
    unzip_store_reader(buffered_zip_reader(file)?, dest, len)
}

/// Ciphertext barely compresses. A much larger unpack is a zip bomb, not a store export.
const ZIP_EXPAND_FACTOR: u64 = 8;

fn unzip_store_reader<R: Read + Seek>(reader: R, dest: &Path, source_len: u64) -> Result<()> {
    let expand_limit = source_len.saturating_mul(ZIP_EXPAND_FACTOR);
    crate::host_fs::create_dir_all(dest)?;
    let mut archive = ZipArchive::new(reader).map_err(|e| zip_err(dest, e))?;
    let strip = detect_single_root_prefix(&mut archive)?;
    let mut unpacked: u64 = 0;
    let mut buf = vec![0u8; ZIP_COPY_BUFFER];
    for i in 0..archive.len() {
        let file = archive.by_index(i).map_err(|e| zip_err(dest, e))?;
        let Some(enclosed) = enclosed_path(file.name(), strip.as_deref()) else {
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

fn detect_single_root_prefix<R: Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
) -> Result<Option<String>> {
    let mut tops = std::collections::BTreeSet::new();
    for i in 0..archive.len() {
        let file = archive
            .by_index(i)
            .map_err(|e| zip_err(Path::new("zip"), e))?;
        let name = file.name().replace('\\', "/");
        if name.is_empty() {
            continue;
        }
        let top = name.split('/').next().unwrap_or("");
        if !top.is_empty() {
            tops.insert(top.to_string());
        }
    }
    if tops.len() == 1 {
        let only = tops.into_iter().next().unwrap();
        if only == "." || only == ".." {
            return Err(UprivError::VaultStoreInvalid {
                path: PathBuf::from(only),
                detail: "zip entry escapes destination".into(),
            });
        }
        // A header file at the zip root is not a directory. Keep the name so
        // the allowlist rejects it.
        if !matches!(
            only.as_str(),
            "header" | "index" | "data" | "vault.header" | "vault.header.copy"
        ) {
            return Ok(Some(only));
        }
    }
    Ok(None)
}

fn enclosed_path(name: &str, strip: Option<&str>) -> Option<PathBuf> {
    let normalized = name.replace('\\', "/");
    let mut trimmed = normalized.as_str();
    if let Some(prefix) = strip {
        let with_slash = format!("{prefix}/");
        if let Some(rest) = trimmed.strip_prefix(&with_slash) {
            trimmed = rest;
        } else if trimmed == prefix || trimmed == format!("{prefix}/") {
            return Some(PathBuf::new());
        }
    }
    if trimmed.is_empty() {
        return Some(PathBuf::new());
    }
    let mut out = PathBuf::new();
    for part in trimmed.split('/') {
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
        zip_store_with_config_to_path(&src, b"[vault]\n", "20260529120000", &out, &job).unwrap();
        let status = crate::session::job_status(&id).unwrap();
        assert_eq!(status.bytes_total, 13);
        assert_eq!(status.bytes_done, 13);
        let mut archive = ZipArchive::new(File::open(&out).unwrap()).unwrap();
        let names: Vec<String> = (0..archive.len())
            .map(|index| archive.by_index(index).unwrap().name().to_string())
            .collect();
        assert_eq!(
            names,
            [
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
            ]
        );
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
        zip_store_with_config_to_path(&src, b"[vault]\n", "20260529120000", &out, &job).unwrap();
        let status = crate::session::job_status(&id).unwrap();
        assert_eq!(status.bytes_total, 300_012);
        assert_eq!(status.bytes_done, 300_012);
    }

    #[test]
    fn zip_round_trip_preserves_bytes() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join(crate::paths::STORE_DIR_NAME);
        crate::host_fs::create_dir_all(src.join("header")).unwrap();
        crate::host_fs::create_dir_all(src.join("data")).unwrap();
        crate::host_fs::write(src.join("header").join("vault.header"), b"header-bytes").unwrap();
        crate::host_fs::write(src.join("data").join("a.blob"), b"cipher").unwrap();
        let zipped = zip_dir(&src);
        let dest = tmp.path().join("out");
        unzip_store_bytes(&zipped, &dest).unwrap();
        assert_eq!(
            crate::host_fs::read(dest.join("header").join("vault.header")).unwrap(),
            b"header-bytes"
        );
        assert_eq!(
            crate::host_fs::read(dest.join("data").join("a.blob")).unwrap(),
            b"cipher"
        );
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
        zip_store_with_config_to_path(&src, config, "20260529120000", &out, &Job::untracked())
            .unwrap();
        let zipped = crate::host_fs::read(&out).unwrap();
        let read = read_zip_config_toml(Cursor::new(zipped.clone()))
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
        unzip_store_bytes(&zipped, &dest).unwrap();
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
        let err = unzip_store_bytes(&cursor.into_inner(), &tmp.path().join("out")).unwrap_err();
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
            let err = unzip_store_bytes(&cursor.into_inner(), &tmp.path().join("out")).unwrap_err();
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
        let err = unzip_store_bytes(&cursor.into_inner(), &dest).unwrap_err();
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
        let err = unzip_store_bytes(&bytes, &tmp.path().join("out")).unwrap_err();
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
}
