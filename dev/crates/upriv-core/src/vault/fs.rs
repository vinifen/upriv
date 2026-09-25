//! Session-backed logical file operations. Mutations seal the index.
//! Each OS import seals before it returns so a kill cannot drop the new file.

use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

use zeroize::Zeroize;

use crate::error::{Result, UprivError};
use crate::logging::{log_event, LogLevel};
use crate::paths::VaultRoot;
use crate::session::{with_open_session, OpenSession};
use crate::store::{
    build_file_tree, child_logical_path, delete_empty_directory, delete_logical_path,
    ensure_folder, file_name, flush_index_parts, from_ui_path, mkdir_logical, move_logical_path,
    read_logical_file, read_logical_range, relocate_logical_path, relocate_replacing,
    remove_file_chunks, rename_logical_path, to_ui_path, truncate_logical_file, unique_file_name,
    unique_folder_name, write_logical_file, write_logical_range, ChunkBlobMutation, FileTreeNode,
    RetiredFileChunks, VaultIndex, INTERNAL_WORKSPACE_FILE, SEED_LOGICAL_PATH,
    VAULT_FS_MAX_INLINE_BYTES,
};

fn store_dir(session: &OpenSession) -> std::path::PathBuf {
    session.vault_dir.join(crate::paths::STORE_DIR_NAME)
}

fn commit(session: &mut OpenSession) -> Result<()> {
    let store = store_dir(session);
    flush_index_parts(&store, &session.header, &session.index_key, &session.index)?;
    session.dirty = false;
    session.tree_revision = session.tree_revision.saturating_add(1);
    Ok(())
}

fn commit_or_restore(session: &mut OpenSession, before: VaultIndex) -> Result<()> {
    match commit(session) {
        Ok(()) => Ok(()),
        Err(error) => {
            session.index = before;
            Err(error)
        }
    }
}

/// Seal `session.index`, then unlink `retired` blobs. A failed seal restores
/// the previous index and leaves blobs in place. After a successful seal the
/// logical delete has landed; a failed unlink leaves orphan ciphertext and is
/// logged instead of being reported as a failed delete.
fn commit_then_unlink(
    session: &mut OpenSession,
    before: VaultIndex,
    retired: Vec<RetiredFileChunks>,
) -> Result<()> {
    if let Err(error) = commit(session) {
        session.index = before;
        return Err(error);
    }
    let store = store_dir(session);
    for item in &retired {
        if remove_file_chunks(&store, &item.file_id, item.chunk_count).is_err() {
            log_event(
                LogLevel::Warn,
                "vault_fs_leftover_blobs",
                &[
                    ("vault_id", session.vault_id.as_str()),
                    ("file_id", item.file_id.as_str()),
                    ("chunk_count", &item.chunk_count.to_string()),
                ],
            );
        }
    }
    Ok(())
}

fn commit_mutation(
    session: &mut OpenSession,
    before: VaultIndex,
    mutation: ChunkBlobMutation,
    retired: Option<RetiredFileChunks>,
) -> Result<()> {
    match commit(session) {
        Ok(()) => {
            mutation.delete_superseded();
            if let Some(retired) = retired {
                let _ =
                    remove_file_chunks(&store_dir(session), &retired.file_id, retired.chunk_count);
            }
            Ok(())
        }
        Err(error) => {
            session.index = before;
            mutation.discard_created();
            Err(error)
        }
    }
}

fn require_open(root: &VaultRoot, vault_id: &str) -> Result<std::path::PathBuf> {
    let dir = root.vault_dir(vault_id)?;
    if !dir.is_dir() {
        return Err(UprivError::VaultNotFound(dir));
    }
    Ok(dir)
}

fn logical(ui_path: &str) -> Result<String> {
    from_ui_path(ui_path)
}

/// Missing layout file is “start clean”, not a user-visible path error (SDD).
fn is_missing_internal_workspace(err: &UprivError, logical: &str) -> bool {
    matches!(err, UprivError::VaultPathNotFound(_)) && file_name(logical) == INTERNAL_WORKSPACE_FILE
}

/// Explorer/FUSE/create/rename/delete must not touch reserved internal files.
/// Reads/writes of `.upriv-workspace.json` stay allowed for layout persistence.
fn require_user_visible_logical(path: &str) -> Result<()> {
    if file_name(path) == INTERNAL_WORKSPACE_FILE || path == SEED_LOGICAL_PATH {
        return Err(UprivError::VaultStoreInvalid {
            path: std::path::PathBuf::from(path),
            detail: "reserved internal path".into(),
        });
    }
    Ok(())
}

pub fn fs_tree_revision(root: &VaultRoot, vault_id: &str) -> Result<u64> {
    let dir = require_open(root, vault_id)?;
    with_open_session(&dir, |session| Ok(session.tree_revision))
}

pub fn fs_list_tree(root: &VaultRoot, vault_id: &str) -> Result<FileTreeNode> {
    let dir = require_open(root, vault_id)?;
    with_open_session(&dir, |session| {
        let name = crate::config::load_vault_config_raw(&session.vault_dir)
            .map(|c| c.vault.display_name)
            .unwrap_or_else(|_| session.vault_id.clone());
        Ok(build_file_tree(&session.index, &name))
    })
}

pub fn fs_read_file(root: &VaultRoot, vault_id: &str, ui_path: &str) -> Result<Vec<u8>> {
    let dir = require_open(root, vault_id)?;
    let path = logical(ui_path)?;
    with_open_session(&dir, |session| {
        if let Some(node) = session.index.find(&path) {
            if let Some((_, size, _)) = node.as_file() {
                if size > VAULT_FS_MAX_INLINE_BYTES {
                    return Err(UprivError::VaultFileTooLarge {
                        path: std::path::PathBuf::from(&path),
                        size,
                        max: VAULT_FS_MAX_INLINE_BYTES,
                    });
                }
            }
        }
        let bytes = match read_logical_file(
            store_dir(session),
            &session.header,
            &session.content_key,
            &session.index,
            &path,
        ) {
            Ok(bytes) => bytes,
            Err(err) if is_missing_internal_workspace(&err, &path) => return Ok(Vec::new()),
            Err(err) => return Err(err),
        };
        if bytes.len() as u64 > VAULT_FS_MAX_INLINE_BYTES {
            return Err(UprivError::VaultFileTooLarge {
                path: std::path::PathBuf::from(&path),
                size: bytes.len() as u64,
                max: VAULT_FS_MAX_INLINE_BYTES,
            });
        }
        Ok(bytes)
    })
}

pub fn fs_read_range(
    root: &VaultRoot,
    vault_id: &str,
    ui_path: &str,
    offset: u64,
    len: u64,
) -> Result<Vec<u8>> {
    let dir = require_open(root, vault_id)?;
    let path = logical(ui_path)?;
    if len == 0 {
        return with_open_session(&dir, |session| match session.index.find(&path) {
            Some(node) if node.as_file().is_some() => Ok(Vec::new()),
            Some(_) => Err(UprivError::VaultStoreInvalid {
                path: std::path::PathBuf::from(&path),
                detail: "logical path is a directory".into(),
            }),
            None if is_missing_internal_workspace(
                &UprivError::VaultPathNotFound(path.clone()),
                &path,
            ) =>
            {
                Ok(Vec::new())
            }
            None => Err(UprivError::VaultPathNotFound(path)),
        });
    }
    if len > VAULT_FS_MAX_INLINE_BYTES {
        return Err(UprivError::VaultFileTooLarge {
            path: std::path::PathBuf::from(&path),
            size: len,
            max: VAULT_FS_MAX_INLINE_BYTES,
        });
    }
    with_open_session(&dir, |session| {
        match read_logical_range(
            store_dir(session),
            &session.header,
            &session.content_key,
            &session.index,
            &path,
            offset,
            len,
        ) {
            Ok(bytes) => Ok(bytes),
            Err(err) if is_missing_internal_workspace(&err, &path) => Ok(Vec::new()),
            Err(err) => Err(err),
        }
    })
}

pub fn fs_write_file(root: &VaultRoot, vault_id: &str, ui_path: &str, data: &[u8]) -> Result<u64> {
    if data.len() as u64 > VAULT_FS_MAX_INLINE_BYTES {
        return Err(UprivError::VaultFileTooLarge {
            path: std::path::PathBuf::from(ui_path),
            size: data.len() as u64,
            max: VAULT_FS_MAX_INLINE_BYTES,
        });
    }
    let dir = require_open(root, vault_id)?;
    let path = logical(ui_path)?;
    with_open_session(&dir, |session| {
        session.dirty = true;
        let before = session.index.clone();
        let (retired, mutation) = write_logical_file(
            store_dir(session),
            &session.header,
            &session.content_key,
            &mut session.index,
            &path,
            data,
        )?;
        commit_mutation(session, before, mutation, retired)?;
        Ok(session.tree_revision)
    })
}

pub fn fs_write_range(
    root: &VaultRoot,
    vault_id: &str,
    ui_path: &str,
    offset: u64,
    data: &[u8],
) -> Result<u64> {
    if data.len() as u64 > VAULT_FS_MAX_INLINE_BYTES {
        return Err(UprivError::VaultFileTooLarge {
            path: std::path::PathBuf::from(ui_path),
            size: data.len() as u64,
            max: VAULT_FS_MAX_INLINE_BYTES,
        });
    }
    let dir = require_open(root, vault_id)?;
    let path = logical(ui_path)?;
    with_open_session(&dir, |session| {
        session.dirty = true;
        let before = session.index.clone();
        let mutation = write_logical_range(
            store_dir(session),
            &session.header,
            &session.content_key,
            &mut session.index,
            &path,
            offset,
            data,
        )?;
        commit_mutation(session, before, mutation, None)?;
        Ok(session.tree_revision)
    })
}

/// Stream plaintext into the open session without the NDJSON inline size cap.
pub fn fs_write_from_reader(
    root: &VaultRoot,
    vault_id: &str,
    ui_path: &str,
    reader: &mut (impl Read + ?Sized),
) -> Result<u64> {
    let dir = require_open(root, vault_id)?;
    let path = logical(ui_path)?;
    with_open_session(&dir, |session| {
        session.dirty = true;
        let before = session.index.clone();
        let mut mutation = ChunkBlobMutation::default();
        let mut retired_acc: Option<RetiredFileChunks> = None;
        let mut buf = vec![0u8; VAULT_FS_MAX_INLINE_BYTES as usize];
        let mut offset = 0u64;
        let mut first = true;
        let streamed: Result<()> = (|| {
            loop {
                let n = reader.read(&mut buf)?;
                if n == 0 {
                    break;
                }
                let piece = if first {
                    let (retired, piece) = write_logical_file(
                        store_dir(session),
                        &session.header,
                        &session.content_key,
                        &mut session.index,
                        &path,
                        &buf[..n],
                    )?;
                    retired_acc = retired;
                    first = false;
                    piece
                } else {
                    write_logical_range(
                        store_dir(session),
                        &session.header,
                        &session.content_key,
                        &mut session.index,
                        &path,
                        offset,
                        &buf[..n],
                    )?
                };
                mutation.merge(piece);
                offset += n as u64;
            }
            if first {
                let (retired, piece) = write_logical_file(
                    store_dir(session),
                    &session.header,
                    &session.content_key,
                    &mut session.index,
                    &path,
                    b"",
                )?;
                retired_acc = retired;
                mutation.merge(piece);
            }
            Ok(())
        })();
        let outcome = match streamed {
            Ok(()) => commit_mutation(session, before, mutation, retired_acc)
                .map(|_| session.tree_revision),
            Err(error) => {
                session.index = before;
                mutation.discard_created();
                Err(error)
            }
        };
        buf.zeroize();
        outcome
    })
}

/// Stream an OS file into the open vault without pulling bytes through JSON-RPC.
///
/// The source must be an absolute regular file (no symlink). The opened path
/// is canonicalized, and ciphertext under this vault's `store/` is refused so
/// a directory symlink cannot re-encrypt our own store.
/// The session lock is held for the whole import so another write cannot
/// replace the file between pieces.
pub fn fs_import_from_os_path(
    root: &VaultRoot,
    vault_id: &str,
    parent_ui: &str,
    base_name: &str,
    os_path: &Path,
) -> Result<(String, u64)> {
    let source = validate_import_os_path(root, vault_id, os_path)?;
    let mut file = open_import_source(&source)?;
    let dir = require_open(root, vault_id)?;
    let parent = logical(parent_ui)?;
    with_open_session(&dir, |session| {
        let name = unique_file_name(&session.index, &parent, base_name);
        let path = if parent.is_empty() {
            name
        } else {
            format!("{parent}/{name}")
        };
        require_user_visible_logical(&path)?;
        if session.index.find(&path).is_some() {
            return Err(UprivError::VaultPathExists(path));
        }
        session.dirty = true;
        // New imports only append a node. Roll that back by length instead of
        // cloning the whole index — the clone itself got slower on every file.
        let nodes_before = session.index.nodes.len();
        let mut mutation = ChunkBlobMutation::default();
        let mut retired_acc = None;
        let mut buf = vec![0u8; VAULT_FS_MAX_INLINE_BYTES as usize];
        let mut offset = 0u64;
        let mut first = true;
        let streamed: Result<()> = (|| {
            loop {
                let n = file
                    .read(&mut buf)
                    .map_err(|_| UprivError::ImportSourceUnreadable(source.clone()))?;
                if n == 0 {
                    break;
                }
                let piece = if first {
                    let (retired, piece) = write_logical_file(
                        store_dir(session),
                        &session.header,
                        &session.content_key,
                        &mut session.index,
                        &path,
                        &buf[..n],
                    )?;
                    retired_acc = retired;
                    first = false;
                    piece
                } else {
                    write_logical_range(
                        store_dir(session),
                        &session.header,
                        &session.content_key,
                        &mut session.index,
                        &path,
                        offset,
                        &buf[..n],
                    )?
                };
                mutation.merge(piece);
                offset += n as u64;
            }
            if first {
                let (retired, piece) = write_logical_file(
                    store_dir(session),
                    &session.header,
                    &session.content_key,
                    &mut session.index,
                    &path,
                    b"",
                )?;
                retired_acc = retired;
                mutation.merge(piece);
            }
            Ok(())
        })();
        let outcome = match streamed {
            Ok(()) => {
                // Seal before return. A kill or "just close" does not run Drop,
                // so an unsealed import would disappear on the next open.
                if let Err(error) = commit(session) {
                    if retired_acc.is_none() {
                        session.index.nodes.truncate(nodes_before);
                        mutation.discard_created();
                        mutation.delete_superseded();
                        session.dirty = false;
                    }
                    Err(error)
                } else {
                    mutation.delete_superseded();
                    if let Some(retired) = retired_acc {
                        let _ = remove_file_chunks(
                            &store_dir(session),
                            &retired.file_id,
                            retired.chunk_count,
                        );
                    }
                    Ok((to_ui_path(&path), session.tree_revision))
                }
            }
            Err(error) => {
                session.index.nodes.truncate(nodes_before);
                mutation.discard_created();
                mutation.delete_superseded();
                session.dirty = false;
                Err(error)
            }
        };
        buf.zeroize();
        outcome
    })
}

fn open_import_source(path: &Path) -> Result<File> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW)
            .open(path)
            .map_err(|_| UprivError::ImportSourceUnreadable(path.to_path_buf()))
    }
    #[cfg(not(unix))]
    {
        File::open(path).map_err(|_| UprivError::ImportSourceUnreadable(path.to_path_buf()))
    }
}

fn reject_unreadable(path: &Path) -> UprivError {
    UprivError::ImportSourceUnreadable(path.to_path_buf())
}

/// Real path of `path`, after directory symlinks. Fail closed when the OS
/// cannot resolve it.
fn canonical_file(path: &Path) -> Result<PathBuf> {
    std::fs::canonicalize(path).map_err(|_| reject_unreadable(path))
}

fn validate_import_os_path(root: &VaultRoot, vault_id: &str, os_path: &Path) -> Result<PathBuf> {
    if !os_path.is_absolute() {
        return Err(reject_unreadable(os_path));
    }
    let meta = std::fs::symlink_metadata(os_path).map_err(|_| reject_unreadable(os_path))?;
    if meta.file_type().is_symlink() || !meta.is_file() {
        return Err(reject_unreadable(os_path));
    }
    let canonical = canonical_file(os_path)?;
    if let Ok(store) = root.vault_store_dir(vault_id) {
        if store.exists() {
            let store = canonical_file(&store).map_err(|_| reject_unreadable(os_path))?;
            if canonical.starts_with(&store) {
                return Err(reject_unreadable(os_path));
            }
        }
    }
    Ok(canonical)
}

pub fn fs_truncate(root: &VaultRoot, vault_id: &str, ui_path: &str, size: u64) -> Result<u64> {
    let dir = require_open(root, vault_id)?;
    let path = logical(ui_path)?;
    with_open_session(&dir, |session| {
        session.dirty = true;
        let before = session.index.clone();
        let mutation = truncate_logical_file(
            store_dir(session),
            &session.header,
            &session.content_key,
            &mut session.index,
            &path,
            size,
        )?;
        commit_mutation(session, before, mutation, None)?;
        Ok(session.tree_revision)
    })
}

pub fn fs_mkdir(root: &VaultRoot, vault_id: &str, ui_path: &str) -> Result<u64> {
    let dir = require_open(root, vault_id)?;
    let path = logical(ui_path)?;
    require_user_visible_logical(&path)?;
    with_open_session(&dir, |session| {
        session.dirty = true;
        let before = session.index.clone();
        mkdir_logical(&mut session.index, &path)?;
        commit_or_restore(session, before)?;
        Ok(session.tree_revision)
    })
}

pub fn fs_create_file(
    root: &VaultRoot,
    vault_id: &str,
    parent_ui: &str,
    base_name: &str,
) -> Result<(String, u64)> {
    let dir = require_open(root, vault_id)?;
    let parent = logical(parent_ui)?;
    with_open_session(&dir, |session| {
        let name = unique_file_name(&session.index, &parent, base_name);
        let path = if parent.is_empty() {
            name
        } else {
            format!("{parent}/{name}")
        };
        require_user_visible_logical(&path)?;
        session.dirty = true;
        let before = session.index.clone();
        let (_retired, mutation) = write_logical_file(
            store_dir(session),
            &session.header,
            &session.content_key,
            &mut session.index,
            &path,
            b"",
        )?;
        commit_mutation(session, before, mutation, None)?;
        Ok((to_ui_path(&path), session.tree_revision))
    })
}

/// Create `parent/name` exactly. FUSE uses this; in-app "New file" uses [`fs_create_file`].
pub fn fs_create_named_file(
    root: &VaultRoot,
    vault_id: &str,
    parent_ui: &str,
    name: &str,
) -> Result<(String, u64)> {
    let dir = require_open(root, vault_id)?;
    let parent = logical(parent_ui)?;
    let path = child_logical_path(&parent, name)?;
    require_user_visible_logical(&path)?;
    with_open_session(&dir, |session| {
        if session.index.find(&path).is_some() {
            return Err(UprivError::VaultPathExists(path));
        }
        session.dirty = true;
        let before = session.index.clone();
        let (_retired, mutation) = write_logical_file(
            store_dir(session),
            &session.header,
            &session.content_key,
            &mut session.index,
            &path,
            b"",
        )?;
        commit_mutation(session, before, mutation, None)?;
        Ok((to_ui_path(&path), session.tree_revision))
    })
}

pub fn fs_create_folder(
    root: &VaultRoot,
    vault_id: &str,
    parent_ui: &str,
    base_name: &str,
) -> Result<(String, u64)> {
    let dir = require_open(root, vault_id)?;
    let parent = logical(parent_ui)?;
    with_open_session(&dir, |session| {
        let name = unique_folder_name(&session.index, &parent, base_name);
        let path = if parent.is_empty() {
            name
        } else {
            format!("{parent}/{name}")
        };
        require_user_visible_logical(&path)?;
        session.dirty = true;
        let before = session.index.clone();
        mkdir_logical(&mut session.index, &path)?;
        commit_or_restore(session, before)?;
        Ok((to_ui_path(&path), session.tree_revision))
    })
}

pub fn fs_ensure_folder(
    root: &VaultRoot,
    vault_id: &str,
    parent_ui: &str,
    name: &str,
) -> Result<(String, u64)> {
    let dir = require_open(root, vault_id)?;
    let parent = logical(parent_ui)?;
    require_user_visible_logical(name)?;
    with_open_session(&dir, |session| {
        let path = child_logical_path(&parent, name)?;
        if let Some(node) = session.index.find(&path) {
            if node.is_dir() {
                return Ok((to_ui_path(&path), session.tree_revision));
            }
            return Err(UprivError::VaultPathExists(path));
        }
        session.dirty = true;
        let before = session.index.clone();
        let created = ensure_folder(&mut session.index, &parent, name)?;
        commit_or_restore(session, before)?;
        Ok((to_ui_path(&created), session.tree_revision))
    })
}

pub fn fs_delete(root: &VaultRoot, vault_id: &str, ui_path: &str) -> Result<u64> {
    let dir = require_open(root, vault_id)?;
    let path = logical(ui_path)?;
    if path.is_empty() {
        return Err(UprivError::VaultStoreInvalid {
            path: std::path::PathBuf::from("/"),
            detail: "cannot delete vault root".into(),
        });
    }
    require_user_visible_logical(&path)?;
    with_open_session(&dir, |session| {
        session.dirty = true;
        let before = session.index.clone();
        let retired = delete_logical_path(&mut session.index, &path)?;
        commit_then_unlink(session, before, retired)?;
        Ok(session.tree_revision)
    })
}

pub fn fs_rmdir(root: &VaultRoot, vault_id: &str, ui_path: &str) -> Result<u64> {
    let dir = require_open(root, vault_id)?;
    let path = logical(ui_path)?;
    if path.is_empty() {
        return Err(UprivError::VaultStoreInvalid {
            path: std::path::PathBuf::from("/"),
            detail: "cannot delete vault root".into(),
        });
    }
    require_user_visible_logical(&path)?;
    with_open_session(&dir, |session| {
        session.dirty = true;
        let before = session.index.clone();
        delete_empty_directory(&mut session.index, &path)?;
        commit_or_restore(session, before)?;
        Ok(session.tree_revision)
    })
}

pub fn fs_rename(
    root: &VaultRoot,
    vault_id: &str,
    ui_path: &str,
    new_name: &str,
) -> Result<(String, u64)> {
    let dir = require_open(root, vault_id)?;
    let path = logical(ui_path)?;
    require_user_visible_logical(&path)?;
    require_user_visible_logical(new_name)?;
    with_open_session(&dir, |session| {
        session.dirty = true;
        let before = session.index.clone();
        let next = rename_logical_path(&mut session.index, &path, new_name)?;
        commit_or_restore(session, before)?;
        Ok((to_ui_path(&next), session.tree_revision))
    })
}

pub fn fs_move(
    root: &VaultRoot,
    vault_id: &str,
    from_ui: &str,
    to_folder_ui: &str,
) -> Result<(String, u64)> {
    let dir = require_open(root, vault_id)?;
    let from = logical(from_ui)?;
    let to_folder = logical(to_folder_ui)?;
    require_user_visible_logical(&from)?;
    with_open_session(&dir, |session| {
        session.dirty = true;
        let before = session.index.clone();
        let next = move_logical_path(&mut session.index, &from, &to_folder)?;
        commit_or_restore(session, before)?;
        Ok((to_ui_path(&next), session.tree_revision))
    })
}

pub fn fs_relocate(
    root: &VaultRoot,
    vault_id: &str,
    from_ui: &str,
    to_folder_ui: &str,
    new_name: &str,
    replace_existing: bool,
) -> Result<(String, u64)> {
    let dir = require_open(root, vault_id)?;
    let from = logical(from_ui)?;
    let to_folder = logical(to_folder_ui)?;
    require_user_visible_logical(&from)?;
    require_user_visible_logical(new_name)?;
    with_open_session(&dir, |session| {
        session.dirty = true;
        let before = session.index.clone();
        let relocated = if replace_existing {
            relocate_replacing(&mut session.index, &from, &to_folder, new_name)
        } else {
            relocate_logical_path(&mut session.index, &from, &to_folder, new_name)
                .map(|next| (next, Vec::new()))
        };
        let (next, retired) = match relocated {
            Ok(value) => value,
            Err(error) => {
                session.index = before;
                return Err(error);
            }
        };
        commit_then_unlink(session, before, retired)?;
        Ok((to_ui_path(&next), session.tree_revision))
    })
}

/// Join a validated logical path (`notes/a.txt`, or `""` for the mount root)
/// onto an OS mount point. Rejects `.` / `..` / empty components.
pub(crate) fn join_logical_under_mount(mount: &Path, logical: &str) -> Result<PathBuf> {
    if logical.is_empty() {
        return Ok(mount.to_path_buf());
    }
    let mut out = mount.to_path_buf();
    for part in logical.split('/') {
        if part.is_empty() || part == "." || part == ".." {
            return Err(UprivError::VaultStoreInvalid {
                path: PathBuf::from(logical),
                detail: "invalid mount relative path".into(),
            });
        }
        out.push(part);
    }
    Ok(out)
}

/// Absolute OS path of a logical item on the live FUSE/WinFsp mount.
///
/// Does not create files. Missing mount (mobile, WinFsp stub, FUSE failure)
/// returns [`UprivError::VaultMountFailed`] — never a plaintext extract.
pub fn fs_os_path(root: &VaultRoot, vault_id: &str, ui_path: &str) -> Result<PathBuf> {
    let dir = require_open(root, vault_id)?;
    let logical = logical(ui_path)?;
    with_open_session(&dir, |session| {
        let Some(mount) = session.mount.as_ref() else {
            return Err(UprivError::VaultMountFailed(
                "OS mount is not available; use the in-app file manager".into(),
            ));
        };
        join_logical_under_mount(mount.mount_point(), &logical)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::{open_store, KdfUnlockPreset};
    use crate::test_support::vault_root_with;
    use crate::vault::{close_vault, create_vault, open_vault};

    fn sample_config(id: &str, name: &str) -> crate::config::VaultConfig {
        toml::from_str(&format!(
            r#"
[vault]
id = "{id}"
display_name = "{name}"
order = 1
[storage]
mode = "encrypted_dir"
"#
        ))
        .expect("config")
    }

    #[test]
    fn missing_workspace_snapshot_reads_as_empty() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        assert!(fs_read_file(&root, "notes", "/.upriv-workspace.json")
            .unwrap()
            .is_empty());
        assert!(
            fs_read_range(&root, "notes", "/.upriv-workspace.json", 0, 64)
                .unwrap()
                .is_empty()
        );
        let missing = fs_read_file(&root, "notes", "/gone.txt").unwrap_err();
        assert!(matches!(missing, UprivError::VaultPathNotFound(_)));
        fs_write_file(
            &root,
            "notes",
            "/.upriv-workspace.json",
            b"{\"format_version\":1}\n",
        )
        .unwrap();
        let got = fs_read_file(&root, "notes", "/.upriv-workspace.json").unwrap();
        assert_eq!(got, b"{\"format_version\":1}\n");
        close_vault(&root, "notes", None).unwrap();
    }

    #[test]
    fn write_is_durable_before_close() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        fs_write_file(&root, "notes", "/hello.txt", b"hello-from-session").unwrap();
        let store = root.vault_store_dir("notes").unwrap();
        let data_dir = store.join("data");
        assert!(
            std::fs::read_dir(&data_dir).unwrap().count() >= 1,
            "ciphertext must land before close"
        );
        // No plaintext next to store/.
        let vault_dir = root.vault_dir("notes").unwrap();
        for entry in walkdir_files(&vault_dir) {
            let bytes = std::fs::read(&entry).unwrap_or_default();
            assert!(
                !bytes
                    .windows(b"hello-from-session".len())
                    .any(|w| w == b"hello-from-session"),
                "plaintext leaked at {}",
                entry.display()
            );
        }
        close_vault(&root, "notes", None).unwrap();
        let opened = open_store(&store, b"pass-word-ok").unwrap();
        let got = crate::store::read_logical_file(
            &store,
            &opened.header,
            &opened.content_key,
            &opened.index,
            "hello.txt",
        )
        .unwrap();
        assert_eq!(got, b"hello-from-session");
    }

    fn walkdir_files(root: &std::path::Path) -> Vec<std::path::PathBuf> {
        let mut out = Vec::new();
        fn rec(path: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
            let Ok(entries) = std::fs::read_dir(path) else {
                return;
            };
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_dir() {
                    rec(&p, out);
                } else {
                    out.push(p);
                }
            }
        }
        rec(root, &mut out);
        out
    }

    #[test]
    fn named_create_does_not_unique_and_relocate_is_one_commit() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        fs_create_named_file(&root, "notes", "/", "exact.txt").unwrap();
        let err = fs_create_named_file(&root, "notes", "/", "exact.txt").unwrap_err();
        assert!(matches!(err, UprivError::VaultPathExists(_)));
        let unique = fs_create_file(&root, "notes", "/", "exact.txt").unwrap();
        assert_eq!(unique.0, "/exact-2.txt");
        fs_mkdir(&root, "notes", "/inbox").unwrap();
        let moved =
            fs_relocate(&root, "notes", "/exact.txt", "/inbox", "renamed.txt", false).unwrap();
        assert_eq!(moved.0, "/inbox/renamed.txt");
        close_vault(&root, "notes", None).unwrap();
    }

    #[test]
    fn write_from_reader_accepts_payload_over_inline_rpc_cap() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        let size = (VAULT_FS_MAX_INLINE_BYTES as usize) + 64;
        let data = vec![0x5Au8; size];
        fs_write_from_reader(&root, "notes", "/big.bin", &mut data.as_slice()).unwrap();
        let inline = fs_write_file(&root, "notes", "/too-big.bin", &data).unwrap_err();
        assert!(matches!(inline, UprivError::VaultFileTooLarge { .. }));
        let store = root.vault_store_dir("notes").unwrap();
        crate::session::with_open_session(&root.vault_dir("notes").unwrap(), |session| {
            let got = crate::store::read_logical_file(
                &store,
                &session.header,
                &session.content_key,
                &session.index,
                "big.bin",
            )
            .unwrap();
            assert_eq!(got, data);
            Ok(())
        })
        .unwrap();
        close_vault(&root, "notes", None).unwrap();
    }

    #[test]
    fn write_from_reader_restores_index_when_a_later_read_fails() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        fs_write_file(&root, "notes", "/notes.txt", b"generation-one").unwrap();

        struct FailAfterFirst {
            first: &'static [u8],
            sent: bool,
        }
        impl Read for FailAfterFirst {
            fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
                if !self.sent {
                    self.sent = true;
                    let n = self.first.len().min(buf.len());
                    buf[..n].copy_from_slice(&self.first[..n]);
                    return Ok(n);
                }
                Err(std::io::Error::other("injected read failure"))
            }
        }

        let err = fs_write_from_reader(
            &root,
            "notes",
            "/notes.txt",
            &mut FailAfterFirst {
                first: b"generation-two",
                sent: false,
            },
        )
        .unwrap_err();
        assert!(matches!(err, UprivError::Io(_)));
        let got = fs_read_file(&root, "notes", "/notes.txt").unwrap();
        assert_eq!(got, b"generation-one");
        close_vault(&root, "notes", None).unwrap();
        let store = root.vault_store_dir("notes").unwrap();
        let opened = open_store(&store, b"pass-word-ok").unwrap();
        let durable = crate::store::read_logical_file(
            &store,
            &opened.header,
            &opened.content_key,
            &opened.index,
            "notes.txt",
        )
        .unwrap();
        assert_eq!(durable, b"generation-one");
    }

    #[cfg(unix)]
    #[test]
    fn range_write_restores_index_when_flush_fails() {
        use std::os::unix::fs::PermissionsExt;

        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        fs_write_file(&root, "notes", "/notes.txt", b"generation-one").unwrap();
        let store = root.vault_store_dir("notes").unwrap();
        let index_dir = store.join(crate::store::INDEX_DIR_NAME);
        let restore = std::fs::metadata(&index_dir).unwrap().permissions();
        let mut locked = restore.clone();
        locked.set_mode(0o555);
        std::fs::set_permissions(&index_dir, locked).unwrap();
        let write = fs_write_range(&root, "notes", "/notes.txt", 0, b"generation-two");
        std::fs::set_permissions(&index_dir, restore).unwrap();
        if write.is_ok() {
            close_vault(&root, "notes", None).unwrap();
            return;
        }
        let got = fs_read_file(&root, "notes", "/notes.txt").unwrap();
        assert_eq!(got, b"generation-one");
        close_vault(&root, "notes", None).unwrap();
        let opened = open_store(&store, b"pass-word-ok").unwrap();
        let durable = crate::store::read_logical_file(
            &store,
            &opened.header,
            &opened.content_key,
            &opened.index,
            "notes.txt",
        )
        .unwrap();
        assert_eq!(durable, b"generation-one");
    }

    #[test]
    fn import_from_os_path_streams_over_inline_cap() {
        let (tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        let size = (VAULT_FS_MAX_INLINE_BYTES as usize) + 64;
        let data = vec![0xA5u8; size];
        let src = tmp.path().join("payload.bin");
        std::fs::write(&src, &data).unwrap();
        let (path, _) = fs_import_from_os_path(&root, "notes", "/", "payload.bin", &src).unwrap();
        assert_eq!(path, "/payload.bin");
        let store = root.vault_store_dir("notes").unwrap();
        crate::session::with_open_session(&root.vault_dir("notes").unwrap(), |session| {
            let got = crate::store::read_logical_file(
                &store,
                &session.header,
                &session.content_key,
                &session.index,
                "payload.bin",
            )
            .unwrap();
            assert_eq!(got, data);
            Ok(())
        })
        .unwrap();
        let relative = fs_import_from_os_path(
            &root,
            "notes",
            "/",
            "nope.bin",
            std::path::Path::new("payload.bin"),
        )
        .unwrap_err();
        assert!(matches!(relative, UprivError::ImportSourceUnreadable(_)));

        let bait = store.join("bait.bin");
        std::fs::write(&bait, b"x").unwrap();
        let from_store =
            fs_import_from_os_path(&root, "notes", "/", "bait.bin", &bait).unwrap_err();
        assert!(matches!(from_store, UprivError::ImportSourceUnreadable(_)));

        #[cfg(unix)]
        {
            let link = tmp.path().join("link.bin");
            std::os::unix::fs::symlink(&src, &link).unwrap();
            let linked =
                fs_import_from_os_path(&root, "notes", "/", "link.bin", &link).unwrap_err();
            assert!(matches!(linked, UprivError::ImportSourceUnreadable(_)));

            let alias = tmp.path().join("alias");
            std::fs::create_dir(&alias).unwrap();
            let store_link = alias.join("into-store");
            std::os::unix::fs::symlink(&store, &store_link).unwrap();
            let via = store_link.join("bait.bin");
            let via_store =
                fs_import_from_os_path(&root, "notes", "/", "via.bin", &via).unwrap_err();
            assert!(matches!(via_store, UprivError::ImportSourceUnreadable(_)));
        }

        close_vault(&root, "notes", None).unwrap();
    }

    #[test]
    fn import_batch_is_readable_after_close_seals_the_index() {
        let (tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        let (folder, _) = fs_ensure_folder(&root, "notes", "/", "photos").unwrap();
        assert_eq!(folder, "/photos");
        let (again, _) = fs_ensure_folder(&root, "notes", "/", "photos").unwrap();
        assert_eq!(again, "/photos");
        let count = 4;
        for index in 0..count {
            let name = format!("f{index}.txt");
            let src = tmp.path().join(&name);
            let body = format!("body-{index}");
            std::fs::write(&src, &body).unwrap();
            let (path, _) = fs_import_from_os_path(&root, "notes", "/photos", &name, &src).unwrap();
            assert_eq!(path, format!("/photos/{name}"));
            let live = fs_read_file(&root, "notes", &path).unwrap();
            assert_eq!(live, body.as_bytes());
        }
        close_vault(&root, "notes", None).unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        for index in 0..count {
            let path = format!("/photos/f{index}.txt");
            let got = fs_read_file(&root, "notes", &path).unwrap();
            assert_eq!(got, format!("body-{index}").into_bytes());
        }
        close_vault(&root, "notes", None).unwrap();
    }

    #[test]
    fn import_seals_the_index_before_it_returns() {
        let (tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        let src = tmp.path().join("one.txt");
        std::fs::write(&src, b"one").unwrap();
        fs_import_from_os_path(&root, "notes", "/", "one.txt", &src).unwrap();
        let dir = root.vault_dir("notes").unwrap();
        crate::session::with_open_session(&dir, |session| {
            let store = store_dir(session);
            assert!(
                crate::store::sealed_index_contains(
                    &store,
                    &session.header,
                    &session.index_key,
                    "one.txt",
                )
                .unwrap(),
                "import seals before it returns"
            );
            Ok(())
        })
        .unwrap();
        close_vault(&root, "notes", None).unwrap();
    }

    #[test]
    fn join_logical_under_mount_keeps_root_and_rejects_dots() {
        let mount = PathBuf::from("/workspace/Notes");
        assert_eq!(
            join_logical_under_mount(&mount, "").unwrap(),
            PathBuf::from("/workspace/Notes")
        );
        assert_eq!(
            join_logical_under_mount(&mount, "a/b.txt").unwrap(),
            PathBuf::from("/workspace/Notes/a/b.txt")
        );
        assert!(join_logical_under_mount(&mount, "a/../b").is_err());
        assert!(join_logical_under_mount(&mount, "a//b").is_err());
    }

    #[test]
    fn os_path_requires_open_session_and_a_mount() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        let closed = fs_os_path(&root, "notes", "/").unwrap_err();
        assert!(matches!(closed, UprivError::VaultNotOpen(_)));

        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        let result = fs_os_path(&root, "notes", "/hello.txt");
        match crate::session::with_open_session(&root.vault_dir("notes").unwrap(), |session| {
            Ok(session.mount.is_some())
        }) {
            Ok(true) => {
                let path = result.expect("mounted vault should resolve an OS path");
                assert!(path.ends_with("hello.txt"));
            }
            Ok(false) => {
                assert!(matches!(
                    result.unwrap_err(),
                    UprivError::VaultMountFailed(_)
                ));
            }
            Err(error) => panic!("{error}"),
        }
        close_vault(&root, "notes", None).unwrap();
    }
}
