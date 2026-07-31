//! Process-wide logging session (daemon / future mobile host).
//!
//! Re-opens the writer when vault-root `logs_dir` or `[logging]` settings change.
//!
//! [`log_event`] / [`ensure_logging_session`] are **no-ops** until a vault-root
//! exists (`load_app_settings().root_path`). When the root disappears (deleted
//! `.upriv`, incomplete, NeedsSetup), the session logger is **cleared** so a
//! stale writer cannot `mkdir` a partial `.upriv/logs` and fake a vault-root.
//! Early WARN/ERROR paths may therefore only reach `eprintln` until setup —
//! intentional lazy logging, not a silent failure of the product log store.

use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use super::config::LogConfig;
use super::store::{self, LogFileInfo};
use super::writer::Logger;
use crate::config::{discover_bootstrap_root, load_app_settings, LoggingSettings};
use crate::error::{Result as CoreResult, UprivError};
use crate::paths::{
    app_home_dir, read_vault_root_alias, setup_default_root_anchor, VaultRoot,
    VAULT_ROOT_SETTINGS_REL,
};

static SESSION: OnceLock<Mutex<SessionState>> = OnceLock::new();
static APP_START_EMITTED: AtomicBool = AtomicBool::new(false);
static VAULT_ROOT_READY_EMITTED: AtomicBool = AtomicBool::new(false);

struct SessionState {
    logger: Option<Arc<Logger>>,
    logs_dir: Option<PathBuf>,
}

fn session() -> &'static Mutex<SessionState> {
    SESSION.get_or_init(|| {
        Mutex::new(SessionState {
            logger: None,
            logs_dir: None,
        })
    })
}

/// Drop the process logger without writing further lines (no `app_stop`).
pub fn clear_logging_session() {
    let mut guard = session()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(logger) = guard.logger.take() {
        logger.flush();
    }
    guard.logs_dir = None;
}

/// Ensure a logger is open for the current vault-root (idempotent unless config/dir changed).
///
/// Uses on-disk `[logging]` settings. If no vault-root is available yet (or the
/// marker vanished), clears any stale session logger and returns `Ok(None)`.
pub fn ensure_logging_session() -> io::Result<Option<Arc<Logger>>> {
    let loaded = match load_app_settings() {
        Ok(loaded) => loaded,
        Err(error) => {
            eprintln!("upriv-core: load_app_settings for logging failed: {error}");
            clear_logging_session();
            return Ok(None);
        }
    };
    let Some(root_path) = loaded.root_path else {
        clear_logging_session();
        return Ok(None);
    };
    // Race: root may have been deleted after load — do not keep/install a writer.
    if let Err(error) = crate::paths::validate_existing_vault_root(&root_path) {
        eprintln!("upriv-core: vault-root no longer valid for logging: {error}");
        clear_logging_session();
        return Ok(None);
    }
    let logs_dir = VaultRoot::new(root_path).logs_dir();
    install_logging_at(&logs_dir, &loaded.settings.logging)
}

/// Install or replace the process logger when `logs_dir` / `[logging]` change.
pub fn install_logging_at(
    logs_dir: &Path,
    settings: &LoggingSettings,
) -> io::Result<Option<Arc<Logger>>> {
    let desired = LogConfig::from_settings(settings, logs_dir);
    let mut guard = session()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    let (replacing, path_changed) = if let Some(existing) = guard.logger.as_ref() {
        if existing.config() == &desired {
            return Ok(Some(existing.clone()));
        }
        let path_changed = existing.config().logs_dir != desired.logs_dir;
        existing.flush();
        guard.logger = None;
        (true, path_changed)
    } else {
        (false, false)
    };

    let logger = Arc::new(Logger::open(desired)?);
    guard.logs_dir = Some(logs_dir.to_path_buf());

    // Settings-only change on the same root — not a data-folder switch.
    if replacing && !path_changed && logger.config().enabled {
        logger.info(
            "logging_reconfigure",
            &[
                ("enabled", "true"),
                ("level", logger.config().min_level.filter_str()),
            ],
        );
    }

    guard.logger = Some(logger.clone());
    Ok(Some(logger))
}

/// Active process logger, if installed.
pub fn session_logger() -> Option<Arc<Logger>> {
    session()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .logger
        .clone()
}

/// Resolved `.upriv/logs` for the current vault-root (always from settings when possible).
///
/// Soft `None` for writers / early paths. Prefer [`require_session_logs_dir`] for
/// read/delete RPC so mid-session missing roots fail loud (A/B).
pub fn session_logs_dir() -> Option<PathBuf> {
    require_session_logs_dir().unwrap_or_default()
}

/// Intended vault-root path when discover reports absence (alias or default anchor).
fn intended_vault_root_path() -> CoreResult<PathBuf> {
    let home = app_home_dir()?;
    if let Some(alias) = read_vault_root_alias(&home)? {
        if alias.active {
            return Ok(alias.path);
        }
    }
    setup_default_root_anchor()
}

/// Strict logs dir for list/get/delete.
///
/// - Valid root → `Ok(Some(logs_dir))`
/// - True bootstrap (never ready this process, no root) → `Ok(None)` (empty list)
/// - Mid-session missing / incomplete / alias invalid → typed `Err` (fail loud)
fn require_session_logs_dir() -> CoreResult<Option<PathBuf>> {
    match discover_bootstrap_root() {
        Ok(Some(root)) => {
            let dir = root.logs_dir();
            let mut guard = session()
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            guard.logs_dir = Some(dir.clone());
            Ok(Some(dir))
        }
        Ok(None) => {
            clear_logging_session();
            if VAULT_ROOT_READY_EMITTED.load(Ordering::Relaxed) {
                let target = intended_vault_root_path()?;
                return Err(UprivError::VaultRootNotFound(
                    target.join(VAULT_ROOT_SETTINGS_REL),
                ));
            }
            Ok(None)
        }
        Err(error) => {
            clear_logging_session();
            Err(error)
        }
    }
}

/// Flush the session logger (best-effort; call on graceful shutdown).
pub fn flush_logging_session() {
    if let Some(logger) = session_logger() {
        logger.flush();
        logger.info("app_stop", &[]);
        logger.flush();
    }
}

/// Emit a structured line via the session logger (ensures session first).
pub fn log_event(level: super::LogLevel, event: &str, fields: &[(&str, &str)]) {
    match ensure_logging_session() {
        Ok(Some(logger)) => logger.log(level, event, fields),
        Ok(None) => {}
        Err(error) => eprintln!("upriv-core: ensure_logging_session failed: {error}"),
    }
}

/// Emit `app_start` once per process (after a vault-root is available).
pub fn log_app_start(source: &str) {
    if APP_START_EMITTED.swap(true, Ordering::Relaxed) {
        return;
    }
    log_event(
        super::LogLevel::Info,
        "app_start",
        &[("version", crate::app_version()), ("source", source)],
    );
}

/// Emit `vault_root_ready` once per process — `.upriv` data root is usable.
///
/// Call [`reset_vault_root_ready`] before this when switching to another root
/// so the new folder also gets a ready line.
pub fn log_vault_root_ready(source: &str, path: &str) {
    if VAULT_ROOT_READY_EMITTED.swap(true, Ordering::Relaxed) {
        return;
    }
    log_event(
        super::LogLevel::Info,
        "vault_root_ready",
        &[("source", source), ("path", path)],
    );
}

/// Allow a subsequent [`log_vault_root_ready`] after a data-folder switch.
pub fn reset_vault_root_ready() {
    VAULT_ROOT_READY_EMITTED.store(false, Ordering::Relaxed);
}

/// Write `vault_root_leaving` on an **existing** logger (old root).
///
/// Call **after** a successful root/alias mutation and **before**
/// [`ensure_logging_session`] / [`install_logging_at`], holding the `Arc`
/// captured before the mutation. Do **not** route through [`log_event`] —
/// that re-resolves the root and can open the new folder first.
pub fn log_vault_root_leaving_on(logger: &Logger, from: &str, to: &str, mode: &str) {
    logger.info(
        "vault_root_leaving",
        &[("from", from), ("to", to), ("mode", mode)],
    );
    logger.flush();
}

/// Write leaving on the current session logger without re-resolving the root.
pub fn log_vault_root_leaving(from: &str, to: &str, mode: &str) {
    if let Some(logger) = session_logger() {
        log_vault_root_leaving_on(&logger, from, to, mode);
    }
}

/// Write on the **new** root after switch (also re-arms + emits `vault_root_ready`).
pub fn log_vault_root_entered(from: &str, to: &str, mode: &str) {
    reset_vault_root_ready();
    log_event(
        super::LogLevel::Info,
        "vault_root_entered",
        &[("from", from), ("to", to), ("mode", mode)],
    );
    log_vault_root_ready(mode, to);
}

/// List log files for the active vault-root.
///
/// Empty only when the root is valid but has no files, or true pre-ready bootstrap.
/// Mid-session missing/corrupt root → [`UprivError`] A/B (not `Ok([])`).
///
/// Read-only: does **not** open/create a writer or emit `app_start`.
pub fn list_session_log_files() -> CoreResult<Vec<LogFileInfo>> {
    match require_session_logs_dir()? {
        Some(dir) => Ok(store::list_log_files(&dir)?),
        None => Ok(Vec::new()),
    }
}

/// Read one log file (content included).
pub fn read_session_log_file(filename: &str) -> CoreResult<Option<LogFileInfo>> {
    match require_session_logs_dir()? {
        Some(dir) => Ok(store::read_log_file(&dir, filename)?),
        None => Ok(None),
    }
}

/// Delete log files; releases the active writer handle when deleting `current-*`.
pub fn delete_session_log_files(filenames: &[String]) -> CoreResult<()> {
    let Some(dir) = require_session_logs_dir()? else {
        return Ok(());
    };
    // Validate all names before releasing the writer (mixed invalid must not drop the handle).
    for filename in filenames {
        if store::safe_log_path(&dir, filename).is_none() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("invalid log filename(s): {filename}"),
            )
            .into());
        }
    }
    if let Some(logger) = session_logger() {
        for name in filenames {
            logger.release_active_named(name);
        }
    }
    Ok(store::delete_log_files(&dir, filenames)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::{initialize_vault_root, ENV_LOCK};

    #[test]
    fn list_bootstrap_without_ready_is_empty() {
        let _guard = ENV_LOCK.lock().unwrap();
        reset_vault_root_ready();
        clear_logging_session();
        let home = tempfile::tempdir().unwrap();
        std::env::remove_var("APPIMAGE");
        std::env::set_var("UPRIV_DEFAULT_ROOT_ANCHOR", home.path());

        let files = list_session_log_files().unwrap();
        assert!(files.is_empty());

        std::env::remove_var("UPRIV_DEFAULT_ROOT_ANCHOR");
    }

    #[test]
    fn list_after_ready_then_delete_upriv_returns_not_found() {
        let _guard = ENV_LOCK.lock().unwrap();
        reset_vault_root_ready();
        clear_logging_session();
        let home = tempfile::tempdir().unwrap();
        std::env::remove_var("APPIMAGE");
        std::env::set_var("UPRIV_DEFAULT_ROOT_ANCHOR", home.path());
        initialize_vault_root(home.path()).unwrap();

        assert!(list_session_log_files().unwrap().is_empty());
        log_vault_root_ready("test", home.path().to_str().unwrap_or(""));

        std::fs::remove_dir_all(home.path().join(".upriv")).unwrap();

        let err = list_session_log_files().unwrap_err();
        assert!(
            matches!(err, UprivError::VaultRootNotFound(_)),
            "expected VaultRootNotFound after deleting .upriv, got {err:?}"
        );

        reset_vault_root_ready();
        clear_logging_session();
        std::env::remove_var("UPRIV_DEFAULT_ROOT_ANCHOR");
    }
}
