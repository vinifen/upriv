//! Import one OS file, or the contents of one OS folder, into a new vault.
//!
//! A real filesystem path is streamed straight into `store/`. Symlinks are
//! refused rather than followed. Android folder picks have no filesystem path:
//! the app creates the vault, opens an ingest session (no mount), and streams
//! each content URI through [`ingest_import_reader`]. Neither path copies the
//! source tree onto disk.

use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};

use crate::config::VaultConfig;
use crate::error::{Result, UprivError};
use crate::logging::{log_event, LogLevel};
use crate::paths::VaultRoot;
use crate::store::{file_name, KdfUnlockPreset, INTERNAL_WORKSPACE_FILE, SEED_LOGICAL_PATH};

use super::create::create_vault;
use super::fs::{fs_ensure_folder, fs_write_from_reader};
use super::open_close::{
    abandon_failed_import, close_vault, delete_failed_import, open_vault_for_ingest,
};
use super::seven_zip_pack::sevenz_member_name_unsafe;

enum PlannedOsEntry {
    Directory(String),
    File { logical: String, source: PathBuf },
}

fn layout_error(path: &Path, detail: impl Into<String>) -> UprivError {
    UprivError::VaultStoreInvalid {
        path: path.to_path_buf(),
        detail: detail.into(),
    }
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
    sevenz_member_name_unsafe(logical)
        || logical == SEED_LOGICAL_PATH
        || file_name(logical) == INTERNAL_WORKSPACE_FILE
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
fn plan_os_path(source: &Path) -> Result<Vec<PlannedOsEntry>> {
    if !source.is_absolute() {
        return Err(layout_error(source, "choose an absolute file or folder"));
    }
    let meta = fs::symlink_metadata(source)?;
    if meta.file_type().is_symlink() {
        return Err(layout_error(source, "refusing a symlink"));
    }
    if meta.is_file() {
        let logical = os_name(source)?;
        if logical_name_rejected(&logical) {
            return Err(layout_error(source, "reserved or unsafe file name"));
        }
        return Ok(vec![PlannedOsEntry::File {
            logical,
            source: source.to_path_buf(),
        }]);
    }
    if !meta.is_dir() {
        return Err(layout_error(source, "choose a file or a folder"));
    }

    let mut planned = Vec::new();
    let mut stack = vec![(source.to_path_buf(), String::new())];
    while let Some((dir, prefix)) = stack.pop() {
        let dir_meta = fs::symlink_metadata(&dir)?;
        if dir_meta.file_type().is_symlink() || !dir_meta.is_dir() {
            return Err(layout_error(&dir, "refusing a symlink"));
        }
        let mut children = fs::read_dir(&dir)?.collect::<std::io::Result<Vec<_>>>()?;
        children.sort_by_key(|entry| entry.file_name());
        for entry in children {
            let path = entry.path();
            let child_meta = fs::symlink_metadata(&path)?;
            if child_meta.file_type().is_symlink() {
                return Err(layout_error(&path, "refusing a symlink"));
            }
            let name = os_name(&path)?;
            let logical = if prefix.is_empty() {
                name
            } else {
                format!("{prefix}/{name}")
            };
            if logical_name_rejected(&logical) {
                return Err(layout_error(&path, "reserved or unsafe file name"));
            }
            if child_meta.is_dir() {
                planned.push(PlannedOsEntry::Directory(logical.clone()));
                stack.push((path, logical));
            } else if child_meta.is_file() {
                planned.push(PlannedOsEntry::File {
                    logical,
                    source: path,
                });
            } else {
                return Err(layout_error(&path, "unsupported file type"));
            }
        }
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
            None => Err(error.into()),
        },
    }
}

fn ingest_planned(root: &VaultRoot, vault_id: &str, planned: &[PlannedOsEntry]) -> Result<()> {
    for entry in planned {
        match entry {
            PlannedOsEntry::Directory(logical) => ensure_folder_path(root, vault_id, logical)?,
            PlannedOsEntry::File { logical, source } => {
                if let Some((parent, _)) = logical.rsplit_once('/') {
                    ensure_folder_path(root, vault_id, parent)?;
                }
                let mut file = open_regular_file(source)?;
                fs_write_from_reader(root, vault_id, &format!("/{logical}"), &mut file)?;
            }
        }
    }
    Ok(())
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
) -> Result<String> {
    if new_password.is_empty() {
        return Err(UprivError::WrongPassword);
    }
    let planned = plan_os_path(source)?;
    create_vault(root, config.clone(), new_password, preset)?;
    let id = config.vault.id.trim().to_string();
    let ingest = (|| {
        open_vault_for_ingest(root, &id, new_password)?;
        ingest_planned(root, &id, &planned)
    })();
    if let Err(ingest_error) = ingest {
        return Err(abandon_failed_import(root, &id, ingest_error));
    }
    close_vault(root, &id, Some(new_password))?;
    log_event(LogLevel::Info, "vault_imported", &[("id", id.as_str())]);
    Ok(id)
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
    reader: &mut (impl Read + ?Sized),
) -> Result<()> {
    let logical = normalize_import_logical(logical_path)?;
    if let Some((parent, _)) = logical.rsplit_once('/') {
        ensure_folder_path(root, vault_id, parent)?;
    }
    fs_write_from_reader(root, vault_id, &format!("/{logical}"), reader)?;
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
    use std::fs;
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
        )
        .unwrap();
        crate::open_vault(&root, "notes", b"pass-word-ok").unwrap();
        assert_eq!(
            crate::vault::fs::fs_read_file(&root, "notes", "/note.txt").unwrap(),
            b"one-file"
        );
        crate::close_vault(&root, "notes", None).unwrap();
        crate::delete_vault(&root, "notes").unwrap();

        import_logical_os_path(&root, config(), b"pass-word-ok", KdfUnlockPreset::M32, &dir)
            .unwrap();
        crate::open_vault(&root, "notes", b"pass-word-ok").unwrap();
        assert_eq!(
            crate::vault::fs::fs_read_file(&root, "notes", "/trip/a.txt").unwrap(),
            b"alpha"
        );
        let listed = crate::vault::fs::fs_list_tree(&root, "notes").unwrap();
        let json = serde_json::to_string(&listed).unwrap();
        assert!(json.contains("empty"), "{json}");
        assert!(!json.contains("Photos"), "{json}");
        crate::close_vault(&root, "notes", None).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_is_refused_and_leaves_no_vault() {
        let (_tmp, root) = crate::test_support::vault_root_with(&[]);
        let dir = _tmp.path().join("Album");
        fs::create_dir(&dir).unwrap();
        let real = _tmp.path().join("secret.txt");
        let mut file = fs::File::create(&real).unwrap();
        file.write_all(b"nope").unwrap();
        std::os::unix::fs::symlink(&real, dir.join("link.txt")).unwrap();

        let err =
            import_logical_os_path(&root, config(), b"pass-word-ok", KdfUnlockPreset::M32, &dir)
                .unwrap_err();
        assert!(matches!(err, UprivError::VaultStoreInvalid { .. }));
        assert!(!root.vault_dir("notes").unwrap().exists());
    }

    #[test]
    fn a_streamed_tree_is_stored_then_closed() {
        let (_tmp, root) = crate::test_support::vault_root_with(&[]);
        crate::create_vault(&root, config(), b"pass-word-ok", KdfUnlockPreset::M32).unwrap();
        open_import_session(&root, "notes", b"pass-word-ok").unwrap();
        ingest_import_directory(&root, "notes", "empty").unwrap();
        ingest_import_reader(&root, "notes", "trip/a.txt", &mut &b"alpha"[..]).unwrap();
        crate::close_vault(&root, "notes", Some(b"pass-word-ok")).unwrap();
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
        crate::close_vault(&root, "notes", None).unwrap();
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
        assert!(!root.vault_dir("notes").unwrap().exists());
    }
}
