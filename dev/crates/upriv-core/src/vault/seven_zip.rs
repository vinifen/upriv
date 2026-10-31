//! Logical `.7z` **import**: decode members in process, never a plaintext
//! tree on ordinary disk. Export packing lives in `seven_zip_pack` (same crate).
//!
//! A path is streamed from the file. In-memory bytes are only the mobile/RPC
//! payload. Members stream into `store/` in waves. Each full wave seals the
//! index; the tail is sealed after the last member.
//! Plaintext is capped at 64 times the archive length, the same factor as a
//! files zip. `.upriv-config/` beside the vault's files is optional: an export
//! writes it as the archive's first block, so a password test reads the
//! settings without decoding a vault file.

use crate::host_fs::File;
use std::collections::HashSet;
use std::io::{BufReader, Cursor, ErrorKind, Read, Seek};
use std::path::{Path, PathBuf};

use sevenz_rust2::{ArchiveEntry, ArchiveReader};
use zeroize::Zeroizing;

use crate::config::VaultConfig;
use crate::error::{Result, UprivError};
use crate::logging::{log_event, LogLevel};
use crate::paths::VaultRoot;
use crate::store::{is_reserved_logical, is_skipped_on_import, KdfUnlockPreset};

use super::config_folder::{
    config_member, read_carried_layout, read_carried_settings, ConfigMember, ImportExtras,
};
use super::create::create_vault;
use super::embedded_settings::EmbeddedVaultSettings;
use super::files_zip::FILES_ZIP_EXPAND_FACTOR;
use super::fs::{
    fs_ensure_folder_path_staged, fs_seal_staged_imports, fs_seal_staged_wave, fs_write_staged,
};
use super::open_close::{abandon_failed_import, close_vault, open_vault_for_ingest};
use super::seven_zip_pack::{seven_zip_decode_threads, sevenz_member_name_unsafe, sevenz_password};

const ARCHIVE_READ_BUFFER: usize = 1024 * 1024;

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
    let threads = seven_zip_decode_threads()?;
    let password = sevenz_password(archive_password)?;
    let mut reader = ArchiveReader::new(reader, password).map_err(map_sevenz_read_error)?;
    reader.set_thread_count(threads);
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

fn open_archive_path(
    path: &Path,
    archive_password: &[u8],
) -> Result<(ArchiveReader<BufReader<File>>, u64)> {
    if !path.is_absolute() {
        return Err(UprivError::ImportArchiveNotFound(path.to_path_buf()));
    }
    let file = crate::paths::open_nofollow(path, crate::paths::NofollowMode::Read)
        .map_err(|error| super::import::map_archive_open_error(path, error))?;
    let len = file.metadata()?.len();
    // The AES decoder asks for 512 bytes at a time, and a storage-access file
    // pays for each read.
    let buffered = BufReader::with_capacity(ARCHIVE_READ_BUFFER, file);
    let reader = open_prepared_reader(buffered, archive_password, len)?;
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
    /// `.upriv-config/config.toml`.
    Settings,
    /// `.upriv-config/workspace.json`.
    Workspace,
    /// A file that is not vault data: the rest of `.upriv-config/`, or a
    /// plaintext-folder marker.
    Skipped,
}

fn archive_layout_error(detail: impl Into<String>) -> UprivError {
    UprivError::VaultStoreInvalid {
        path: PathBuf::from("7z"),
        detail: detail.into(),
    }
}

/// One outer folder. Every document sits directly under it, beside an optional
/// `.upriv-config/`.
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
    match config_member(&logical) {
        Some(ConfigMember::Settings) => return Ok(ArchiveMember::Settings),
        Some(ConfigMember::Workspace) => return Ok(ArchiveMember::Workspace),
        Some(ConfigMember::Other) => return Ok(ArchiveMember::Skipped),
        None => {}
    }
    if is_skipped_on_import(&logical) {
        return Ok(ArchiveMember::Skipped);
    }
    if is_reserved_logical(&logical) {
        return Err(archive_layout_error("reserved internal file in .7z"));
    }
    Ok(ArchiveMember::File(logical))
}

fn budget_exceeded() -> UprivError {
    archive_layout_error("7z expanded plaintext exceeds the archive budget")
}

/// One import walking the archive's members into a new vault.
struct MemberIngest<'a> {
    root: &'a VaultRoot,
    vault_id: &'a str,
    keep_workspace: bool,
    outer: Option<String>,
    budget: u64,
    folders: HashSet<String>,
    /// The carried file-manager layout, when `keep_workspace` asked for it.
    layout: Option<Zeroizing<Vec<u8>>>,
}

impl MemberIngest<'_> {
    /// Stages the member. The caller seals each full wave, then the tail.
    /// Every member's bytes are read through: the decoder reads them in order.
    fn ingest(&mut self, entry: &ArchiveEntry, payload: &mut dyn Read) -> Result<()> {
        let member = classify_archive_member(entry, &mut self.outer)?;
        match &member {
            ArchiveMember::Directory(None) => return Ok(()),
            ArchiveMember::Directory(Some(logical)) if is_reserved_logical(logical) => {
                return Ok(());
            }
            ArchiveMember::Directory(Some(logical)) => {
                return fs_ensure_folder_path_staged(
                    self.root,
                    self.vault_id,
                    logical,
                    &mut self.folders,
                );
            }
            _ => {}
        }
        if entry.size > self.budget {
            return Err(budget_exceeded());
        }
        let mut limited = BudgetReader {
            inner: payload,
            budget: self.budget,
        };
        match member {
            ArchiveMember::File(logical) => {
                if let Some((parent, _)) = logical.rsplit_once('/') {
                    fs_ensure_folder_path_staged(
                        self.root,
                        self.vault_id,
                        parent,
                        &mut self.folders,
                    )?;
                }
                let path = format!("/{logical}");
                fs_write_staged(self.root, self.vault_id, &path, &mut limited)?;
            }
            ArchiveMember::Workspace if self.keep_workspace => {
                self.layout = read_carried_layout(&mut limited)?;
            }
            _ => {
                std::io::copy(&mut limited, &mut std::io::sink())?;
            }
        }
        self.budget = limited.budget;
        Ok(())
    }
}

/// Password check, and the settings the archive carries.
///
/// A wrong password fails even when the header is not encrypted: `config.toml`
/// is read to its end, so its checksum is checked, or else one byte of the first
/// file is decoded. An archive that is only the outer folder succeeds after that
/// directory is classified. Only the first member is read, so no vault file is
/// decoded for the settings.
fn probe_reader<R: Read + Seek>(
    reader: &mut ArchiveReader<R>,
    archive_len: u64,
) -> Result<Option<EmbeddedVaultSettings>> {
    let budget = plaintext_budget(archive_len);
    let mut outer = None;
    let mut settings = None;
    let mut layout_error: Option<UprivError> = None;
    reader
        .for_each_entries(|entry, payload| {
            if layout_error.is_some() {
                return Ok(false);
            }
            match classify_archive_member(entry, &mut outer) {
                Ok(ArchiveMember::Directory(_)) => Ok(true),
                Ok(ArchiveMember::Settings) => {
                    settings = read_carried_settings(payload)?;
                    Ok(false)
                }
                Ok(ArchiveMember::File(_) | ArchiveMember::Workspace | ArchiveMember::Skipped) => {
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
    Ok(settings)
}

/// Password check of a `.7z` in memory, and the settings it carries.
pub fn probe_logical_seven_zip(
    archive_bytes: &[u8],
    archive_password: &[u8],
) -> Result<Option<EmbeddedVaultSettings>> {
    let mut reader = open_archive_reader(archive_bytes, archive_password)?;
    probe_reader(&mut reader, archive_bytes.len() as u64)
}

/// Password check of a `.7z` file, and the settings it carries. The compressed
/// bytes stay on disk.
pub fn probe_logical_seven_zip_path(
    path: &Path,
    archive_password: &[u8],
) -> Result<Option<EmbeddedVaultSettings>> {
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
    extras: ImportExtras<'_>,
) -> Result<String> {
    if new_password.is_empty() {
        return Err(UprivError::WrongPassword);
    }
    extras.check()?;
    create_vault(root, config.clone(), new_password, preset)?;
    let id = config.vault.id.trim().to_string();
    let ingest = (|| {
        open_vault_for_ingest(root, &id, new_password)?;
        let mut members = MemberIngest {
            root,
            vault_id: &id,
            keep_workspace: extras.keep_workspace,
            outer: None,
            budget: plaintext_budget(archive_len),
            folders: HashSet::new(),
            layout: None,
        };
        let mut write_error: Option<UprivError> = None;
        reader
            .for_each_entries(|entry, payload| {
                if write_error.is_some() {
                    return Ok(false);
                }
                match members.ingest(entry, payload) {
                    Ok(()) => match fs_seal_staged_wave(root, &id) {
                        Ok(()) => Ok(true),
                        Err(error) => {
                            write_error = Some(error);
                            Ok(false)
                        }
                    },
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
        if members.outer.is_none() {
            return Err(archive_layout_error("missing .7z outer folder"));
        }
        fs_seal_staged_imports(root, &id)?;
        extras.seal(root, &id, members.layout)
    })();
    if let Err(ingest_error) = ingest {
        return Err(abandon_failed_import(root, &id, ingest_error));
    }
    close_vault(root, &id)?;
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
    extras: ImportExtras<'_>,
) -> Result<String> {
    let reader = open_archive_reader(archive_bytes, archive_password)?;
    import_reader(
        root,
        config,
        new_password,
        preset,
        reader,
        archive_bytes.len() as u64,
        extras,
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
    extras: ImportExtras<'_>,
) -> Result<String> {
    let (reader, len) = open_archive_path(archive_path, archive_password)?;
    import_reader(root, config, new_password, preset, reader, len, extras)
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

        let mut carried = ArchiveEntry::new();
        carried.name = "Notes/.upriv-config/config.toml".into();
        assert!(matches!(
            classify_archive_member(&carried, &mut outer).unwrap(),
            ArchiveMember::Settings
        ));
        carried.name = "Notes/.upriv-config/workspace.json".into();
        assert!(matches!(
            classify_archive_member(&carried, &mut outer).unwrap(),
            ArchiveMember::Workspace
        ));
        carried.name = "Notes/.upriv-config/README.md".into();
        assert!(matches!(
            classify_archive_member(&carried, &mut outer).unwrap(),
            ArchiveMember::Skipped
        ));
        carried.name = "Notes/docs/.upriv-config/config.toml".into();
        assert!(matches!(
            classify_archive_member(&carried, &mut outer).unwrap(),
            ArchiveMember::Skipped
        ));

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
        let err = crate::vault::fs::fs_ensure_folder_path_staged(
            &root,
            "notes",
            "docs",
            &mut HashSet::new(),
        )
        .unwrap_err();
        assert!(matches!(err, UprivError::VaultPathExists(_)));
        close_vault(&root, "notes").unwrap();
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
