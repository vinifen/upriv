//! Open / close against `contents/` with an in-process session.

use crate::config::{load_vault_config, VaultSecurityMode, VaultStorageMode};
use crate::contents::{content_hash_hex, flush_index_parts, open_store};
use crate::error::{Result, UprivError};
use crate::logging::{log_event, LogLevel};
use crate::paths::VaultRoot;
use crate::session::{
    check_unlock_allowed, insert_session, is_vault_open_at, record_unlock_failure,
    record_unlock_success, take_session, with_unlock_lock, ClosingGuard, OpenSession,
};

use super::persistence::{save_vault_persistence, VaultPersistence};

fn vault_dir_or_not_found(root: &VaultRoot, vault_id: &str) -> Result<std::path::PathBuf> {
    let dir = root.vault_dir(vault_id)?;
    if !dir.is_dir() {
        return Err(UprivError::VaultNotFound(dir));
    }
    Ok(dir)
}

/// Unlock into a RAM session. Password bytes are used exactly as given.
pub fn open_vault(root: &VaultRoot, vault_id: &str, password: &[u8]) -> Result<()> {
    if password.is_empty() {
        return Err(UprivError::WrongPassword);
    }
    let vault_dir = vault_dir_or_not_found(root, vault_id)?;
    with_unlock_lock(|| {
        check_unlock_allowed(&vault_dir)?;
        if is_vault_open_at(&vault_dir) {
            return Err(UprivError::VaultAlreadyOpen(vault_id.to_string()));
        }
        let config = load_vault_config(&vault_dir)?;
        if config.storage_mode() == VaultStorageMode::UprivPlain {
            return Err(UprivError::UprivPlainUnavailable);
        }
        let contents = vault_dir.join("contents");
        let opened = match open_store(&contents, password) {
            Ok(opened) => opened,
            Err(UprivError::WrongPassword) => {
                let _ = record_unlock_failure(&vault_dir);
                return Err(UprivError::WrongPassword);
            }
            Err(other) => return Err(other),
        };
        record_unlock_success(&vault_dir);
        insert_session(OpenSession::from_opened(
            vault_id.to_string(),
            vault_dir.clone(),
            config.security.mode.normalized(),
            opened,
        ))?;
        log_event(LogLevel::Info, "vault_opened", &[("id", vault_id)]);
        Ok(())
    })
}

/// Flush the empty (or dirty) index and drop the session.
///
/// `password` is required only for `always_prompt` as a **presence** check
/// (non-empty bytes). Do not re-run Argon2 / `open_store` — that would be a
/// second multi-minute unlock, not a lock gate (SECURITY-CRYPTO / TS lifecycle).
pub fn close_vault(root: &VaultRoot, vault_id: &str, password: Option<&[u8]>) -> Result<()> {
    let vault_dir = vault_dir_or_not_found(root, vault_id)?;
    // Hold before `take_session` so root-switch never sees an empty gap mid-close.
    let _closing = ClosingGuard::enter(&vault_dir)?;
    let session = take_session(&vault_dir)?;
    if session.security_mode == VaultSecurityMode::AlwaysPrompt {
        let present = password.is_some_and(|p| !p.is_empty());
        if !present {
            insert_session(session)?;
            return Err(UprivError::WrongPassword);
        }
    }
    let contents = vault_dir.join("contents");
    let persist = (|| {
        // Always reseal until a writer sets `session.dirty` (empty index is cheap).
        flush_index_parts(
            &contents,
            &session.header,
            &session.index_key,
            &session.index,
        )?;
        let hash = content_hash_hex(&contents)?;
        let display_name = crate::config::load_vault_config_raw(&vault_dir)
            .map(|c| c.vault.display_name)
            .unwrap_or_else(|_| session.vault_id.clone());
        save_vault_persistence(
            &vault_dir,
            &VaultPersistence::closed(session.vault_id.clone(), display_name, Some(hash)),
        )
    })();
    if let Err(error) = persist {
        let _ = insert_session(session);
        return Err(error);
    }
    log_event(LogLevel::Info, "vault_closed", &[("id", vault_id)]);
    Ok(())
}
