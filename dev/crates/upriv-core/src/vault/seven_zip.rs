//! Logical `.7z` **import**: decode members in process, never a plaintext
//! tree on ordinary disk. Export packing lives in `seven_zip_pack` (same crate).
//!
//! A path is streamed from the file. In-memory bytes are only the mobile/RPC
//! payload. Members stream into `store/` through `fs_write_from_reader`.
//! Plaintext is capped at 64 times the archive length, the same factor as a
//! files zip.

use std::fs::File;
use std::io::{Cursor, ErrorKind, Read, Seek};
use std::path::{Path, PathBuf};

use sevenz_rust2::{ArchiveEntry, ArchiveReader};

use crate::config::VaultConfig;
use crate::error::{Result, UprivError};
use crate::logging::{log_event, LogLevel};
use crate::paths::VaultRoot;
use crate::store::{file_name, KdfUnlockPreset, INTERNAL_WORKSPACE_FILE, SEED_LOGICAL_PATH};

use super::create::create_vault;
use super::files_zip::FILES_ZIP_EXPAND_FACTOR;
use super::fs::{fs_ensure_folder, fs_write_from_reader};
use super::open_close::{abandon_failed_import, close_vault, open_vault_for_ingest};
use super::seven_zip_pack::{
    ensure_seven_zip_export_ram, seven_zip_import_ram_needed, sevenz_member_name_unsafe,
    sevenz_password,
};

fn map_sevenz_read_error(error: sevenz_rust2::Error) -> UprivError {
    match error {
        sevenz_rust2::Error::PasswordRequired
        | sevenz_rust2::Error::MaybeBadPassword(_)
        | sevenz_rust2::Error::ChecksumVerificationFailed
        | sevenz_rust2::Error::NextHeaderCrcMismatch => UprivError::WrongPassword,
        other => UprivError::VaultStoreInvalid {
            path: PathBuf::from("7z"),
            detail: other.to_string(),
        },
    }
}

fn plaintext_budget(archive_len: u64) -> u64 {
    archive_len.saturating_mul(FILES_ZIP_EXPAND_FACTOR)
}

fn open_prepared_reader<R: Read + Seek>(
    reader: R,
    archive_password: &[u8],
    archive_len: u64,
) -> Result<ArchiveReader<R>> {
    ensure_seven_zip_export_ram(seven_zip_import_ram_needed())?;
    let password = sevenz_password(archive_password)?;
    let mut reader = ArchiveReader::new(reader, password).map_err(map_sevenz_read_error)?;
    reader.set_thread_count(1);
    let budget = plaintext_budget(archive_len);
    if reader
        .archive()
        .blocks
        .iter()
        .any(|block| block.get_unpack_size() > budget)
    {
        return Err(budget_exceeded());
    }
    Ok(reader)
}

fn open_archive_reader<'a>(
    archive_bytes: &'a [u8],
    archive_password: &[u8],
) -> Result<ArchiveReader<Cursor<&'a [u8]>>> {
    open_prepared_reader(
        Cursor::new(archive_bytes),
        archive_password,
        archive_bytes.len() as u64,
    )
}

fn open_archive_path(path: &Path, archive_password: &[u8]) -> Result<(ArchiveReader<File>, u64)> {
    if !path.is_absolute() {
        return Err(UprivError::ImportArchiveNotFound(path.to_path_buf()));
    }
    let file = crate::paths::open_nofollow(path, crate::paths::NofollowMode::Read)
        .map_err(|error| super::import::map_archive_open_error(path, error))?;
    let len = file.metadata()?.len();
    let reader = open_prepared_reader(file, archive_password, len)?;
    Ok((reader, len))
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
                "7z expanded plaintext exceeds the archive budget",
            ));
        }
        let max = buf.len().min(self.budget as usize);
        let n = self.inner.read(&mut buf[..max])?;
        self.budget = self.budget.saturating_sub(n as u64);
        Ok(n)
    }
}

fn normalize_member_name(name: &str) -> String {
    name.replace('\\', "/").trim_start_matches('/').to_string()
}

#[derive(Debug)]
enum ArchiveMember {
    /// `None` is the outer folder. `Some` is a vault folder under it.
    Directory(Option<String>),
    /// Logical path with the outer folder removed.
    File(String),
}

fn archive_layout_error(detail: impl Into<String>) -> UprivError {
    UprivError::VaultStoreInvalid {
        path: PathBuf::from("7z"),
        detail: detail.into(),
    }
}

/// One outer folder. Every document sits directly under it. A `.7z` is documents
/// only: it does not carry the store-zip `README.md` envelope.
fn classify_archive_member(
    entry: &ArchiveEntry,
    outer: &mut Option<String>,
) -> Result<ArchiveMember> {
    if entry.is_anti_item {
        return Err(archive_layout_error("refusing a .7z anti-item"));
    }
    let name = normalize_member_name(&entry.name);
    if sevenz_member_name_unsafe(&name) {
        return Err(archive_layout_error("refusing an unsafe .7z member path"));
    }
    let parts: Vec<&str> = name.split('/').filter(|part| !part.is_empty()).collect();
    let Some(folder) = parts.first().copied() else {
        return Err(archive_layout_error("missing .7z outer folder"));
    };
    match outer {
        Some(current) if current != folder => {
            return Err(archive_layout_error(
                "a .7z must contain exactly one top folder",
            ));
        }
        None => *outer = Some(folder.to_string()),
        Some(_) => {}
    }
    if parts.len() == 1 {
        if entry.is_directory {
            return Ok(ArchiveMember::Directory(None));
        }
        return Err(archive_layout_error(
            "a file must sit under the outer folder",
        ));
    }
    if entry.is_directory {
        return Ok(ArchiveMember::Directory(Some(parts[1..].join("/"))));
    }
    let logical = parts[1..].join("/");
    if logical == SEED_LOGICAL_PATH || file_name(&logical) == INTERNAL_WORKSPACE_FILE {
        return Err(archive_layout_error("reserved internal file in .7z"));
    }
    Ok(ArchiveMember::File(logical))
}

fn logical_is_reserved(logical: &str) -> bool {
    logical == SEED_LOGICAL_PATH || file_name(logical) == INTERNAL_WORKSPACE_FILE
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

fn ensure_parent_dirs(root: &VaultRoot, vault_id: &str, logical: &str) -> Result<()> {
    let parts: Vec<&str> = logical.split('/').filter(|part| !part.is_empty()).collect();
    if parts.len() < 2 {
        return Ok(());
    }
    let mut parent_ui = "/".to_string();
    for part in &parts[..parts.len() - 1] {
        let (created, _) = fs_ensure_folder(root, vault_id, &parent_ui, part)?;
        parent_ui = created;
    }
    Ok(())
}

fn budget_exceeded() -> UprivError {
    archive_layout_error("7z expanded plaintext exceeds the archive budget")
}

fn ingest_archive_member(
    root: &VaultRoot,
    vault_id: &str,
    entry: &ArchiveEntry,
    payload: &mut dyn Read,
    outer: &mut Option<String>,
    budget: &mut u64,
) -> Result<()> {
    match classify_archive_member(entry, outer)? {
        ArchiveMember::Directory(None) => Ok(()),
        ArchiveMember::Directory(Some(logical)) if logical_is_reserved(&logical) => Ok(()),
        ArchiveMember::Directory(Some(logical)) => ensure_folder_path(root, vault_id, &logical),
        ArchiveMember::File(logical) => {
            if entry.size > *budget {
                return Err(budget_exceeded());
            }
            ensure_parent_dirs(root, vault_id, &logical)?;
            let mut limited = BudgetReader {
                inner: payload,
                budget: *budget,
            };
            fs_write_from_reader(root, vault_id, &format!("/{logical}"), &mut limited)?;
            *budget = limited.budget;
            Ok(())
        }
    }
}

/// Password check. A `.7z` has no settings member.
///
/// A wrong password fails even when the header is not encrypted: one byte of
/// the first user file is decoded. An archive that is only the outer folder
/// succeeds after that directory is classified.
fn probe_reader<R: Read + Seek>(reader: &mut ArchiveReader<R>, archive_len: u64) -> Result<()> {
    let budget = plaintext_budget(archive_len);
    let mut outer = None;
    let mut layout_error: Option<UprivError> = None;
    reader
        .for_each_entries(|entry, payload| {
            if layout_error.is_some() {
                return Ok(false);
            }
            match classify_archive_member(entry, &mut outer) {
                Ok(ArchiveMember::Directory(_)) => Ok(true),
                Ok(ArchiveMember::File(_)) => {
                    if entry.size > budget {
                        layout_error = Some(budget_exceeded());
                        return Ok(false);
                    }
                    let mut limited = BudgetReader {
                        inner: payload,
                        budget,
                    };
                    if let Err(error) =
                        std::io::copy(&mut (&mut limited).take(1), &mut std::io::sink())
                    {
                        layout_error = Some(error.into());
                        return Ok(false);
                    }
                    Ok(false)
                }
                Err(error) => {
                    layout_error = Some(error);
                    Ok(false)
                }
            }
        })
        .map_err(map_sevenz_read_error)?;
    if let Some(error) = layout_error {
        return Err(error);
    }
    if outer.is_none() {
        return Err(archive_layout_error("missing .7z outer folder"));
    }
    Ok(())
}

/// Password check. A `.7z` has no settings member.
///
/// A wrong password fails even when the header is not encrypted: one byte of
/// the first user file is decoded. An archive that is only the outer folder
/// succeeds after that directory is classified.
pub fn probe_logical_seven_zip(archive_bytes: &[u8], archive_password: &[u8]) -> Result<()> {
    let mut reader = open_archive_reader(archive_bytes, archive_password)?;
    probe_reader(&mut reader, archive_bytes.len() as u64)
}

/// Password check of a `.7z` file. The compressed bytes stay on disk.
pub fn probe_logical_seven_zip_path(path: &Path, archive_password: &[u8]) -> Result<()> {
    let (mut reader, len) = open_archive_path(path, archive_password)?;
    probe_reader(&mut reader, len)
}

fn import_reader<R: Read + Seek>(
    root: &VaultRoot,
    config: VaultConfig,
    new_password: &[u8],
    preset: KdfUnlockPreset,
    mut reader: ArchiveReader<R>,
    archive_len: u64,
) -> Result<String> {
    if new_password.is_empty() {
        return Err(UprivError::WrongPassword);
    }
    create_vault(root, config.clone(), new_password, preset)?;
    let id = config.vault.id.trim().to_string();
    let ingest = (|| {
        open_vault_for_ingest(root, &id, new_password)?;
        let mut budget = plaintext_budget(archive_len);
        let mut write_error: Option<UprivError> = None;
        let mut outer = None;
        reader
            .for_each_entries(|entry, payload| {
                if write_error.is_some() {
                    return Ok(false);
                }
                match ingest_archive_member(root, &id, entry, payload, &mut outer, &mut budget) {
                    Ok(()) => Ok(true),
                    Err(error) => {
                        write_error = Some(error);
                        Ok(false)
                    }
                }
            })
            .map_err(map_sevenz_read_error)?;
        if let Some(error) = write_error {
            return Err(error);
        }
        if outer.is_none() {
            return Err(archive_layout_error("missing .7z outer folder"));
        }
        Ok(())
    })();
    if let Err(ingest_error) = ingest {
        return Err(abandon_failed_import(root, &id, ingest_error));
    }
    close_vault(root, &id, Some(new_password))?;
    log_event(LogLevel::Info, "vault_imported", &[("id", id.as_str())]);
    Ok(id)
}

/// Create a new vault and stream logical files from a `.7z` into `store/`.
pub fn import_logical_seven_zip(
    root: &VaultRoot,
    config: VaultConfig,
    new_password: &[u8],
    preset: KdfUnlockPreset,
    archive_bytes: &[u8],
    archive_password: &[u8],
) -> Result<String> {
    let reader = open_archive_reader(archive_bytes, archive_password)?;
    import_reader(
        root,
        config,
        new_password,
        preset,
        reader,
        archive_bytes.len() as u64,
    )
}

/// Create a new vault from a `.7z` path. The archive is not loaded into a `Vec`.
pub fn import_logical_seven_zip_path(
    root: &VaultRoot,
    config: VaultConfig,
    new_password: &[u8],
    preset: KdfUnlockPreset,
    archive_path: &Path,
    archive_password: &[u8],
) -> Result<String> {
    let (reader, len) = open_archive_path(archive_path, archive_password)?;
    import_reader(root, config, new_password, preset, reader, len)
}

#[cfg(test)]
mod import_mem_tests {
    use super::*;
    use crate::open_vault;

    #[test]
    fn classifies_the_outer_folder_layout() {
        let mut outer = None;
        let mut settings = ArchiveEntry::new();
        settings.name = "Notes/config.toml".into();
        match classify_archive_member(&settings, &mut outer).unwrap() {
            ArchiveMember::File(logical) => assert_eq!(logical, "config.toml"),
            other => panic!("expected a file, got {other:?}"),
        }

        let mut doc = ArchiveEntry::new();
        doc.name = "Notes/docs/hi.txt".into();
        match classify_archive_member(&doc, &mut outer).unwrap() {
            ArchiveMember::File(logical) => assert_eq!(logical, "docs/hi.txt"),
            other => panic!("expected a file, got {other:?}"),
        }

        let mut nested_layout = ArchiveEntry::new();
        nested_layout.name = "Notes/docs/.upriv-workspace.json".into();
        assert!(classify_archive_member(&nested_layout, &mut outer).is_err());

        let mut layout = ArchiveEntry::new();
        layout.name = "Notes/.upriv-workspace.json".into();
        assert!(classify_archive_member(&layout, &mut outer).is_err());

        let mut second = ArchiveEntry::new();
        second.name = "Other/notes.txt".into();
        assert!(classify_archive_member(&second, &mut outer).is_err());

        let mut traversal = ArchiveEntry::new();
        traversal.name = "Notes/../secret.txt".into();
        assert!(classify_archive_member(&traversal, &mut None).is_err());
    }

    #[test]
    fn file_node_is_not_treated_as_a_parent_directory() {
        let (_tmp, root) = crate::test_support::vault_root_with(&[]);
        let config = toml::from_str(
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
        create_vault(&root, config, b"pass-word-ok", KdfUnlockPreset::M32).unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        crate::vault::fs::fs_create_named_file(&root, "notes", "/", "docs").unwrap();
        let err = ensure_parent_dirs(&root, "notes", "docs/a.txt").unwrap_err();
        assert!(matches!(err, UprivError::VaultPathExists(_)));
        close_vault(&root, "notes", None).unwrap();
    }

    #[test]
    fn probe_rejects_empty_password() {
        let err = probe_logical_seven_zip(b"7z\xbc\xaf'\x1c", b"").unwrap_err();
        assert!(matches!(err, UprivError::WrongPassword));
    }

    #[test]
    fn plaintext_budget_stops_at_the_cap_and_allows_eof() {
        let mut exact = BudgetReader {
            inner: &b"abc"[..],
            budget: 3,
        };
        let mut got = Vec::new();
        std::io::Read::read_to_end(&mut exact, &mut got).unwrap();
        assert_eq!(got, b"abc");

        let mut over = BudgetReader {
            inner: &b"abcd"[..],
            budget: 3,
        };
        let mut got = Vec::new();
        let err = std::io::Read::read_to_end(&mut over, &mut got).unwrap_err();
        assert_eq!(err.kind(), ErrorKind::InvalidData);
        assert_eq!(got, b"abc");
    }
}
