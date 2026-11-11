//! Logical `.7z` **import**: decode members in process, never a plaintext
//! tree on ordinary disk. Export packing lives in `seven_zip_pack` (same crate).
//!
//! A path is streamed from the file. In-memory bytes are only the mobile/RPC
//! payload. Members stream into `store/` in waves. Each full wave seals the
//! index; the tail is sealed after the last member.
//! Plaintext is capped at 64 times the archive length, the same factor as a
//! files zip. `.upriv-config/` beside the vault folder is optional: an export
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
use crate::paths::VaultRoot;
use crate::session::{Job, JobKind, ProgressReader};
use crate::store::{is_reserved_logical, is_skipped_on_import, KdfUnlockPreset};

use super::config_folder::{
    config_member, read_carried_layout, read_carried_settings, ConfigMember, ImportExtras,
};
use super::embedded_settings::EmbeddedVaultSettings;
use super::files_zip::FILES_ZIP_EXPAND_FACTOR;
use super::fs::{
    fs_ensure_folder_path_staged, fs_seal_staged_imports, fs_seal_staged_wave, fs_write_staged,
};
use super::import_job::fill_new_vault;
use super::package::{imported_vault_name, Package, PackageWalk, Placed};
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

/// The archive in memory, read through `job`: a stop fails the next read.
fn open_archive_reader<'a, 'j>(
    archive_bytes: &'a [u8],
    archive_password: &[u8],
    job: &'j Job,
) -> Result<ArchiveReader<ProgressReader<'j, Cursor<&'a [u8]>>>> {
    let len = archive_bytes.len() as u64;
    job.set_total(len);
    open_prepared_reader(
        job.progress_reader(Cursor::new(archive_bytes)),
        archive_password,
        len,
    )
}

/// The archive at `path`, read through `job`: a stop fails the next read.
fn open_archive_path<'j>(
    path: &Path,
    archive_password: &[u8],
    job: &'j Job,
) -> Result<(ArchiveReader<ProgressReader<'j, BufReader<File>>>, u64)> {
    if !path.is_absolute() {
        return Err(UprivError::ImportArchiveNotFound(path.to_path_buf()));
    }
    let file = crate::paths::open_nofollow(path, crate::paths::NofollowMode::Read)
        .map_err(|error| super::import::map_archive_open_error(path, error))?;
    let len = file.metadata()?.len();
    job.set_total(len);
    // The AES decoder asks for 512 bytes at a time, and a storage-access file
    // pays for each read.
    let buffered = BufReader::with_capacity(ARCHIVE_READ_BUFFER, file);
    let reader = open_prepared_reader(job.progress_reader(buffered), archive_password, len)?;
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
    /// `None` is one of the package's folders. `Some` is a vault folder.
    Directory(Option<String>),
    /// Logical path under the package's vault folder.
    File(String),
    /// `config.toml` of `.upriv-config/`, beside the vault folder.
    Settings,
    /// `workspace.json` of `.upriv-config/`.
    Workspace,
    /// A file that is not vault data: the rest of `.upriv-config/`, or a
    /// name a vault never holds.
    Skipped,
}

fn archive_layout_error(detail: impl Into<String>) -> UprivError {
    UprivError::VaultStoreInvalid {
        path: PathBuf::from("7z"),
        detail: detail.into(),
    }
}

/// The package (`super::package`): one folder holding the vault folder, with
/// the vault's documents, and an optional `.upriv-config/` beside it.
fn classify_archive_member(entry: &ArchiveEntry, walk: &mut PackageWalk) -> Result<ArchiveMember> {
    if entry.is_anti_item {
        return Err(archive_layout_error("refusing a .7z anti-item"));
    }
    let name = normalize_member_name(&entry.name);
    if sevenz_member_name_unsafe(&name) {
        return Err(archive_layout_error("refusing an unsafe .7z member path"));
    }
    let logical = match walk.place(&name, entry.is_directory) {
        Ok(Placed::Vault(logical)) => logical,
        Ok(Placed::Folder) => return Ok(ArchiveMember::Directory(None)),
        Ok(Placed::Config(_)) if entry.is_directory => return Ok(ArchiveMember::Directory(None)),
        Ok(Placed::Config(file)) => {
            return Ok(match config_member(&file) {
                ConfigMember::Settings => ArchiveMember::Settings,
                ConfigMember::Workspace => ArchiveMember::Workspace,
                ConfigMember::Other => ArchiveMember::Skipped,
            });
        }
        Err(detail) => return Err(archive_layout_error(detail)),
    };
    if entry.is_directory {
        return Ok(ArchiveMember::Directory(Some(logical)));
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
    walk: PackageWalk,
    budget: u64,
    folders: HashSet<String>,
    /// The carried file-manager layout, when `keep_workspace` asked for it.
    layout: Option<Zeroizing<Vec<u8>>>,
}

impl MemberIngest<'_> {
    /// Stages the member. The caller seals each full wave, then the tail.
    /// Every member's bytes are read through: the decoder reads them in order.
    fn ingest(&mut self, entry: &ArchiveEntry, payload: &mut dyn Read) -> Result<()> {
        let member = classify_archive_member(entry, &mut self.walk)?;
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

/// What a `.7z`'s password test learns.
#[derive(Debug, Clone)]
pub struct SevenZipProbe {
    /// The settings its `.upriv-config/` carries.
    pub settings: Option<EmbeddedVaultSettings>,
    /// The name the new vault takes: the name those settings hold, or else
    /// its package's vault folder (`super::package::imported_vault_name`).
    pub vault_name: String,
}

fn missing_vault_folder() -> UprivError {
    archive_layout_error("missing .7z vault folder")
}

/// The package every member name of `reader` forms, read from the archive's
/// listing without decoding a member.
fn archive_package<R: Read + Seek>(reader: &ArchiveReader<R>) -> Result<Package> {
    let mut walk = PackageWalk::default();
    for entry in &reader.archive().files {
        let name = normalize_member_name(entry.name());
        walk.place(&name, entry.is_directory())
            .map_err(archive_layout_error)?;
    }
    walk.package().ok_or_else(missing_vault_folder)
}

/// Password check, the settings the archive carries, and its vault's name.
///
/// A wrong password fails even when the header is not encrypted: `config.toml`
/// is read to its end, so its checksum is checked, or else one byte of the first
/// file is decoded. An archive that is only its package's folders succeeds
/// after they are classified. Only the first member is read, so no vault file
/// is decoded for the settings. The vault folder comes from the names of
/// every member, which the settings beside it do not carry.
fn probe_reader<R: Read + Seek>(
    reader: &mut ArchiveReader<R>,
    archive_len: u64,
) -> Result<SevenZipProbe> {
    let package = archive_package(reader)?;
    let budget = plaintext_budget(archive_len);
    let mut walk = PackageWalk::default();
    let mut settings = None;
    let mut layout_error: Option<UprivError> = None;
    reader
        .for_each_entries(|entry, payload| {
            if layout_error.is_some() {
                return Ok(false);
            }
            match classify_archive_member(entry, &mut walk) {
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
    let carried = settings
        .as_ref()
        .map(|settings| settings.config.vault.display_name.as_str());
    let vault_name = imported_vault_name(carried, &package);
    Ok(SevenZipProbe {
        settings,
        vault_name,
    })
}

/// Password check of a `.7z` in memory, the settings it carries, and its
/// vault's name, as the job `job_id`.
pub fn probe_logical_seven_zip(
    archive_bytes: &[u8],
    archive_password: &[u8],
    job_id: &str,
) -> Result<SevenZipProbe> {
    Job::run(job_id, JobKind::ImportProbe, None, |job| {
        let mut reader = open_archive_reader(archive_bytes, archive_password, job)?;
        probe_reader(&mut reader, archive_bytes.len() as u64)
    })
}

/// Password check of a `.7z` file, the settings it carries, and its vault's
/// name, as the job `job_id`. The compressed bytes stay on disk.
pub fn probe_logical_seven_zip_path(
    path: &Path,
    archive_password: &[u8],
    job_id: &str,
) -> Result<SevenZipProbe> {
    Job::run(job_id, JobKind::ImportProbe, None, |job| {
        let (mut reader, len) = open_archive_path(path, archive_password, job)?;
        probe_reader(&mut reader, len)
    })
}

#[allow(clippy::too_many_arguments)]
fn import_reader<R: Read + Seek>(
    root: &VaultRoot,
    config: VaultConfig,
    new_password: &[u8],
    preset: KdfUnlockPreset,
    mut reader: ArchiveReader<R>,
    archive_len: u64,
    extras: ImportExtras<'_>,
    job: &Job,
) -> Result<String> {
    if new_password.is_empty() {
        return Err(UprivError::WrongPassword);
    }
    extras.check()?;
    fill_new_vault(root, config, new_password, preset, job, |id| {
        let mut members = MemberIngest {
            root,
            vault_id: id,
            keep_workspace: extras.keep_workspace,
            walk: PackageWalk::default(),
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
                    Ok(()) => match fs_seal_staged_wave(root, id) {
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
        if std::mem::take(&mut members.walk).package().is_none() {
            return Err(missing_vault_folder());
        }
        fs_seal_staged_imports(root, id)?;
        extras.seal(root, id, members.layout)
    })
}

/// Create a new vault and stream logical files from a `.7z` into `store/`, as
/// the job `job_id`.
#[allow(clippy::too_many_arguments)]
pub fn import_logical_seven_zip(
    root: &VaultRoot,
    config: VaultConfig,
    new_password: &[u8],
    preset: KdfUnlockPreset,
    archive_bytes: &[u8],
    archive_password: &[u8],
    extras: ImportExtras<'_>,
    job_id: &str,
) -> Result<String> {
    let vault_id = config.vault.id.clone();
    Job::run(job_id, JobKind::VaultImport, Some(&vault_id), |job| {
        let reader = open_archive_reader(archive_bytes, archive_password, job)?;
        import_reader(
            root,
            config,
            new_password,
            preset,
            reader,
            archive_bytes.len() as u64,
            extras,
            job,
        )
    })
}

/// Create a new vault from a `.7z` path, as the job `job_id`. The archive is
/// not loaded into a `Vec`.
#[allow(clippy::too_many_arguments)]
pub fn import_logical_seven_zip_path(
    root: &VaultRoot,
    config: VaultConfig,
    new_password: &[u8],
    preset: KdfUnlockPreset,
    archive_path: &Path,
    archive_password: &[u8],
    extras: ImportExtras<'_>,
    job_id: &str,
) -> Result<String> {
    let vault_id = config.vault.id.clone();
    Job::run(job_id, JobKind::VaultImport, Some(&vault_id), |job| {
        let (reader, len) = open_archive_path(archive_path, archive_password, job)?;
        import_reader(root, config, new_password, preset, reader, len, extras, job)
    })
}

#[cfg(test)]
mod import_mem_tests {
    use super::*;
    use crate::{close_vault, create_vault, open_vault};

    fn member(name: &str, is_directory: bool) -> ArchiveEntry {
        let mut entry = ArchiveEntry::new();
        entry.name = name.into();
        entry.is_directory = is_directory;
        entry
    }

    #[test]
    fn classifies_the_package_layout() {
        let mut walk = PackageWalk::default();
        for folder in ["Notes-sevenzip", "Notes-sevenzip/Notes"] {
            assert!(matches!(
                classify_archive_member(&member(folder, true), &mut walk).unwrap(),
                ArchiveMember::Directory(None)
            ));
        }
        match classify_archive_member(
            &member("Notes-sevenzip/Notes/config.toml", false),
            &mut walk,
        )
        .unwrap()
        {
            ArchiveMember::File(logical) => assert_eq!(logical, "config.toml"),
            other => panic!("expected a file, got {other:?}"),
        }
        match classify_archive_member(
            &member("Notes-sevenzip/Notes/docs/hi.txt", false),
            &mut walk,
        )
        .unwrap()
        {
            ArchiveMember::File(logical) => assert_eq!(logical, "docs/hi.txt"),
            other => panic!("expected a file, got {other:?}"),
        }

        for reserved in [
            "Notes-sevenzip/Notes/docs/.upriv-workspace.json",
            "Notes-sevenzip/Notes/.upriv-workspace.json",
        ] {
            assert!(classify_archive_member(&member(reserved, false), &mut walk).is_err());
        }

        let carried = |name: &str, walk: &mut PackageWalk| {
            classify_archive_member(&member(name, false), walk).unwrap()
        };
        // What the export carries sits beside the vault folder.
        assert!(matches!(
            carried("Notes-sevenzip/.upriv-config/config.toml", &mut walk),
            ArchiveMember::Settings
        ));
        assert!(matches!(
            carried("Notes-sevenzip/.upriv-config/workspace.json", &mut walk),
            ArchiveMember::Workspace
        ));
        assert!(matches!(
            carried("Notes-sevenzip/.upriv-config/README.md", &mut walk),
            ArchiveMember::Skipped
        ));
        // A vault never holds the name: inside the vault folder it is skipped.
        for inside in [
            "Notes-sevenzip/Notes/.upriv-config/config.toml",
            "Notes-sevenzip/Notes/docs/.upriv-config/config.toml",
        ] {
            assert!(matches!(carried(inside, &mut walk), ArchiveMember::Skipped));
        }

        // Anything outside the package's vault folder breaks it.
        for stray in [
            ("Other/Notes/notes.txt", false),
            ("Notes-sevenzip/Other/notes.txt", false),
            ("Notes-sevenzip/notes.txt", false),
            ("Notes-sevenzip/Notes/../secret.txt", false),
        ] {
            assert!(
                classify_archive_member(&member(stray.0, stray.1), &mut walk).is_err(),
                "{stray:?}"
            );
        }
        assert_eq!(walk.package().unwrap().vault, "Notes");
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
        let err =
            probe_logical_seven_zip(b"7z\xbc\xaf'\x1c", b"", &crate::test_support::test_job_id())
                .unwrap_err();
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
