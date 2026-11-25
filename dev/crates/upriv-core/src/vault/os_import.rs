//! Import one OS file, or the contents of one OS folder, into a new vault.
//!
//! A real filesystem path is streamed straight into `store/`. Symlinks are
//! never followed: a chosen link is refused, a link inside the folder is
//! skipped. Nothing is imported while any item of the chosen file or folder
//! cannot be: the error names every one, so no file is left out without the
//! person knowing. Android folder picks have no filesystem path: the app
//! creates the vault, opens an ingest session (no mount), and streams each
//! content URI through [`ingest_import_reader`]. Neither path copies the
//! source tree onto disk.

#[allow(unused_imports)]
use crate::host_fs::HostFsQuery;
use crate::host_fs::{self as fs, File};
use std::collections::HashSet;
use std::io::Read;
use std::path::{Path, PathBuf};

use crate::config::VaultConfig;
use crate::error::{ImportBlockReason, ImportBlockedItem, Result, UprivError};
use crate::logging::{log_event, LogLevel};
use crate::paths::VaultRoot;
use crate::session::{Job, JobKind};
use crate::store::{is_reserved_logical, is_skipped_on_import, KdfUnlockPreset};

use super::fs::{
    fs_ensure_folder, fs_ensure_folder_path_staged, fs_seal_staged_imports, fs_seal_staged_wave,
    fs_write_staged,
};
use super::import_job::{close_filled_vault, fill_new_vault, ImportEnd, ImportedVault};
use super::open_close::{delete_failed_import, open_vault_for_ingest, CloseVaultOutcome};
use super::seven_zip_pack::sevenz_member_name_unsafe;
use super::welcome::{seal_welcome_if_absent, VaultWelcome};

/// How many blocked items an import names. Every one is counted, so a folder
/// that blocks throughout still answers with a list a screen can hold.
pub const IMPORT_BLOCKED_LIST_MAX: usize = 500;

enum PlannedOsEntry {
    Directory(String),
    File { logical: String, source: PathBuf },
}

/// What a chosen file or folder holds, by name and source path, and what of
/// it cannot be imported.
struct PlannedOs {
    /// The chosen item's name, which starts every blocked path.
    name: String,
    entries: Vec<PlannedOsEntry>,
    blocked: Blocked,
}

impl PlannedOs {
    /// `logical` as the person finds it: from the chosen item, its name first.
    fn shown(&self, logical: &str) -> String {
        if logical.is_empty() {
            self.name.clone()
        } else {
            format!("{}/{logical}", self.name.trim_end_matches('/'))
        }
    }

    fn block(&mut self, logical: &str, reason: ImportBlockReason) {
        let path = self.shown(logical);
        self.blocked.add(path, reason);
        if logical.is_empty() {
            self.blocked.whole = true;
        }
    }
}

/// Every item that blocks an import, counted; the first
/// [`IMPORT_BLOCKED_LIST_MAX`] are named.
#[derive(Default)]
struct Blocked {
    count: usize,
    items: Vec<ImportBlockedItem>,
    /// The chosen item itself cannot be imported, so nothing of it can.
    whole: bool,
}

impl Blocked {
    fn add(&mut self, path: String, reason: ImportBlockReason) {
        self.count += 1;
        if self.items.len() < IMPORT_BLOCKED_LIST_MAX {
            self.items.push(ImportBlockedItem { path, reason });
        }
    }

    fn is_empty(&self) -> bool {
        self.count == 0
    }

    /// The error naming what blocks, in path order.
    fn into_error(mut self) -> UprivError {
        self.items.sort_by(|a, b| a.path.cmp(&b.path));
        UprivError::ImportBlocked {
            count: self.count,
            items: self.items,
            whole: self.whole,
        }
    }
}

/// What to do with items that cannot be imported.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BlockedItems {
    /// Import nothing and name them all (`ImportBlocked`).
    Refuse,
    /// The person chose to import without them: the rest goes in, and the
    /// answer counts what was left out.
    LeaveOut,
}

/// Why `error`, from reading an item, keeps it out.
pub(crate) fn read_reason(error: &std::io::Error) -> ImportBlockReason {
    match error.kind() {
        std::io::ErrorKind::PermissionDenied => ImportBlockReason::Permission,
        std::io::ErrorKind::NotFound => ImportBlockReason::Missing,
        _ => ImportBlockReason::Unreadable,
    }
}

/// `path`'s last name as it reads, also when it is not Unicode.
fn shown_name(path: &Path) -> String {
    path.file_name().map_or_else(
        || path.to_string_lossy().into_owned(),
        |name| name.to_string_lossy().into_owned(),
    )
}

fn join_logical(prefix: &str, name: &str) -> String {
    if prefix.is_empty() {
        name.to_string()
    } else {
        format!("{prefix}/{name}")
    }
}

fn layout_error(path: &Path, detail: impl Into<String>) -> UprivError {
    UprivError::VaultStoreInvalid {
        path: path.to_path_buf(),
        detail: detail.into(),
    }
}

fn logical_name_rejected(logical: &str) -> bool {
    sevenz_member_name_unsafe(logical) || is_reserved_logical(logical)
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

/// Names and source paths only. File bytes stay on the user's disk until ingest.
/// Links inside a folder are skipped, never followed. The chosen path itself
/// must not be a link. Plaintext-folder names and the settings folder of an
/// unpacked export are skipped in every mode. An item that cannot be imported
/// is noted and the walk goes on, so the list is whole; a folder that cannot
/// be listed is one item, and is not planned as an empty folder.
fn plan_os_path(source: &Path) -> Result<PlannedOs> {
    if !source.is_absolute() {
        return Err(layout_error(source, "choose an absolute file or folder"));
    }
    let mut planned = PlannedOs {
        name: shown_name(source),
        entries: Vec::new(),
        blocked: Blocked::default(),
    };
    let meta = match fs::symlink_metadata(source) {
        Ok(meta) => meta,
        Err(error) => {
            planned.block("", read_reason(&error));
            return Ok(planned);
        }
    };
    if meta.file_type().is_symlink() {
        planned.block("", ImportBlockReason::Link);
        return Ok(planned);
    }
    if meta.host_is_file() {
        match source.file_name().and_then(|name| name.to_str()) {
            Some(name) if !logical_name_rejected(name) => {
                planned.entries.push(PlannedOsEntry::File {
                    logical: name.to_string(),
                    source: source.to_path_buf(),
                });
            }
            _ => planned.block("", ImportBlockReason::Name),
        }
        return Ok(planned);
    }
    if !meta.host_is_dir() {
        planned.block("", ImportBlockReason::Special);
        return Ok(planned);
    }

    let mut links = 0usize;
    let mut stack = vec![(source.to_path_buf(), String::new())];
    while let Some((dir, prefix)) = stack.pop() {
        let children = match list_folder(&dir) {
            Ok(children) => children,
            Err(reason) => {
                planned.block(&prefix, reason);
                continue;
            }
        };
        if !prefix.is_empty() {
            planned
                .entries
                .push(PlannedOsEntry::Directory(prefix.clone()));
        }
        for entry in children {
            let path = entry.path();
            let meta = match fs::symlink_metadata(&path) {
                Ok(meta) => meta,
                Err(error) => {
                    planned.block(
                        &join_logical(&prefix, &shown_name(&path)),
                        read_reason(&error),
                    );
                    continue;
                }
            };
            if meta.file_type().is_symlink() {
                links += 1;
                continue;
            }
            let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
                planned.block(
                    &join_logical(&prefix, &shown_name(&path)),
                    ImportBlockReason::Name,
                );
                continue;
            };
            let logical = join_logical(&prefix, name);
            if is_skipped_on_import(&logical) {
                continue;
            }
            if !meta.host_is_dir() && !meta.host_is_file() {
                planned.block(&logical, ImportBlockReason::Special);
                continue;
            }
            if logical_name_rejected(&logical) {
                planned.block(&logical, ImportBlockReason::Name);
                continue;
            }
            if meta.host_is_dir() {
                stack.push((path, logical));
            } else {
                planned.entries.push(PlannedOsEntry::File {
                    logical,
                    source: path,
                });
            }
        }
    }
    if links > 0 {
        log_event(
            LogLevel::Info,
            "import_symlinks_skipped",
            &[("count", links.to_string().as_str())],
        );
    }
    Ok(planned)
}

/// A folder's entries, sorted by name, or why it cannot be listed. A folder
/// swapped for a link after its parent was listed is refused.
fn list_folder(dir: &Path) -> std::result::Result<Vec<fs::DirEntry>, ImportBlockReason> {
    let meta = fs::symlink_metadata(dir).map_err(|error| read_reason(&error))?;
    if meta.file_type().is_symlink() {
        return Err(ImportBlockReason::Link);
    }
    if !meta.host_is_dir() {
        return Err(ImportBlockReason::Missing);
    }
    let mut children = fs::read_dir(dir)
        .and_then(|listing| listing.collect::<std::io::Result<Vec<_>>>())
        .map_err(|error| read_reason(&error))?;
    children.sort_by_key(|entry| entry.file_name());
    Ok(children)
}

/// Open a regular file without following a symlink that replaced it after
/// planning, or say why it cannot be.
pub(crate) fn open_source(path: &Path) -> std::result::Result<File, ImportBlockReason> {
    crate::paths::open_nofollow(path, crate::paths::NofollowMode::Read).map_err(|error| {
        match crate::paths::nofollow_reject(&error) {
            Some(crate::paths::NofollowReject::NonFile) => ImportBlockReason::Special,
            Some(crate::paths::NofollowReject::Symlink) => ImportBlockReason::Link,
            None => read_reason(&error),
        }
    })
}

/// A chosen file's reader that keeps why a read failed, so a failure of the
/// file is told from one of the vault it is written into.
struct SourceReader<R> {
    inner: R,
    failed: Option<ImportBlockReason>,
}

impl<R: Read> Read for SourceReader<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        self.inner.read(buf).inspect_err(|error| {
            if error.kind() != std::io::ErrorKind::Interrupted {
                self.failed = Some(read_reason(error));
            }
        })
    }
}

/// Open each file of `entries` and note the ones that cannot be. Nothing is
/// copied, so the list names every file that blocks.
fn check_files(
    planned: &PlannedOs,
    entries: &[PlannedOsEntry],
    blocked: &mut Blocked,
    job: &Job,
) -> Result<()> {
    for entry in entries {
        job.ensure_running()?;
        if let PlannedOsEntry::File { logical, source } = entry {
            if let Err(reason) = open_source(source) {
                blocked.add(planned.shown(logical), reason);
            }
        }
    }
    Ok(())
}

/// Stage every entry and answer how many files were left out. A full wave
/// seals the index, and the tail is sealed once at the end. A file that cannot
/// be read is left out when the person chose that; otherwise it ends the copy
/// there, and the rest is only opened, so the error names every file that
/// blocks. A returned error, or a stop of `job`, still abandons the new vault.
fn ingest_planned(
    root: &VaultRoot,
    vault_id: &str,
    planned: &PlannedOs,
    blocked_items: BlockedItems,
    job: &Job,
) -> Result<usize> {
    let mut folders = HashSet::new();
    let mut left_out = 0;
    for (index, entry) in planned.entries.iter().enumerate() {
        job.ensure_running()?;
        match entry {
            PlannedOsEntry::Directory(logical) => {
                fs_ensure_folder_path_staged(root, vault_id, logical, &mut folders)?
            }
            PlannedOsEntry::File { logical, source } => {
                if let Some(reason) =
                    ingest_file(root, vault_id, logical, source, &mut folders, job)?
                {
                    if blocked_items == BlockedItems::LeaveOut {
                        left_out += 1;
                        continue;
                    }
                    let mut blocked = Blocked::default();
                    blocked.add(planned.shown(logical), reason);
                    check_files(planned, &planned.entries[index + 1..], &mut blocked, job)?;
                    return Err(blocked.into_error());
                }
            }
        }
        fs_seal_staged_wave(root, vault_id)?;
    }
    fs_seal_staged_imports(root, vault_id)?;
    Ok(left_out)
}

/// Stream one file into the vault. `Some` says why the file itself could not
/// be read; an error is the vault's or a stop.
fn ingest_file(
    root: &VaultRoot,
    vault_id: &str,
    logical: &str,
    source: &Path,
    folders: &mut HashSet<String>,
    job: &Job,
) -> Result<Option<ImportBlockReason>> {
    let file = match open_source(source) {
        Ok(file) => file,
        Err(reason) => return Ok(Some(reason)),
    };
    if let Some((parent, _)) = logical.rsplit_once('/') {
        fs_ensure_folder_path_staged(root, vault_id, parent, folders)?;
    }
    let mut reader = SourceReader {
        inner: file,
        failed: None,
    };
    let written = fs_write_staged(
        root,
        vault_id,
        &format!("/{logical}"),
        &mut job.progress_reader(&mut reader),
    );
    match reader.failed {
        Some(reason) => Ok(Some(reason)),
        None => written.map(|_| None),
    }
}

/// Create a vault and stream `source` into it, as the job `job_id`.
///
/// A file becomes that one document. A folder's children become the vault
/// root, including subfolders. The folder's own name is not added as a prefix.
/// Items that cannot be imported refuse the import, or are left out and
/// counted when `blocked_items` says so; the chosen item itself always refuses
/// it, since nothing would be left.
#[allow(clippy::too_many_arguments)]
pub fn import_logical_os_path(
    root: &VaultRoot,
    config: VaultConfig,
    new_password: &[u8],
    preset: KdfUnlockPreset,
    source: &Path,
    welcome: Option<VaultWelcome<'_>>,
    blocked_items: BlockedItems,
    job_id: &str,
) -> Result<ImportedVault> {
    if new_password.is_empty() {
        return Err(UprivError::WrongPassword);
    }
    if let Some(welcome) = welcome {
        welcome.files()?;
    }
    let vault_id = config.vault.id.clone();
    Job::run(job_id, JobKind::VaultImport, Some(&vault_id), |job| {
        let mut planned = plan_os_path(source)?;
        let refused = blocked_items == BlockedItems::Refuse && !planned.blocked.is_empty();
        if planned.blocked.whole || refused {
            // No vault is made. Every file is still opened, so the list is whole.
            let mut blocked = std::mem::take(&mut planned.blocked);
            check_files(&planned, &planned.entries, &mut blocked, job)?;
            return Err(blocked.into_error());
        }
        let mut left_out = planned.blocked.count;
        let filled = fill_new_vault(root, config, new_password, preset, job, |id| {
            left_out += ingest_planned(root, id, &planned, blocked_items, job)?;
            if let Some(welcome) = welcome {
                seal_welcome_if_absent(root, id, welcome)?;
            }
            Ok(())
        })?;
        if left_out > 0 {
            log_event(
                LogLevel::Info,
                "import_left_out",
                &[("count", left_out.to_string().as_str())],
            );
        }
        Ok(ImportedVault { left_out, ..filled })
    })
}

/// Unlock a vault that was just created so files can be streamed in.
///
/// Does not attach a desktop mount. The creating row stays up until
/// [`crate::close_vault`] or [`abort_import_vault`].
pub fn open_import_session(root: &VaultRoot, vault_id: &str, password: &[u8]) -> Result<()> {
    open_vault_for_ingest(root, vault_id, password)
}

/// Create one folder, including parents, inside an import session.
pub fn ingest_import_directory(root: &VaultRoot, vault_id: &str, logical_path: &str) -> Result<()> {
    let logical = normalize_import_logical(logical_path)?;
    ensure_folder_path(root, vault_id, &logical)
}

/// Stream one document into the open vault (a file manager import, or an
/// import session), staged for the next index seal like every file import,
/// as the job `job_id`. A stop leaves no file: the document enters the index
/// only once its blob is written, and a stop deletes that blob. A crash leaves
/// it for the next open to set aside.
///
/// Its folder must already be in the vault: the file manager creates it
/// first, and an import session adds every folder before the files. A folder
/// deleted meanwhile refuses the document (`VaultPathNotFound`) and stays gone.
/// A read of the document that fails is `ImportSourceUnreadable`, with why,
/// so it is told from a failure of the vault.
pub fn ingest_import_reader(
    root: &VaultRoot,
    vault_id: &str,
    logical_path: &str,
    reader: &mut (impl Read + ?Sized),
    job_id: &str,
) -> Result<()> {
    Job::run(job_id, JobKind::FileImport, Some(vault_id), |job| {
        let logical = normalize_import_logical(logical_path)?;
        let mut source = SourceReader {
            inner: reader,
            failed: None,
        };
        let written = fs_write_staged(
            root,
            vault_id,
            &format!("/{logical}"),
            &mut job.progress_reader(&mut source),
        );
        match source.failed {
            Some(reason) => Err(UprivError::ImportSourceUnreadable {
                path: PathBuf::from(&logical),
                reason,
            }),
            None => written.map(|_| ()),
        }
    })
}

/// Drop an in-progress import without flushing a backup, then delete the vault.
pub fn abort_import_vault(root: &VaultRoot, vault_id: &str) -> Result<()> {
    delete_failed_import(root, vault_id)
}

/// Close an import session: every file is in (`Whole`), or the person stopped
/// it and the files that got in stay (`Stopped`). See [`close_filled_vault`].
pub fn finish_import_session(
    root: &VaultRoot,
    vault_id: &str,
    end: ImportEnd,
) -> Result<CloseVaultOutcome> {
    close_filled_vault(root, vault_id, end)
}

fn normalize_import_logical(path: &str) -> Result<String> {
    let trimmed = path.trim().trim_start_matches('/');
    if trimmed.is_empty()
        || trimmed.contains('\\')
        || trimmed.contains('\0')
        || logical_name_rejected(trimmed)
    {
        return Err(layout_error(
            Path::new(trimmed),
            "reserved or unsafe file name",
        ));
    }
    Ok(trimmed.to_string())
}

#[cfg(test)]
mod tests {
    #[allow(unused_imports)]
    use crate::host_fs::HostFsQuery;
    use std::fs;
    #[cfg(unix)]
    use std::io::Write;

    use super::*;

    fn config() -> VaultConfig {
        toml::from_str(
            r#"
[vault]
id = "notes"
display_name = "Notes"
order = 1
[storage]
mode = "encrypted_dir"
"#,
        )
        .expect("config")
    }

    #[test]
    fn a_file_is_one_document_and_a_folder_keeps_its_children() {
        let (_tmp, root) = crate::test_support::vault_root_with(&[]);
        let dir = _tmp.path().join("Photos");
        fs::create_dir_all(dir.join("trip")).unwrap();
        fs::write(dir.join("trip/a.txt"), b"alpha").unwrap();
        fs::create_dir(dir.join("empty")).unwrap();
        let single = _tmp.path().join("note.txt");
        fs::write(&single, b"one-file").unwrap();

        import_logical_os_path(
            &root,
            config(),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
            &single,
            None,
            BlockedItems::Refuse,
            &crate::test_support::test_job_id(),
        )
        .unwrap();
        crate::open_vault(&root, "notes", b"pass-word-ok").unwrap();
        assert_eq!(
            crate::vault::fs::fs_read_file(&root, "notes", "/note.txt").unwrap(),
            b"one-file"
        );
        crate::close_vault(&root, "notes").unwrap();
        crate::delete_vault(
            &root,
            "notes",
            false,
            false,
            &crate::test_support::test_job_id(),
        )
        .unwrap();

        let welcome = crate::vault::VaultWelcome {
            readme: "# Welcome\n",
            workspace: "{\"format_version\":1}\n",
        };
        import_logical_os_path(
            &root,
            config(),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
            &dir,
            Some(welcome),
            BlockedItems::Refuse,
            &crate::test_support::test_job_id(),
        )
        .unwrap();
        crate::open_vault(&root, "notes", b"pass-word-ok").unwrap();
        assert_eq!(
            crate::vault::fs::fs_read_file(&root, "notes", "/trip/a.txt").unwrap(),
            b"alpha"
        );
        assert_eq!(
            crate::vault::fs::fs_read_file(&root, "notes", "/README.md").unwrap(),
            b"# Welcome\n"
        );
        let listed = crate::vault::fs::fs_list_tree(&root, "notes").unwrap();
        let json = serde_json::to_string(&listed).unwrap();
        assert!(json.contains("empty"), "{json}");
        assert!(!json.contains("Photos"), "{json}");
        crate::close_vault(&root, "notes").unwrap();
    }

    fn import_with(
        root: &VaultRoot,
        source: &Path,
        blocked_items: BlockedItems,
    ) -> Result<ImportedVault> {
        import_logical_os_path(
            root,
            config(),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
            source,
            None,
            blocked_items,
            &crate::test_support::test_job_id(),
        )
    }

    fn import(root: &VaultRoot, source: &Path) -> Result<ImportedVault> {
        import_with(root, source, BlockedItems::Refuse)
    }

    /// The blocked items an import answered with, as `(path, reason)`.
    fn blocked(err: UprivError) -> (usize, Vec<(String, ImportBlockReason)>) {
        let UprivError::ImportBlocked { count, items, .. } = err else {
            panic!("expected ImportBlocked, got {err:?}");
        };
        let items = items
            .into_iter()
            .map(|item| (item.path, item.reason))
            .collect();
        (count, items)
    }

    #[test]
    fn a_missing_file_blocks_the_import_and_leaves_no_vault() {
        let (_tmp, root) = crate::test_support::vault_root_with(&[]);
        let err = import(&root, &_tmp.path().join("gone.txt")).unwrap_err();
        assert_eq!(
            blocked(err),
            (1, vec![("gone.txt".into(), ImportBlockReason::Missing)])
        );
        assert!(!root.vault_dir("notes").unwrap().host_exists());
    }

    #[test]
    fn a_chosen_item_that_blocks_refuses_even_an_import_without_it() {
        let (_tmp, root) = crate::test_support::vault_root_with(&[]);
        let err =
            import_with(&root, &_tmp.path().join("gone"), BlockedItems::LeaveOut).unwrap_err();
        assert!(matches!(err, UprivError::ImportBlocked { whole: true, .. }));
        assert!(!root.vault_dir("notes").unwrap().host_exists());
    }

    #[cfg(unix)]
    #[test]
    fn an_import_without_the_blocked_items_takes_the_rest_and_counts_them() {
        use std::os::unix::fs::PermissionsExt;
        if reads_everything() {
            return;
        }
        let (_tmp, root) = crate::test_support::vault_root_with(&[]);
        let dir = _tmp.path().join("Work");
        fs::create_dir_all(dir.join("db")).unwrap();
        fs::create_dir_all(dir.join("notes")).unwrap();
        fs::write(dir.join("notes/a.txt"), b"alpha").unwrap();
        fs::write(dir.join("notes/locked.txt"), b"secret").unwrap();
        fs::write(dir.join("db/data"), b"rows").unwrap();
        let _socket = std::os::unix::net::UnixListener::bind(dir.join("notes/agent.sock")).unwrap();
        let mode = |path: &Path, bits: u32| {
            fs::set_permissions(path, fs::Permissions::from_mode(bits)).unwrap();
        };
        mode(&dir.join("notes/locked.txt"), 0o000);
        mode(&dir.join("db"), 0o000);

        let imported = import_with(&root, &dir, BlockedItems::LeaveOut);
        mode(&dir.join("db"), 0o755);
        let imported = imported.unwrap();
        assert_eq!(imported.left_out, 3);
        crate::open_vault(&root, "notes", b"pass-word-ok").unwrap();
        assert_eq!(
            crate::vault::fs::fs_read_file(&root, "notes", "/notes/a.txt").unwrap(),
            b"alpha"
        );
        let json = serde_json::to_string(&crate::vault::fs::fs_list_tree(&root, "notes").unwrap())
            .unwrap();
        // A folder that could not be read is not made as an empty one.
        assert!(!json.contains("\"db\""), "{json}");
        assert!(!json.contains("locked.txt"), "{json}");
        assert!(!json.contains("agent.sock"), "{json}");
        crate::close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn every_item_is_counted_and_the_first_ones_are_named_in_path_order() {
        let mut list = Blocked::default();
        for index in (0..IMPORT_BLOCKED_LIST_MAX + 3).rev() {
            list.add(format!("Docs/{index:04}"), ImportBlockReason::Permission);
        }
        let (count, items) = blocked(list.into_error());
        assert_eq!(count, IMPORT_BLOCKED_LIST_MAX + 3);
        assert_eq!(items.len(), IMPORT_BLOCKED_LIST_MAX);
        assert!(items.windows(2).all(|pair| pair[0].0 < pair[1].0));
    }

    /// Whether this process reads files whatever their mode (root does).
    #[cfg(unix)]
    fn reads_everything() -> bool {
        // SAFETY: `geteuid` has no preconditions.
        unsafe { libc::geteuid() == 0 }
    }

    #[cfg(unix)]
    #[test]
    fn every_item_that_blocks_is_named_and_no_vault_is_made() {
        use std::os::unix::fs::PermissionsExt;
        if reads_everything() {
            return;
        }
        let (_tmp, root) = crate::test_support::vault_root_with(&[]);
        let dir = _tmp.path().join("Work");
        fs::create_dir_all(dir.join("db")).unwrap();
        fs::create_dir_all(dir.join("notes")).unwrap();
        fs::write(dir.join("notes/a.txt"), b"alpha").unwrap();
        fs::write(dir.join("notes/locked.txt"), b"secret").unwrap();
        fs::write(dir.join("db/data"), b"rows").unwrap();
        let _socket = std::os::unix::net::UnixListener::bind(dir.join("notes/agent.sock")).unwrap();
        let mode = |path: &Path, bits: u32| {
            fs::set_permissions(path, fs::Permissions::from_mode(bits)).unwrap();
        };
        mode(&dir.join("notes/locked.txt"), 0o000);
        mode(&dir.join("db"), 0o000);

        let err = import(&root, &dir).unwrap_err();
        mode(&dir.join("db"), 0o755);
        assert_eq!(
            blocked(err),
            (
                3,
                vec![
                    ("Work/db".into(), ImportBlockReason::Permission),
                    ("Work/notes/agent.sock".into(), ImportBlockReason::Special),
                    (
                        "Work/notes/locked.txt".into(),
                        ImportBlockReason::Permission
                    ),
                ]
            )
        );
        assert!(!root.vault_dir("notes").unwrap().host_exists());
    }

    #[cfg(unix)]
    #[test]
    fn a_file_that_blocks_the_copy_ends_it_and_the_rest_is_only_checked() {
        use std::os::unix::fs::PermissionsExt;
        if reads_everything() {
            return;
        }
        let (_tmp, root) = crate::test_support::vault_root_with(&[]);
        let dir = _tmp.path().join("Album");
        fs::create_dir_all(&dir).unwrap();
        for name in ["a.txt", "b.txt", "c.txt", "d.txt"] {
            fs::write(dir.join(name), name.as_bytes()).unwrap();
        }
        // Planning reads no file, so these block once the copy has begun.
        for name in ["b.txt", "d.txt"] {
            fs::set_permissions(dir.join(name), fs::Permissions::from_mode(0o000)).unwrap();
        }

        let err = import(&root, &dir).unwrap_err();
        assert_eq!(
            blocked(err),
            (
                2,
                vec![
                    ("Album/b.txt".into(), ImportBlockReason::Permission),
                    ("Album/d.txt".into(), ImportBlockReason::Permission),
                ]
            )
        );
        assert!(!root.vault_dir("notes").unwrap().host_exists());
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_inside_the_folder_is_skipped_not_followed() {
        let (_tmp, root) = crate::test_support::vault_root_with(&[]);
        let dir = _tmp.path().join("Album");
        fs::create_dir_all(dir.join("bin")).unwrap();
        fs::write(dir.join("photo.txt"), b"kept").unwrap();
        let real = _tmp.path().join("secret.txt");
        let mut file = fs::File::create(&real).unwrap();
        file.write_all(b"outside-the-folder").unwrap();
        std::os::unix::fs::symlink(&real, dir.join("link.txt")).unwrap();
        std::os::unix::fs::symlink(_tmp.path(), dir.join("bin/up")).unwrap();

        import(&root, &dir).unwrap();
        crate::open_vault(&root, "notes", b"pass-word-ok").unwrap();
        assert_eq!(
            crate::vault::fs::fs_read_file(&root, "notes", "/photo.txt").unwrap(),
            b"kept"
        );
        let json = serde_json::to_string(&crate::vault::fs::fs_list_tree(&root, "notes").unwrap())
            .unwrap();
        assert!(json.contains("bin"), "{json}");
        assert!(!json.contains("link.txt"), "{json}");
        assert!(!json.contains("\"up\""), "{json}");
        crate::close_vault(&root, "notes").unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_chosen_symlink_is_refused_and_leaves_no_vault() {
        let (_tmp, root) = crate::test_support::vault_root_with(&[]);
        let real = _tmp.path().join("Album");
        fs::create_dir(&real).unwrap();
        let link = _tmp.path().join("Shortcut");
        std::os::unix::fs::symlink(&real, &link).unwrap();

        let err = import(&root, &link).unwrap_err();
        assert_eq!(
            blocked(err),
            (1, vec![("Shortcut".into(), ImportBlockReason::Link)])
        );
        assert!(!root.vault_dir("notes").unwrap().host_exists());
    }

    #[test]
    fn a_streamed_tree_is_stored_then_closed() {
        let (_tmp, root) = crate::test_support::vault_root_with(&[]);
        crate::create_vault(&root, config(), b"pass-word-ok", KdfUnlockPreset::M32).unwrap();
        open_import_session(&root, "notes", b"pass-word-ok").unwrap();
        ingest_import_directory(&root, "notes", "empty").unwrap();
        ingest_import_directory(&root, "notes", "trip").unwrap();
        ingest_import_reader(&root, "notes", "trip/a.txt", &mut &b"alpha"[..], &job()).unwrap();
        finish_import_session(&root, "notes", ImportEnd::Whole).unwrap();
        let backups = root.vault_dir("notes").unwrap().join("backups");
        let zip_count = backups.read_dir().map_or(0, |entries| {
            entries
                .flatten()
                .filter(|entry| {
                    entry.path().extension().and_then(|ext| ext.to_str()) == Some("zip")
                })
                .count()
        });
        assert_eq!(zip_count, 0, "creating a vault must not snapshot it");

        crate::open_vault(&root, "notes", b"pass-word-ok").unwrap();
        assert_eq!(
            crate::vault::fs::fs_read_file(&root, "notes", "/trip/a.txt").unwrap(),
            b"alpha"
        );
        let listed = crate::vault::fs::fs_list_tree(&root, "notes").unwrap();
        let json = serde_json::to_string(&listed).unwrap();
        assert!(json.contains("empty"), "{json}");
        crate::close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn a_reserved_stream_name_aborts_and_leaves_no_vault() {
        let (_tmp, root) = crate::test_support::vault_root_with(&[]);
        crate::create_vault(&root, config(), b"pass-word-ok", KdfUnlockPreset::M32).unwrap();
        open_import_session(&root, "notes", b"pass-word-ok").unwrap();
        ingest_import_reader(&root, "notes", "ok.txt", &mut &b"keep"[..], &job()).unwrap();
        let err = ingest_import_reader(&root, "notes", "upriv-seed.txt", &mut &b"no"[..], &job())
            .unwrap_err();
        assert!(matches!(err, UprivError::VaultStoreInvalid { .. }));
        abort_import_vault(&root, "notes").unwrap();
        assert!(!root.vault_dir("notes").unwrap().host_exists());
    }

    #[test]
    fn a_document_whose_read_fails_says_why_and_leaves_no_file() {
        struct Refused;
        impl Read for Refused {
            fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
                Err(std::io::ErrorKind::PermissionDenied.into())
            }
        }
        let (_tmp, root) = crate::test_support::vault_root_with(&[]);
        crate::create_vault(&root, config(), b"pass-word-ok", KdfUnlockPreset::M32).unwrap();
        open_import_session(&root, "notes", b"pass-word-ok").unwrap();
        let err = ingest_import_reader(&root, "notes", "db.bin", &mut Refused, &job()).unwrap_err();
        assert!(matches!(
            err,
            UprivError::ImportSourceUnreadable {
                reason: ImportBlockReason::Permission,
                ..
            }
        ));
        ingest_import_reader(&root, "notes", "ok.txt", &mut &b"keep"[..], &job()).unwrap();
        finish_import_session(&root, "notes", ImportEnd::Whole).unwrap();
        crate::open_vault(&root, "notes", b"pass-word-ok").unwrap();
        assert!(crate::vault::fs::fs_read_file(&root, "notes", "/db.bin").is_err());
        assert!(crate::vault::fs::fs_read_file(&root, "notes", "/ok.txt").is_ok());
        crate::close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn a_stopped_file_import_leaves_no_file() {
        let (_tmp, root) = crate::test_support::vault_root_with(&[]);
        crate::create_vault(&root, config(), b"pass-word-ok", KdfUnlockPreset::M32).unwrap();
        open_import_session(&root, "notes", b"pass-word-ok").unwrap();
        let id = job();
        crate::session::cancel_job(&id).unwrap();
        let err =
            ingest_import_reader(&root, "notes", "big.bin", &mut &b"bytes"[..], &id).unwrap_err();
        assert!(matches!(err, UprivError::JobCancelled));
        finish_import_session(&root, "notes", ImportEnd::Whole).unwrap();
        crate::open_vault(&root, "notes", b"pass-word-ok").unwrap();
        assert!(crate::vault::fs::fs_read_file(&root, "notes", "/big.bin").is_err());
        crate::close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn a_phone_import_keeps_its_mark_until_it_finishes() {
        let (_tmp, root) = crate::test_support::vault_root_with(&[]);
        crate::create_vault_as_job(
            &root,
            config(),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
            None,
            true,
            &job(),
        )
        .unwrap();
        let marked = || {
            crate::config::load_vault_config(root.vault_dir("notes").unwrap())
                .unwrap()
                .importing
                .is_some()
        };
        assert!(marked());
        // The create left no record: what fills the vault is the mark's.
        assert!(crate::runtime_state::load_runtime_state(&root)
            .unwrap()
            .unfinished_imports
            .is_empty());
        open_import_session(&root, "notes", b"pass-word-ok").unwrap();
        ingest_import_reader(&root, "notes", "a.txt", &mut &b"alpha"[..], &job()).unwrap();
        finish_import_session(&root, "notes", ImportEnd::Whole).unwrap();
        assert!(!marked());
        let row = crate::vault::list_vaults(&root).unwrap().remove(0);
        assert_eq!(row.session, None);
        assert!(!row.import_unfinished);
    }

    #[cfg(unix)]
    #[test]
    fn a_phone_import_drops_its_mark_only_once_every_file_is_sealed() {
        use std::os::unix::fs::PermissionsExt;

        let (_tmp, root) = crate::test_support::vault_root_with(&[]);
        crate::create_vault_as_job(
            &root,
            config(),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
            None,
            true,
            &job(),
        )
        .unwrap();
        open_import_session(&root, "notes", b"pass-word-ok").unwrap();
        ingest_import_reader(&root, "notes", "a.txt", &mut &b"alpha"[..], &job()).unwrap();
        let marked = || {
            crate::config::load_vault_config(root.vault_dir("notes").unwrap())
                .unwrap()
                .importing
                .is_some()
        };
        let index_dir = root
            .vault_store_dir("notes")
            .unwrap()
            .join(crate::store::INDEX_DIR_NAME);
        let restore = crate::host_fs::metadata(&index_dir).unwrap().permissions();
        let mut locked = restore.clone();
        locked.set_mode(0o555);
        crate::host_fs::set_permissions(&index_dir, locked).unwrap();
        let finished = finish_import_session(&root, "notes", ImportEnd::Whole);
        crate::host_fs::set_permissions(&index_dir, restore).unwrap();
        if finished.is_ok() {
            // Running as root: the lock did not apply.
            return;
        }
        assert!(marked(), "the seal failed, so the vault is not whole");
        assert!(crate::session::is_vault_open_at(
            &root.vault_dir("notes").unwrap()
        ));

        finish_import_session(&root, "notes", ImportEnd::Whole).unwrap();
        assert!(!marked());
        crate::open_vault(&root, "notes", b"pass-word-ok").unwrap();
        assert_eq!(
            crate::vault::fs::fs_read_file(&root, "notes", "/a.txt").unwrap(),
            b"alpha"
        );
        crate::close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn a_new_vault_never_takes_the_marks_its_settings_carry() {
        let (_tmp, root) = crate::test_support::vault_root_with(&[]);
        let mut carried = config();
        carried.deleting = Some(crate::config::vault_config::VaultDeletingSection {
            outside_backups: true,
        });
        carried.importing = Some(crate::config::vault_config::VaultImportingSection {
            started_at: "2026-11-24T00:20:46.000Z".into(),
        });
        crate::create_vault(&root, carried, b"pass-word-ok", KdfUnlockPreset::M32).unwrap();
        let made = crate::config::load_vault_config(root.vault_dir("notes").unwrap()).unwrap();
        assert_eq!(made.deleting, None);
        assert_eq!(made.importing, None);
    }

    fn job() -> String {
        crate::test_support::test_job_id()
    }
}
