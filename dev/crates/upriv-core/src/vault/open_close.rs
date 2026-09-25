//! Open / close against `store/` with an in-process session.

use crate::config::{load_app_settings_at, load_vault_config, VaultSecurityMode, VaultStorageMode};
use crate::error::{Result, UprivError};
use crate::lockfile::acquire_vault_lock;
use crate::logging::{log_event, LogLevel};
use crate::paths::{resolve_vault_mount_point, VaultRoot};
use crate::runtime_state::{mark_session_closed, mark_session_open, release_recorded_mount};
use crate::session::{
    check_unlock_allowed, insert_session, is_vault_closing_at, is_vault_open_at, open_session_ids,
    record_unlock_failure, record_unlock_success, take_session, with_open_session,
    with_unlock_lock, with_vault_dir_lock, ClosingGuard, OpenSession, PreparingGuard,
};
use crate::store::{content_hash_hex, flush_index_parts, open_store};

use super::backup::backup_on_close;
use super::persistence::{save_vault_persistence, VaultPersistence};

fn vault_dir_or_not_found(root: &VaultRoot, vault_id: &str) -> Result<std::path::PathBuf> {
    let dir = root.vault_dir(vault_id)?;
    if !dir.is_dir() {
        return Err(UprivError::VaultNotFound(dir));
    }
    Ok(dir)
}

fn try_attach_mount(root: &VaultRoot, vault_id: &str, vault_dir: &std::path::Path) -> Result<()> {
    let config = match load_vault_config(vault_dir) {
        Ok(config) => config,
        Err(_) => return Ok(()),
    };
    let global = load_app_settings_at(root.root())
        .map(|loaded| loaded.settings.workspace.path)
        .unwrap_or_default();
    let Some(mount_point) = resolve_vault_mount_point(
        &global,
        &config.mount.workspace_path,
        &config.vault.display_name,
    ) else {
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

/// Unlock into a RAM session. Password bytes are used exactly as given.
pub fn open_vault(root: &VaultRoot, vault_id: &str, password: &[u8]) -> Result<()> {
    if password.is_empty() {
        return Err(UprivError::WrongPassword);
    }
    let vault_dir = vault_dir_or_not_found(root, vault_id)?;
    let _preparing = PreparingGuard::enter(&vault_dir)?;
    with_vault_dir_lock(&vault_dir, || {
        if !vault_dir.is_dir() {
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
                config.security.mode.normalized(),
                opened,
            );
            session.lock = Some(lock);
            insert_session(session)?;
            if let Err(error) = mark_session_open(root, vault_id, None) {
                let _ = take_session(&vault_dir);
                return Err(error);
            }
            try_attach_mount(root, vault_id, &vault_dir)?;
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

fn close_vault_inner(
    root: &VaultRoot,
    vault_id: &str,
    password: Option<&[u8]>,
    kind: CloseKind,
) -> Result<CloseVaultOutcome> {
    let vault_dir = vault_dir_or_not_found(root, vault_id)?;
    let _closing = ClosingGuard::enter(&vault_dir)?;
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
        flush_index_parts(&store, &session.header, &session.index_key, &session.index)?;
        let hash = content_hash_hex(&store)?;
        let display_name = crate::config::load_vault_config_raw(&vault_dir)
            .map(|c| c.vault.display_name)
            .unwrap_or_else(|_| session.vault_id.clone());
        save_vault_persistence(
            &vault_dir,
            &VaultPersistence::closed(session.vault_id.clone(), display_name, Some(hash)),
        )?;
        if let Err(_error) = backup_on_close(root, vault_id) {
            backup_failed = true;
            // No `detail`: `UprivError`'s Display text includes filesystem paths.
            log_event(
                LogLevel::Warn,
                "vault_backup_on_close_failed",
                &[("id", vault_id)],
            );
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

#[cfg(test)]
mod tests {
    use super::*;
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
        if backups.is_dir() {
            std::fs::remove_dir_all(&backups).unwrap();
        }
        std::fs::write(&backups, b"not-a-directory").unwrap();
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
}
