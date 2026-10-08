//! Open / close against `store/` with an in-process session.

use crate::config::{load_app_settings_at, load_vault_config, VaultSecurityMode, VaultStorageMode};
use crate::error::{Result, UprivError};
#[allow(unused_imports)]
use crate::host_fs::HostFsQuery;
use crate::lockfile::acquire_vault_lock;
use crate::logging::{log_event, LogLevel};
use crate::paths::{
    encrypted_shortcut_active, resolve_vault_mount_point, resolved_workspace_parent, VaultRoot,
    WorkspaceSystem,
};
use crate::runtime_state::{mark_session_closed, mark_session_open, release_recorded_mount};
use crate::session::{
    check_unlock_allowed, insert_session, is_vault_closing_at, is_vault_open_at, open_session_ids,
    record_unlock_failure, record_unlock_success, take_session, vault_close_phase_at,
    with_open_session, with_unlock_lock, with_vault_dir_lock, ClosePhase, ClosingGuard,
    OpenSession, PreparingGuard,
};
use crate::store::{
    content_hash_hex, flush_index_parts, index_logical_hash, open_store, pack_blob_waste,
    BlobPackMode, ChunkBlobMutation,
};

use super::backup::{backup_on_close, list_backups};
use super::persistence::{load_vault_persistence, save_vault_persistence, VaultPersistence};

fn vault_dir_or_not_found(root: &VaultRoot, vault_id: &str) -> Result<std::path::PathBuf> {
    let dir = root.vault_dir(vault_id)?;
    if !dir.host_is_dir() {
        return Err(UprivError::VaultNotFound(dir));
    }
    Ok(dir)
}

fn try_attach_mount(root: &VaultRoot, vault_id: &str, vault_dir: &std::path::Path) -> Result<()> {
    let config = match load_vault_config(vault_dir) {
        Ok(config) => config,
        Err(_) => return Ok(()),
    };
    let app = load_app_settings_at(root.root())
        .map(|loaded| loaded.settings.workspace.0)
        .unwrap_or_default();
    let system = WorkspaceSystem::current();
    if !encrypted_shortcut_active(&app, &config.mount, system) {
        return Ok(());
    }
    let own_folder = !config.mount.row(system).path.trim().is_empty();
    let parent = resolved_workspace_parent(&app, &config.mount, system, root.root());
    let Some(mount_point) =
        resolve_vault_mount_point(&parent, &config.vault.display_name, own_folder)
    else {
        return Ok(());
    };
    match crate::mount::mount_encrypted_dir(root.clone(), vault_id.to_string(), mount_point.clone())
    {
        Ok(mounted) => {
            let path = mounted.mount_point().display().to_string();
            match with_open_session(vault_dir, |session| {
                session.mount = Some(mounted);
                Ok(())
            }) {
                Ok(()) => {
                    if let Err(error) = mark_session_open(root, vault_id, Some(path)) {
                        let _ = with_open_session(vault_dir, |session| {
                            drop(session.mount.take());
                            Ok(())
                        });
                        let _ = take_session(vault_dir);
                        let _ = mark_session_closed(root, vault_id);
                        return Err(error);
                    }
                    Ok(())
                }
                Err(error) => {
                    log_event(LogLevel::Warn, "vault_mount_failed", &[("id", vault_id)]);
                    let _ = take_session(vault_dir);
                    let _ = mark_session_closed(root, vault_id);
                    Err(error)
                }
            }
        }
        Err(_) => {
            log_event(LogLevel::Warn, "vault_mount_failed", &[("id", vault_id)]);
            Ok(())
        }
    }
}

/// Unlock into a RAM session and attach the FUSE mount. Password bytes are used exactly as given.
pub fn open_vault(root: &VaultRoot, vault_id: &str, password: &[u8]) -> Result<()> {
    open_unlocked_session(root, vault_id, password, true)
}

/// Unlock for an in-process ingest (portable `.7z` import). No FUSE mount:
/// a half-written vault must not appear on the desktop where a file manager can block on it.
pub(crate) fn open_vault_for_ingest(
    root: &VaultRoot,
    vault_id: &str,
    password: &[u8],
) -> Result<()> {
    open_unlocked_session(root, vault_id, password, false)
}

fn open_unlocked_session(
    root: &VaultRoot,
    vault_id: &str,
    password: &[u8],
    attach_mount: bool,
) -> Result<()> {
    if password.is_empty() {
        return Err(UprivError::WrongPassword);
    }
    let vault_dir = vault_dir_or_not_found(root, vault_id)?;
    let _preparing = PreparingGuard::enter(&vault_dir)?;
    with_vault_dir_lock(&vault_dir, || {
        if !vault_dir.host_is_dir() {
            return Err(UprivError::VaultNotFound(vault_dir.clone()));
        }
        with_unlock_lock(|| {
            check_unlock_allowed(&vault_dir)?;
            if is_vault_open_at(&vault_dir) {
                return Err(UprivError::VaultAlreadyOpen(vault_id.to_string()));
            }
            if is_vault_closing_at(&vault_dir) {
                return Err(UprivError::VaultConfigBusy {
                    target: "action.open".into(),
                });
            }
            let config = load_vault_config(&vault_dir)?;
            if config.storage_mode() == VaultStorageMode::UprivPlain {
                return Err(UprivError::UprivPlainUnavailable);
            }
            let lock = acquire_vault_lock(root.runtime_lock_path(vault_id)?)?;
            // This process now owns the lock, so any recorded mount is stale.
            release_recorded_mount(root, vault_id);
            let store = vault_dir.join(crate::paths::STORE_DIR_NAME);
            let opened = match open_store(&store, password) {
                Ok(opened) => opened,
                Err(UprivError::WrongPassword) => {
                    let _ = record_unlock_failure(&vault_dir);
                    return Err(UprivError::WrongPassword);
                }
                Err(other) => return Err(other),
            };
            record_unlock_success(&vault_dir);
            let mut session = OpenSession::from_opened(
                vault_id.to_string(),
                vault_dir.clone(),
                config.security.mode,
                opened,
            );
            session.lock = Some(lock);
            session.skip_close_backup = !attach_mount;
            insert_session(session)?;
            if let Err(error) = mark_session_open(root, vault_id, None) {
                let _ = take_session(&vault_dir);
                return Err(error);
            }
            if attach_mount {
                try_attach_mount(root, vault_id, &vault_dir)?;
            }
            log_event(LogLevel::Info, "vault_opened", &[("id", vault_id)]);
            Ok(())
        })
    })
}

#[derive(Clone, Copy)]
enum CloseKind {
    User,
    Shutdown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CloseVaultOutcome {
    pub backup_failed: bool,
}

/// Phase of a `close_vault` still running for this vault. `None` when idle.
pub fn close_phase(root: &VaultRoot, vault_id: &str) -> Result<Option<ClosePhase>> {
    let vault_dir = root.vault_dir(vault_id)?;
    Ok(vault_close_phase_at(&vault_dir))
}

fn close_vault_inner(
    root: &VaultRoot,
    vault_id: &str,
    password: Option<&[u8]>,
    kind: CloseKind,
) -> Result<CloseVaultOutcome> {
    let vault_dir = vault_dir_or_not_found(root, vault_id)?;
    let closing = ClosingGuard::enter(&vault_dir)?;
    let mut session = take_session(&vault_dir)?;
    if matches!(kind, CloseKind::User) && session.security_mode == VaultSecurityMode::AlwaysPrompt {
        let present = password.is_some_and(|p| !p.is_empty());
        if !present {
            insert_session(session)?;
            return Err(UprivError::WrongPassword);
        }
    }
    let store = vault_dir.join(crate::paths::STORE_DIR_NAME);
    let mut backup_failed = false;
    let persist = (|| {
        let packed = match pack_blob_waste(
            &store,
            &session.header,
            &session.content_key,
            &mut session.index,
            BlobPackMode::Close,
            None,
        ) {
            Ok(mutation) => mutation,
            Err(_error) => {
                log_event(
                    LogLevel::Warn,
                    "vault_blob_pack_failed",
                    &[("id", vault_id)],
                );
                ChunkBlobMutation::default()
            }
        };
        let packed_ok = if packed.created.is_empty() {
            false
        } else if packed.sync_before_index().is_ok() {
            true
        } else {
            packed.restore_packed_nodes(&mut session.index);
            packed.discard_created();
            log_event(
                LogLevel::Warn,
                "vault_blob_pack_failed",
                &[("id", vault_id)],
            );
            false
        };
        if !session.staged_blobs.is_empty() {
            super::fs::sync_staged_blobs(&session.staged_blobs)?;
            session.staged_blobs.clear();
        }
        if let Err(error) =
            flush_index_parts(&store, &session.header, &session.index_key, &session.index)
        {
            if packed_ok {
                packed.restore_packed_nodes(&mut session.index);
                packed.discard_created();
            }
            return Err(error);
        }
        session.index.clear_unsealed_holes();
        if packed_ok {
            packed.delete_superseded();
        }
        let hash = content_hash_hex(&store)?;
        let logical_hash = index_logical_hash(&session.index);
        let previous = load_vault_persistence(&vault_dir).ok().flatten();
        let previous_backup = previous
            .as_ref()
            .and_then(|saved| saved.backed_up_index_hash.clone());
        let previous_stamp = previous
            .as_ref()
            .and_then(|saved| saved.backed_up_stamp.clone());
        let display_name = crate::config::load_vault_config_raw(&vault_dir)
            .map(|c| c.vault.display_name)
            .unwrap_or_else(|_| session.vault_id.clone());
        let mut persistence =
            VaultPersistence::closed(session.vault_id.clone(), display_name, Some(hash));
        persistence.backed_up_index_hash = previous_backup.clone();
        persistence.backed_up_stamp = previous_stamp.clone();
        save_vault_persistence(&vault_dir, &persistence)?;
        if !session.skip_close_backup {
            let already_backed_up = logical_hash.as_ref().is_some_and(|hash| {
                previous_backup.as_deref() == Some(hash.as_str())
                    && previous_stamp.as_deref().is_some_and(|stamp| {
                        list_backups(root, vault_id)
                            .is_ok_and(|entries| entries.iter().any(|entry| entry.stamp == stamp))
                    })
            });
            if !already_backed_up {
                closing.set_phase(ClosePhase::Backup);
                match backup_on_close(root, vault_id) {
                    Ok(Some(stamp)) => {
                        if let Some(hash) = logical_hash {
                            persistence.backed_up_index_hash = Some(hash);
                            persistence.backed_up_stamp = Some(stamp);
                            save_vault_persistence(&vault_dir, &persistence)?;
                        }
                    }
                    Ok(None) => {}
                    Err(_error) => {
                        backup_failed = true;
                        // No `detail`: `UprivError`'s Display text includes filesystem paths.
                        log_event(
                            LogLevel::Warn,
                            "vault_backup_on_close_failed",
                            &[("id", vault_id)],
                        );
                    }
                }
            }
        }
        Ok(())
    })();
    if let Err(error) = persist {
        if matches!(kind, CloseKind::Shutdown) {
            // Quit must exit. Drop the session and its mount; do not put them back.
            drop(session.mount.take());
            drop(session);
            return Err(error);
        }
        let _ = insert_session(session);
        return Err(error);
    }
    // Keep the mount until the close is recorded. Dropping it first and then
    // failing the state write would reinsert an open session with no mount.
    let mount = session.mount.take();
    if let Err(error) = mark_session_closed(root, vault_id) {
        if matches!(kind, CloseKind::Shutdown) {
            drop(mount);
            drop(session);
            return Err(error);
        }
        session.mount = mount;
        let _ = insert_session(session);
        return Err(error);
    }
    drop(mount);
    drop(session);
    log_event(LogLevel::Info, "vault_closed", &[("id", vault_id)]);
    Ok(CloseVaultOutcome { backup_failed })
}

/// Flush the empty (or dirty) index and drop the session.
///
/// `password` is required only for `always_prompt` as a **presence** check
/// (non-empty bytes). Do not re-run Argon2 / `open_store` — that would be a
/// second multi-minute unlock, not a lock gate (SECURITY-CRYPTO / TS lifecycle).
pub fn close_vault(
    root: &VaultRoot,
    vault_id: &str,
    password: Option<&[u8]>,
) -> Result<CloseVaultOutcome> {
    close_vault_inner(root, vault_id, password, CloseKind::User)
}

/// Flush every open vault. Used by `app_shutdown` (skips always_prompt).
pub fn close_all_vaults(root: &VaultRoot) -> Result<Vec<String>> {
    let ids = open_session_ids();
    let mut closed = Vec::new();
    let mut first_err = None;
    for id in ids {
        match close_vault_inner(root, &id, None, CloseKind::Shutdown) {
            Ok(_) => closed.push(id),
            Err(error) => {
                if first_err.is_none() {
                    first_err = Some(error);
                }
            }
        }
    }
    match first_err {
        Some(error) => Err(error),
        None => Ok(closed),
    }
}

/// Remove a vault whose import did not finish.
///
/// The partial `store/` is discarded. Closing it would flush that tree and
/// write a backup, which needs more free space and can fail when the disk is
/// already full. Drop the session so delete is not refused, then remove the
/// folder.
pub(crate) fn delete_failed_import(root: &VaultRoot, vault_id: &str) -> Result<()> {
    let dir = root.vault_dir(vault_id)?;
    if is_vault_open_at(&dir) {
        drop(take_session(&dir)?);
    }
    if dir.host_is_dir() {
        super::delete::delete_vault(root, vault_id)?;
    }
    Ok(())
}

/// Drop a failed import and always surface `ingest_error`.
///
/// A cleanup failure is logged and tried once more. It does not replace the
/// reason the import stopped.
pub(crate) fn abandon_failed_import(
    root: &VaultRoot,
    vault_id: &str,
    ingest_error: UprivError,
) -> UprivError {
    if let Err(_error) = delete_failed_import(root, vault_id) {
        log_event(
            LogLevel::Warn,
            "vault_import_cleanup_failed",
            &[("id", vault_id)],
        );
        if let Err(_error) = delete_failed_import(root, vault_id) {
            log_event(
                LogLevel::Warn,
                "vault_import_cleanup_retry_failed",
                &[("id", vault_id)],
            );
        }
    }
    ingest_error
}

#[cfg(test)]
mod tests {
    use super::*;
    #[allow(unused_imports)]
    use crate::host_fs::HostFsQuery;
    use crate::store::KdfUnlockPreset;
    use crate::test_support::vault_root_with;
    use crate::vault::create_vault;

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
    fn close_succeeds_when_backup_copy_fails() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        let vault_dir = root.vault_dir("notes").unwrap();
        let backups = vault_dir.join("backups");
        if backups.host_is_dir() {
            crate::host_fs::remove_dir_all(&backups).unwrap();
        }
        crate::host_fs::write(&backups, b"not-a-directory").unwrap();
        let outcome = close_vault(&root, "notes", None).unwrap();
        assert!(
            outcome.backup_failed,
            "close must report the failed snapshot"
        );
        assert!(
            !crate::session::is_vault_open_at(&vault_dir),
            "session must still drop when the close backup fails"
        );
    }

    #[test]
    fn second_close_keeps_the_existing_backup_when_nothing_changed() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        close_vault(&root, "notes", None).unwrap();
        let first = list_backups(&root, "notes").unwrap();
        assert_eq!(first.len(), 1);
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        close_vault(&root, "notes", None).unwrap();
        let second = list_backups(&root, "notes").unwrap();
        assert_eq!(second.len(), 1);
        assert_eq!(second[0].file_name, first[0].file_name);
    }

    #[test]
    fn close_writes_a_new_backup_when_the_recorded_zip_is_gone() {
        let (_tmp, root) = vault_root_with(&[]);
        let mut config = sample_config("notes", "Notes");
        config.backup.keep_last = 5;
        create_vault(&root, config, b"pass-word-ok", KdfUnlockPreset::M32).unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        crate::vault::fs_write_file(&root, "notes", "/a.txt", b"one").unwrap();
        close_vault(&root, "notes", None).unwrap();
        let first = list_backups(&root, "notes").unwrap();
        assert_eq!(first.len(), 1);

        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        crate::vault::fs_write_file(&root, "notes", "/a.txt", b"two").unwrap();
        close_vault(&root, "notes", None).unwrap();
        let both = list_backups(&root, "notes").unwrap();
        assert_eq!(both.len(), 2);
        let newest = both[0].file_name.clone();
        let older = both[1].file_name.clone();
        let vault_dir = root.vault_dir("notes").unwrap();
        crate::host_fs::remove_file(vault_dir.join("backups").join(&newest)).unwrap();
        let after_delete = list_backups(&root, "notes").unwrap();
        assert_eq!(after_delete.len(), 1);
        assert_eq!(after_delete[0].file_name, older);

        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        close_vault(&root, "notes", None).unwrap();
        let replaced = list_backups(&root, "notes").unwrap();
        assert_eq!(replaced.len(), 2);
        assert!(replaced.iter().any(|entry| entry.file_name == older));

        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        close_vault(&root, "notes", None).unwrap();
        let kept = list_backups(&root, "notes").unwrap();
        assert_eq!(
            kept.iter()
                .map(|entry| &entry.file_name)
                .collect::<Vec<_>>(),
            replaced
                .iter()
                .map(|entry| &entry.file_name)
                .collect::<Vec<_>>()
        );
    }
}
