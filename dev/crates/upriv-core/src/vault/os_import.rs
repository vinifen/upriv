//! Import one OS file, or the contents of one OS folder, into a new vault.
//!
//! A real filesystem path is streamed straight into `store/`. Symlinks are
//! never followed: a chosen link is refused, a link inside the folder is
//! skipped. Android folder picks have no filesystem path:
//! the app creates the vault, opens an ingest session (no mount), and streams
//! each content URI through [`ingest_import_reader`]. Neither path copies the
//! source tree onto disk.

#[allow(unused_imports)]
use crate::host_fs::HostFsQuery;
use crate::host_fs::{self as fs, File};
use std::collections::HashSet;
use std::io::Read;
use std::path::{Path, PathBuf};

use crate::config::VaultConfig;
use crate::error::{Result, UprivError};
use crate::logging::{log_event, LogLevel};
use crate::paths::VaultRoot;
use crate::store::{is_plain_internal, is_reserved_logical, KdfUnlockPreset};

use super::create::create_vault;
use super::fs::{
    fs_ensure_folder, fs_ensure_folder_path_staged, fs_seal_staged_imports, fs_seal_staged_wave,
    fs_write_send_reader, fs_write_staged,
};
use super::open_close::{
    abandon_failed_import, close_vault, delete_failed_import, open_vault_for_ingest,
};
use super::seven_zip_pack::sevenz_member_name_unsafe;
use super::welcome::{seal_welcome_if_absent, VaultWelcome};

enum PlannedOsEntry {
    Directory(String),
    File { logical: String, source: PathBuf },
}

struct PlannedOs {
    entries: Vec<PlannedOsEntry>,
}

fn layout_error(path: &Path, detail: impl Into<String>) -> UprivError {
    UprivError::VaultStoreInvalid {
        path: path.to_path_buf(),
        detail: detail.into(),
    }
}

/// The chosen file or folder could not be read. Not a vault-root `io_error`.
fn source_unreadable(path: &Path) -> UprivError {
    UprivError::ImportSourceUnreadable(path.to_path_buf())
}

fn os_name(path: &Path) -> Result<String> {
    let raw = path
        .file_name()
        .ok_or_else(|| layout_error(path, "the chosen path has no name"))?;
    raw.to_str()
        .map(|name| name.to_string())
        .ok_or_else(|| layout_error(path, "the file name is not Unicode"))
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
/// must not be a link. Plaintext-folder names are skipped in every mode.
fn plan_os_path(source: &Path) -> Result<PlannedOs> {
    if !source.is_absolute() {
        return Err(layout_error(source, "choose an absolute file or folder"));
    }
    let meta = fs::symlink_metadata(source).map_err(|_| source_unreadable(source))?;
    if meta.file_type().is_symlink() {
        return Err(layout_error(source, "refusing a symlink"));
    }
    if meta.host_is_file() {
        let logical = os_name(source)?;
        if logical_name_rejected(&logical) {
            return Err(layout_error(source, "reserved or unsafe file name"));
        }
        return Ok(PlannedOs {
            entries: vec![PlannedOsEntry::File {
                logical,
                source: source.to_path_buf(),
            }],
        });
    }
    if !meta.host_is_dir() {
        return Err(layout_error(source, "choose a file or a folder"));
    }

    let mut planned = PlannedOs {
        entries: Vec::new(),
    };
    let mut links = 0usize;
    let mut stack = vec![(source.to_path_buf(), String::new())];
    while let Some((dir, prefix)) = stack.pop() {
        let dir_meta = fs::symlink_metadata(&dir).map_err(|_| source_unreadable(&dir))?;
        if dir_meta.file_type().is_symlink() || !dir_meta.host_is_dir() {
            return Err(layout_error(&dir, "refusing a symlink"));
        }
        let mut children = fs::read_dir(&dir)
            .map_err(|_| source_unreadable(&dir))?
            .collect::<std::io::Result<Vec<_>>>()
            .map_err(|_| source_unreadable(&dir))?;
        children.sort_by_key(|entry| entry.file_name());
        for entry in children {
            let path = entry.path();
            let child_meta = fs::symlink_metadata(&path).map_err(|_| source_unreadable(&path))?;
            if child_meta.file_type().is_symlink() {
                links += 1;
                continue;
            }
            let name = os_name(&path)?;
            let logical = if prefix.is_empty() {
                name
            } else {
                format!("{prefix}/{name}")
            };
            if is_plain_internal(&logical) {
                continue;
            }
            let supported = child_meta.host_is_dir() || child_meta.host_is_file();
            if !supported || logical_name_rejected(&logical) {
                return Err(if supported {
                    layout_error(&path, "reserved or unsafe file name")
                } else {
                    layout_error(&path, "unsupported file type")
                });
            }
            if child_meta.host_is_dir() {
                planned
                    .entries
                    .push(PlannedOsEntry::Directory(logical.clone()));
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

/// Open a regular file without following a symlink that replaced it after planning.
fn open_regular_file(path: &Path) -> Result<File> {
    match crate::paths::open_nofollow(path, crate::paths::NofollowMode::Read) {
        Ok(file) => Ok(file),
        Err(error) => match crate::paths::nofollow_reject(&error) {
            Some(crate::paths::NofollowReject::NonFile) => {
                Err(layout_error(path, "unsupported file type"))
            }
            Some(crate::paths::NofollowReject::Symlink) => {
                Err(layout_error(path, "refusing a symlink"))
            }
            None => Err(source_unreadable(path)),
        },
    }
}

/// Stage every entry. A full wave seals the index, and the tail is sealed once
/// at the end. A returned error still abandons the new vault. A kill keeps the
/// last sealed wave.
fn ingest_planned(root: &VaultRoot, vault_id: &str, planned: &[PlannedOsEntry]) -> Result<()> {
    let mut folders = HashSet::new();
    for entry in planned {
        match entry {
            PlannedOsEntry::Directory(logical) => {
                fs_ensure_folder_path_staged(root, vault_id, logical, &mut folders)?
            }
            PlannedOsEntry::File { logical, source } => {
                let mut file = open_regular_file(source)?;
                if let Some((parent, _)) = logical.rsplit_once('/') {
                    fs_ensure_folder_path_staged(root, vault_id, parent, &mut folders)?;
                }
                fs_write_staged(root, vault_id, &format!("/{logical}"), &mut file)?;
            }
        }
        fs_seal_staged_wave(root, vault_id)?;
    }
    fs_seal_staged_imports(root, vault_id)?;
    Ok(())
}

/// Create the vault, stream `planned` into it, and close it. A failure deletes
/// the new vault.
fn import_planned(
    root: &VaultRoot,
    config: VaultConfig,
    new_password: &[u8],
    preset: KdfUnlockPreset,
    planned: &PlannedOs,
    welcome: Option<VaultWelcome<'_>>,
) -> Result<String> {
    create_vault(root, config.clone(), new_password, preset)?;
    let id = config.vault.id.trim().to_string();
    let ingest = (|| {
        open_vault_for_ingest(root, &id, new_password)?;
        ingest_planned(root, &id, &planned.entries)?;
        if let Some(welcome) = welcome {
            seal_welcome_if_absent(root, &id, welcome)?;
        }
        Ok(())
    })();
    if let Err(ingest_error) = ingest {
        return Err(abandon_failed_import(root, &id, ingest_error));
    }
    close_vault(root, &id)?;
    log_event(LogLevel::Info, "vault_imported", &[("id", id.as_str())]);
    Ok(id)
}

/// Create a vault and stream `source` into it.
///
/// A file becomes that one document. A folder's children become the vault
/// root, including subfolders. The folder's own name is not added as a prefix.
pub fn import_logical_os_path(
    root: &VaultRoot,
    config: VaultConfig,
    new_password: &[u8],
    preset: KdfUnlockPreset,
    source: &Path,
    welcome: Option<VaultWelcome<'_>>,
) -> Result<String> {
    if new_password.is_empty() {
        return Err(UprivError::WrongPassword);
    }
    if let Some(welcome) = welcome {
        welcome.files()?;
    }
    let planned = plan_os_path(source)?;
    import_planned(root, config, new_password, preset, &planned, welcome)
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

/// Stream one document into an import session. One commit for the whole file.
pub fn ingest_import_reader(
    root: &VaultRoot,
    vault_id: &str,
    logical_path: &str,
    reader: &mut (impl Read + Send + ?Sized),
) -> Result<()> {
    ingest_import_reader_at(root, vault_id, logical_path, reader, false)
}

/// Stream one document without sealing the index.
/// [`crate::fs_seal_staged_imports`] writes the index for the staged files.
pub fn ingest_import_reader_staged(
    root: &VaultRoot,
    vault_id: &str,
    logical_path: &str,
    reader: &mut (impl Read + Send + ?Sized),
) -> Result<()> {
    ingest_import_reader_at(root, vault_id, logical_path, reader, true)
}

fn ingest_import_reader_at(
    root: &VaultRoot,
    vault_id: &str,
    logical_path: &str,
    reader: &mut (impl Read + Send + ?Sized),
    defer_index: bool,
) -> Result<()> {
    let logical = normalize_import_logical(logical_path)?;
    if let Some((parent, _)) = logical.rsplit_once('/') {
        ensure_folder_path(root, vault_id, parent)?;
    }
    fs_write_send_reader(root, vault_id, &format!("/{logical}"), reader, defer_index)?;
    Ok(())
}

/// Drop an in-progress import without flushing a backup, then delete the vault.
pub fn abort_import_vault(root: &VaultRoot, vault_id: &str) -> Result<()> {
    delete_failed_import(root, vault_id)
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
        )
        .unwrap();
        crate::open_vault(&root, "notes", b"pass-word-ok").unwrap();
        assert_eq!(
            crate::vault::fs::fs_read_file(&root, "notes", "/note.txt").unwrap(),
            b"one-file"
        );
        crate::close_vault(&root, "notes").unwrap();
        crate::delete_vault(&root, "notes").unwrap();

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

    #[test]
    fn a_missing_file_is_unreadable_and_leaves_no_vault() {
        let (_tmp, root) = crate::test_support::vault_root_with(&[]);
        let missing = _tmp.path().join("gone.txt");
        let err = import_logical_os_path(
            &root,
            config(),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
            &missing,
            None,
        )
        .unwrap_err();
        assert!(matches!(err, UprivError::ImportSourceUnreadable(_)));
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

        import_logical_os_path(
            &root,
            config(),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
            &dir,
            None,
        )
        .unwrap();
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

        let err = import_logical_os_path(
            &root,
            config(),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
            &link,
            None,
        )
        .unwrap_err();
        assert!(matches!(err, UprivError::VaultStoreInvalid { .. }));
        assert!(!root.vault_dir("notes").unwrap().host_exists());
    }

    #[test]
    fn a_streamed_tree_is_stored_then_closed() {
        let (_tmp, root) = crate::test_support::vault_root_with(&[]);
        crate::create_vault(&root, config(), b"pass-word-ok", KdfUnlockPreset::M32).unwrap();
        open_import_session(&root, "notes", b"pass-word-ok").unwrap();
        ingest_import_directory(&root, "notes", "empty").unwrap();
        ingest_import_reader(&root, "notes", "trip/a.txt", &mut &b"alpha"[..]).unwrap();
        crate::close_vault(&root, "notes").unwrap();
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
        ingest_import_reader(&root, "notes", "ok.txt", &mut &b"keep"[..]).unwrap();
        let err =
            ingest_import_reader(&root, "notes", "upriv-seed.txt", &mut &b"no"[..]).unwrap_err();
        assert!(matches!(err, UprivError::VaultStoreInvalid { .. }));
        abort_import_vault(&root, "notes").unwrap();
        assert!(!root.vault_dir("notes").unwrap().host_exists());
    }
}
