//! In-RAM portable `.7z` encoder (Plan B export).
//!
//! Logical vault bytes stay in process memory. The destination `.7z` on disk is
//! ciphertext. If RAM cannot hold the working set, the op fails closed — never
//! a plaintext staging tree on ordinary disk or tmpfs.

use std::io::{Cursor, ErrorKind, Seek, Write};
use std::path::{Path, PathBuf};

use sevenz_rust2::encoder_options::{AesEncoderOptions, Lzma2Options};
use sevenz_rust2::{ArchiveEntry, ArchiveWriter, EncoderMethod, Password, SourceReader};
use zeroize::Zeroizing;

use crate::config::vault_config::{VaultArchiveMode, VaultSevenZipSection};
use crate::error::{Result, UprivError};
use crate::store::{read_logical_file, VaultHeader, VaultIndex, VaultNode};

const ARCHIVE_HEADER_SLACK: u64 = 1024 * 1024;
const ENCODER_SLACK: u64 = 32 * 1024 * 1024;

#[derive(Clone, Copy)]
pub(crate) enum SevenZipSink {
    /// NDJSON / bytes path: ciphertext archive stays in a `Vec`.
    Memory,
    /// User dest path: ciphertext streams to a `File`.
    File,
}

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

/// RAM the `.7z` decoder needs while the archive stays on disk.
///
/// This is the decode slack, not the compressed length. A caller that loads
/// the archive into a `Vec` checks that length on its own.
pub(crate) fn seven_zip_import_ram_needed() -> u64 {
    SEVEN_ZIP_DECODE_SLACK
}

fn mem_available_bytes() -> Option<u64> {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        let text = std::fs::read_to_string("/proc/meminfo").ok()?;
        parse_mem_available_bytes(&text)
    }
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        return apple_mem_available_bytes();
    }
    #[cfg(windows)]
    {
        return windows_mem_available_bytes();
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
    let mut stats: libc::vm_statistics64 = unsafe { std::mem::zeroed() };
    let mut count = libc::HOST_VM_INFO64_COUNT;
    let host = unsafe { libc::mach_host_self() };
    let rc = unsafe {
        libc::host_statistics64(
            host,
            libc::HOST_VM_INFO64,
            &mut stats as *mut libc::vm_statistics64 as libc::host_info64_t,
            &mut count,
        )
    };
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

fn lzma_dict_bytes(level: u8) -> u64 {
    match level.min(9) {
        0 => 64 * 1024,
        1 => 256 * 1024,
        2 => 1024 * 1024,
        3 => 4 * 1024 * 1024,
        4 => 8 * 1024 * 1024,
        5 => 16 * 1024 * 1024,
        6 => 32 * 1024 * 1024,
        _ => 64 * 1024 * 1024,
    }
}

fn encoder_working_set(opts: &VaultSevenZipSection) -> u64 {
    if opts.archive_mode == VaultArchiveMode::EncryptOnly {
        ENCODER_SLACK
    } else {
        ENCODER_SLACK.saturating_add(lzma_dict_bytes(opts.compression_level))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct LogicalExportSize {
    pub total: u64,
    pub largest: u64,
    pub files: u64,
}

pub(crate) fn logical_export_size(
    index: &VaultIndex,
    skip: impl Fn(&str) -> bool,
) -> LogicalExportSize {
    let mut total = 0u64;
    let mut largest = 0u64;
    let mut files = 0u64;
    for node in &index.nodes {
        if skip(&node.path) || node.is_dir() {
            continue;
        }
        let Some((_, size, _)) = node.as_file() else {
            continue;
        };
        total = total.saturating_add(size);
        largest = largest.max(size);
        files = files.saturating_add(1);
    }
    LogicalExportSize {
        total,
        largest,
        files,
    }
}

pub(crate) fn seven_zip_pack_ram_needed(
    sizes: LogicalExportSize,
    opts: &VaultSevenZipSection,
    sink: SevenZipSink,
) -> u64 {
    let work = encoder_working_set(opts);
    let plaintext = if opts.solid {
        sizes.total
    } else {
        sizes.largest
    };
    let archive = match sink {
        SevenZipSink::Memory => sizes
            .total
            .saturating_add(ARCHIVE_HEADER_SLACK)
            .saturating_add(sizes.files.saturating_mul(4096)),
        SevenZipSink::File => ARCHIVE_HEADER_SLACK,
    };
    plaintext.saturating_add(archive).saturating_add(work)
}

pub(crate) fn seven_zip_archive_vec_budget(sizes: LogicalExportSize) -> u64 {
    sizes
        .total
        .saturating_add(ARCHIVE_HEADER_SLACK)
        .saturating_add(sizes.files.saturating_mul(4096))
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

fn content_methods(
    opts: &VaultSevenZipSection,
    password: Password,
) -> Vec<sevenz_rust2::EncoderConfiguration> {
    let mut aes_opts = AesEncoderOptions::new(password);
    // 7-Zip CLI default is 2^19 SHA-256 iterations (`7zAES:19`).
    aes_opts.num_cycles_power = 19;
    let aes = aes_opts.into();
    let data = if opts.archive_mode == VaultArchiveMode::EncryptOnly {
        EncoderMethod::COPY.into()
    } else {
        Lzma2Options::from_level(u32::from(opts.compression_level.min(9))).into()
    };
    vec![aes, data]
}

fn export_file_nodes(index: &VaultIndex, skip: impl Fn(&str) -> bool) -> Vec<&VaultNode> {
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

fn read_export_file(
    store_dir: &Path,
    header: &VaultHeader,
    content_key: &[u8; 32],
    index: &VaultIndex,
    outer_folder: &str,
    node: &VaultNode,
) -> Result<(String, Zeroizing<Vec<u8>>)> {
    let name = archive_member_name(&seven_zip_logical_member(outer_folder, &node.path))?;
    let data = Zeroizing::new(read_logical_file(
        store_dir,
        header,
        content_key,
        index,
        &node.path,
    )?);
    Ok((name, data))
}

fn push_one<W: Write + Seek>(writer: &mut ArchiveWriter<W>, name: &str, data: &[u8]) -> Result<()> {
    let entry = ArchiveEntry::new_file(name);
    writer
        .push_archive_entry(entry, Some(Cursor::new(data)))
        .map_err(map_sevenz_error)?;
    Ok(())
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

fn push_solid<W: Write + Seek>(
    writer: &mut ArchiveWriter<W>,
    files: &[(String, Zeroizing<Vec<u8>>)],
) -> Result<()> {
    if files.is_empty() {
        return Ok(());
    }
    let mut entries = Vec::with_capacity(files.len());
    let mut readers = Vec::with_capacity(files.len());
    for (name, data) in files {
        let mut entry = ArchiveEntry::new_file(name);
        entry.size = data.len() as u64;
        entries.push(entry);
        readers.push(SourceReader::new(Cursor::new(data.as_slice())));
    }
    writer
        .push_archive_entries(entries, readers)
        .map_err(map_sevenz_error)?;
    Ok(())
}

pub(crate) struct LogicalSevenZipSource<'a> {
    pub store_dir: &'a Path,
    pub header: &'a VaultHeader,
    pub content_key: &'a [u8; 32],
    pub index: &'a VaultIndex,
}

pub(crate) fn pack_logical_seven_zip_to_writer<W: Write + Seek>(
    dest: W,
    source: LogicalSevenZipSource<'_>,
    archive_password: &[u8],
    opts: &VaultSevenZipSection,
    outer_folder: &str,
    skip: impl Fn(&str) -> bool,
) -> Result<W> {
    let password = sevenz_password(archive_password)?;
    let mut writer = ArchiveWriter::new(dest).map_err(map_sevenz_error)?;
    writer.set_encrypt_header(opts.encrypt_file_names);
    writer.set_content_methods(content_methods(opts, password));
    let dirs = export_dir_nodes(source.index, &skip);
    let nodes = export_file_nodes(source.index, skip);
    // A vault with no files and no folders is one outer directory. Folders that
    // exist in the vault, including empty ones, are members under that name.
    if nodes.is_empty() && dirs.is_empty() {
        push_directory(&mut writer, outer_folder)?;
    } else {
        for dir in dirs {
            let name = archive_member_name(&seven_zip_logical_member(outer_folder, &dir.path))?;
            push_directory(&mut writer, &name)?;
        }
    }
    if opts.solid {
        let mut files = Vec::with_capacity(nodes.len());
        for node in nodes {
            files.push(read_export_file(
                source.store_dir,
                source.header,
                source.content_key,
                source.index,
                outer_folder,
                node,
            )?);
        }
        push_solid(&mut writer, &files)?;
    } else {
        for node in nodes {
            let (name, data) = read_export_file(
                source.store_dir,
                source.header,
                source.content_key,
                source.index,
                outer_folder,
                node,
            )?;
            push_one(&mut writer, &name, data.as_slice())?;
        }
    }
    writer.finish().map_err(map_io_error)
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn import_decoder_ram_does_not_grow_with_the_archive() {
        assert_eq!(seven_zip_import_ram_needed(), SEVEN_ZIP_DECODE_SLACK);
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
    fn ram_needed_memory_sink_includes_archive() {
        let opts = VaultSevenZipSection::default();
        let sizes = LogicalExportSize {
            total: 1000,
            largest: 800,
            files: 2,
        };
        let memory = seven_zip_pack_ram_needed(sizes, &opts, SevenZipSink::Memory);
        let file = seven_zip_pack_ram_needed(sizes, &opts, SevenZipSink::File);
        assert!(memory > file);
        assert!(memory >= sizes.total + sizes.largest);
    }

    #[test]
    fn archive_member_name_rejects_dotdot() {
        assert!(archive_member_name("docs/hi.txt").is_ok());
        assert!(archive_member_name("../x").is_err());
        assert!(archive_member_name("/abs").is_err());
        assert!(sevenz_member_name_unsafe("docs//hi.txt"));
    }
}
