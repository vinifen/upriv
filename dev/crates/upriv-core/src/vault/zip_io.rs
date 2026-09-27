//! Zip envelope of a ciphertext `store/` tree (no zip password).

use std::fs::File;
use std::io::{Cursor, Read, Seek, Write};
use std::path::{Path, PathBuf};

use zip::write::FileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::error::{Result, UprivError};

use super::embedded_settings::{store_zip_readme, ZIP_CONFIG_ENTRY, ZIP_README_ENTRY};
use crate::paths::STORE_DIR_NAME;
use crate::store::{
    HEADER_DIR_NAME, HEADER_FILE_NAME, INDEX_COPY_FILE_NAME, INDEX_DIR_NAME, INDEX_FILE_NAME,
    STORE_DANGER_FILE_NAME,
};

fn zip_err(path: &Path, error: impl std::fmt::Display) -> UprivError {
    UprivError::VaultStoreInvalid {
        path: path.to_path_buf(),
        detail: error.to_string(),
    }
}

/// True when `bytes` is a readable zip (store envelope probe).
pub fn probe_store_zip(bytes: &[u8]) -> Result<()> {
    probe_store_zip_reader(Cursor::new(bytes))
}

/// Probe a zip file without reading every entry into RAM.
pub fn probe_store_zip_path(path: &Path) -> Result<()> {
    if !path.is_absolute() || !path.is_file() {
        return Err(UprivError::ImportArchiveNotFound(path.to_path_buf()));
    }
    let file = File::open(path)?;
    probe_store_zip_reader(file)
}

fn probe_store_zip_reader<R: Read + Seek>(reader: R) -> Result<()> {
    ZipArchive::new(reader).map_err(|e| zip_err(Path::new("zip"), e))?;
    Ok(())
}

/// A vault zip is recognized by `store/header/vault.header`, including one outer folder.
/// A symlink at the final component is not a vault zip.
pub(crate) fn zip_contains_store_header(path: &Path) -> bool {
    let Ok(file) = crate::paths::open_nofollow(path, crate::paths::NofollowMode::Read) else {
        return false;
    };
    let Ok(mut archive) = ZipArchive::new(file) else {
        return false;
    };
    for index in 0..archive.len() {
        let Ok(entry) = archive.by_index(index) else {
            continue;
        };
        if zip_entry_is_store_header(entry.name()) {
            return true;
        }
    }
    false
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

/// Read every entry (so the zip checksums are checked) and require the two
/// sealed index files to be present and byte-identical.
pub(crate) fn verify_store_zip_copies(path: &Path) -> Result<()> {
    let file = File::open(path)?;
    let mut archive = ZipArchive::new(file).map_err(|e| zip_err(path, e))?;
    let mut primary = None;
    let mut copy = None;
    for i in 0..archive.len() {
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

fn write_zip<W: Write + std::io::Seek>(src: &Path, writer: W) -> Result<()> {
    if !src.is_dir() {
        return Err(UprivError::VaultPathNotFound(src.display().to_string()));
    }
    let mut zip = ZipWriter::new(writer);
    let options = FileOptions::default().compression_method(CompressionMethod::Stored);
    add_dir(&mut zip, src, Path::new(""), options)?;
    zip.finish().map_err(|e| zip_err(src, e))?;
    Ok(())
}

/// `README.md` and `config.toml` beside `store/`.
///
/// The warning file already in `store/` is copied with the tree.
fn write_zip_with_config<W: Write + std::io::Seek>(
    src: &Path,
    config_toml: &[u8],
    readme: &str,
    writer: W,
) -> Result<()> {
    if !src.is_dir() {
        return Err(UprivError::VaultPathNotFound(src.display().to_string()));
    }
    let mut zip = ZipWriter::new(writer);
    let options = FileOptions::default().compression_method(CompressionMethod::Stored);
    zip.start_file(ZIP_README_ENTRY, options)
        .map_err(|e| zip_err(src, e))?;
    zip.write_all(readme.as_bytes())
        .map_err(|e| zip_err(src, e))?;
    zip.start_file(ZIP_CONFIG_ENTRY, options)
        .map_err(|e| zip_err(src, e))?;
    zip.write_all(config_toml).map_err(|e| zip_err(src, e))?;
    let store_rel = Path::new(STORE_DIR_NAME);
    zip.add_directory(format!("{STORE_DIR_NAME}/"), options)
        .map_err(|e| zip_err(src, e))?;
    add_dir(&mut zip, src, store_rel, options)?;
    zip.finish().map_err(|e| zip_err(src, e))?;
    Ok(())
}

/// Zip of `store/` plus `README.md` and `config.toml`.
///
/// `created_stamp` is UTC `YYYYMMDDHHmmss` and is written into `README.md`.
pub fn zip_store_with_config_to_bytes(
    store: &Path,
    config_toml: &[u8],
    created_stamp: &str,
) -> Result<Vec<u8>> {
    let readme = store_zip_readme(created_stamp, super::sum_regular_file_bytes(store)?)?;
    let mut cursor = Cursor::new(Vec::new());
    write_zip_with_config(store, config_toml, &readme, &mut cursor)?;
    Ok(cursor.into_inner())
}

/// Zip of `store/` plus `README.md` and `config.toml`, written to `dest`.
///
/// `created_stamp` is UTC `YYYYMMDDHHmmss` and is written into `README.md`.
pub fn zip_store_with_config_to_path(
    store: &Path,
    config_toml: &[u8],
    created_stamp: &str,
    dest: &Path,
) -> Result<u64> {
    let readme = store_zip_readme(created_stamp, super::sum_regular_file_bytes(store)?)?;
    let file = File::create(dest)?;
    write_zip_with_config(store, config_toml, &readme, file)?;
    Ok(std::fs::metadata(dest)?.len())
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

/// Pack `src` (typically `store/` or a backup of it) into a `.zip` in memory.
pub fn zip_directory_to_bytes(src: &Path) -> Result<Vec<u8>> {
    let mut cursor = Cursor::new(Vec::new());
    write_zip(src, &mut cursor)?;
    Ok(cursor.into_inner())
}

/// Pack `src` into `dest` without holding the zip in an extra buffer.
pub fn zip_directory_to_path(src: &Path, dest: &Path) -> Result<u64> {
    let file = File::create(dest)?;
    write_zip(src, file)?;
    Ok(std::fs::metadata(dest)?.len())
}

fn add_dir<W: Write + std::io::Seek>(
    zip: &mut ZipWriter<W>,
    abs: &Path,
    rel: &Path,
    options: FileOptions,
) -> Result<()> {
    let mut entries: Vec<_> = std::fs::read_dir(abs)?.filter_map(|e| e.ok()).collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let name = entry.file_name();
        let child_rel = if rel.as_os_str().is_empty() {
            PathBuf::from(&name)
        } else {
            rel.join(&name)
        };
        let child_abs = entry.path();
        let ft = entry.file_type()?;
        if ft.is_symlink() {
            return Err(UprivError::VaultStoreInvalid {
                path: child_abs,
                detail: "refusing to copy a symlink into a zip".into(),
            });
        }
        if ft.is_dir() {
            let dir_name = format!("{}/", child_rel.to_string_lossy().replace('\\', "/"));
            zip.add_directory(&dir_name, options)
                .map_err(|e| zip_err(&child_abs, e))?;
            add_dir(zip, &child_abs, &child_rel, options)?;
        } else if ft.is_file() {
            let zip_name = child_rel.to_string_lossy().replace('\\', "/");
            zip.start_file(&zip_name, options)
                .map_err(|e| zip_err(&child_abs, e))?;
            let mut file = open_regular_nofollow(&child_abs)?;
            std::io::copy(&mut file, zip).map_err(|e| zip_err(&child_abs, e))?;
        } else {
            return Err(UprivError::VaultStoreInvalid {
                path: child_abs,
                detail: "refusing to copy a special file into a zip".into(),
            });
        }
    }
    Ok(())
}

fn open_regular_nofollow(src: &Path) -> Result<File> {
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

/// Stored zip whose entries are existing files (a bundle of backup `.zip`s).
pub fn zip_files_to_path(entries: &[(String, &Path)], dest: &Path) -> Result<u64> {
    let file = File::create(dest)?;
    let mut zip = ZipWriter::new(file);
    let options = FileOptions::default().compression_method(CompressionMethod::Stored);
    for (name, src) in entries {
        if name.contains("..") || name.contains('/') || name.contains('\\') {
            return Err(UprivError::VaultStoreInvalid {
                path: src.to_path_buf(),
                detail: "refusing a zip entry name that is not a single file".into(),
            });
        }
        zip.start_file(name, options).map_err(|e| zip_err(src, e))?;
        let mut input = open_regular_nofollow(src)?;
        std::io::copy(&mut input, &mut zip).map_err(|e| zip_err(src, e))?;
    }
    zip.finish().map_err(|e| zip_err(dest, e))?;
    Ok(std::fs::metadata(dest)?.len())
}

/// Extract a `.zip` of `store/` into `dest`. Rejects path escape.
pub fn unzip_store_bytes(bytes: &[u8], dest: &Path) -> Result<()> {
    unzip_store_reader(Cursor::new(bytes), dest, bytes.len() as u64)
}

/// Extract a zip file into `dest`, copying each entry without a second full buffer.
pub fn unzip_store_path(path: &Path, dest: &Path) -> Result<()> {
    let file = File::open(path)?;
    let len = file.metadata()?.len();
    unzip_store_reader(file, dest, len)
}

/// Ciphertext barely compresses. A much larger unpack is a zip bomb, not a store export.
const ZIP_EXPAND_FACTOR: u64 = 8;

fn unzip_store_reader<R: Read + Seek>(reader: R, dest: &Path, source_len: u64) -> Result<()> {
    let expand_limit = source_len.saturating_mul(ZIP_EXPAND_FACTOR);
    std::fs::create_dir_all(dest)?;
    let mut archive = ZipArchive::new(reader).map_err(|e| zip_err(dest, e))?;
    let strip = detect_single_root_prefix(&mut archive)?;
    let mut unpacked: u64 = 0;
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
            std::fs::create_dir_all(&out)?;
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
            std::fs::create_dir_all(parent)?;
        }
        let mut dest_file = File::create(&out)?;
        let copied = std::io::copy(&mut file.take(entry_len), &mut dest_file)?;
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
    use std::io::Write;

    use super::*;

    #[test]
    fn zip_round_trip_preserves_bytes() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join(crate::paths::STORE_DIR_NAME);
        std::fs::create_dir_all(src.join("header")).unwrap();
        std::fs::create_dir_all(src.join("data")).unwrap();
        std::fs::write(src.join("header").join("vault.header"), b"header-bytes").unwrap();
        std::fs::write(src.join("data").join("a.blob"), b"cipher").unwrap();
        let dest_file = tmp.path().join("packed.zip");
        let size = zip_directory_to_path(&src, &dest_file).unwrap();
        let zipped = zip_directory_to_bytes(&src).unwrap();
        assert_eq!(size as usize, zipped.len());
        assert_eq!(std::fs::read(&dest_file).unwrap(), zipped);
        let dest = tmp.path().join("out");
        unzip_store_bytes(&zipped, &dest).unwrap();
        assert_eq!(
            std::fs::read(dest.join("header").join("vault.header")).unwrap(),
            b"header-bytes"
        );
        assert_eq!(
            std::fs::read(dest.join("data").join("a.blob")).unwrap(),
            b"cipher"
        );
    }

    #[test]
    fn store_zip_keeps_config_out_of_the_store_tree() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join(crate::paths::STORE_DIR_NAME);
        std::fs::create_dir_all(src.join("header")).unwrap();
        std::fs::write(src.join("header").join("vault.header"), b"header-bytes").unwrap();
        std::fs::write(src.join(STORE_DANGER_FILE_NAME), b"notice").unwrap();
        let config = b"[vault]\nid = \"notes\"\ndisplay_name = \"Notes\"\nnote = \"kept\"\n";
        let zipped = zip_store_with_config_to_bytes(&src, config, "20260529120000").unwrap();
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
        assert!(!dest.join("config.toml").exists());
        assert!(!dest.join("README.md").exists());
        assert!(!dest.join(STORE_DANGER_FILE_NAME).exists());
        assert_eq!(
            std::fs::read(dest.join("header").join("vault.header")).unwrap(),
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
        assert!(!dest.join("header").join("vault.header").exists());
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
        verify_store_zip_copies(&good).unwrap();

        let drifted = tmp.path().join("drifted.zip");
        write_index_pair(&drifted, b"sealed", b"other");
        assert!(verify_store_zip_copies(&drifted).is_err());

        let missing = tmp.path().join("missing.zip");
        write_index_pair(&missing, b"sealed", b"");
        assert!(verify_store_zip_copies(&missing).is_err());
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
