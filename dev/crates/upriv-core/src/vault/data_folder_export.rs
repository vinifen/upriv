//! Copy the whole `.upriv` into one zip, `<name>.zip`, that unzips to
//! `<name>/.upriv/`, ready to select as a data folder. The person picks the
//! name; the window fills in `upriv-<UTC stamp>`.
//!
//! Vault bodies are already ciphertext, so the zip is Stored and has no
//! password, like a backup zip. Every vault stays held until the zip is
//! written: open, rename, delete, rewrap, export, and Back up now refuse with
//! `vault_busy`. A new vault, an import, and a backup delete or pin refuse with
//! `data_folder_export_busy`. Settings, groups, and logs keep working: each
//! write replaces its file whole or appends to it, so the copy holds one
//! complete version of every file.

use std::io::{BufReader, ErrorKind, Read, Seek, Write};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use zip::write::FileOptions;
use zip::{CompressionMethod, DateTime, ZipArchive, ZipWriter};

use crate::error::{Result, UprivError};
#[allow(unused_imports)]
use crate::host_fs::HostFsQuery;
use crate::host_fs::{File, Metadata, OpenOptions};
use crate::logging::{log_event, LogLevel};
use crate::paths::VaultRoot;
use crate::session::{
    any_preparing_under, any_session_under, is_vault_closing_at, is_vault_open_at,
    with_vault_dir_lock, with_vault_registry_lock, DataFolderExportGuard, PreparingGuard,
};

use super::backup::classify_backup_failure;
use super::zip_io::{buffered_zip_file, open_regular_nofollow, zip_err};

/// The data-folder zip written by [`export_data_folder`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DataFolderExport {
    pub path: PathBuf,
    pub size: u64,
}

const UPRIV_DIR_NAME: &str = ".upriv";
/// Locks of open vault sessions. They belong to the process that holds them,
/// so the copy keeps the folder and leaves its files out.
const RUNTIME_DIR_NAME: &str = "runtime";
/// Same suffix as a vault export that is still being written.
const PART_SUFFIX: &str = ".upriv-part";
const COPY_BUFFER: usize = 256 * 1024;
/// End records, zip64 records, and room for a log that grows while copied.
const ZIP_SLACK: u64 = 1024 * 1024;
/// Longest zip name, in bytes of UTF-8. `<name>.zip.upriv-part` still fits the
/// 255 a file name may hold on every system.
const DATA_FOLDER_ZIP_NAME_MAX_BYTES: usize = 200;

/// Zip `.upriv` into `dest_dir/<name>.zip`. Every vault must be closed or in
/// recovery, and no other work may hold one.
pub fn export_data_folder(
    root: &VaultRoot,
    dest_dir: &Path,
    name: &str,
) -> Result<DataFolderExport> {
    validate_data_folder_zip_name(name)?;
    crate::paths::validate_existing_vault_root(root.root())?;
    // A picked Android folder is the logical export root. Its tree address
    // says whether it sits inside a `.upriv`.
    let picked_tree = crate::host_fs::export_tree_uri(dest_dir);
    if crate::paths::path_is_under_reserved_upriv_tree(dest_dir)
        || picked_tree
            .is_some_and(|uri| crate::paths::path_is_under_reserved_upriv_tree(Path::new(&uri)))
        || crate::paths::is_reserved_upriv_workspace_path(dest_dir, root.root())
    {
        return Err(UprivError::DataFolderExportDestinationReserved(
            dest_dir.to_path_buf(),
        ));
    }
    if !dest_dir.host_is_dir() {
        return Err(std::io::Error::new(ErrorKind::NotFound, "export folder not found").into());
    }
    // Asked before the vaults are held; the write itself refuses a late arrival.
    let target = ZipTarget::new(dest_dir, name);
    if target.dest.host_exists() || target.partial.host_exists() {
        return Err(UprivError::DataFolderExportNameTaken(target.dest));
    }
    let held = hold_data_folder(root)?;
    let written = write_data_folder_zip(root, &target, &held.running)
        .map_err(|error| destination_unreachable_as_io(error, root));
    log_outcome(&written, held.vaults.len());
    written
}

/// The name a data-folder zip and the folder inside it share. Portable rules,
/// so the copy unzips the same on Linux, Windows, macOS, and Android: no
/// characters any of them refuse, no Windows device name, no leading dot that
/// would hide it, and no trailing dot or space that Windows drops.
fn validate_data_folder_zip_name(name: &str) -> Result<()> {
    let refused = name.is_empty()
        || name.len() > DATA_FOLDER_ZIP_NAME_MAX_BYTES
        || name.trim() != name
        || name.starts_with('.')
        || name.ends_with('.')
        || name
            .chars()
            .any(|c| c.is_control() || r#"<>:"/\|?*"#.contains(c))
        || crate::paths::is_windows_reserved_device_name(name);
    if refused {
        return Err(UprivError::DataFolderExportNameInvalid);
    }
    Ok(())
}

/// Where one export writes: the zip, and the partial it is renamed from.
struct ZipTarget {
    dir: PathBuf,
    /// The folder inside the zip, named like the zip.
    top: String,
    dest: PathBuf,
    partial: PathBuf,
}

impl ZipTarget {
    fn new(dest_dir: &Path, name: &str) -> Self {
        Self {
            dir: dest_dir.to_path_buf(),
            top: name.to_string(),
            dest: dest_dir.join(format!("{name}.zip")),
            partial: dest_dir.join(format!("{name}.zip{PART_SUFFIX}")),
        }
    }
}

/// A picked Android folder whose drive stops answering fails this export like
/// any write error. Only a data folder that stops answering stays unreachable,
/// which asks the person to reconnect it.
fn destination_unreachable_as_io(error: UprivError, root: &VaultRoot) -> UprivError {
    match error {
        UprivError::Io(io) if crate::host_fs::is_unreachable(&io) && root.root().host_is_dir() => {
            UprivError::Io(std::io::Error::new(io.kind(), io.to_string()))
        }
        other => other,
    }
}

/// The export mark plus one exclusive hold per vault folder.
struct HeldDataFolder {
    running: DataFolderExportGuard,
    vaults: Vec<PreparingGuard>,
}

fn hold_data_folder(root: &VaultRoot) -> Result<HeldDataFolder> {
    let vaults_dir = root.vaults_dir();
    // Create and import make `vaults/<id>/` and mark it inside this section,
    // so a vault on its way in is either counted below or refused afterwards.
    with_vault_registry_lock(|| {
        let running = DataFolderExportGuard::enter(root.root())?;
        if any_session_under(&vaults_dir) || any_preparing_under(&vaults_dir) {
            return Err(UprivError::DataFolderBusy);
        }
        let mut vaults = Vec::new();
        for dir in vault_dirs(&vaults_dir)? {
            match PreparingGuard::enter_exclusive(&dir) {
                Ok(hold) => vaults.push(hold),
                Err(UprivError::VaultBusy) => return Err(UprivError::DataFolderBusy),
                Err(error) => return Err(error),
            }
        }
        // An open that finished between the check and its hold is a session now.
        if any_session_under(&vaults_dir) {
            return Err(UprivError::DataFolderBusy);
        }
        Ok(HeldDataFolder { running, vaults })
    })
}

fn vault_dirs(vaults_dir: &Path) -> Result<Vec<PathBuf>> {
    let entries = match crate::host_fs::read_dir(vaults_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.into()),
    };
    let mut dirs = Vec::new();
    for entry in entries {
        let entry = entry?;
        if entry.file_type()?.host_is_dir() {
            dirs.push(entry.path());
        }
    }
    Ok(dirs)
}

fn write_data_folder_zip(
    root: &VaultRoot,
    target: &ZipTarget,
    running: &DataFolderExportGuard,
) -> Result<DataFolderExport> {
    let ZipTarget {
        dir,
        top,
        dest,
        partial,
    } = target;
    let upriv = root.root().join(UPRIV_DIR_NAME);
    let tree = DataFolderTree {
        upriv: &upriv,
        runtime: upriv.join(RUNTIME_DIR_NAME),
        vaults_dir: root.vaults_dir(),
    };
    let mut size = SizeSink::default();
    tree.walk(top, &mut size)?;
    running.set_total(size.bytes);
    let needed = size
        .bytes
        .saturating_add(size.overhead)
        .saturating_add(ZIP_SLACK);
    if let Some(available) = crate::host_fs::free_bytes(dir) {
        if available < needed {
            return Err(UprivError::DataFolderExportSpaceShort { needed, available });
        }
    }
    // Another export may have taken this name since it was checked.
    let taken = |error: std::io::Error| match error.kind() {
        ErrorKind::AlreadyExists => UprivError::DataFolderExportNameTaken(dest.clone()),
        _ => error.into(),
    };
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(partial)
        .map_err(taken)?;
    let installed = (|| {
        let entries = write_zip(&tree, top, file, running)?;
        crate::paths::sync_file_durable(partial)?;
        verify_zip(partial, top, entries)?;
        crate::host_fs::rename_no_replace(partial, dest).map_err(taken)?;
        Ok(())
    })();
    if let Err(error) = installed {
        let _ = crate::host_fs::remove_file(partial);
        return Err(error);
    }
    let size = crate::host_fs::metadata(dest)?.len();
    Ok(DataFolderExport {
        path: dest.clone(),
        size,
    })
}

fn write_zip(
    tree: &DataFolderTree<'_>,
    top: &str,
    file: File,
    running: &DataFolderExportGuard,
) -> Result<usize> {
    let mut sink = ZipSink {
        zip: ZipWriter::new(buffered_zip_file(file)),
        running,
        buf: vec![0; COPY_BUFFER],
        entries: 0,
    };
    tree.walk(top, &mut sink)?;
    let mut out = sink
        .zip
        .finish()
        .map_err(|error| zip_err(Path::new(top), error))?;
    // Dropping a buffered writer would discard a failed last flush.
    out.flush()?;
    Ok(sink.entries)
}

/// Read back the central directory: every entry is listed and the data-folder
/// marker is there. File bodies are not read a second time.
fn verify_zip(path: &Path, top: &str, entries: usize) -> Result<()> {
    let archive =
        ZipArchive::new(BufReader::new(File::open(path)?)).map_err(|error| zip_err(path, error))?;
    let marker = format!("{top}/{}", crate::paths::VAULT_ROOT_SETTINGS_REL);
    if archive.len() != entries || !archive.file_names().any(|name| name == marker) {
        return Err(UprivError::VaultStoreInvalid {
            path: path.to_path_buf(),
            detail: "the data folder zip does not list every entry".into(),
        });
    }
    Ok(())
}

fn log_outcome(written: &Result<DataFolderExport>, vaults: usize) {
    match written {
        Ok(export) => {
            let vaults = vaults.to_string();
            let bytes = export.size.to_string();
            log_event(
                LogLevel::Info,
                "data_folder_exported",
                &[("vaults", vaults.as_str()), ("bytes", bytes.as_str())],
            );
        }
        Err(UprivError::DataFolderExportCancelled) => {
            log_event(LogLevel::Info, "data_folder_export_cancelled", &[]);
        }
        Err(error) => {
            let class = classify_backup_failure(error);
            let os = class.os.map(|code| code.to_string());
            let mut fields = vec![("reason", class.reason), ("kind", class.kind)];
            if let Some(code) = os.as_deref() {
                fields.push(("os", code));
            }
            log_event(LogLevel::Warn, "data_folder_export_failed", &fields);
        }
    }
}

/// Left behind by a write that did not finish: an atomic replace, a backup or
/// export zip still being written. None of them is part of the data folder.
fn is_transient_file(name: &str) -> bool {
    name.ends_with(PART_SUFFIX)
        || name.ends_with(".partial")
        || name.ends_with(".tmp")
        || name.contains(".tmp.")
}

/// What one walk of `.upriv` reports. The size pass and the zip pass see the
/// same entries in the same order.
trait Sink {
    /// `name` is the zip path, ending in `/`.
    fn dir(&mut self, name: &str, meta: &Metadata) -> Result<()>;
    fn file(&mut self, path: &Path, name: &str, meta: &Metadata) -> Result<()>;
}

struct DataFolderTree<'a> {
    upriv: &'a Path,
    runtime: PathBuf,
    vaults_dir: PathBuf,
}

impl DataFolderTree<'_> {
    fn walk(&self, top: &str, sink: &mut impl Sink) -> Result<()> {
        let meta = crate::host_fs::metadata(self.upriv)?;
        sink.dir(&format!("{top}/"), &meta)?;
        self.walk_dir(self.upriv, &format!("{top}/{UPRIV_DIR_NAME}/"), &meta, sink)
    }

    fn walk_dir(
        &self,
        dir: &Path,
        name: &str,
        meta: &Metadata,
        sink: &mut impl Sink,
    ) -> Result<()> {
        sink.dir(name, meta)?;
        if dir == self.runtime {
            return Ok(());
        }
        let mut entries = crate::host_fs::read_dir(dir)?.collect::<std::io::Result<Vec<_>>>()?;
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            let path = entry.path();
            let file_name = entry.file_name();
            // A lossy name would unzip as a different file than the one copied.
            let Some(leaf) = file_name.to_str() else {
                return Err(refused(&path, "refusing a file name that is not UTF-8"));
            };
            let file_type = entry.file_type()?;
            if file_type.is_symlink() {
                return Err(refused(&path, "refusing to copy a symlink into a zip"));
            }
            let meta = match entry.metadata() {
                Ok(meta) => meta,
                // Replaced or removed since the listing.
                Err(error) if error.kind() == ErrorKind::NotFound => continue,
                Err(error) => return Err(error.into()),
            };
            if file_type.host_is_dir() {
                let child = format!("{name}{leaf}/");
                if path.parent() == Some(self.vaults_dir.as_path()) {
                    with_vault_dir_lock(&path, || self.walk_vault(&path, &child, &meta, sink))?;
                } else {
                    self.walk_dir(&path, &child, &meta, sink)?;
                }
            } else if file_type.host_is_file() {
                if !is_transient_file(leaf) {
                    sink.file(&path, &format!("{name}{leaf}"), &meta)?;
                }
            } else {
                return Err(refused(&path, "refusing to copy a special file into a zip"));
            }
        }
        Ok(())
    }

    /// One vault folder, under the lock delete and rename take, so neither
    /// moves it out from under the copy.
    fn walk_vault(
        &self,
        dir: &Path,
        name: &str,
        meta: &Metadata,
        sink: &mut impl Sink,
    ) -> Result<()> {
        if !dir.host_is_dir() {
            // Deleted while this walk waited for its lock.
            return Ok(());
        }
        if is_vault_open_at(dir) || is_vault_closing_at(dir) {
            return Err(UprivError::DataFolderBusy);
        }
        self.walk_dir(dir, name, meta, sink)
    }
}

fn refused(path: &Path, detail: &str) -> UprivError {
    UprivError::VaultStoreInvalid {
        path: path.to_path_buf(),
        detail: detail.into(),
    }
}

/// Bytes to copy, and what the zip adds around them.
#[derive(Default)]
struct SizeSink {
    bytes: u64,
    overhead: u64,
}

impl Sink for SizeSink {
    fn dir(&mut self, name: &str, _meta: &Metadata) -> Result<()> {
        self.overhead += entry_overhead(name);
        Ok(())
    }

    fn file(&mut self, _path: &Path, name: &str, meta: &Metadata) -> Result<()> {
        self.bytes = self.bytes.saturating_add(meta.len());
        self.overhead += entry_overhead(name);
        Ok(())
    }
}

/// Local header and central record, each with the name and a zip64 field.
fn entry_overhead(name: &str) -> u64 {
    30 + 46 + 2 * 28 + 2 * name.len() as u64
}

struct ZipSink<'a, W: Write + Seek> {
    zip: ZipWriter<W>,
    running: &'a DataFolderExportGuard,
    buf: Vec<u8>,
    entries: usize,
}

impl<W: Write + Seek> Sink for ZipSink<'_, W> {
    fn dir(&mut self, name: &str, meta: &Metadata) -> Result<()> {
        self.running.ensure_not_cancelled()?;
        self.zip
            .add_directory(name, entry_options(meta))
            .map_err(|error| zip_err(Path::new(name), error))?;
        self.entries += 1;
        Ok(())
    }

    fn file(&mut self, path: &Path, name: &str, _listed: &Metadata) -> Result<()> {
        self.running.ensure_not_cancelled()?;
        // A file replaced whole since the listing is copied as it is now.
        let mut file = match open_regular_nofollow(path) {
            Ok(file) => file,
            Err(UprivError::Io(error)) if error.kind() == ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(error),
        };
        let meta = file.metadata()?;
        let options = entry_options(&meta).large_file(meta.len() >= u64::from(u32::MAX));
        self.zip
            .start_file(name, options)
            .map_err(|error| zip_err(path, error))?;
        loop {
            self.running.ensure_not_cancelled()?;
            let read = match file.read(&mut self.buf) {
                Ok(0) => break,
                Ok(read) => read,
                Err(error) if error.kind() == ErrorKind::Interrupted => continue,
                Err(error) => return Err(error.into()),
            };
            self.zip
                .write_all(&self.buf[..read])
                .map_err(|error| zip_err(path, error))?;
            self.running.advance(read as u64);
        }
        self.entries += 1;
        Ok(())
    }
}

/// Stored, with the file's date and, on Unix, its permission bits, so a
/// private file stays private once unzipped.
fn entry_options(meta: &Metadata) -> FileOptions {
    let options = FileOptions::default().compression_method(CompressionMethod::Stored);
    let options = match zip_time(meta) {
        Some(time) => options.last_modified_time(time),
        None => options,
    };
    #[cfg(unix)]
    let options = {
        use std::os::unix::fs::PermissionsExt;
        options.unix_permissions(meta.permissions().mode())
    };
    options
}

/// The last change in UTC. A zip date carries no zone.
fn zip_time(meta: &Metadata) -> Option<DateTime> {
    let seconds = meta
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_secs();
    let (year, month, day, hour, minute, second) = crate::time::utc_ymdhms(seconds);
    DateTime::from_date_and_time(
        u16::try_from(year).ok()?,
        month as u8,
        day as u8,
        hour as u8,
        minute as u8,
        second as u8,
    )
    .ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::VaultConfig;
    use crate::session::{cancel_data_folder_export, data_folder_export_status};
    use crate::store::KdfUnlockPreset;
    use crate::test_support::vault_root_with;
    use crate::vault::backup::delete_backups;
    use crate::vault::create::create_vault;
    use crate::vault::fs::{fs_read_file, fs_write_file};
    use crate::vault::list_vaults;
    use crate::vault::open_close::{close_vault, open_vault};

    const PASSWORD: &[u8] = b"pass-word-ok";
    const NAME: &str = "upriv-2026-10-19-101500";

    fn sample_config(id: &str, name: &str) -> VaultConfig {
        toml::from_str(&format!(
            "[vault]\nid = \"{id}\"\ndisplay_name = \"{name}\"\norder = 1\n[storage]\nmode = \"encrypted_dir\"\n"
        ))
        .expect("config")
    }

    /// A data folder with one closed vault that holds `/secret.txt`.
    fn notes_root() -> (tempfile::TempDir, VaultRoot) {
        let (tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            PASSWORD,
            KdfUnlockPreset::M32,
        )
        .unwrap();
        open_vault(&root, "notes", PASSWORD).unwrap();
        fs_write_file(&root, "notes", "/secret.txt", b"kept-secret").unwrap();
        close_vault(&root, "notes").unwrap();
        (tmp, root)
    }

    fn zip_names(path: &Path) -> Vec<String> {
        let archive = ZipArchive::new(File::open(path).unwrap()).unwrap();
        archive.file_names().map(str::to_string).collect()
    }

    fn entry_count(dir: &Path) -> usize {
        crate::host_fs::read_dir(dir).unwrap().count()
    }

    #[test]
    fn the_unzipped_copy_opens_as_a_data_folder() {
        let (_tmp, root) = notes_root();
        let dest = tempfile::tempdir().unwrap();
        let export = export_data_folder(&root, dest.path(), NAME).unwrap();
        assert_eq!(export.path, dest.path().join(format!("{NAME}.zip")));
        let top = NAME;
        assert_eq!(
            export.size,
            crate::host_fs::metadata(&export.path).unwrap().len()
        );
        assert_eq!(entry_count(dest.path()), 1);

        let mut archive = ZipArchive::new(File::open(&export.path).unwrap()).unwrap();
        let settings = archive
            .by_name(&format!("{top}/.upriv/settings.toml"))
            .unwrap()
            .last_modified();
        assert!(settings.year() > 1980);
        let unzipped = tempfile::tempdir().unwrap();
        archive.extract(unzipped.path()).unwrap();

        let copy = VaultRoot::discover(unzipped.path().join(top)).unwrap();
        let ids: Vec<String> = list_vaults(&copy)
            .unwrap()
            .into_iter()
            .map(|item| item.id)
            .collect();
        assert_eq!(ids, ["notes"]);
        open_vault(&copy, "notes", PASSWORD).unwrap();
        assert_eq!(
            fs_read_file(&copy, "notes", "/secret.txt").unwrap(),
            b"kept-secret"
        );
        close_vault(&copy, "notes").unwrap();
    }

    #[test]
    fn the_copy_leaves_out_locks_and_unfinished_writes() {
        let (_tmp, root) = vault_root_with(&[]);
        let upriv = root.root().join(UPRIV_DIR_NAME);
        let backups = upriv.join("vaults/notes/backups");
        for dir in [upriv.join("runtime"), upriv.join("app"), backups.clone()] {
            crate::host_fs::create_dir_all(dir).unwrap();
        }
        for (path, body) in [
            (upriv.join("runtime/notes.lock"), "lock"),
            (upriv.join("state.json"), "{}"),
            (upriv.join("settings.tmp.41.7"), "half"),
            (upriv.join("vault_groups.toml.tmp"), "half"),
            (upriv.join("app/kept.txt"), "kept"),
            (backups.join("20260101000000-notes.zip.partial"), "half"),
            (backups.join("20260101000000-notes.zip"), "zip"),
        ] {
            crate::host_fs::write(path, body).unwrap();
        }
        let dest = tempfile::tempdir().unwrap();
        let export = export_data_folder(&root, dest.path(), NAME).unwrap();
        let top = NAME;
        let names = zip_names(&export.path);
        for kept in [
            format!("{top}/"),
            format!("{top}/.upriv/runtime/"),
            format!("{top}/.upriv/state.json"),
            format!("{top}/.upriv/app/kept.txt"),
            format!("{top}/.upriv/vaults/notes/backups/20260101000000-notes.zip"),
        ] {
            assert!(names.contains(&kept), "{kept} missing from {names:?}");
        }
        for name in &names {
            assert!(!name.ends_with(".lock"), "{name}");
            assert!(!name.contains(".tmp"), "{name}");
            assert!(!name.ends_with(".partial"), "{name}");
        }
    }

    #[test]
    fn an_open_vault_keeps_the_data_folder_from_exporting() {
        let (_tmp, root) = notes_root();
        open_vault(&root, "notes", PASSWORD).unwrap();
        let dest = tempfile::tempdir().unwrap();
        assert!(matches!(
            export_data_folder(&root, dest.path(), NAME),
            Err(UprivError::DataFolderBusy)
        ));
        assert!(data_folder_export_status(root.root()).is_none());
        close_vault(&root, "notes").unwrap();
        assert_eq!(entry_count(dest.path()), 0);
    }

    #[test]
    fn a_running_export_holds_vaults_and_refuses_new_ones() {
        let (_tmp, root) = notes_root();
        let dest = tempfile::tempdir().unwrap();
        let held = hold_data_folder(&root).unwrap();
        assert!(matches!(
            open_vault(&root, "notes", PASSWORD),
            Err(UprivError::VaultBusy)
        ));
        assert!(matches!(
            create_vault(
                &root,
                sample_config("more", "More"),
                PASSWORD,
                KdfUnlockPreset::M32
            ),
            Err(UprivError::DataFolderExportBusy)
        ));
        assert!(!root.vault_dir("more").unwrap().host_exists());
        assert!(matches!(
            delete_backups(&root, "notes", &[]),
            Err(UprivError::DataFolderExportBusy)
        ));
        assert!(matches!(
            export_data_folder(&root, dest.path(), NAME),
            Err(UprivError::DataFolderExportBusy)
        ));
        assert!(crate::session::vault_activity_blocks_root_switch());
        assert!(data_folder_export_status(root.root()).is_some());

        drop(held);
        assert!(data_folder_export_status(root.root()).is_none());
        open_vault(&root, "notes", PASSWORD).unwrap();
        close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn progress_reaches_the_measured_total() {
        let (_tmp, root) = notes_root();
        let dest = tempfile::tempdir().unwrap();
        let held = hold_data_folder(&root).unwrap();
        write_data_folder_zip(&root, &ZipTarget::new(dest.path(), NAME), &held.running).unwrap();
        let status = data_folder_export_status(root.root()).unwrap();
        assert!(status.bytes_total > 0);
        assert_eq!(status.bytes_done, status.bytes_total);
    }

    #[test]
    fn a_cancelled_export_leaves_no_zip() {
        let (_tmp, root) = notes_root();
        let dest = tempfile::tempdir().unwrap();
        let held = hold_data_folder(&root).unwrap();
        assert!(cancel_data_folder_export(root.root()));
        assert!(matches!(
            write_data_folder_zip(&root, &ZipTarget::new(dest.path(), NAME), &held.running),
            Err(UprivError::DataFolderExportCancelled)
        ));
        assert_eq!(entry_count(dest.path()), 0);
        drop(held);
        assert!(!cancel_data_folder_export(root.root()));
    }

    #[test]
    fn the_zip_cannot_go_inside_a_upriv_folder() {
        let (_tmp, root) = vault_root_with(&[]);
        let inside = root.root().join(".upriv/app");
        crate::host_fs::create_dir_all(&inside).unwrap();
        assert!(matches!(
            export_data_folder(&root, &inside, NAME),
            Err(UprivError::DataFolderExportDestinationReserved(_))
        ));
        let other = tempfile::tempdir().unwrap();
        let other_upriv = other.path().join(".upriv");
        crate::host_fs::create_dir_all(&other_upriv).unwrap();
        assert!(matches!(
            export_data_folder(&root, &other_upriv, NAME),
            Err(UprivError::DataFolderExportDestinationReserved(_))
        ));
        assert_eq!(entry_count(&inside), 0);
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_in_the_data_folder_stops_the_export() {
        let (_tmp, root) = vault_root_with(&[]);
        let elsewhere = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(elsewhere.path(), root.root().join(".upriv/app")).unwrap();
        let dest = tempfile::tempdir().unwrap();
        assert!(matches!(
            export_data_folder(&root, dest.path(), NAME),
            Err(UprivError::VaultStoreInvalid { .. })
        ));
        assert_eq!(entry_count(dest.path()), 0);
    }

    #[test]
    fn zip_names_follow_the_shared_rules() {
        let cases: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../apps/shared/src/domain/data-folder-export/zip-name-cases.json"
        ))
        .expect("zip-name-cases.json");
        for name in cases["valid"].as_array().expect("valid") {
            let name = name.as_str().expect("str");
            assert!(validate_data_folder_zip_name(name).is_ok(), "{name:?}");
        }
        for name in cases["invalid"].as_array().expect("invalid") {
            let name = name.as_str().expect("str");
            assert!(
                matches!(
                    validate_data_folder_zip_name(name),
                    Err(UprivError::DataFolderExportNameInvalid)
                ),
                "{name:?}"
            );
        }
    }

    #[test]
    fn a_zip_name_is_measured_in_bytes() {
        let longest = "a".repeat(DATA_FOLDER_ZIP_NAME_MAX_BYTES);
        assert!(validate_data_folder_zip_name(&longest).is_ok());
        assert!(validate_data_folder_zip_name(&format!("{longest}a")).is_err());
        // Two bytes each in UTF-8.
        let accented = "é".repeat(DATA_FOLDER_ZIP_NAME_MAX_BYTES / 2);
        assert!(validate_data_folder_zip_name(&accented).is_ok());
        assert!(validate_data_folder_zip_name(&format!("{accented}é")).is_err());
    }

    #[test]
    fn an_invalid_name_writes_nothing() {
        let (_tmp, root) = notes_root();
        let dest = tempfile::tempdir().unwrap();
        assert!(matches!(
            export_data_folder(&root, dest.path(), "../escape"),
            Err(UprivError::DataFolderExportNameInvalid)
        ));
        assert_eq!(entry_count(dest.path()), 0);
        assert!(data_folder_export_status(root.root()).is_none());
    }

    #[test]
    fn a_name_already_in_the_folder_is_kept_and_refused() {
        let (_tmp, root) = notes_root();
        let dest = tempfile::tempdir().unwrap();
        let existing = dest.path().join(format!("{NAME}.zip"));
        crate::host_fs::write(&existing, "kept").unwrap();
        assert!(matches!(
            export_data_folder(&root, dest.path(), NAME),
            Err(UprivError::DataFolderExportNameTaken(path)) if path == existing
        ));
        assert_eq!(crate::host_fs::read(&existing).unwrap(), b"kept");
        assert_eq!(entry_count(dest.path()), 1);
        assert!(data_folder_export_status(root.root()).is_none());

        // A zip of that name still being written holds the name too.
        let other = tempfile::tempdir().unwrap();
        let partial = other.path().join(format!("{NAME}.zip{PART_SUFFIX}"));
        crate::host_fs::write(&partial, "half").unwrap();
        assert!(matches!(
            export_data_folder(&root, other.path(), NAME),
            Err(UprivError::DataFolderExportNameTaken(_))
        ));
        assert_eq!(crate::host_fs::read(&partial).unwrap(), b"half");
    }

    #[test]
    fn a_name_taken_during_the_copy_is_refused() {
        let (_tmp, root) = notes_root();
        let dest = tempfile::tempdir().unwrap();
        let target = ZipTarget::new(dest.path(), NAME);
        crate::host_fs::write(&target.partial, "another export").unwrap();
        let held = hold_data_folder(&root).unwrap();
        assert!(matches!(
            write_data_folder_zip(&root, &target, &held.running),
            Err(UprivError::DataFolderExportNameTaken(_))
        ));
        assert_eq!(
            crate::host_fs::read(&target.partial).unwrap(),
            b"another export"
        );
    }

    #[test]
    fn unfinished_writes_are_recognized_by_name() {
        for name in [
            "settings.tmp.41.7",
            "vault_groups.toml.tmp",
            "20260101000000-notes.zip.partial",
            "upriv-2026-10-18-143012.zip.upriv-part",
        ] {
            assert!(is_transient_file(name), "{name}");
        }
        for name in [
            "settings.toml",
            "vault_groups.toml.bak",
            "upriv-2026-10-18.log",
            "root.idx.enc",
        ] {
            assert!(!is_transient_file(name), "{name}");
        }
    }
}
