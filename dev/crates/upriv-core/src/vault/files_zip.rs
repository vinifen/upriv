//! Logical import of a `.zip` of readable files: ordinary documents, or a
//! plain-text export of a vault.
//!
//! This is not a Upriv store zip. Entries are streamed into a new `store/`.
//! Nothing is unpacked onto disk. A plain-text export is the same thing with
//! `.upriv-config/` beside its files; every part of that folder is optional.

#[allow(unused_imports)]
use crate::host_fs::HostFsQuery;
use std::collections::HashSet;
use std::io::{Cursor, ErrorKind, Read, Seek};
use std::path::Path;

use zeroize::Zeroizing;
use zip::ZipArchive;

use crate::config::VaultConfig;
use crate::error::{Result, UprivError};
use crate::logging::{log_event, LogLevel};
use crate::paths::{VaultRoot, STORE_DIR_NAME};
use crate::store::{
    is_reserved_logical, is_skipped_on_import, KdfUnlockPreset, EXPORT_CONFIG_DIR, HEADER_DIR_NAME,
    HEADER_FILE_NAME,
};

use super::config_folder::{
    config_member, read_carried_layout, read_carried_settings, ConfigMember, ImportExtras,
};
use super::create::create_vault;
use super::embedded_settings::EmbeddedVaultSettings;
use super::fs::{
    fs_ensure_folder_path_staged, fs_seal_staged_imports, fs_seal_staged_wave, fs_write_staged,
};
use super::open_close::{abandon_failed_import, close_vault, open_vault_for_ingest};
use super::seven_zip_pack::sevenz_member_name_unsafe;
use super::zip_io::buffered_zip_reader;

/// Deflate of text can be well above the store-zip factor. Still finite.
pub(crate) const FILES_ZIP_EXPAND_FACTOR: u64 = 64;
/// Zip comment of a plain-text export. Its files sit at the zip's root, so one
/// top folder there is a vault folder and not a wrapper, and a `store/` there is
/// a document. A zip tool that packs it again drops the comment.
pub(crate) const PLAIN_ZIP_COMMENT: &str = "Upriv plain-text vault export";
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
    /// Readable files to wrap into a new `store/`.
    Files,
}

/// What a `.zip` is and what its `.upriv-config/` offers the new vault.
#[derive(Debug, Clone, PartialEq)]
pub struct ImportZipProbe {
    pub class: ZipImportClass,
    /// Settings a `.zip` of files carries. One that cannot be read counts as missing.
    pub settings: Option<EmbeddedVaultSettings>,
    /// It carries a file-manager layout.
    pub workspace: bool,
}

#[derive(Debug)]
pub(crate) enum PlannedZipEntry {
    Directory(String),
    File {
        index: usize,
        logical: String,
    },
    /// `.upriv-config/config.toml`.
    Settings {
        index: usize,
    },
    /// `.upriv-config/workspace.json`.
    Workspace {
        index: usize,
    },
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

/// `store/header/vault.header`, at the zip root or inside one outer folder.
/// A document that is merely named `vault.header`, or a `store/` deeper in a
/// folder of documents, is not a vault.
fn is_upriv_store_entry(name: &str) -> bool {
    let parts = entry_parts(name);
    let n = parts.len();
    (3..=4).contains(&n)
        && parts[n - 3] == STORE_DIR_NAME
        && parts[n - 2] == HEADER_DIR_NAME
        && parts[n - 1] == HEADER_FILE_NAME
}

/// `.upriv-config/` at the zip root or inside one outer folder: this zip is a
/// plain-text export, whatever else its files look like.
fn is_config_folder_entry(name: &str) -> bool {
    entry_parts(name)
        .iter()
        .take(2)
        .any(|part| *part == EXPORT_CONFIG_DIR)
}

fn usable_for_probe(name: &str) -> bool {
    !name.is_empty() && !is_os_junk(name)
}

/// One shared top folder is removed when every entry lives under it, so a zip
/// that holds only that folder, or only empty folders inside it, has its root
/// there too. A file at the top means there is no shared folder.
fn shared_root<'a>(entries: &[(&ZipEntryMeta, &'a str)]) -> Option<&'a str> {
    let mut root: Option<&str> = None;
    for (entry, name) in entries {
        let top = match name.split_once('/') {
            Some((top, _)) => top,
            None if entry.is_dir => name,
            None => return None,
        };
        if top == EXPORT_CONFIG_DIR {
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

fn carries_config_folder(entries: &[ZipEntryMeta]) -> bool {
    entries.iter().any(|entry| {
        let name = normalize_entry_name(&entry.name);
        usable_for_probe(&name) && is_config_folder_entry(&name)
    })
}

/// Store zip when a Upriv marker is present. Otherwise a files zip, or an error.
pub(crate) fn classify_zip_entries(
    entries: &[ZipEntryMeta],
    source_len: u64,
    exported: bool,
) -> Result<ZipImportClass> {
    let store = !exported
        && !carries_config_folder(entries)
        && entries.iter().any(|entry| {
            let name = normalize_entry_name(&entry.name);
            usable_for_probe(&name) && is_upriv_store_entry(&name)
        });
    if store {
        return Ok(ZipImportClass::Store);
    }
    plan_files_zip(entries, source_len, exported)?;
    Ok(ZipImportClass::Files)
}

fn probe_reader<R: Read + Seek>(reader: R, source_len: u64) -> Result<ImportZipProbe> {
    let mut archive = ZipArchive::new(reader).map_err(map_zip_error)?;
    let entries = collect_entries(&mut archive)?;
    let exported = is_plain_text_export(&archive);
    let class = classify_zip_entries(&entries, source_len, exported)?;
    if class == ZipImportClass::Store {
        return Ok(ImportZipProbe {
            class,
            settings: None,
            workspace: false,
        });
    }
    let mut probe = ImportZipProbe {
        class,
        settings: None,
        workspace: false,
    };
    for entry in plan_files_zip(&entries, source_len, exported)? {
        match entry {
            PlannedZipEntry::Settings { index } => {
                let mut file = archive.by_index(index).map_err(map_zip_error)?;
                // A damaged entry counts as missing, as an unparsable one does.
                probe.settings = read_carried_settings(&mut file).unwrap_or(None);
            }
            PlannedZipEntry::Workspace { .. } => probe.workspace = true,
            PlannedZipEntry::Directory(_) | PlannedZipEntry::File { .. } => {}
        }
    }
    Ok(probe)
}

/// Examine a `.zip` from an absolute path. Reads the central directory, each
/// entry's local header, and a carried `config.toml`, not the other file bodies.
pub fn probe_import_zip_path(zip_path: &Path) -> Result<ImportZipProbe> {
    if !zip_path.is_absolute() || !zip_path.host_is_file() {
        return Err(UprivError::ImportArchiveNotFound(zip_path.to_path_buf()));
    }
    let file = crate::host_fs::File::open(zip_path)
        .map_err(|error| super::import::map_archive_open_error(zip_path, error))?;
    let len = file.metadata()?.len();
    probe_reader(buffered_zip_reader(file)?, len)
}

/// Examine a `.zip` already in memory.
pub fn probe_import_zip_bytes(zip_bytes: &[u8]) -> Result<ImportZipProbe> {
    probe_reader(Cursor::new(zip_bytes), zip_bytes.len() as u64)
}

fn is_plain_text_export<R: Read + Seek>(archive: &ZipArchive<R>) -> bool {
    archive.comment() == PLAIN_ZIP_COMMENT.as_bytes()
}

/// Decide vault paths before any vault is created. `exported` is a zip this app
/// wrote: its root is the vault root.
pub(crate) fn plan_files_zip(
    entries: &[ZipEntryMeta],
    source_len: u64,
    exported: bool,
) -> Result<Vec<PlannedZipEntry>> {
    let plain_text_export = exported || carries_config_folder(entries);
    let mut usable = Vec::new();
    for entry in entries {
        let name = normalize_entry_name(&entry.name);
        // A link is never followed or stored (e.g. `node_modules/.bin`); the
        // rest of the archive still imports.
        if name.is_empty() || is_os_junk(&name) || entry.symlink {
            continue;
        }
        if sevenz_member_name_unsafe(&name) {
            return Err(layout_error("refusing an unsafe zip entry path"));
        }
        if !plain_text_export && is_upriv_store_entry(&name) {
            return Err(layout_error(
                "this .zip is a Upriv vault file, not a folder of documents",
            ));
        }
        usable.push((entry, name));
    }

    let named: Vec<(&ZipEntryMeta, &str)> = usable
        .iter()
        .map(|(entry, name)| (*entry, name.as_str()))
        .collect();
    let root = if exported { None } else { shared_root(&named) };
    let limit = source_len.saturating_mul(FILES_ZIP_EXPAND_FACTOR);
    let mut declared = 0u64;
    let mut seen = HashSet::new();
    let mut planned = Vec::new();
    for (entry, name) in &usable {
        let Some(logical) = strip_root(name, root) else {
            continue;
        };
        match config_member(logical) {
            Some(_) if entry.is_dir => continue,
            Some(ConfigMember::Settings) => {
                planned.push(PlannedZipEntry::Settings { index: entry.index });
                continue;
            }
            Some(ConfigMember::Workspace) => {
                planned.push(PlannedZipEntry::Workspace { index: entry.index });
                continue;
            }
            Some(ConfigMember::Other) => continue,
            None => {}
        }
        if is_skipped_on_import(logical) {
            continue;
        }
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

/// Stage every entry and return the carried layout when `keep_workspace` asks
/// for it. A full wave seals the index, and the tail is sealed once at the end.
/// A returned error still abandons the new vault. A kill keeps the last sealed
/// wave.
fn ingest_planned<R: Read + Seek>(
    root: &VaultRoot,
    vault_id: &str,
    archive: &mut ZipArchive<R>,
    planned: &[PlannedZipEntry],
    source_len: u64,
    keep_workspace: bool,
) -> Result<Option<Zeroizing<Vec<u8>>>> {
    let mut budget = source_len.saturating_mul(FILES_ZIP_EXPAND_FACTOR);
    let mut folders = HashSet::new();
    let mut layout = None;
    for entry in planned {
        match entry {
            PlannedZipEntry::Directory(logical) => {
                fs_ensure_folder_path_staged(root, vault_id, logical, &mut folders)?
            }
            PlannedZipEntry::File { index, logical } => {
                if let Some((parent, _)) = logical.rsplit_once('/') {
                    fs_ensure_folder_path_staged(root, vault_id, parent, &mut folders)?;
                }
                let mut file = archive.by_index(*index).map_err(map_zip_error)?;
                let mut reader = BudgetReader {
                    inner: &mut file,
                    budget,
                };
                fs_write_staged(root, vault_id, &format!("/{logical}"), &mut reader)?;
                budget = reader.budget;
            }
            PlannedZipEntry::Workspace { index } if keep_workspace => {
                let mut file = archive.by_index(*index).map_err(map_zip_error)?;
                let mut reader = BudgetReader {
                    inner: &mut file,
                    budget,
                };
                // The layout is a convenience: a damaged one must not stop the files.
                layout = read_carried_layout(&mut reader).unwrap_or(None);
                budget = reader.budget;
            }
            PlannedZipEntry::Workspace { .. } | PlannedZipEntry::Settings { .. } => {}
        }
        fs_seal_staged_wave(root, vault_id)?;
    }
    fs_seal_staged_imports(root, vault_id)?;
    Ok(layout)
}

fn import_reader<R: Read + Seek>(
    root: &VaultRoot,
    config: VaultConfig,
    new_password: &[u8],
    preset: KdfUnlockPreset,
    reader: R,
    source_len: u64,
    extras: ImportExtras<'_>,
) -> Result<String> {
    if new_password.is_empty() {
        return Err(UprivError::WrongPassword);
    }
    extras.check()?;
    let mut archive = ZipArchive::new(reader).map_err(map_zip_error)?;
    let entries = collect_entries(&mut archive)?;
    let planned = plan_files_zip(&entries, source_len, is_plain_text_export(&archive))?;
    let links = entries.iter().filter(|entry| entry.symlink).count();
    if links > 0 {
        log_event(
            LogLevel::Info,
            "import_symlinks_skipped",
            &[("count", links.to_string().as_str())],
        );
    }
    create_vault(root, config.clone(), new_password, preset)?;
    let id = config.vault.id.trim().to_string();
    let ingest = (|| {
        open_vault_for_ingest(root, &id, new_password)?;
        let layout = ingest_planned(
            root,
            &id,
            &mut archive,
            &planned,
            source_len,
            extras.keep_workspace,
        )?;
        extras.seal(root, &id, layout)
    })();
    if let Err(ingest_error) = ingest {
        return Err(abandon_failed_import(root, &id, ingest_error));
    }
    close_vault(root, &id)?;
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
    extras: ImportExtras<'_>,
) -> Result<String> {
    import_reader(
        root,
        config,
        new_password,
        preset,
        Cursor::new(zip_bytes),
        zip_bytes.len() as u64,
        extras,
    )
}

/// Same import, reading the archive from an absolute path one entry at a time.
pub fn import_logical_files_zip_path(
    root: &VaultRoot,
    config: VaultConfig,
    new_password: &[u8],
    preset: KdfUnlockPreset,
    zip_path: &Path,
    extras: ImportExtras<'_>,
) -> Result<String> {
    if !zip_path.is_absolute() || !zip_path.host_is_file() {
        return Err(UprivError::ImportArchiveNotFound(zip_path.to_path_buf()));
    }
    let file = crate::host_fs::File::open(zip_path)
        .map_err(|error| super::import::map_archive_open_error(zip_path, error))?;
    let len = file.metadata()?.len();
    import_reader(
        root,
        config,
        new_password,
        preset,
        buffered_zip_reader(file)?,
        len,
        extras,
    )
}

#[cfg(test)]
mod tests {
    #[allow(unused_imports)]
    use crate::host_fs::HostFsQuery;
    use std::io::Write;

    use zip::write::FileOptions;
    use zip::{CompressionMethod, ZipWriter};

    use super::*;

    fn plan(entries: &[ZipEntryMeta], source_len: u64) -> Result<Vec<PlannedZipEntry>> {
        plan_files_zip(entries, source_len, false)
    }

    fn classify(entries: &[ZipEntryMeta], source_len: u64) -> Result<ZipImportClass> {
        classify_zip_entries(entries, source_len, false)
    }

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
                PlannedZipEntry::Settings { .. } => "<settings>".to_string(),
                PlannedZipEntry::Workspace { .. } => "<workspace>".to_string(),
            })
            .collect()
    }

    #[test]
    fn strips_one_shared_folder_and_skips_os_junk() {
        let planned = plan(
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
    fn a_zip_of_only_folders_still_has_its_one_outer_folder_removed() {
        let empty_vault = plan(&[meta(0, "Notes/", true, 0)], 100).unwrap();
        assert!(logicals(&empty_vault).is_empty());
        let empty_folders = plan(
            &[
                meta(0, "Notes/", true, 0),
                meta(1, "Notes/docs/", true, 0),
                meta(2, "Notes/docs/blank/", true, 0),
            ],
            100,
        )
        .unwrap();
        assert_eq!(
            logicals(&empty_folders),
            vec!["docs".to_string(), "docs/blank".to_string()]
        );
    }

    #[test]
    fn the_config_folder_is_read_only_at_the_vault_root() {
        let planned = plan(
            &[
                meta(0, "Notes/.upriv-config/", true, 0),
                meta(1, "Notes/.upriv-config/config.toml", false, 5),
                meta(2, "Notes/.upriv-config/workspace.json", false, 5),
                meta(3, "Notes/.upriv-config/README.md", false, 5),
                meta(4, "Notes/.upriv-config/unknown.txt", false, 5),
                meta(5, "Notes/docs/.upriv-config/config.toml", false, 5),
                meta(6, "Notes/docs/hi.txt", false, 5),
            ],
            100,
        )
        .unwrap();
        assert_eq!(
            logicals(&planned),
            vec![
                "<settings>".to_string(),
                "<workspace>".to_string(),
                "docs/hi.txt".to_string()
            ]
        );
    }

    #[test]
    fn a_vault_copy_inside_a_plain_text_export_is_a_document() {
        let entries = [
            meta(0, "Notes/.upriv-config/README.md", false, 5),
            meta(1, "Notes/store/header/vault.header", false, 5),
        ];
        assert_eq!(classify(&entries, 100).unwrap(), ZipImportClass::Files);
        assert_eq!(
            logicals(&plan(&entries, 100).unwrap()),
            vec!["store/header/vault.header".to_string()]
        );
        let deeper = [meta(0, "Notes/backups/store/header/vault.header", false, 5)];
        assert_eq!(classify(&deeper, 100).unwrap(), ZipImportClass::Files);
    }

    #[test]
    fn keeps_a_flat_zip() {
        let planned = plan(
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
            classify(&[meta(0, "store/header/vault.header", false, 4)], 100).unwrap(),
            ZipImportClass::Store
        );
        assert_eq!(
            classify(&[meta(0, "Notes/docs/hi.txt", false, 4)], 100).unwrap(),
            ZipImportClass::Files
        );
        assert_eq!(
            classify(
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
            classify(&[meta(0, "Notes/store/header/vault.header", false, 4)], 100).unwrap(),
            ZipImportClass::Store
        );
        assert_eq!(
            classify(&[meta(0, "notes/vault.header", false, 4)], 100).unwrap(),
            ZipImportClass::Files
        );
        assert_eq!(
            classify(&[meta(0, "header/vault.header", false, 4)], 100).unwrap(),
            ZipImportClass::Files
        );
    }

    #[test]
    fn refuses_a_upriv_store_zip() {
        let err = plan(&[meta(0, "store/header/vault.header", false, 4)], 100).unwrap_err();
        assert!(matches!(err, UprivError::VaultStoreInvalid { .. }));
    }

    #[test]
    fn refuses_traversal_reserved_names_and_expansion() {
        assert!(plan(&[meta(0, "Notes/../secret.txt", false, 1)], 100).is_err());
        assert!(plan(&[meta(0, ".upriv-workspace.json", false, 1)], 100).is_err());
        assert!(plan(&[meta(0, "upriv-seed.txt", false, 1)], 100).is_err());
        assert!(plan(&[meta(0, "docs/.upriv-workspace.json", false, 1)], 100).is_err());
        assert!(plan(&[meta(0, "big.txt", false, 10_000)], 10).is_err());
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
            ImportExtras::default(),
        )
        .unwrap_err();
        assert!(matches!(err, UprivError::VaultStoreInvalid { .. }));
        assert!(!root.vault_dir("notes").unwrap().host_exists());

        import_logical_files_zip(
            &root,
            config,
            b"pass-word-ok",
            KdfUnlockPreset::M32,
            &bytes,
            ImportExtras::default(),
        )
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
        crate::close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn symlink_entries_are_skipped_and_the_rest_imports() {
        let (_tmp, root) = crate::test_support::vault_root_with(&[]);
        let config: VaultConfig = toml::from_str(
            "[vault]\nid = \"notes\"\ndisplay_name = \"Notes\"\norder = 1\n[storage]\nmode = \"encrypted_dir\"\n",
        )
        .expect("config");
        let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
        zip.start_file("app/index.js", stored_options()).unwrap();
        zip.write_all(b"console.log(1)").unwrap();
        zip.add_symlink(
            "app/node_modules/.bin/tsc",
            "../typescript/bin/tsc",
            stored_options(),
        )
        .unwrap();
        zip.add_symlink("app/escape", "/etc/passwd", stored_options())
            .unwrap();
        let bytes = zip.finish().unwrap().into_inner();

        assert_eq!(
            probe_import_zip_bytes(&bytes).unwrap().class,
            ZipImportClass::Files
        );
        import_logical_files_zip(
            &root,
            config,
            b"pass-word-ok",
            KdfUnlockPreset::M32,
            &bytes,
            ImportExtras::default(),
        )
        .unwrap();
        crate::open_vault(&root, "notes", b"pass-word-ok").unwrap();
        assert_eq!(
            crate::vault::fs::fs_read_file(&root, "notes", "/index.js").unwrap(),
            b"console.log(1)"
        );
        let json = serde_json::to_string(&crate::vault::fs::fs_list_tree(&root, "notes").unwrap())
            .unwrap();
        assert!(!json.contains("tsc"), "{json}");
        assert!(!json.contains("escape"), "{json}");
        crate::close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn welcome_readme_is_added_only_when_the_root_has_none() {
        let (_tmp, root) = crate::test_support::vault_root_with(&[]);
        let config = |id: &str| -> VaultConfig {
            toml::from_str(&format!(
                "[vault]\nid = \"{id}\"\ndisplay_name = \"{id}\"\norder = 1\n[storage]\nmode = \"encrypted_dir\"\n"
            ))
            .expect("config")
        };
        let welcome = crate::vault::VaultWelcome {
            readme: "# Welcome\n",
            workspace: "{\"format_version\":1}\n",
        };

        let docs = zip_with(&[("Notes/docs/hi.txt", b"hello")]);
        import_logical_files_zip(
            &root,
            config("plain"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
            &docs,
            ImportExtras {
                welcome: Some(welcome),
                keep_workspace: false,
            },
        )
        .unwrap();
        crate::open_vault(&root, "plain", b"pass-word-ok").unwrap();
        let readme = crate::vault::fs::fs_read_file(&root, "plain", "/README.md").unwrap();
        assert_eq!(readme, b"# Welcome\n");
        let layout =
            crate::vault::fs::fs_read_file(&root, "plain", "/.upriv-workspace.json").unwrap();
        assert_eq!(layout, welcome.workspace.as_bytes());
        crate::close_vault(&root, "plain").unwrap();

        let has_readme = zip_with(&[("Notes/readme.md", b"mine")]);
        import_logical_files_zip(
            &root,
            config("own"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
            &has_readme,
            ImportExtras {
                welcome: Some(welcome),
                keep_workspace: false,
            },
        )
        .unwrap();
        crate::open_vault(&root, "own", b"pass-word-ok").unwrap();
        let listed = crate::vault::fs::fs_list_tree(&root, "own").unwrap();
        let json = serde_json::to_string(&listed).unwrap();
        assert!(!json.contains("README.md"), "{json}");
        assert_eq!(
            crate::vault::fs::fs_read_file(&root, "own", "/readme.md").unwrap(),
            b"mine"
        );
        assert!(
            crate::vault::fs::fs_read_file(&root, "own", "/.upriv-workspace.json")
                .unwrap()
                .is_empty()
        );
        crate::close_vault(&root, "own").unwrap();
    }
}
