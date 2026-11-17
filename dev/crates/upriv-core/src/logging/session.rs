//! Process-wide logging session (daemon / mobile FFI host).
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
use crate::error::Result as CoreResult;
use crate::paths::{data_folder_lost, VaultRoot};

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
    // Tests never find a data folder to log into: `cargo test` runs inside
    // `dev/`, where discovery would reach the developer's own, and the app home
    // a test sets is process-wide, so a line any other test logs meanwhile
    // would land in that test's folder. A test that needs a logger installs it.
    if cfg!(test) {
        return Ok(session_logger());
    }
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

/// Strict logs dir for list/get/delete.
///
/// - Valid root → `Ok(Some(logs_dir))`
/// - True bootstrap (never ready this process, no root) → `Ok(None)` (empty list)
/// - Mid-session missing / incomplete → typed `Err` (fail loud)
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
                return Err(data_folder_lost());
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

/// Write `event` with `fields` and then the fields that name the device that
/// started this process, so a data folder that moves between machines keeps
/// a log that says which machine wrote which lines.
fn log_with_device(event: &str, fields: &[(&str, &str)]) {
    let device = crate::device::this_device().log_fields();
    let mut all = fields.to_vec();
    all.extend(device.iter().map(|(key, value)| (*key, value.as_str())));
    log_event(super::LogLevel::Info, event, &all);
}

/// Emit `app_start` once per process (after a vault-root is available).
pub fn log_app_start(source: &str) {
    if APP_START_EMITTED.swap(true, Ordering::Relaxed) {
        return;
    }
    log_with_device(
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
    log_with_device("vault_root_ready", &[("source", source), ("path", path)]);
}

/// Allow a subsequent [`log_vault_root_ready`] after a data-folder switch.
pub fn reset_vault_root_ready() {
    VAULT_ROOT_READY_EMITTED.store(false, Ordering::Relaxed);
}

/// True after this process has emitted `vault_root_ready` (a usable `.upriv` existed).
pub fn vault_root_was_ready() -> bool {
    VAULT_ROOT_READY_EMITTED.load(Ordering::Relaxed)
}

/// Write `vault_root_leaving` on an **existing** logger (old root).
///
/// Call **after** the data folder switched and **before**
/// [`ensure_logging_session`] / [`install_logging_at`], holding the `Arc`
/// captured before the switch. Do **not** route through [`log_event`] —
/// that re-resolves the root and can open the new folder first.
pub fn log_vault_root_leaving_on(logger: &Logger, from: &str, to: &str, source: &str) {
    logger.info(
        "vault_root_leaving",
        &[("from", from), ("to", to), ("source", source)],
    );
    logger.flush();
}

/// Write on the **new** root after switch (also re-arms + emits `vault_root_ready`).
pub fn log_vault_root_entered(from: &str, to: &str, source: &str) {
    reset_vault_root_ready();
    log_with_device(
        "vault_root_entered",
        &[("from", from), ("to", to), ("source", source)],
    );
    log_vault_root_ready(source, to);
}

/// List log files for the active vault-root.
///
/// Empty only when the root is valid but has no files, or true pre-ready bootstrap.
/// Mid-session missing/corrupt root → [`crate::error::UprivError`] A/B (not `Ok([])`).
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
    use crate::error::UprivError;
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

        crate::host_fs::remove_dir_all(home.path().join(".upriv")).unwrap();

        let err = list_session_log_files().unwrap_err();
        assert!(
            matches!(err, UprivError::VaultRootNotFound(_)),
            "expected VaultRootNotFound after deleting .upriv, got {err:?}"
        );

        reset_vault_root_ready();
        clear_logging_session();
        std::env::remove_var("UPRIV_DEFAULT_ROOT_ANCHOR");
    }

    #[test]
    fn a_data_folder_lost_after_ready_stays_selected_and_fails_again() {
        use crate::folder_list::data_folder::{
            load_data_folder_list, save_data_folder_list, selected_place, DataFolderList,
            DataFolderPlace,
        };
        use crate::folder_list::{DeviceGroup, Row, Selection};
        use crate::paths::{resolve_vault_root, ResolveVaultRoot, ResolveVaultRootOptions};

        let _guard = ENV_LOCK.lock().unwrap();
        reset_vault_root_ready();
        clear_logging_session();
        let home = tempfile::tempdir().unwrap();
        let usb = tempfile::tempdir().unwrap();
        std::env::remove_var("APPIMAGE");
        std::env::set_var("UPRIV_DEFAULT_ROOT_ANCHOR", home.path());
        initialize_vault_root(usb.path()).unwrap();
        let device = crate::device::this_device();
        let mut list = DataFolderList::default();
        list.devices.0.insert(
            device.id.clone().expect("tests need this device's ID"),
            DeviceGroup {
                rows: vec![Row {
                    number: 1,
                    name: String::new(),
                    path: usb.path().display().to_string(),
                }],
                selected: Selection::Row(1),
                next_number: 2,
                ..DeviceGroup::for_device(device)
            },
        );
        save_data_folder_list(home.path(), &list).unwrap();
        log_vault_root_ready("test", usb.path().to_str().unwrap_or(""));

        crate::host_fs::remove_dir_all(usb.path().join(".upriv")).unwrap();

        let err = list_session_log_files().unwrap_err();
        assert!(
            matches!(err, UprivError::VaultRootNotFound(_)),
            "expected VaultRootNotFound after deleting .upriv, got {err:?}"
        );
        let kept = load_data_folder_list(home.path()).unwrap();
        assert!(
            matches!(selected_place(&kept, device), DataFolderPlace::Row(row) if row.number == 1)
        );
        assert!(matches!(
            resolve_vault_root(ResolveVaultRootOptions::default()).unwrap(),
            ResolveVaultRoot::SelectedFailed { .. }
        ));

        reset_vault_root_ready();
        clear_logging_session();
        std::env::remove_var("UPRIV_DEFAULT_ROOT_ANCHOR");
    }

    #[test]
    fn the_ready_line_of_a_data_folder_names_this_device() {
        let _guard = ENV_LOCK.lock().unwrap();
        reset_vault_root_ready();
        clear_logging_session();
        let home = tempfile::tempdir().unwrap();
        std::env::remove_var("APPIMAGE");
        std::env::set_var("UPRIV_DEFAULT_ROOT_ANCHOR", home.path());
        initialize_vault_root(home.path()).unwrap();
        let logs = home.path().join(".upriv").join("logs");
        let settings = crate::config::AppSettings::default().logging;
        install_logging_at(&logs, &settings).unwrap();

        log_vault_root_ready("test", home.path().to_str().unwrap_or(""));
        flush_logging_session();

        let device = crate::device::this_device();
        let text: String = std::fs::read_dir(&logs)
            .unwrap()
            .map(|entry| std::fs::read_to_string(entry.unwrap().path()).unwrap())
            .collect();
        let ready = text
            .lines()
            .find(|line| line.contains("vault_root_ready"))
            .expect("a ready line");
        let id = device.id.as_ref().map_or("unknown", |id| id.as_str());
        assert!(ready.contains(&format!("device={id}")), "{ready}");
        assert!(ready.contains(&format!("system={}", device.system.as_str())));
        // The computer's name is never logged.
        assert!(!ready.contains("host="), "{ready}");

        reset_vault_root_ready();
        clear_logging_session();
        std::env::remove_var("UPRIV_DEFAULT_ROOT_ANCHOR");
    }
}
