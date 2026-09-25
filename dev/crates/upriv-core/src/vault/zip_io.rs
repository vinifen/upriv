//! Zip envelope of a ciphertext `store/` tree (no zip password).

use std::fs::File;
use std::io::{Cursor, Read, Seek, Write};
use std::path::{Path, PathBuf};

use zip::write::FileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::error::{Result, UprivError};

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
    #[cfg(unix)]
    let file = {
        use std::os::unix::fs::OpenOptionsExt;
        std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW)
            .open(src)
            .map_err(|_| UprivError::VaultStoreInvalid {
                path: src.to_path_buf(),
                detail: "refusing to copy a symlink into a zip".into(),
            })?
    };
    #[cfg(not(unix))]
    let file = File::open(src)?;
    if !file.metadata()?.is_file() {
        return Err(UprivError::VaultStoreInvalid {
            path: src.to_path_buf(),
            detail: "refusing to copy a non-regular file into a zip".into(),
        });
    }
    Ok(file)
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
            continue;
        };
        if enclosed.as_os_str().is_empty() {
            continue;
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
        if only != "header" && only != "index" && only != "data" && only != "vault.header" {
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
        std::fs::create_dir_all(src.join("data")).unwrap();
        std::fs::write(src.join("vault.header"), b"header-bytes").unwrap();
        std::fs::write(src.join("data").join("a.chunk.enc"), b"cipher").unwrap();
        let dest_file = tmp.path().join("packed.zip");
        let size = zip_directory_to_path(&src, &dest_file).unwrap();
        let zipped = zip_directory_to_bytes(&src).unwrap();
        assert_eq!(size as usize, zipped.len());
        assert_eq!(std::fs::read(&dest_file).unwrap(), zipped);
        let dest = tmp.path().join("out");
        unzip_store_bytes(&zipped, &dest).unwrap();
        assert_eq!(
            std::fs::read(dest.join("vault.header")).unwrap(),
            b"header-bytes"
        );
        assert_eq!(
            std::fs::read(dest.join("data").join("a.chunk.enc")).unwrap(),
            b"cipher"
        );
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
}
