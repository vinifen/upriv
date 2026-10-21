//! In-RAM portable `.7z` encoder (Plan B export).
//!
//! Logical vault bytes stay in process memory. The destination `.7z` on disk is
//! ciphertext. If RAM cannot hold the working set, the op fails closed — never
//! a plaintext staging tree on ordinary disk or tmpfs.
//!
//! A worker thread decrypts the files from `store/` in archive order, one
//! chunk at a time, into a short queue that the encoder reads, so no file sits
//! whole in RAM. Files are grouped into 7z blocks that close at
//! [`SEVEN_ZIP_BLOCK_BYTES`] (one block with `solid`). Each block, and the
//! encrypted header, gets its own random AES salt and IV, so files that start
//! alike do not encrypt alike. The AES key is derived once per block, which is
//! why a block does not hold a single small file.

#[allow(unused_imports)]
use crate::host_fs::HostFsQuery;
use std::io::{BufWriter, ErrorKind, Read, Seek, Write};
use std::ops::Range;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{sync_channel, Receiver, SyncSender};

use sevenz_rust2::encoder_options::{AesEncoderOptions, Lzma2Options};
use sevenz_rust2::{ArchiveEntry, ArchiveWriter, EncoderMethod, Password, SourceReader};
use zeroize::Zeroizing;

use crate::config::vault_config::{VaultArchiveMode, VaultSevenZipSection};
use crate::error::{Result, UprivError};
use crate::session::Job;
use crate::store::{read_file_chunks, VaultHeader, VaultIndex, VaultNode, CHUNK_SIZE};

const ARCHIVE_HEADER_SLACK: u64 = 1024 * 1024;
/// Fixed fields of one member: the writer's entry and its rows in the header.
const ARCHIVE_ENTRY_BYTES: u64 = 256;
/// Bytes per byte of a member name while packing: our copy, the writer's
/// entry, and the UTF-16 raw header and its encoded copy.
const ARCHIVE_NAME_COPIES: u64 = 6;
/// Working room for the AES and copy coders, the CRCs, and the LZMA coder that
/// packs the archive header.
const ENCODER_SLACK: u64 = 32 * 1024 * 1024;
/// The AES coder hands the archive 16 bytes per write, and a storage-access
/// file pays for each write.
const ARCHIVE_WRITE_BUFFER: usize = 1024 * 1024;
/// Decrypted chunks the worker may hold ahead of the encoder.
const DECRYPT_QUEUE_CHUNKS: usize = 8;
/// A 7z block closes before the file that would take it past this much
/// plaintext. A larger file gets a block of its own.
pub(crate) const SEVEN_ZIP_BLOCK_BYTES: u64 = 64 * 1024 * 1024;
/// LZMA2 coder state beyond its window and match finder: price tables, the
/// optimum array, and the range coder buffer.
const LZMA_CODER_BYTES: u64 = 1024 * 1024;

pub fn seven_zip_export_available() -> bool {
    true
}

pub(crate) fn sevenz_password(password: &[u8]) -> Result<Password> {
    if password.is_empty() {
        return Err(UprivError::WrongPassword);
    }
    if password
        .iter()
        .any(|b| *b == 0 || *b == b'\n' || *b == b'\r')
    {
        return Err(UprivError::VaultStoreInvalid {
            path: PathBuf::from("7z"),
            detail: ".7z password cannot contain a newline or NUL".into(),
        });
    }
    let text = std::str::from_utf8(password).map_err(|_| UprivError::VaultStoreInvalid {
        path: PathBuf::from("7z"),
        detail: ".7z password must be UTF-8".into(),
    })?;
    Ok(Password::new(text))
}

pub(crate) fn sevenz_member_name_unsafe(name: &str) -> bool {
    if name.is_empty() || name.starts_with('/') || name.contains('\0') {
        return true;
    }
    name.split('/')
        .any(|part| part.is_empty() || part == "." || part == "..")
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) fn parse_mem_available_bytes(meminfo: &str) -> Option<u64> {
    for line in meminfo.lines() {
        let Some(rest) = line.strip_prefix("MemAvailable:") else {
            continue;
        };
        let kb: u64 = rest.split_whitespace().next()?.parse().ok()?;
        return Some(kb.saturating_mul(1024));
    }
    None
}

/// Working space for a `.7z` decoder beyond the compressed archive.
pub(crate) const SEVEN_ZIP_DECODE_SLACK: u64 = 64 * 1024 * 1024;

/// Cores LZMA2 may use. Extra threads each keep their own encoder or decoder,
/// so the count stays inside what the RAM check can still refuse.
pub(crate) fn seven_zip_cpu_threads() -> u32 {
    let cores = std::thread::available_parallelism()
        .map(|count| u32::try_from(count.get()).unwrap_or(1))
        .unwrap_or(1);
    cores.clamp(1, 8)
}

/// How many of `cores` fit in `available` when each one costs `per_thread`
/// on top of `fixed`. Unknown RAM stays on one thread. A budget that cannot
/// hold even one thread still returns 1 so the caller fails closed.
pub(crate) fn threads_that_fit(
    cores: u32,
    available: Option<u64>,
    per_thread: u64,
    fixed: u64,
) -> u32 {
    let cores = cores.clamp(1, 8);
    let Some(available) = available else {
        return 1;
    };
    let mut fit = 1u32;
    for threads in 1..=cores {
        let needed = fixed.saturating_add(per_thread.saturating_mul(u64::from(threads)));
        if available >= needed {
            fit = threads;
        } else {
            break;
        }
    }
    fit
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct SevenZipDecodeBudget {
    pub ram: u64,
    pub threads: u32,
}

/// Decoder threads that fit in currently free RAM, and the bytes those
/// threads need. The archive length is not part of this. A caller that loads
/// the archive into a `Vec` checks that length on its own.
pub(crate) fn seven_zip_decode_budget() -> SevenZipDecodeBudget {
    let threads = threads_that_fit(
        seven_zip_cpu_threads(),
        mem_available_bytes(),
        SEVEN_ZIP_DECODE_SLACK,
        0,
    );
    SevenZipDecodeBudget {
        ram: SEVEN_ZIP_DECODE_SLACK.saturating_mul(u64::from(threads)),
        threads,
    }
}

fn mem_available_bytes() -> Option<u64> {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        let text = crate::host_fs::read_to_string("/proc/meminfo").ok()?;
        parse_mem_available_bytes(&text)
    }
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        apple_mem_available_bytes()
    }
    #[cfg(windows)]
    {
        windows_mem_available_bytes()
    }
    #[cfg(not(any(
        target_os = "linux",
        target_os = "android",
        target_os = "macos",
        target_os = "ios",
        windows
    )))]
    {
        None
    }
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn apple_mem_available_bytes() -> Option<u64> {
    // libSystem. `libc` deprecates its own Mach port bindings.
    extern "C" {
        static mach_task_self_: libc::mach_port_t;
        fn mach_host_self() -> libc::host_t;
        fn mach_port_deallocate(
            task: libc::mach_port_t,
            name: libc::mach_port_t,
        ) -> libc::kern_return_t;
    }
    let mut stats: libc::vm_statistics64 = unsafe { std::mem::zeroed() };
    let mut count = libc::HOST_VM_INFO64_COUNT;
    let host = unsafe { mach_host_self() };
    let rc = unsafe {
        libc::host_statistics64(
            host,
            libc::HOST_VM_INFO64,
            &mut stats as *mut libc::vm_statistics64 as libc::host_info64_t,
            &mut count,
        )
    };
    // Each `mach_host_self` call adds a reference to the host port.
    unsafe { mach_port_deallocate(mach_task_self_, host) };
    if rc != libc::KERN_SUCCESS {
        return None;
    }
    let page = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
    if page <= 0 {
        return None;
    }
    let pages = u64::from(stats.free_count)
        .saturating_add(u64::from(stats.inactive_count))
        .saturating_add(u64::from(stats.speculative_count));
    Some(pages.saturating_mul(page as u64))
}

#[cfg(windows)]
fn windows_mem_available_bytes() -> Option<u64> {
    #[repr(C)]
    struct MemoryStatusEx {
        length: u32,
        memory_load: u32,
        total_phys: u64,
        avail_phys: u64,
        total_page_file: u64,
        avail_page_file: u64,
        total_virtual: u64,
        avail_virtual: u64,
        avail_extended_virtual: u64,
    }
    extern "system" {
        fn GlobalMemoryStatusEx(lpbuffer: *mut MemoryStatusEx) -> i32;
    }
    let mut status = MemoryStatusEx {
        length: std::mem::size_of::<MemoryStatusEx>() as u32,
        memory_load: 0,
        total_phys: 0,
        avail_phys: 0,
        total_page_file: 0,
        avail_page_file: 0,
        total_virtual: 0,
        avail_virtual: 0,
        avail_extended_virtual: 0,
    };
    if unsafe { GlobalMemoryStatusEx(&mut status) } == 0 {
        return None;
    }
    Some(status.avail_phys)
}

/// Window of an LZMA2 encoder at `level`, which is also the chunk each
/// worker compresses on its own.
fn lzma_dict_bytes(level: u8) -> u64 {
    // `lzma-rust2` 0.16 `LzmaOptions::PRESET_TO_DICT_SIZE`.
    const PRESETS: [u64; 10] = [
        1 << 18,
        1 << 20,
        1 << 21,
        1 << 22,
        1 << 22,
        1 << 23,
        1 << 23,
        1 << 24,
        1 << 25,
        1 << 26,
    ];
    PRESETS[usize::from(level.min(9))]
}

/// Entries in the encoder's 4-byte hash table for a `dict`-byte window
/// (`Hash234::get_hash4_size` in `lzma-rust2` 0.16).
fn lzma_hash4_entries(dict: u64) -> u64 {
    let mut h = u32::try_from(dict.saturating_sub(1)).unwrap_or(u32::MAX);
    h |= h >> 1;
    h |= h >> 2;
    h |= h >> 4;
    h |= h >> 8;
    h >>= 1;
    h |= 0xFFFF;
    if h > 1 << 24 {
        h >>= 1;
    }
    u64::from(h) + 1
}

/// Bytes one LZMA2 encoder allocates at `level` in `lzma-rust2` 0.16: its
/// window, the match finder (hash tables, plus a chain for presets 0–3 or a
/// binary tree for 4–9), and the coder state. The crate's own
/// `get_memory_usage` adds bytes to KiB, so it is not used.
fn lzma_encoder_bytes(level: u8) -> u64 {
    let dict = lzma_dict_bytes(level);
    // The dictionary, up to 4 KiB of lookahead on each side, the longest
    // match, and the reserve that lets the window move.
    let window = dict + 2 * 4096 + 273 + (dict / 2 + (256 << 10)).min(512 << 20);
    let hash = 4 * ((1 << 10) + (1 << 16) + lzma_hash4_entries(dict));
    let finder_entries = if level <= 3 { dict + 1 } else { 2 * (dict + 1) };
    window + hash + 4 * finder_entries + LZMA_CODER_BYTES
}

/// RAM of the content coder with `threads` LZMA2 workers. One worker streams.
/// Several share a queue that takes a whole block of plaintext ahead of them,
/// and finished chunks wait for the slowest one, so the largest block counts
/// twice.
fn coder_bytes(opts: &VaultSevenZipSection, threads: u32, largest_block: u64) -> u64 {
    if opts.archive_mode == VaultArchiveMode::EncryptOnly {
        return 0;
    }
    let encoder = lzma_encoder_bytes(opts.compression_level);
    if threads <= 1 {
        return encoder;
    }
    encoder
        .saturating_mul(u64::from(threads))
        .saturating_add(largest_block.saturating_mul(2))
}

/// Where a block closes. With several LZMA2 workers a block holds at least
/// one chunk per worker, so each has work.
fn block_limit(opts: &VaultSevenZipSection, threads: u32, block_bytes: u64) -> u64 {
    if opts.solid {
        return u64::MAX;
    }
    if opts.archive_mode == VaultArchiveMode::CompressEncrypt && threads > 1 {
        let chunks = lzma_dict_bytes(opts.compression_level).saturating_mul(u64::from(threads));
        return block_bytes.max(chunks);
    }
    block_bytes
}

/// Plaintext the decrypt stream holds at once: the queue, the chunk the
/// worker is decrypting and its ciphertext, and the chunk the encoder reads.
fn decrypt_stream_bytes() -> u64 {
    (DECRYPT_QUEUE_CHUNKS as u64 + 3) * u64::from(CHUNK_SIZE)
}

/// The archive's record of its members, from the length of each logical path.
fn archive_header_bytes(outer_folder: &str, paths: impl Iterator<Item = usize>) -> u64 {
    let member = |path: usize| {
        let name = (outer_folder.len() + 1 + path) as u64;
        ARCHIVE_ENTRY_BYTES.saturating_add(name.saturating_mul(ARCHIVE_NAME_COPIES))
    };
    paths
        .map(member)
        .fold(ARCHIVE_HEADER_SLACK, u64::saturating_add)
}

fn file_size(node: &VaultNode) -> u64 {
    node.as_file().map_or(0, |(_, size, _)| size)
}

/// Split `files` into 7z blocks. A block closes before the file that would
/// take it past `limit`, so only a file larger than `limit` goes beyond it.
fn plan_blocks(files: &[&VaultNode], limit: u64) -> Vec<Range<usize>> {
    let mut blocks = Vec::new();
    let mut start = 0;
    let mut bytes = 0u64;
    for (at, node) in files.iter().enumerate() {
        let size = file_size(node);
        if at > start && bytes.saturating_add(size) > limit {
            blocks.push(start..at);
            start = at;
            bytes = 0;
        }
        bytes = bytes.saturating_add(size);
    }
    if start < files.len() {
        blocks.push(start..files.len());
    }
    blocks
}

fn largest_block(files: &[&VaultNode], blocks: &[Range<usize>]) -> u64 {
    blocks
        .iter()
        .map(|block| {
            files[block.clone()]
                .iter()
                .map(|node| file_size(node))
                .fold(0, u64::saturating_add)
        })
        .max()
        .unwrap_or(0)
}

/// The device a pack is planned for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct PackLimits {
    /// Cores LZMA2 may use.
    pub(crate) cores: u32,
    /// Free RAM. `None` when the system does not report it.
    pub(crate) available: Option<u64>,
    /// Where a block closes: [`SEVEN_ZIP_BLOCK_BYTES`].
    pub(crate) block_bytes: u64,
}

impl PackLimits {
    /// This device, now.
    pub(crate) fn current() -> Self {
        Self {
            cores: seven_zip_cpu_threads(),
            available: mem_available_bytes(),
            block_bytes: SEVEN_ZIP_BLOCK_BYTES,
        }
    }
}

/// One export: its members, its 7z blocks, the LZMA2 workers, and the RAM
/// they take. Planned from the index before anything is decrypted.
pub(crate) struct SevenZipPackPlan<'a> {
    dirs: Vec<&'a VaultNode>,
    files: Vec<&'a VaultNode>,
    /// Ranges of `files`, one per 7z block, in archive order.
    blocks: Vec<Range<usize>>,
    /// Logical bytes of every file packed: the job's total.
    bytes: u64,
    threads: u32,
    pub(crate) ram: u64,
}

/// Plan the `.7z` of `index`, leaving out every path `skip` names. LZMA2 gets
/// as many workers as fit in free RAM, and one when no more fit; a copy-only
/// archive uses one.
pub(crate) fn plan_seven_zip_pack<'a>(
    index: &'a VaultIndex,
    opts: &VaultSevenZipSection,
    outer_folder: &str,
    skip: impl Fn(&str) -> bool,
    limits: PackLimits,
) -> SevenZipPackPlan<'a> {
    let dirs = export_dir_nodes(index, &skip);
    let files = export_file_nodes(index, &skip);
    let bytes = files
        .iter()
        .map(|node| file_size(node))
        .fold(0, u64::saturating_add);
    let paths = dirs.iter().chain(&files).map(|node| node.path.len());
    let fixed = ENCODER_SLACK
        .saturating_add(ARCHIVE_WRITE_BUFFER as u64)
        .saturating_add(decrypt_stream_bytes())
        .saturating_add(archive_header_bytes(outer_folder, paths));
    let layout = |threads: u32| {
        let blocks = plan_blocks(&files, block_limit(opts, threads, limits.block_bytes));
        let coder = coder_bytes(opts, threads, largest_block(&files, &blocks));
        (blocks, fixed.saturating_add(coder))
    };
    let (mut blocks, mut ram) = layout(1);
    let mut threads = 1;
    if opts.archive_mode == VaultArchiveMode::CompressEncrypt {
        for more in 2..=limits.cores.clamp(1, 8) {
            let (wider, needed) = layout(more);
            if limits.available.is_none_or(|free| needed > free) {
                break;
            }
            (blocks, ram, threads) = (wider, needed, more);
        }
    }
    SevenZipPackPlan {
        dirs,
        files,
        blocks,
        bytes,
        threads,
        ram,
    }
}

pub(crate) fn ensure_available_ram(available: Option<u64>, needed: u64) -> Result<()> {
    match available {
        Some(available) if available >= needed => Ok(()),
        _ => Err(UprivError::InsufficientRamExport),
    }
}

pub(crate) fn ensure_seven_zip_export_ram(needed: u64) -> Result<()> {
    ensure_available_ram(mem_available_bytes(), needed)
}

pub(crate) fn try_vec_with_capacity(bytes: u64) -> Result<Vec<u8>> {
    let cap = usize::try_from(bytes).map_err(|_| UprivError::InsufficientRamExport)?;
    let mut buf = Vec::new();
    if buf.try_reserve(cap.max(64 * 1024)).is_err() {
        return Err(UprivError::InsufficientRamExport);
    }
    Ok(buf)
}

fn map_io_error(err: std::io::Error) -> UprivError {
    if err.kind() == ErrorKind::OutOfMemory {
        UprivError::InsufficientRamExport
    } else {
        UprivError::from(err)
    }
}

fn map_sevenz_error(err: sevenz_rust2::Error) -> UprivError {
    match err {
        sevenz_rust2::Error::MaxMemLimited { .. } => UprivError::InsufficientRamExport,
        sevenz_rust2::Error::Io(io, _)
        | sevenz_rust2::Error::FileOpen(io, _)
        | sevenz_rust2::Error::MaybeBadPassword(io) => map_io_error(io),
        other => UprivError::VaultStoreInvalid {
            path: PathBuf::from("export.7z"),
            detail: format!("could not create portable .7z: {other}"),
        },
    }
}

fn archive_member_name(logical: &str) -> Result<String> {
    if sevenz_member_name_unsafe(logical) {
        return Err(UprivError::VaultStoreInvalid {
            path: PathBuf::from(logical),
            detail: "refusing unsafe .7z member path".into(),
        });
    }
    Ok(logical.to_string())
}

/// AES (with a fresh random salt and IV) over the content coder.
fn content_methods(
    opts: &VaultSevenZipSection,
    password: Password,
    threads: u32,
) -> Vec<sevenz_rust2::EncoderConfiguration> {
    let mut aes_opts = AesEncoderOptions::new(password);
    // 7-Zip CLI default is 2^19 SHA-256 iterations (`7zAES:19`).
    aes_opts.num_cycles_power = 19;
    let aes = aes_opts.into();
    let level = u32::from(opts.compression_level.min(9));
    let data = if opts.archive_mode == VaultArchiveMode::EncryptOnly {
        EncoderMethod::COPY.into()
    } else if threads <= 1 {
        Lzma2Options::from_level(level).into()
    } else {
        Lzma2Options::from_level_mt(level, threads, lzma_dict_bytes(opts.compression_level)).into()
    };
    vec![aes, data]
}

fn export_file_nodes<'a>(
    index: &'a VaultIndex,
    skip: &impl Fn(&str) -> bool,
) -> Vec<&'a VaultNode> {
    index
        .nodes
        .iter()
        .filter(|node| !skip(&node.path) && !node.is_dir() && node.as_file().is_some())
        .collect()
}

fn export_dir_nodes<'a>(index: &'a VaultIndex, skip: &impl Fn(&str) -> bool) -> Vec<&'a VaultNode> {
    let mut dirs: Vec<&VaultNode> = index
        .nodes
        .iter()
        .filter(|node| !skip(&node.path) && node.is_dir())
        .collect();
    dirs.sort_by(|left, right| left.path.cmp(&right.path));
    dirs
}

fn seven_zip_logical_member(outer: &str, logical: &str) -> String {
    let logical = logical.trim_start_matches('/');
    format!("{outer}/{logical}")
}

fn push_directory<W: Write + Seek>(writer: &mut ArchiveWriter<W>, name: &str) -> Result<()> {
    let mut entry = ArchiveEntry::new_directory(name);
    // sevenz-rust2 0.20.2 writes the anti-item bit inverted (`has_anti |= !is_anti`),
    // so a normal directory is stored as an anti-item. Setting the flag makes
    // the writer omit that bit and import reads a directory. Re-check on upgrade.
    entry.is_anti_item = true;
    writer
        .push_archive_entry::<std::io::Empty>(entry, None)
        .map_err(map_sevenz_error)?;
    Ok(())
}

/// Where the logical files are read from: a closed vault's `store/`, unlocked.
#[derive(Clone, Copy)]
pub(crate) struct LogicalSevenZipSource<'a> {
    pub store_dir: &'a Path,
    pub header: &'a VaultHeader,
    pub content_key: &'a [u8; 32],
}

/// One file's plaintext, taken chunk by chunk from the decrypt queue. A
/// chunk counts toward the job's progress when the encoder takes it.
struct QueuedFile<'q> {
    queue: &'q Receiver<Zeroizing<Vec<u8>>>,
    job: &'q Job,
    /// Bytes of this file not yet taken from the queue.
    left: u64,
    chunk: Zeroizing<Vec<u8>>,
    read: usize,
}

impl<'q> QueuedFile<'q> {
    fn new(queue: &'q Receiver<Zeroizing<Vec<u8>>>, job: &'q Job, size: u64) -> Self {
        Self {
            queue,
            job,
            left: size,
            chunk: Zeroizing::new(Vec::new()),
            read: 0,
        }
    }
}

impl Read for QueuedFile<'_> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if self.read == self.chunk.len() {
            if self.left == 0 {
                return Ok(0);
            }
            let chunk = self
                .queue
                .recv()
                .map_err(|_| std::io::Error::other("vault decrypt stopped"))?;
            let len = chunk.len() as u64;
            if len == 0 || len > self.left {
                return Err(std::io::Error::new(
                    ErrorKind::InvalidData,
                    "decrypted chunk does not fit the file",
                ));
            }
            self.left -= len;
            self.job.advance(len);
            self.chunk = chunk;
            self.read = 0;
        }
        let n = buf.len().min(self.chunk.len() - self.read);
        buf[..n].copy_from_slice(&self.chunk[self.read..self.read + n]);
        self.read += n;
        Ok(n)
    }
}

/// Decrypt `files` in order into `queue`. Returns without an error once the
/// encoder stops reading: the encoder reports why.
fn decrypt_in_order(
    source: LogicalSevenZipSource<'_>,
    files: &[&VaultNode],
    queue: SyncSender<Zeroizing<Vec<u8>>>,
) -> Result<()> {
    for node in files {
        let mut encoder_gone = false;
        let read = read_file_chunks(
            source.store_dir,
            source.header,
            source.content_key,
            node,
            |chunk| {
                queue.send(chunk).map_err(|_| {
                    encoder_gone = true;
                    UprivError::JobCancelled
                })
            },
        );
        if encoder_gone {
            return Ok(());
        }
        read?;
    }
    Ok(())
}

fn push_blocks<W: Write + Seek>(
    writer: &mut ArchiveWriter<W>,
    queue: &Receiver<Zeroizing<Vec<u8>>>,
    opts: &VaultSevenZipSection,
    password: &Password,
    outer_folder: &str,
    plan: &SevenZipPackPlan<'_>,
    job: &Job,
) -> Result<()> {
    for block in &plan.blocks {
        job.ensure_running()?;
        let files = &plan.files[block.clone()];
        let mut entries = Vec::with_capacity(files.len());
        let mut readers = Vec::with_capacity(files.len());
        for node in files {
            let name = archive_member_name(&seven_zip_logical_member(outer_folder, &node.path))?;
            entries.push(ArchiveEntry::new_file(&name));
            readers.push(SourceReader::new(QueuedFile::new(
                queue,
                job,
                file_size(node),
            )));
        }
        // Each block is sealed with its own salt and IV.
        writer.set_content_methods(content_methods(opts, password.clone(), plan.threads));
        writer
            .push_archive_entries(entries, readers)
            .map_err(map_sevenz_error)?;
    }
    Ok(())
}

/// Stream the files of `plan` into `writer`, one 7z block at a time, while a
/// worker thread decrypts them. A decrypt failure is the error returned: it
/// is why the encoder ran dry.
fn push_file_blocks<W: Write + Seek>(
    writer: &mut ArchiveWriter<W>,
    source: LogicalSevenZipSource<'_>,
    opts: &VaultSevenZipSection,
    password: &Password,
    outer_folder: &str,
    plan: &SevenZipPackPlan<'_>,
    job: &Job,
) -> Result<()> {
    let (decrypted, queue) = sync_channel(DECRYPT_QUEUE_CHUNKS);
    let files = plan.files.as_slice();
    std::thread::scope(|scope| {
        let worker = scope.spawn(move || decrypt_in_order(source, files, decrypted));
        let pushed = push_blocks(writer, &queue, opts, password, outer_folder, plan, job);
        // Without its reader the worker stops at its next chunk.
        drop(queue);
        let read = worker
            .join()
            .unwrap_or_else(|panic| std::panic::resume_unwind(panic));
        read.and(pushed)
    })
}

/// Pack the files of `plan` into `dest`. `job` is checked before each block,
/// every archive write fails once it is asked to stop, and its progress counts
/// the logical bytes packed.
pub(crate) fn pack_logical_seven_zip_to_writer<W: Write + Seek>(
    dest: W,
    source: LogicalSevenZipSource<'_>,
    archive_password: &[u8],
    opts: &VaultSevenZipSection,
    outer_folder: &str,
    plan: &SevenZipPackPlan<'_>,
    job: &Job,
) -> Result<W> {
    let password = sevenz_password(archive_password)?;
    let buffered = BufWriter::with_capacity(ARCHIVE_WRITE_BUFFER, dest);
    let mut writer = ArchiveWriter::new(job.writer(buffered)).map_err(map_sevenz_error)?;
    writer.set_encrypt_header(opts.encrypt_file_names);
    // A vault with no files and no folders is one outer directory. Folders that
    // exist in the vault, including empty ones, are members under that name.
    if plan.files.is_empty() && plan.dirs.is_empty() {
        push_directory(&mut writer, outer_folder)?;
    } else {
        for dir in &plan.dirs {
            let name = archive_member_name(&seven_zip_logical_member(outer_folder, &dir.path))?;
            push_directory(&mut writer, &name)?;
        }
    }
    job.set_total(plan.bytes);
    push_file_blocks(
        &mut writer,
        source,
        opts,
        &password,
        outer_folder,
        plan,
        job,
    )?;
    // The header is sealed with its own salt and IV.
    writer.set_content_methods(content_methods(opts, password, plan.threads));
    let buffered = writer.finish().map_err(map_io_error)?.into_inner();
    buffered
        .into_inner()
        .map_err(|error| map_io_error(error.into_error()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[allow(unused_imports)]
    use crate::host_fs::HostFsQuery;
    use std::io::{Cursor, SeekFrom};

    use crate::session::{cancel_job, job_status};
    use crate::store::{blob_path, is_reserved_logical, open_store, KdfUnlockPreset};
    use crate::test_support::{test_job_id, vault_root_with};
    use crate::vault::create::create_vault;
    use crate::vault::fs::{fs_read_file, fs_write_file};
    use crate::vault::open_close::{close_vault, open_vault};
    use crate::vault::seven_zip::import_logical_seven_zip;

    const MIB: u64 = 1024 * 1024;
    const PASSWORD: &[u8] = b"pass-word-ok";

    fn opts(archive_mode: VaultArchiveMode, compression_level: u8) -> VaultSevenZipSection {
        VaultSevenZipSection {
            archive_mode,
            compression_level,
            ..VaultSevenZipSection::default()
        }
    }

    fn limits(cores: u32, available: Option<u64>) -> PackLimits {
        PackLimits {
            cores,
            available,
            block_bytes: SEVEN_ZIP_BLOCK_BYTES,
        }
    }

    /// An index of files with these sizes. The chunk lists stay empty: a plan
    /// reads only paths and sizes.
    fn index_of(sizes: &[u64]) -> VaultIndex {
        let mut index = VaultIndex::empty();
        for (at, size) in sizes.iter().enumerate() {
            index.nodes.push(VaultNode::file(
                &format!("docs/file-{at}.bin"),
                uuid::Uuid::new_v4().to_string(),
                *size,
                Vec::new(),
                Vec::new(),
            ));
        }
        index
    }

    fn plan<'a>(
        index: &'a VaultIndex,
        opts: &VaultSevenZipSection,
        limits: PackLimits,
    ) -> SevenZipPackPlan<'a> {
        plan_seven_zip_pack(index, opts, "Notes", is_reserved_logical, limits)
    }

    fn vault_config(id: &str) -> crate::config::VaultConfig {
        toml::from_str(&format!(
            "[vault]\nid = \"{id}\"\ndisplay_name = \"{id}\"\norder = 1\n[storage]\nmode = \"encrypted_dir\"\n"
        ))
        .unwrap()
    }

    /// A closed vault `notes` holding `files`.
    fn closed_vault(files: &[(&str, &[u8])]) -> (tempfile::TempDir, crate::paths::VaultRoot) {
        let (tmp, root) = vault_root_with(&[]);
        create_vault(&root, vault_config("notes"), PASSWORD, KdfUnlockPreset::M32).unwrap();
        open_vault(&root, "notes", PASSWORD).unwrap();
        for (path, bytes) in files {
            fs_write_file(&root, "notes", path, bytes).unwrap();
        }
        close_vault(&root, "notes").unwrap();
        (tmp, root)
    }

    /// Pack the closed vault `notes` into `dest` with `limits`.
    fn pack_into<W: Write + Seek>(
        root: &crate::paths::VaultRoot,
        dest: W,
        opts: &VaultSevenZipSection,
        limits: PackLimits,
        job: &Job,
    ) -> Result<W> {
        let store = root
            .vault_dir("notes")
            .unwrap()
            .join(crate::paths::STORE_DIR_NAME);
        let opened = open_store(&store, PASSWORD).unwrap();
        let plan = plan(&opened.index, opts, limits);
        pack_logical_seven_zip_to_writer(
            dest,
            LogicalSevenZipSource {
                store_dir: &store,
                header: &opened.header,
                content_key: &opened.content_key,
            },
            PASSWORD,
            opts,
            "Notes",
            &plan,
            job,
        )
    }

    /// Counts the writes that reach the archive file.
    struct CountingCursor {
        inner: Cursor<Vec<u8>>,
        writes: usize,
    }

    impl Write for CountingCursor {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.writes += 1;
            self.inner.write(buf)
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    impl Seek for CountingCursor {
        fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
            self.inner.seek(pos)
        }
    }

    #[test]
    fn sevenz_password_rejects_newline_and_empty() {
        assert!(sevenz_password(b"ok-pass").is_ok());
        assert!(matches!(
            sevenz_password(b"").unwrap_err(),
            UprivError::WrongPassword
        ));
        assert!(sevenz_password(b"bad\npass").is_err());
        assert!(sevenz_password(b"bad\0pass").is_err());
    }

    #[test]
    fn copy_only_pack_stays_on_one_thread() {
        let index = index_of(&[1000, 800]);
        let copy = VaultSevenZipSection::default();
        assert_eq!(plan(&index, &copy, limits(8, Some(u64::MAX))).threads, 1);
    }

    #[test]
    fn plaintext_in_ram_does_not_grow_with_the_files() {
        let small = index_of(&[MIB]);
        let large = index_of(&[4096 * MIB, 4096 * MIB]);
        for opts in [
            VaultSevenZipSection::default(),
            opts(VaultArchiveMode::CompressEncrypt, 5),
        ] {
            let one = limits(1, Some(u64::MAX));
            let small_ram = plan(&small, &opts, one).ram;
            let large_ram = plan(&large, &opts, one).ram;
            // Only the two extra members of the header differ.
            assert!(large_ram - small_ram < MIB, "{opts:?}");
        }
    }

    #[test]
    fn several_lzma_workers_count_the_largest_block_twice() {
        let index = index_of(&[512 * MIB]);
        let lzma = opts(VaultArchiveMode::CompressEncrypt, 5);
        let one = plan(&index, &lzma, limits(1, Some(u64::MAX)));
        let four = plan(&index, &lzma, limits(4, Some(u64::MAX)));
        assert_eq!(four.threads, 4);
        assert_eq!(
            four.ram - one.ram,
            3 * lzma_encoder_bytes(5) + 2 * 512 * MIB
        );
    }

    #[test]
    fn lzma_workers_grow_only_while_the_ram_fits() {
        let index = index_of(&[16 * MIB]);
        let lzma = opts(VaultArchiveMode::CompressEncrypt, 5);
        let fits_three = plan(&index, &lzma, limits(3, Some(u64::MAX))).ram;
        assert_eq!(plan(&index, &lzma, limits(8, Some(fits_three))).threads, 3);
        assert_eq!(
            plan(&index, &lzma, limits(8, Some(fits_three - 1))).threads,
            2
        );
        assert_eq!(plan(&index, &lzma, limits(8, Some(u64::MAX))).threads, 8);
        // Unknown RAM keeps one worker; the export's RAM check then refuses.
        assert_eq!(plan(&index, &lzma, limits(8, None)).threads, 1);
    }

    #[test]
    fn a_block_closes_before_the_file_that_would_pass_the_limit() {
        let index = index_of(&[40 * MIB, 20 * MIB, 10 * MIB, 200 * MIB, 0, MIB]);
        let copy = VaultSevenZipSection::default();
        let planned = plan(&index, &copy, limits(1, Some(u64::MAX)));
        assert_eq!(planned.blocks, vec![0..2, 2..3, 3..4, 4..6]);
        assert_eq!(planned.bytes, 271 * MIB);
    }

    #[test]
    fn solid_puts_every_file_in_one_block() {
        let index = index_of(&[40 * MIB, 200 * MIB, MIB]);
        let solid = VaultSevenZipSection {
            solid: true,
            ..VaultSevenZipSection::default()
        };
        assert_eq!(
            plan(&index, &solid, limits(1, Some(u64::MAX))).blocks,
            vec![0..3]
        );
    }

    #[test]
    fn several_lzma_workers_get_a_chunk_each_per_block() {
        let index = index_of(&[64 * MIB; 8]);
        let lzma = opts(VaultArchiveMode::CompressEncrypt, 9);
        let planned = plan(&index, &lzma, limits(8, Some(u64::MAX)));
        assert_eq!(planned.threads, 8);
        // Eight 64 MiB chunks: one per worker.
        assert_eq!(planned.blocks, vec![0..8]);
    }

    #[test]
    fn lzma_encoder_bytes_follow_the_crate_allocations() {
        assert_eq!(lzma_hash4_entries(1 << 18), 1 << 17);
        assert_eq!(lzma_hash4_entries(1 << 20), 1 << 19);
        assert_eq!(lzma_hash4_entries(1 << 23), 1 << 22);
        assert_eq!(lzma_hash4_entries(1 << 26), 1 << 24);
        // Level 5: 8 MiB window, BT4 tree of 64 MiB, 16 MiB hash table.
        let level5 = lzma_encoder_bytes(5);
        assert!((93 * MIB..95 * MIB).contains(&level5), "{level5}");
        // Level 9: 64 MiB window, BT4 tree of 512 MiB, 64 MiB hash table.
        let level9 = lzma_encoder_bytes(9);
        assert!((673 * MIB..675 * MIB).contains(&level9), "{level9}");
        // Level 1 chains (HC4) instead of a tree.
        let level1 = lzma_encoder_bytes(1);
        assert!((8 * MIB..10 * MIB).contains(&level1), "{level1}");
    }

    #[test]
    fn import_decoder_ram_does_not_grow_with_the_archive() {
        let needed = seven_zip_decode_budget().ram;
        assert_eq!(needed % SEVEN_ZIP_DECODE_SLACK, 0);
        assert!(needed >= SEVEN_ZIP_DECODE_SLACK);
        assert!(needed / SEVEN_ZIP_DECODE_SLACK <= u64::from(seven_zip_cpu_threads()));
    }

    #[test]
    fn threads_stop_when_the_next_worker_would_not_fit() {
        let slack = 64 * 1024 * 1024;
        assert_eq!(threads_that_fit(4, None, slack, 0), 1);
        assert_eq!(threads_that_fit(4, Some(slack / 2), slack, 0), 1);
        assert_eq!(threads_that_fit(4, Some(slack * 3), slack, 0), 3);
        assert_eq!(threads_that_fit(4, Some(slack * 9), slack, 0), 4);
        let dict = 16 * 1024 * 1024;
        let fixed = 40 * 1024 * 1024;
        assert_eq!(threads_that_fit(8, Some(fixed + dict), dict, fixed), 1);
        assert_eq!(threads_that_fit(8, Some(fixed + dict * 2), dict, fixed), 2);
        assert_eq!(
            threads_that_fit(8, Some(fixed + dict * 2 - 1), dict, fixed),
            1
        );
    }

    #[test]
    fn lzma_dict_follows_the_encoder_presets() {
        assert_eq!(lzma_dict_bytes(0), 1 << 18);
        assert_eq!(lzma_dict_bytes(3), 1 << 22);
        assert_eq!(lzma_dict_bytes(5), 1 << 23);
        assert_eq!(lzma_dict_bytes(9), 1 << 26);
        assert_eq!(lzma_dict_bytes(99), 1 << 26);
    }

    #[test]
    fn cpu_thread_cap_stays_inside_one_and_eight() {
        let cores = seven_zip_cpu_threads();
        assert!((1..=8).contains(&cores));
    }

    #[test]
    fn unknown_ram_fails_closed() {
        assert!(matches!(
            ensure_available_ram(None, 1).unwrap_err(),
            UprivError::InsufficientRamExport
        ));
        assert!(ensure_available_ram(Some(10), 10).is_ok());
        assert!(matches!(
            ensure_available_ram(Some(9), 10).unwrap_err(),
            UprivError::InsufficientRamExport
        ));
    }

    #[test]
    fn parse_mem_available_reads_kib() {
        let text = "MemTotal:        8000000 kB\nMemAvailable:    2048 kB\n";
        assert_eq!(parse_mem_available_bytes(text), Some(2048 * 1024));
        assert_eq!(parse_mem_available_bytes("MemTotal: 1 kB\n"), None);
    }

    #[test]
    fn archive_member_name_rejects_dotdot() {
        assert!(archive_member_name("docs/hi.txt").is_ok());
        assert!(archive_member_name("../x").is_err());
        assert!(archive_member_name("/abs").is_err());
        assert!(sevenz_member_name_unsafe("docs//hi.txt"));
    }

    #[test]
    fn the_archive_reaches_its_file_in_large_writes() {
        let data = vec![7u8; 3 * 1024 * 1024];
        let (_tmp, root) = closed_vault(&[("/docs/big.bin", &data)]);
        let dest = CountingCursor {
            inner: Cursor::new(Vec::new()),
            writes: 0,
        };
        let copy = VaultSevenZipSection::default();
        let packed = pack_into(&root, dest, &copy, limits(1, None), &Job::untracked()).unwrap();
        assert!(packed.inner.get_ref().len() as u64 > 3 * MIB);
        // The AES coder emits 16 bytes per write; the buffer turns those into a few.
        assert!(packed.writes < 32, "{} writes", packed.writes);
    }

    #[test]
    fn identical_files_in_separate_blocks_encrypt_differently() {
        let same = vec![0x5au8; 4096];
        let (_tmp, root) = closed_vault(&[("/a.bin", &same), ("/b.bin", &same)]);
        let copy = VaultSevenZipSection::default();
        let one_file_per_block = PackLimits {
            block_bytes: 4096,
            ..limits(1, None)
        };
        let packed = pack_into(
            &root,
            Cursor::new(Vec::new()),
            &copy,
            one_file_per_block,
            &Job::untracked(),
        )
        .unwrap()
        .into_inner();
        // Copy-only blocks follow the 32-byte signature header in order, each
        // as long as its file.
        let first = &packed[32..32 + 4096];
        let second = &packed[32 + 4096..32 + 2 * 4096];
        assert_ne!(first, second, "two blocks share a key and IV");

        let imported = import_logical_seven_zip(
            &root,
            vault_config("copy"),
            PASSWORD,
            KdfUnlockPreset::M32,
            &packed,
            PASSWORD,
            None,
        )
        .unwrap();
        open_vault(&root, &imported, PASSWORD).unwrap();
        assert_eq!(fs_read_file(&root, &imported, "/a.bin").unwrap(), same);
        assert_eq!(fs_read_file(&root, &imported, "/b.bin").unwrap(), same);
        close_vault(&root, &imported).unwrap();
    }

    #[test]
    fn compressed_exports_import_whole_with_one_worker_or_several() {
        // Sixteen letters: about four bits a byte, well inside the import's
        // 64x expansion cap.
        let mut seed = 0x9e37_79b9_u32;
        let text: Vec<u8> = (0..360_000)
            .map(|_| {
                seed ^= seed << 13;
                seed ^= seed >> 17;
                seed ^= seed << 5;
                b'a' + (seed % 16) as u8
            })
            .collect();
        let (_tmp, root) = closed_vault(&[
            ("/one.txt", &text),
            ("/two/three.txt", &text[..1000]),
            ("/empty.txt", b""),
        ]);
        let lzma = opts(VaultArchiveMode::CompressEncrypt, 1);
        // One worker streams, here in two blocks; two workers share one block.
        for (cores, blocks) in [(1, 2), (2, 1)] {
            let small_blocks = PackLimits {
                block_bytes: 1000,
                ..limits(cores, Some(u64::MAX))
            };
            let store = root
                .vault_dir("notes")
                .unwrap()
                .join(crate::paths::STORE_DIR_NAME);
            let opened = open_store(&store, PASSWORD).unwrap();
            assert_eq!(
                plan(&opened.index, &lzma, small_blocks).blocks.len(),
                blocks
            );
            let packed = pack_into(
                &root,
                Cursor::new(Vec::new()),
                &lzma,
                small_blocks,
                &Job::untracked(),
            )
            .unwrap()
            .into_inner();
            assert!(packed.len() < text.len() * 3 / 4, "{} bytes", packed.len());
            let imported = import_logical_seven_zip(
                &root,
                vault_config(&format!("lzma-{cores}")),
                PASSWORD,
                KdfUnlockPreset::M32,
                &packed,
                PASSWORD,
                None,
            )
            .unwrap();
            open_vault(&root, &imported, PASSWORD).unwrap();
            assert_eq!(fs_read_file(&root, &imported, "/one.txt").unwrap(), text);
            assert_eq!(
                fs_read_file(&root, &imported, "/two/three.txt").unwrap(),
                &text[..1000]
            );
            assert!(fs_read_file(&root, &imported, "/empty.txt")
                .unwrap()
                .is_empty());
            close_vault(&root, &imported).unwrap();
        }
    }

    #[test]
    fn a_damaged_chunk_fails_the_export_with_the_store_error() {
        let (_tmp, root) = closed_vault(&[("/docs/hi.txt", b"hello-export")]);
        let store = root
            .vault_dir("notes")
            .unwrap()
            .join(crate::paths::STORE_DIR_NAME);
        let opened = open_store(&store, PASSWORD).unwrap();
        let node = opened.index.find("docs/hi.txt").unwrap();
        let blob = blob_path(&store, node.as_file().unwrap().0).unwrap();
        let mut bytes = crate::host_fs::read(&blob).unwrap();
        let last = bytes.len() - 1;
        bytes[last] ^= 0x01;
        crate::host_fs::write(&blob, &bytes).unwrap();

        let copy = VaultSevenZipSection::default();
        let err = pack_into(
            &root,
            Cursor::new(Vec::new()),
            &copy,
            limits(1, None),
            &Job::untracked(),
        )
        .unwrap_err();
        assert!(
            matches!(&err, UprivError::VaultStoreInvalid { detail, .. } if detail == "chunk tag failed"),
            "{err:?}"
        );
    }

    #[test]
    fn progress_counts_the_logical_bytes_packed() {
        let data = vec![3u8; 600_000];
        let (_tmp, root) = closed_vault(&[("/a.bin", &data), ("/b.bin", b"tail")]);
        let id = test_job_id();
        let job = Job::start(&id).unwrap();
        let copy = VaultSevenZipSection::default();
        pack_into(&root, Cursor::new(Vec::new()), &copy, limits(1, None), &job).unwrap();
        let status = job_status(&id).unwrap();
        assert_eq!(status.bytes_total, 600_004);
        assert_eq!(status.bytes_done, 600_004);
    }

    #[test]
    fn a_stop_ends_the_pack_and_its_decrypt_worker() {
        let data = vec![9u8; 2 * 1024 * 1024];
        let (_tmp, root) = closed_vault(&[("/a.bin", &data), ("/b.bin", &data)]);
        let id = test_job_id();
        let job = Job::start(&id).unwrap();
        cancel_job(&id);
        let copy = VaultSevenZipSection::default();
        let packed = pack_into(&root, Cursor::new(Vec::new()), &copy, limits(1, None), &job);
        assert!(matches!(job.settle(packed), Err(UprivError::JobCancelled)));
    }
}
