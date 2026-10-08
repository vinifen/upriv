//! Logical import of an ordinary `.zip` of documents.
//!
//! This is not a Upriv store zip. Entries are streamed into a new `store/`.
//! Nothing is unpacked onto disk.

#[allow(unused_imports)]
use crate::host_fs::HostFsQuery;
use std::collections::HashSet;
use std::io::{Cursor, ErrorKind, Read, Seek};
use std::path::Path;

use zip::ZipArchive;

use crate::config::VaultConfig;
use crate::error::{Result, UprivError};
use crate::logging::{log_event, LogLevel};
use crate::paths::{VaultRoot, STORE_DIR_NAME};
use crate::store::{
    file_name, KdfUnlockPreset, HEADER_DIR_NAME, HEADER_FILE_NAME, INTERNAL_WORKSPACE_FILE,
    SEED_LOGICAL_PATH,
};

use super::create::create_vault;
use super::fs::{fs_ensure_folder, fs_write_from_reader};
use super::open_close::{abandon_failed_import, close_vault, open_vault_for_ingest};
use super::seven_zip_pack::sevenz_member_name_unsafe;

/// Deflate of text can be well above the store-zip factor. Still finite.
pub(crate) const FILES_ZIP_EXPAND_FACTOR: u64 = 64;
const S_IFMT: u32 = 0o170000;
const S_IFLNK: u32 = 0o120000;

pub(crate) struct ZipEntryMeta {
    pub index: usize,
    pub name: String,
    pub is_dir: bool,
    pub declared_size: u64,
    pub symlink: bool,
}

/// What a `.zip` is, from its central directory. No file bytes are unpacked.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ZipImportClass {
    /// Upriv ciphertext (`vault.header` inside `store/`).
    Store,
    /// Ordinary documents to wrap into a new `store/`.
    Files,
}

#[derive(Debug)]
pub(crate) enum PlannedZipEntry {
    Directory(String),
    File { index: usize, logical: String },
}

fn layout_error(detail: impl Into<String>) -> UprivError {
    UprivError::VaultStoreInvalid {
        path: Path::new("zip").to_path_buf(),
        detail: detail.into(),
    }
}

fn map_zip_error(error: zip::result::ZipError) -> UprivError {
    if matches!(
        error,
        zip::result::ZipError::UnsupportedArchive(zip::result::ZipError::PASSWORD_REQUIRED)
    ) {
        return layout_error("a files .zip cannot use a zip password");
    }
    layout_error(error.to_string())
}

fn normalize_entry_name(name: &str) -> String {
    name.replace('\\', "/").trim_matches('/').to_string()
}

fn entry_parts(name: &str) -> Vec<&str> {
    name.split('/').filter(|part| !part.is_empty()).collect()
}

fn is_os_junk(name: &str) -> bool {
    entry_parts(name)
        .iter()
        .any(|part| *part == "__MACOSX" || *part == ".DS_Store")
}

/// `store/header/vault.header`, including when one outer folder wraps the zip.
/// A document that is merely named `vault.header` is not a vault.
fn is_upriv_store_entry(name: &str) -> bool {
    let parts = entry_parts(name);
    let n = parts.len();
    n >= 3
        && parts[n - 3] == STORE_DIR_NAME
        && parts[n - 2] == HEADER_DIR_NAME
        && parts[n - 1] == HEADER_FILE_NAME
}

fn is_reserved_logical(logical: &str) -> bool {
    logical == SEED_LOGICAL_PATH || file_name(logical) == INTERNAL_WORKSPACE_FILE
}

/// One shared top folder is removed when every file lives under it.
fn shared_file_root<'a>(files: &[&'a str]) -> Option<&'a str> {
    if files.is_empty() {
        return None;
    }
    let mut root: Option<&str> = None;
    for name in files {
        let (top, rest) = name.split_once('/')?;
        if rest.is_empty() {
            return None;
        }
        match root {
            None => root = Some(top),
            Some(current) if current != top => return None,
            Some(_) => {}
        }
    }
    root
}

fn strip_root<'a>(name: &'a str, root: Option<&str>) -> Option<&'a str> {
    let Some(root) = root else {
        return Some(name);
    };
    let prefix = format!("{root}/");
    name.strip_prefix(&prefix).filter(|rest| !rest.is_empty())
}

/// Store zip when a Upriv marker is present. Otherwise a files zip, or an error.
pub(crate) fn classify_zip_entries(
    entries: &[ZipEntryMeta],
    source_len: u64,
) -> Result<ZipImportClass> {
    let store = entries.iter().any(|entry| {
        let name = normalize_entry_name(&entry.name);
        !name.is_empty() && !is_os_junk(&name) && is_upriv_store_entry(&name)
    });
    if store {
        return Ok(ZipImportClass::Store);
    }
    plan_files_zip(entries, source_len)?;
    Ok(ZipImportClass::Files)
}

fn classify_reader<R: Read + Seek>(reader: R, source_len: u64) -> Result<ZipImportClass> {
    let mut archive = ZipArchive::new(reader).map_err(map_zip_error)?;
    let entries = collect_entries(&mut archive)?;
    classify_zip_entries(&entries, source_len)
}

/// Classify a `.zip` from an absolute path. Reads the central directory only.
pub fn classify_import_zip_path(zip_path: &Path) -> Result<ZipImportClass> {
    if !zip_path.is_absolute() || !zip_path.host_is_file() {
        return Err(UprivError::ImportArchiveNotFound(zip_path.to_path_buf()));
    }
    let file = crate::host_fs::File::open(zip_path)
        .map_err(|error| super::import::map_archive_open_error(zip_path, error))?;
    let len = file.metadata()?.len();
    classify_reader(file, len)
}

/// Classify a `.zip` already in memory.
pub fn classify_import_zip_bytes(zip_bytes: &[u8]) -> Result<ZipImportClass> {
    classify_reader(Cursor::new(zip_bytes), zip_bytes.len() as u64)
}

/// Decide vault paths before any vault is created.
pub(crate) fn plan_files_zip(
    entries: &[ZipEntryMeta],
    source_len: u64,
) -> Result<Vec<PlannedZipEntry>> {
    let mut usable = Vec::new();
    for entry in entries {
        let name = normalize_entry_name(&entry.name);
        if name.is_empty() || is_os_junk(&name) {
            continue;
        }
        if entry.symlink {
            return Err(layout_error("refusing a zip symlink"));
        }
        if sevenz_member_name_unsafe(&name) {
            return Err(layout_error("refusing an unsafe zip entry path"));
        }
        if is_upriv_store_entry(&name) {
            return Err(layout_error(
                "this .zip is a Upriv vault file, not a folder of documents",
            ));
        }
        usable.push((entry, name));
    }

    let file_names: Vec<&str> = usable
        .iter()
        .filter(|(entry, _)| !entry.is_dir)
        .map(|(_, name)| name.as_str())
        .collect();
    let root = shared_file_root(&file_names);
    let limit = source_len.saturating_mul(FILES_ZIP_EXPAND_FACTOR);
    let mut declared = 0u64;
    let mut seen = HashSet::new();
    let mut planned = Vec::new();
    for (entry, name) in &usable {
        let Some(logical) = strip_root(name, root) else {
            continue;
        };
        if is_reserved_logical(logical) {
            return Err(layout_error("reserved internal file in files .zip"));
        }
        if !seen.insert(logical.to_string()) {
            return Err(layout_error("duplicate path in files .zip"));
        }
        if entry.is_dir {
            planned.push(PlannedZipEntry::Directory(logical.to_string()));
            continue;
        }
        declared = declared.saturating_add(entry.declared_size);
        if declared > limit {
            return Err(layout_error("zip expands beyond the archive"));
        }
        planned.push(PlannedZipEntry::File {
            index: entry.index,
            logical: logical.to_string(),
        });
    }
    Ok(planned)
}

fn collect_entries<R: Read + Seek>(archive: &mut ZipArchive<R>) -> Result<Vec<ZipEntryMeta>> {
    let mut entries = Vec::with_capacity(archive.len());
    for index in 0..archive.len() {
        let file = archive.by_index(index).map_err(map_zip_error)?;
        let mode = file.unix_mode().unwrap_or(0);
        entries.push(ZipEntryMeta {
            index,
            name: file.name().to_string(),
            is_dir: file.is_dir(),
            declared_size: file.size(),
            symlink: mode & S_IFMT == S_IFLNK,
        });
    }
    Ok(entries)
}

struct BudgetReader<R> {
    inner: R,
    budget: u64,
}

impl<R: Read> Read for BudgetReader<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if buf.is_empty() {
            return Ok(0);
        }
        if self.budget == 0 {
            let n = self.inner.read(&mut buf[..1])?;
            if n == 0 {
                return Ok(0);
            }
            return Err(std::io::Error::new(
                ErrorKind::InvalidData,
                "zip expands beyond the archive",
            ));
        }
        let max = buf.len().min(self.budget as usize);
        let n = self.inner.read(&mut buf[..max])?;
        self.budget = self.budget.saturating_sub(n as u64);
        Ok(n)
    }
}

fn ensure_folder_path(root: &VaultRoot, vault_id: &str, logical: &str) -> Result<()> {
    let parts: Vec<&str> = logical.split('/').filter(|part| !part.is_empty()).collect();
    let mut parent = "/".to_string();
    for part in parts {
        let (created, _) = fs_ensure_folder(root, vault_id, &parent, part)?;
        parent = created;
    }
    Ok(())
}

fn ingest_planned<R: Read + Seek>(
    root: &VaultRoot,
    vault_id: &str,
    archive: &mut ZipArchive<R>,
    planned: &[PlannedZipEntry],
    source_len: u64,
) -> Result<()> {
    let mut budget = source_len.saturating_mul(FILES_ZIP_EXPAND_FACTOR);
    for entry in planned {
        match entry {
            PlannedZipEntry::Directory(logical) => ensure_folder_path(root, vault_id, logical)?,
            PlannedZipEntry::File { index, logical } => {
                if let Some((parent, _)) = logical.rsplit_once('/') {
                    ensure_folder_path(root, vault_id, parent)?;
                }
                let mut file = archive.by_index(*index).map_err(map_zip_error)?;
                let mut reader = BudgetReader {
                    inner: &mut file,
                    budget,
                };
                fs_write_from_reader(root, vault_id, &format!("/{logical}"), &mut reader)?;
                budget = reader.budget;
            }
        }
    }
    Ok(())
}

fn import_reader<R: Read + Seek>(
    root: &VaultRoot,
    config: VaultConfig,
    new_password: &[u8],
    preset: KdfUnlockPreset,
    reader: R,
    source_len: u64,
) -> Result<String> {
    if new_password.is_empty() {
        return Err(UprivError::WrongPassword);
    }
    let mut archive = ZipArchive::new(reader).map_err(map_zip_error)?;
    let entries = collect_entries(&mut archive)?;
    let planned = plan_files_zip(&entries, source_len)?;
    create_vault(root, config.clone(), new_password, preset)?;
    let id = config.vault.id.trim().to_string();
    let ingest = (|| {
        open_vault_for_ingest(root, &id, new_password)?;
        ingest_planned(root, &id, &mut archive, &planned, source_len)
    })();
    if let Err(ingest_error) = ingest {
        return Err(abandon_failed_import(root, &id, ingest_error));
    }
    close_vault(root, &id, Some(new_password))?;
    log_event(LogLevel::Info, "vault_imported", &[("id", id.as_str())]);
    Ok(id)
}

/// Create a new vault and stream documents from an in-memory files `.zip`.
pub fn import_logical_files_zip(
    root: &VaultRoot,
    config: VaultConfig,
    new_password: &[u8],
    preset: KdfUnlockPreset,
    zip_bytes: &[u8],
) -> Result<String> {
    import_reader(
        root,
        config,
        new_password,
        preset,
        Cursor::new(zip_bytes),
        zip_bytes.len() as u64,
    )
}

/// Same import, reading the archive from an absolute path one entry at a time.
pub fn import_logical_files_zip_path(
    root: &VaultRoot,
    config: VaultConfig,
    new_password: &[u8],
    preset: KdfUnlockPreset,
    zip_path: &Path,
) -> Result<String> {
    if !zip_path.is_absolute() || !zip_path.host_is_file() {
        return Err(UprivError::ImportArchiveNotFound(zip_path.to_path_buf()));
    }
    let file = crate::host_fs::File::open(zip_path)
        .map_err(|error| super::import::map_archive_open_error(zip_path, error))?;
    let len = file.metadata()?.len();
    import_reader(root, config, new_password, preset, file, len)
}

#[cfg(test)]
mod tests {
    #[allow(unused_imports)]
    use crate::host_fs::HostFsQuery;
    use std::io::Write;

    use zip::write::FileOptions;
    use zip::{CompressionMethod, ZipWriter};

    use super::*;

    fn stored_options() -> FileOptions {
        FileOptions::default().compression_method(CompressionMethod::Stored)
    }

    fn zip_with(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
        for (name, body) in files {
            zip.start_file(*name, stored_options()).unwrap();
            zip.write_all(body).unwrap();
        }
        zip.finish().unwrap().into_inner()
    }

    fn meta(index: usize, name: &str, is_dir: bool, size: u64) -> ZipEntryMeta {
        ZipEntryMeta {
            index,
            name: name.to_string(),
            is_dir,
            declared_size: size,
            symlink: false,
        }
    }

    fn logicals(planned: &[PlannedZipEntry]) -> Vec<String> {
        planned
            .iter()
            .map(|entry| match entry {
                PlannedZipEntry::Directory(logical) | PlannedZipEntry::File { logical, .. } => {
                    logical.clone()
                }
            })
            .collect()
    }

    #[test]
    fn strips_one_shared_folder_and_skips_os_junk() {
        let planned = plan_files_zip(
            &[
                meta(0, "Notes/", true, 0),
                meta(1, "Notes/docs/hi.txt", false, 5),
                meta(2, "Notes/config.toml", false, 4),
                meta(3, "__MACOSX/Notes/._hi.txt", false, 8),
                meta(4, "Notes/.DS_Store", false, 3),
            ],
            100,
        )
        .unwrap();
        assert_eq!(
            logicals(&planned),
            vec!["docs/hi.txt".to_string(), "config.toml".to_string()]
        );
    }

    #[test]
    fn keeps_a_flat_zip() {
        let planned = plan_files_zip(
            &[meta(0, "a.txt", false, 1), meta(1, "docs/b.txt", false, 1)],
            100,
        )
        .unwrap();
        assert_eq!(
            logicals(&planned),
            vec!["a.txt".to_string(), "docs/b.txt".to_string()]
        );
    }

    #[test]
    fn classifies_a_store_zip_separately_from_documents() {
        assert_eq!(
            classify_zip_entries(&[meta(0, "store/header/vault.header", false, 4)], 100).unwrap(),
            ZipImportClass::Store
        );
        assert_eq!(
            classify_zip_entries(&[meta(0, "Notes/docs/hi.txt", false, 4)], 100).unwrap(),
            ZipImportClass::Files
        );
        assert_eq!(
            classify_zip_entries(
                &[
                    meta(0, "README.md", false, 20),
                    meta(1, "config.toml", false, 20),
                    meta(2, "notes.txt", false, 4),
                ],
                100,
            )
            .unwrap(),
            ZipImportClass::Files
        );
        assert_eq!(
            classify_zip_entries(&[meta(0, "Notes/store/header/vault.header", false, 4)], 100)
                .unwrap(),
            ZipImportClass::Store
        );
        assert_eq!(
            classify_zip_entries(&[meta(0, "notes/vault.header", false, 4)], 100).unwrap(),
            ZipImportClass::Files
        );
        assert_eq!(
            classify_zip_entries(&[meta(0, "header/vault.header", false, 4)], 100).unwrap(),
            ZipImportClass::Files
        );
    }

    #[test]
    fn refuses_a_upriv_store_zip() {
        let err =
            plan_files_zip(&[meta(0, "store/header/vault.header", false, 4)], 100).unwrap_err();
        assert!(matches!(err, UprivError::VaultStoreInvalid { .. }));
    }

    #[test]
    fn refuses_traversal_reserved_names_and_expansion() {
        assert!(plan_files_zip(&[meta(0, "Notes/../secret.txt", false, 1)], 100).is_err());
        assert!(plan_files_zip(&[meta(0, ".upriv-workspace.json", false, 1)], 100).is_err());
        assert!(plan_files_zip(&[meta(0, "upriv-seed.txt", false, 1)], 100).is_err());
        assert!(plan_files_zip(&[meta(0, "docs/.upriv-workspace.json", false, 1)], 100).is_err());
        assert!(plan_files_zip(&[meta(0, "big.txt", false, 10_000)], 10).is_err());
    }

    #[test]
    fn import_streams_documents_into_a_new_vault() {
        let (_tmp, root) = crate::test_support::vault_root_with(&[]);
        let config: crate::config::VaultConfig = toml::from_str(
            r#"
[vault]
id = "notes"
display_name = "Notes"
order = 1
[storage]
mode = "encrypted_dir"
"#,
        )
        .expect("config");
        let bytes = zip_with(&[
            ("Notes/docs/hi.txt", b"hello-files"),
            ("Notes/config.toml", b"user-config"),
            ("__MACOSX/._hi.txt", b"junk"),
        ]);
        let rejected = zip_with(&[("store/header/vault.header", b"header")]);
        let err = import_logical_files_zip(
            &root,
            config.clone(),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
            &rejected,
        )
        .unwrap_err();
        assert!(matches!(err, UprivError::VaultStoreInvalid { .. }));
        assert!(!root.vault_dir("notes").unwrap().host_exists());

        import_logical_files_zip(&root, config, b"pass-word-ok", KdfUnlockPreset::M32, &bytes)
            .unwrap();
        crate::open_vault(&root, "notes", b"pass-word-ok").unwrap();
        let body = crate::vault::fs::fs_read_file(&root, "notes", "/docs/hi.txt").unwrap();
        assert_eq!(body, b"hello-files");
        let named = crate::vault::fs::fs_read_file(&root, "notes", "/config.toml").unwrap();
        assert_eq!(named, b"user-config");
        let listed = crate::vault::fs::fs_list_tree(&root, "notes").unwrap();
        let json = serde_json::to_string(&listed).unwrap();
        assert!(!json.contains("_hi.txt"), "{json}");
        assert!(!json.contains("MACOSX"), "{json}");
        crate::close_vault(&root, "notes", None).unwrap();
    }
}
