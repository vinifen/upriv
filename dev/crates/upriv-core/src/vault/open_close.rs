//! Open / close against `store/` with an in-process session.

use std::path::Path;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

use crate::config::{load_app_settings_at, load_vault_config, VaultStorageMode};
use crate::error::{Result, UprivError};
#[allow(unused_imports)]
use crate::host_fs::HostFsQuery;
use crate::lockfile::{acquire_vault_lock, wait_for_lock_holder, LOCK_HOLDER_WAIT};
use crate::logging::{log_event, LogLevel};
use crate::paths::{
    encrypted_shortcut_active, resolve_vault_mount_point, resolved_workspace_parent, VaultRoot,
    WorkspaceSystem,
};
use crate::runtime_state::{mark_session_closed, mark_session_open, release_recorded_mount};
use crate::session::{
    any_close_under, check_unlock_allowed, hurry_close_at, hurry_closes_under, insert_session,
    is_vault_closing_at, is_vault_open_at, open_session_ids_under, record_unlock_failure,
    record_unlock_success, take_session, vault_close_phase_at, with_open_session, with_unlock_lock,
    with_vault_dir_lock, ClosePhase, ClosingGuard, Job, OpenSession, PreparingGuard,
};
use crate::store::{
    content_hash_with_index, flush_index_parts, index_logical_hash, open_store, pack_blob_waste,
    BlobPackMode, ChunkBlobMutation,
};

use super::backup::{
    backup_on_close, backup_stamp_present, classify_write_failure, discard_unfinished_backups,
    list_backups, promote_backup_save,
};
use super::persistence::{load_vault_persistence, save_vault_persistence, VaultPersistence};

/// How often quit looks for closes still running on other threads.
const CLOSE_WAIT_POLL: Duration = Duration::from_millis(20);

/// Unmount, then start thumbnail cleanup for that path.
/// The cache lives outside the mount. Cleanup returns immediately, so a bad
/// cache cannot hold this close open.
fn discard_mount(mount: Option<crate::mount::MountedVault>) {
    let path = mount
        .as_ref()
        .map(|mounted| mounted.mount_point().to_path_buf());
    drop(mount);
    if let Some(path) = path {
        crate::mount::purge_folder_thumbnails(&path);
    }
}

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
                        let mount =
                            with_open_session(vault_dir, |session| Ok(session.mount.take()))
                                .ok()
                                .flatten();
                        discard_mount(mount);
                        let _ = take_session(vault_dir);
                        let _ = mark_session_closed(root, vault_id);
                        return Err(error);
                    }
                    Ok(())
                }
                Err(error) => {
                    log_event(LogLevel::Warn, "vault_mount_failed", &[("id", vault_id)]);
                    let mount = with_open_session(vault_dir, |session| Ok(session.mount.take()))
                        .ok()
                        .flatten();
                    discard_mount(mount);
                    let _ = take_session(vault_dir);
                    let _ = mark_session_closed(root, vault_id);
                    Err(error)
                }
            }
        }
        Err(error) => {
            let detail = match &error {
                UprivError::VaultMountFailed(detail) => detail.clone(),
                other => other.to_string(),
            };
            log_event(
                LogLevel::Warn,
                "vault_mount_failed",
                &[("id", vault_id), ("detail", detail.as_str())],
            );
            let _ = with_open_session(vault_dir, |session| {
                session.mount_failure = Some(detail);
                Ok(())
            });
            Ok(())
        }
    }
}

/// What [`open_vault`] did. A plaintext vault whose place is not yet confirmed
/// stays unlocked until [`confirm_plain_destination`] or close.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OpenVaultOutcome {
    Opened,
    /// Unlock succeeded. Nothing was written. Confirm this path, or close.
    PlainConfirm {
        path: std::path::PathBuf,
        class: super::plain::PlainFolderClass,
    },
}

/// Unlock into a RAM session. An encrypted vault attaches its file-manager
/// mount when that is on; a plaintext vault fills its folder. Password bytes
/// are used exactly as given.
pub fn open_vault(root: &VaultRoot, vault_id: &str, password: &[u8]) -> Result<OpenVaultOutcome> {
    open_unlocked_session(root, vault_id, password, OpenKind::User { consent: None })
}

/// Fill the folder of a plaintext vault that is already unlocked, once the
/// user agreed to `plain_path`. Close drops the keys if they cancel.
pub fn confirm_plain_destination(
    root: &VaultRoot,
    vault_id: &str,
    plain_path: &Path,
) -> Result<()> {
    let vault_dir = vault_dir_or_not_found(root, vault_id)?;
    if !is_vault_open_at(&vault_dir) {
        return Err(UprivError::VaultNotOpen(vault_id.to_string()));
    }
    let already = with_open_session(&vault_dir, |session| Ok(session.plain.is_some()))?;
    if already {
        return Ok(());
    }
    if let Err(error) = super::plain::activate(root, vault_id, &vault_dir, Some(plain_path)) {
        drop_unfinished_session(root, vault_id, &vault_dir);
        return Err(error);
    }
    Ok(())
}

/// [`open_vault`] once the user agreed to put a plaintext vault's files at
/// `plain_path`, the path [`UprivError::PlainDestinationUnconfirmed`] named.
pub fn open_vault_confirmed(
    root: &VaultRoot,
    vault_id: &str,
    password: &[u8],
    plain_path: &Path,
) -> Result<OpenVaultOutcome> {
    let vault_dir = root.vault_dir(vault_id)?;
    if is_vault_open_at(&vault_dir) {
        confirm_plain_destination(root, vault_id, plain_path)?;
        return Ok(OpenVaultOutcome::Opened);
    }
    open_unlocked_session(
        root,
        vault_id,
        password,
        OpenKind::User {
            consent: Some(plain_path),
        },
    )
}

/// Unlock for an in-process ingest (an import). Nothing appears outside the
/// app: no FUSE mount a file manager can block on, and no plaintext folder.
pub(crate) fn open_vault_for_ingest(
    root: &VaultRoot,
    vault_id: &str,
    password: &[u8],
) -> Result<()> {
    open_unlocked_session(root, vault_id, password, OpenKind::Ingest).map(|_| ())
}

#[derive(Clone, Copy)]
enum OpenKind<'a> {
    /// The user opens the vault. `consent` confirms a plaintext folder.
    User { consent: Option<&'a Path> },
    /// An import streams files into a vault it just made.
    Ingest,
}

fn open_unlocked_session(
    root: &VaultRoot,
    vault_id: &str,
    password: &[u8],
    kind: OpenKind<'_>,
) -> Result<OpenVaultOutcome> {
    if password.is_empty() {
        return Err(UprivError::WrongPassword);
    }
    let vault_dir = vault_dir_or_not_found(root, vault_id)?;
    let _preparing = PreparingGuard::enter_exclusive(&vault_dir)?;
    with_vault_dir_lock(&vault_dir, || {
        if !vault_dir.host_is_dir() {
            return Err(UprivError::VaultNotFound(vault_dir.clone()));
        }
        // The core of an app that went away may still be closing this vault.
        if !is_vault_open_at(&vault_dir) && !is_vault_closing_at(&vault_dir) {
            wait_for_lock_holder(&root.runtime_lock_path(vault_id)?, LOCK_HOLDER_WAIT);
        }
        let config = load_vault_config(&vault_dir)?;
        let consent = match kind {
            OpenKind::User { consent } => Some(consent),
            OpenKind::Ingest => None,
        };
        let plain = consent.is_some() && config.storage_mode() == VaultStorageMode::UprivPlain;
        // A vault another process holds is not a leftover: the lock below
        // refuses it with the right error.
        if plain && !crate::runtime_state::vault_is_live(root, vault_id) {
            super::plain::check_before_unlock(root, vault_id, &config)?;
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
            let lock = acquire_vault_lock(root.runtime_lock_path(vault_id)?)?;
            // This process now owns the lock, so any recorded mount is stale,
            // and a backup zip still marked unfinished will never finish.
            release_recorded_mount(root, vault_id);
            discard_unfinished_backups(&vault_dir);
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
                config.vault.display_name.clone(),
                vault_dir.clone(),
                opened,
            );
            // Writes hash only when a close will compare contents. Turning the
            // skip on later costs one zip, not a re-read.
            session.index.writes.track_digests =
                config.backup.enabled && config.backup.skip_unchanged;
            session.lock = Some(lock);
            session.skip_close_backup = consent.is_none();
            insert_session(session)?;
            if let Err(error) = mark_session_open(root, vault_id, None) {
                let _ = take_session(&vault_dir);
                return Err(error);
            }
            if consent.is_some() && !plain {
                forget_plain_place(&vault_dir, vault_id);
                try_attach_mount(root, vault_id, &vault_dir)?;
            }
            Ok(())
        })?;
        if let (true, Some(consent)) = (plain, consent) {
            // Outside the unlock lock: filling a folder can take minutes, and
            // other vaults must still open meanwhile.
            match super::plain::activate(root, vault_id, &vault_dir, consent) {
                Ok(()) => {}
                Err(UprivError::PlainDestinationUnconfirmed { path, class })
                    if consent.is_none() =>
                {
                    log_event(LogLevel::Info, "vault_opened", &[("id", vault_id)]);
                    return Ok(OpenVaultOutcome::PlainConfirm { path, class });
                }
                Err(error) => {
                    drop_unfinished_session(root, vault_id, &vault_dir);
                    return Err(error);
                }
            }
        }
        log_event(LogLevel::Info, "vault_opened", &[("id", vault_id)]);
        Ok(OpenVaultOutcome::Opened)
    })
}

/// An unlock in encrypted mode forgets the plaintext place the user agreed
/// to, so switching back to plain text asks again.
fn forget_plain_place(vault_dir: &Path, vault_id: &str) {
    if with_open_session(vault_dir, super::plain::forget_plain_policy).is_err() {
        log_event(
            LogLevel::Warn,
            "vault_plain_policy_kept",
            &[("id", vault_id)],
        );
    }
}

/// Drop a session whose open did not finish.
fn drop_unfinished_session(root: &VaultRoot, vault_id: &str, vault_dir: &Path) {
    drop(take_session(vault_dir));
    let _ = mark_session_closed(root, vault_id);
}

#[derive(Clone, Copy)]
enum CloseKind {
    User,
    Auto,
    /// Close now: a close that starts out hurried.
    Now,
    Shutdown,
    /// [`CloseKind::Now`] while the app quits.
    ShutdownNow,
}

impl CloseKind {
    fn reason(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Auto => "auto",
            Self::Now => "now",
            Self::Shutdown => "shutdown",
            Self::ShutdownNow => "shutdown_now",
        }
    }

    fn quitting(self) -> bool {
        matches!(self, Self::Shutdown | Self::ShutdownNow)
    }

    fn immediate(self) -> bool {
        matches!(self, Self::Now | Self::ShutdownNow)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CloseVaultOutcome {
    pub backup_failed: bool,
    /// `disk_full`, `permission`, or `other` when the close backup was not written.
    pub backup_failure: Option<&'static str>,
    /// What happened to a plaintext vault's folder.
    pub plain: Option<super::plain::PlainCloseSummary>,
}

/// Keep the newest backup for good: it holds the vault from before a session
/// in which other apps changed most of it. True when it is kept.
fn pin_newest_backup(root: &VaultRoot, vault_id: &str) -> bool {
    match list_backups(root, vault_id) {
        Ok(entries) => match entries.first() {
            Some(entry) if entry.saved => true,
            Some(entry) => promote_backup_save(root, vault_id, &entry.stamp).is_ok(),
            None => false,
        },
        Err(_) => false,
    }
}

/// Phase of a `close_vault` still running for this vault. `None` when idle.
pub fn close_phase(root: &VaultRoot, vault_id: &str) -> Result<Option<ClosePhase>> {
    let vault_dir = root.vault_dir(vault_id)?;
    Ok(vault_close_phase_at(&vault_dir))
}

/// Make the close running for this vault finish the way [`close_vault_now`]
/// does: the closing pass, the backup, and the overwrite stop where they are.
/// Sealing the index still finishes. False when no close is running.
pub fn hurry_close(root: &VaultRoot, vault_id: &str) -> Result<bool> {
    Ok(hurry_close_at(&root.vault_dir(vault_id)?))
}

fn close_vault_inner(
    root: &VaultRoot,
    vault_id: &str,
    kind: CloseKind,
) -> Result<CloseVaultOutcome> {
    let vault_dir = vault_dir_or_not_found(root, vault_id)?;
    let closing = ClosingGuard::enter(&vault_dir)?;
    let hurry = Arc::clone(closing.hurry());
    if kind.immediate() {
        hurry.store(true, Ordering::Relaxed);
    }
    let hurried = || hurry.load(Ordering::Relaxed);
    let plain_pass = super::plain::before_close(&vault_dir, &hurry);
    let mut session = take_session(&vault_dir)?;
    let pin_backup = session
        .plain
        .as_ref()
        .is_some_and(super::plain::wants_pinned_backup);
    if hurried() {
        if let Some(plain) = session.plain.as_mut() {
            super::plain::drop_files_before_seal(vault_id, &vault_dir, plain);
        }
    }
    let store = vault_dir.join(crate::paths::STORE_DIR_NAME);
    let mut backup_failed = false;
    let mut backup_failure: Option<&'static str> = None;
    let mut backup_pinned = false;
    let persist = (|| {
        // Only blobs this session left dead bytes in. Every other blob was
        // already measured by the close after its last write. A hurried close
        // leaves them: dead bytes cost space, and the next write packs them.
        let rewritten: Vec<String> = session
            .index
            .writes
            .rewritten_blobs
            .iter()
            .cloned()
            .collect();
        let packed = if hurried() {
            ChunkBlobMutation::default()
        } else {
            match pack_blob_waste(
                &store,
                &session.header,
                &session.content_key,
                &mut session.index,
                BlobPackMode::Close,
                Some(&rewritten),
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
        // The layout held since the last seal is sealed by this close.
        let layout = super::fs::stage_pending_layout(&mut session);
        if !session.staged_blobs.is_empty() {
            if let Err(error) = super::fs::sync_staged_blobs(&session.staged_blobs) {
                super::fs::settle_staged_layout(&mut session, layout, false);
                return Err(error);
            }
            session.staged_blobs.clear();
        }
        // Before the seal, so the digests of files written in order are stored.
        session.index.settle_digest_streams();
        let sealed_index =
            match flush_index_parts(&store, &session.header, &session.index_key, &session.index) {
                Ok(sealed) => sealed,
                Err(error) => {
                    super::fs::settle_staged_layout(&mut session, layout, false);
                    if packed_ok {
                        packed.restore_packed_nodes(&mut session.index);
                        packed.discard_created();
                    }
                    return Err(error);
                }
            };
        super::fs::settle_staged_layout(&mut session, layout, true);
        session.index.clear_unsealed_holes();
        if packed_ok {
            packed.delete_superseded();
        }
        // The index just written is still in hand; only the header is read.
        let hash = content_hash_with_index(&store, &sealed_index)?;
        drop(sealed_index);
        let config = load_vault_config(&vault_dir).ok();
        // An unreadable config is not the default "skip": the backup attempt
        // reports that failure. A readable config with the key omitted is on.
        let backup_config = config.as_ref().map(|config| config.backup.clone());
        let backups_off = backup_config.as_ref().is_some_and(|backup| !backup.enabled);
        let skip_when_unchanged = backup_config
            .as_ref()
            .is_some_and(|backup| backup.enabled && backup.skip_unchanged);
        // Only a close that may skip its zip needs the contents id.
        let skip_backup = session.skip_close_backup || hurried();
        let logical_hash =
            (skip_when_unchanged && !skip_backup).then(|| index_logical_hash(&session.index));
        let previous = load_vault_persistence(&vault_dir).ok().flatten();
        let previous_backup = previous
            .as_ref()
            .and_then(|saved| saved.backed_up_index_hash.clone());
        let previous_stamp = previous
            .as_ref()
            .and_then(|saved| saved.backed_up_stamp.clone());
        // A config whose mount does not validate still names the vault.
        let display_name = match config {
            Some(config) => config.vault.display_name,
            None => crate::config::load_vault_config_raw(&vault_dir)
                .map(|c| c.vault.display_name)
                .unwrap_or_else(|_| session.vault_id.clone()),
        };
        let mut persistence =
            VaultPersistence::closed(session.vault_id.clone(), display_name, Some(hash));
        persistence.backed_up_index_hash = previous_backup.clone();
        persistence.backed_up_stamp = previous_stamp.clone();
        save_vault_persistence(&vault_dir, &persistence)?;
        if pin_backup {
            backup_pinned = pin_newest_backup(root, vault_id);
        }
        if !skip_backup && !backups_off {
            let already_backed_up = logical_hash.as_ref().is_some_and(|hash| {
                previous_backup.as_deref() == Some(hash.as_str())
                    && previous_stamp
                        .as_deref()
                        .is_some_and(|stamp| backup_stamp_present(root, vault_id, stamp))
            });
            if !already_backed_up {
                closing.set_phase(ClosePhase::Backup);
                match backup_on_close(root, vault_id, &Job::stopped_by(Arc::clone(&hurry))) {
                    Ok(Some(stamp)) => {
                        if let Some(hash) = logical_hash {
                            persistence.backed_up_index_hash = Some(hash);
                            persistence.backed_up_stamp = Some(stamp);
                            save_vault_persistence(&vault_dir, &persistence)?;
                        }
                    }
                    // Close now ended it; the next normal close writes it.
                    Ok(None) | Err(UprivError::JobCancelled) => {}
                    Err(error) => {
                        backup_failed = true;
                        let class = classify_write_failure(&error);
                        backup_failure = Some(class.reason);
                        let os = class.os.map(|code| code.to_string());
                        let mut fields = vec![
                            ("id", vault_id),
                            ("reason", class.reason),
                            ("kind", class.kind),
                        ];
                        if let Some(code) = os.as_deref() {
                            fields.push(("os", code));
                        }
                        log_event(LogLevel::Warn, "vault_backup_on_close_failed", &fields);
                    }
                }
            }
        }
        Ok(())
    })();
    if let Err(error) = persist {
        if kind.quitting() {
            // Quit must exit. Drop the session and its mount; do not put them
            // back. A plaintext folder stays recorded for recovery.
            let mount = session.mount.take();
            drop(session);
            discard_mount(mount);
            return Err(error);
        }
        reinsert_after_failed_close(session, &vault_dir, vault_id);
        return Err(error);
    }
    // Keep the mount until the close is recorded. Dropping it first and then
    // failing the state write would reinsert an open session with no mount.
    let mount = session.mount.take();
    if let Err(error) = mark_session_closed(root, vault_id) {
        if kind.quitting() {
            drop(session);
            discard_mount(mount);
            return Err(error);
        }
        session.mount = mount;
        reinsert_after_failed_close(session, &vault_dir, vault_id);
        return Err(error);
    }
    // Clear the folder while the lock file is still held, so another process
    // cannot fill it again meanwhile.
    let plain = session.plain.take().map(|plain| {
        super::plain::after_close(
            root,
            vault_id,
            &vault_dir,
            plain,
            plain_pass,
            backup_pinned,
            &hurry,
        )
    });
    drop(session);
    discard_mount(mount);
    log_event(
        LogLevel::Info,
        "vault_closed",
        &[("id", vault_id), ("reason", kind.reason())],
    );
    Ok(CloseVaultOutcome {
        backup_failed,
        backup_failure,
        plain,
    })
}

/// Put back a session whose close could not save it. A plaintext vault
/// syncs again.
fn reinsert_after_failed_close(session: OpenSession, vault_dir: &Path, vault_id: &str) {
    let plain = session.plain.is_some();
    if insert_session(session).is_ok() && plain {
        super::plain::resume_after_failed_close(vault_dir, vault_id);
    }
}

/// Flush the open session into `store/`. A manual lock.
pub fn close_vault(root: &VaultRoot, vault_id: &str) -> Result<CloseVaultOutcome> {
    close_vault_inner(root, vault_id, CloseKind::User)
}

/// Same flush as [`close_vault`]. The log line records `reason=auto`.
pub fn close_vault_auto(root: &VaultRoot, vault_id: &str) -> Result<CloseVaultOutcome> {
    close_vault_inner(root, vault_id, CloseKind::Auto)
}

/// Seal the open session and drop its keys and mount, with no backup. A
/// plaintext vault's folder is removed without the closing pass or an
/// overwrite, so what other apps changed since the last pass is lost.
pub fn close_vault_now(root: &VaultRoot, vault_id: &str) -> Result<CloseVaultOutcome> {
    close_vault_inner(root, vault_id, CloseKind::Now)
}

/// Flush every open vault, and wait for the closes already running. Used by
/// `app_shutdown`.
pub fn close_all_vaults(root: &VaultRoot) -> Result<Vec<String>> {
    close_every_vault(root, CloseKind::Shutdown)
}

/// [`close_vault_now`] for every open vault, and [`hurry_close`] for every
/// close already running. Used by `app_shutdown` on the quit dialog's Close now.
pub fn close_all_vaults_now(root: &VaultRoot) -> Result<Vec<String>> {
    close_every_vault(root, CloseKind::ShutdownNow)
}

fn close_every_vault(root: &VaultRoot, kind: CloseKind) -> Result<Vec<String>> {
    let vaults_dir = root.vaults_dir();
    if kind.immediate() {
        hurry_closes_under(&vaults_dir);
    }
    let mut closed = Vec::new();
    let mut first_err = None;
    for id in open_session_ids_under(&vaults_dir) {
        // Its close is already running; the wait below covers it.
        if root
            .vault_dir(&id)
            .is_ok_and(|dir| is_vault_closing_at(&dir))
        {
            continue;
        }
        match close_vault_inner(root, &id, kind) {
            Ok(_) => closed.push(id),
            Err(error) => {
                if first_err.is_none() {
                    first_err = Some(error);
                }
            }
        }
    }
    // The process exits next, and a close on another thread must not die
    // halfway. Electron's limit on `app_shutdown` bounds this.
    while any_close_under(&vaults_dir) {
        std::thread::sleep(CLOSE_WAIT_POLL);
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
    fn open_refuses_while_the_vault_is_held() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        let vault_dir = root.vault_dir("notes").unwrap();
        let _held = PreparingGuard::enter(&vault_dir).unwrap();
        let err = open_vault(&root, "notes", b"pass-word-ok").unwrap_err();
        assert!(matches!(err, UprivError::VaultBusy));
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
        let outcome = close_vault(&root, "notes").unwrap();
        assert!(
            outcome.backup_failed,
            "close must report the failed snapshot"
        );
        assert_eq!(outcome.backup_failure, Some("other"));
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
        close_vault(&root, "notes").unwrap();
        let first = list_backups(&root, "notes").unwrap();
        assert_eq!(first.len(), 1);
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        close_vault(&root, "notes").unwrap();
        let second = list_backups(&root, "notes").unwrap();
        assert_eq!(second.len(), 1);
        assert_eq!(second[0].file_name, first[0].file_name);
    }

    #[test]
    fn close_now_seals_the_files_and_writes_no_backup() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        crate::vault::fs_write_file(&root, "notes", "/hello.txt", b"secret").unwrap();
        let outcome = close_vault_now(&root, "notes").unwrap();
        assert!(!outcome.backup_failed);
        assert!(list_backups(&root, "notes").unwrap().is_empty());

        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        assert_eq!(
            crate::vault::fs_read_file(&root, "notes", "/hello.txt").unwrap(),
            b"secret"
        );
        // The next close makes the backup Close now skipped.
        close_vault(&root, "notes").unwrap();
        assert_eq!(list_backups(&root, "notes").unwrap().len(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn a_close_now_that_fails_leaves_the_next_close_its_backup() {
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
        crate::vault::fs_write_file(&root, "notes", "/hello.txt", b"secret").unwrap();
        let index = root.vault_dir("notes").unwrap().join("store/index");
        std::fs::set_permissions(&index, std::fs::Permissions::from_mode(0o500)).unwrap();
        let failed = close_vault_now(&root, "notes");
        std::fs::set_permissions(&index, std::fs::Permissions::from_mode(0o700)).unwrap();
        assert!(failed.is_err());

        close_vault(&root, "notes").unwrap();
        assert_eq!(list_backups(&root, "notes").unwrap().len(), 1);
    }

    #[test]
    fn a_stopped_close_backup_leaves_no_zip_and_the_next_close_writes_one() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        let stop = Arc::new(std::sync::atomic::AtomicBool::new(true));
        let stopped = backup_on_close(&root, "notes", &Job::stopped_by(stop));
        assert!(matches!(stopped, Err(UprivError::JobCancelled)));
        assert!(list_backups(&root, "notes").unwrap().is_empty());
        let backups = root.vault_dir("notes").unwrap().join("backups");
        let leftovers = crate::host_fs::read_dir(&backups).map_or(0, |dir| {
            dir.flatten().filter(|entry| entry.path().is_file()).count()
        });
        assert_eq!(leftovers, 0);

        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        close_vault(&root, "notes").unwrap();
        assert_eq!(list_backups(&root, "notes").unwrap().len(), 1);
    }

    #[test]
    fn hurry_close_says_when_no_close_is_running() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        assert!(!hurry_close(&root, "notes").unwrap());
        let vault_dir = root.vault_dir("notes").unwrap();
        let closing = ClosingGuard::enter(&vault_dir).unwrap();
        assert!(hurry_close(&root, "notes").unwrap());
        assert!(closing.hurry().load(Ordering::Relaxed));
    }

    #[test]
    fn close_all_waits_for_a_close_already_running() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        let vault_dir = root.vault_dir("notes").unwrap();
        let closing = ClosingGuard::enter(&vault_dir).unwrap();
        let ending = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(100));
            let hurried = closing.hurry().load(Ordering::Relaxed);
            drop(closing);
            hurried
        });
        close_all_vaults_now(&root).unwrap();
        assert!(!is_vault_closing_at(&vault_dir));
        assert!(
            ending.join().unwrap(),
            "quit tells a running close to hurry"
        );
    }

    #[test]
    fn close_all_now_closes_every_vault_with_no_backup() {
        let (_tmp, root) = vault_root_with(&[]);
        for (id, name) in [("notes", "Notes"), ("photos", "Photos")] {
            create_vault(
                &root,
                sample_config(id, name),
                b"pass-word-ok",
                KdfUnlockPreset::M32,
            )
            .unwrap();
            open_vault(&root, id, b"pass-word-ok").unwrap();
        }
        let mut closed = close_all_vaults_now(&root).unwrap();
        closed.sort();
        assert_eq!(closed, ["notes", "photos"]);
        assert!(list_backups(&root, "notes").unwrap().is_empty());
        assert!(list_backups(&root, "photos").unwrap().is_empty());
    }

    #[test]
    fn workspace_layout_does_not_create_a_backup() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        close_vault(&root, "notes").unwrap();
        let first = list_backups(&root, "notes").unwrap();
        assert_eq!(first.len(), 1);

        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        crate::vault::fs_write_file(
            &root,
            "notes",
            "/.upriv-workspace.json",
            br#"{"openTabs":["/README.md"],"activeTabPath":"/README.md"}"#,
        )
        .unwrap();
        close_vault(&root, "notes").unwrap();
        let after_layout = list_backups(&root, "notes").unwrap();
        assert_eq!(after_layout.len(), 1);
        assert_eq!(after_layout[0].file_name, first[0].file_name);

        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        crate::vault::fs_write_file(&root, "notes", "/note.txt", b"edited").unwrap();
        close_vault(&root, "notes").unwrap();
        let after_edit = list_backups(&root, "notes").unwrap();
        assert_eq!(after_edit.len(), 1);
        assert_ne!(after_edit[0].file_name, first[0].file_name);
    }

    /// Close timings on this machine. Needs about 200 MiB free in the temp dir:
    /// `cargo test --release -p upriv-core --lib close_cost_report -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn close_cost_report() {
        let (_tmp, root) = vault_root_with(&[]);
        let mut config = sample_config("notes", "Notes");
        config.backup.keep_last = 50;
        create_vault(&root, config, b"pass-word-ok", KdfUnlockPreset::M32).unwrap();
        let timed_close = |label: &str| {
            let started = std::time::Instant::now();
            close_vault(&root, "notes").unwrap();
            let zips = backup_names(&root).len();
            eprintln!("close {label}: {:?} ({zips} backups)", started.elapsed());
        };

        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        crate::vault::fs_mkdir(&root, "notes", "/small").unwrap();
        for i in 0..2000 {
            let path = format!("/small/{i}.txt");
            crate::vault::fs_write_file(&root, "notes", &path, &[b'x'; 1024]).unwrap();
        }
        timed_close("after 2000 new small files");
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        timed_close("unchanged, 2000 files");

        let big: Vec<u8> = (0..64 * 1024 * 1024).map(|i| (i % 251) as u8).collect();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        write_in_pieces(&root, "/big.bin", &big, 128 * 1024);
        timed_close("after 64 MiB written in order");
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        crate::vault::fs_truncate(&root, "notes", "/big.bin", 0).unwrap();
        write_in_pieces(&root, "/big.bin", &big, 128 * 1024);
        timed_close("after the same 64 MiB written again");
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        timed_close("unchanged, all files");
    }

    /// A file copied into the Linux folder, timed. Needs FUSE and the helper
    /// beside the test binary:
    /// `cargo build --release -p upriv-fuse && cargo test --release -p upriv-core --lib mount_write_cost_report -- --ignored --nocapture`
    #[cfg(target_os = "linux")]
    #[test]
    #[ignore]
    fn mount_write_cost_report() {
        use std::io::Write;
        let (tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        let point = tmp.path().join("folder");
        let mounted =
            crate::mount::mount_encrypted_dir(root.clone(), "notes".into(), point.clone()).unwrap();
        let big: Vec<u8> = (0..16 * 1024 * 1024).map(|i| (i % 251) as u8).collect();
        let started = std::time::Instant::now();
        let mut out = std::fs::File::create(point.join("big.bin")).unwrap();
        for part in big.chunks(1024 * 1024) {
            out.write_all(part).unwrap();
        }
        out.sync_all().unwrap();
        drop(out);
        let wrote = started.elapsed();
        assert_eq!(std::fs::read(point.join("big.bin")).unwrap(), big);
        drop(mounted);
        let started = std::time::Instant::now();
        close_vault(&root, "notes").unwrap();
        eprintln!(
            "16 MiB through the folder: write {wrote:?}, close {:?}",
            started.elapsed()
        );
    }

    /// Edits made through the Linux folder read back the same through it and
    /// from the store after a close and an unlock. Needs FUSE and the helper
    /// beside the test binary:
    /// `cargo build -p upriv-fuse && cargo test -p upriv-core --lib folder_edits_reach_the_store_intact -- --ignored`
    #[cfg(target_os = "linux")]
    #[test]
    #[ignore]
    fn folder_edits_reach_the_store_intact() {
        use std::collections::BTreeMap;
        use std::io::Write;
        use std::os::unix::fs::FileExt;

        const CHUNK: usize = 256 * 1024;
        let pattern = |len: usize, seed: u8| -> Vec<u8> {
            (0..len)
                .map(|i| (i as u8).wrapping_mul(31).wrapping_add(seed))
                .collect()
        };
        let (tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        let point = tmp.path().join("folder");
        let mounted =
            crate::mount::mount_encrypted_dir(root.clone(), "notes".into(), point.clone()).unwrap();
        let mut expected: BTreeMap<String, Vec<u8>> = BTreeMap::new();

        // Written in order, as a copy does, then edited in place.
        let mut big = pattern(3 * CHUNK + 12_345, 1);
        let mut out = std::fs::File::create(point.join("big.bin")).unwrap();
        for part in big.chunks(1024 * 1024) {
            out.write_all(part).unwrap();
        }
        drop(out);
        let file = std::fs::OpenOptions::new()
            .write(true)
            .open(point.join("big.bin"))
            .unwrap();
        let across_chunks = pattern(3_000, 2);
        file.write_all_at(&across_chunks, (CHUNK - 1_000) as u64)
            .unwrap();
        big[CHUNK - 1_000..CHUNK + 2_000].copy_from_slice(&across_chunks);
        // Shrink inside a chunk, then grow: the new bytes are zeros.
        file.set_len((2 * CHUNK + 7) as u64).unwrap();
        big.truncate(2 * CHUNK + 7);
        file.set_len((2 * CHUNK + 5_000) as u64).unwrap();
        big.resize(2 * CHUNK + 5_000, 0);
        // A write past the end leaves zeros before it.
        file.write_all_at(b"tail", (3 * CHUNK) as u64).unwrap();
        big.resize(3 * CHUNK, 0);
        big.extend_from_slice(b"tail");
        file.sync_all().unwrap();
        drop(file);
        expected.insert("big.bin".into(), big);

        std::fs::write(point.join("log.txt"), b"first\n").unwrap();
        let mut log = std::fs::OpenOptions::new()
            .append(true)
            .open(point.join("log.txt"))
            .unwrap();
        log.write_all(b"second\n").unwrap();
        drop(log);
        expected.insert("log.txt".into(), b"first\nsecond\n".to_vec());

        std::fs::create_dir_all(point.join("docs").join("drafts")).unwrap();
        for i in 0..20u8 {
            let name = format!("{i}.md");
            let bytes = pattern(100 + usize::from(i), i);
            std::fs::write(point.join("docs").join("drafts").join(&name), &bytes).unwrap();
            expected.insert(format!("docs/final/{name}"), bytes);
        }
        std::fs::rename(
            point.join("docs").join("drafts"),
            point.join("docs").join("final"),
        )
        .unwrap();

        // Saved as editors do it: a new file renamed over the old one.
        std::fs::write(point.join("note.txt"), b"old text").unwrap();
        let mut saved = std::fs::File::create(point.join("note.txt.tmp")).unwrap();
        saved
            .write_all(b"new text, longer than the old one")
            .unwrap();
        saved.sync_all().unwrap();
        drop(saved);
        std::fs::rename(point.join("note.txt.tmp"), point.join("note.txt")).unwrap();
        expected.insert(
            "note.txt".into(),
            b"new text, longer than the old one".to_vec(),
        );

        std::fs::write(point.join("move-me.txt"), b"moved").unwrap();
        std::fs::rename(
            point.join("move-me.txt"),
            point.join("docs").join("moved.txt"),
        )
        .unwrap();
        expected.insert("docs/moved.txt".into(), b"moved".to_vec());
        std::fs::write(point.join("gone.txt"), b"gone").unwrap();
        std::fs::remove_file(point.join("gone.txt")).unwrap();
        std::fs::create_dir(point.join("empty")).unwrap();
        std::fs::remove_dir(point.join("empty")).unwrap();

        for (path, bytes) in &expected {
            let read = std::fs::read(point.join(path)).unwrap();
            assert!(&read == bytes, "{path} through the folder");
        }
        drop(mounted);
        close_vault(&root, "notes").unwrap();

        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        for (path, bytes) in &expected {
            let read = crate::vault::fs_read_file(&root, "notes", &format!("/{path}")).unwrap();
            assert!(&read == bytes, "{path} after an unlock");
        }
        for gone in [
            "/gone.txt",
            "/move-me.txt",
            "/note.txt.tmp",
            "/docs/drafts/0.md",
            "/empty",
        ] {
            assert!(
                crate::vault::fs_read_file(&root, "notes", gone).is_err(),
                "{gone} is gone"
            );
        }
        close_vault(&root, "notes").unwrap();
    }

    fn backup_names(root: &crate::paths::VaultRoot) -> Vec<String> {
        list_backups(root, "notes")
            .unwrap()
            .into_iter()
            .map(|entry| entry.file_name)
            .collect()
    }

    #[test]
    fn rewriting_the_same_bytes_does_not_create_a_backup() {
        let (_tmp, root) = vault_root_with(&[]);
        let mut config = sample_config("notes", "Notes");
        config.backup.keep_last = 9;
        create_vault(&root, config, b"pass-word-ok", KdfUnlockPreset::M32).unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        crate::vault::fs_write_file(&root, "notes", "/a.txt", b"alpha").unwrap();
        crate::vault::fs_write_file(&root, "notes", "/b.txt", b"beta").unwrap();
        close_vault(&root, "notes").unwrap();
        let first = backup_names(&root);
        assert_eq!(first.len(), 1);

        // New blob, chunk versions, and timestamps; the node also moves in the index.
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        crate::vault::fs_write_file(&root, "notes", "/a.txt", b"alpha").unwrap();
        crate::vault::fs_write_file(&root, "notes", "/a.txt", b"alpha").unwrap();
        close_vault(&root, "notes").unwrap();
        assert_eq!(backup_names(&root), first);

        // Same size, different bytes.
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        crate::vault::fs_write_file(&root, "notes", "/a.txt", b"ALPHA").unwrap();
        close_vault(&root, "notes").unwrap();
        assert_eq!(backup_names(&root).len(), 2);
    }

    fn sha256_of(bytes: &[u8]) -> String {
        use sha2::Digest;
        let mut hasher = sha2::Sha256::new();
        hasher.update(bytes);
        crate::store::sha256_hex(hasher)
    }

    fn sealed_digest(root: &crate::paths::VaultRoot, path: &str) -> Option<String> {
        let store = root
            .vault_dir("notes")
            .unwrap()
            .join(crate::paths::STORE_DIR_NAME);
        let opened = open_store(&store, b"pass-word-ok").unwrap();
        let node = opened.index.find(path).expect(path);
        node.current_digest().map(str::to_owned)
    }

    /// FUSE and WinFsp write a file as ranges in order, after a truncate.
    fn write_in_pieces(root: &crate::paths::VaultRoot, path: &str, bytes: &[u8], piece: usize) {
        for (i, part) in bytes.chunks(piece).enumerate() {
            crate::vault::fs_write_range(root, "notes", path, (i * piece) as u64, part).unwrap();
        }
    }

    #[test]
    fn close_seals_the_digest_each_writer_already_held() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        // Crosses chunk boundaries, and ends mid-chunk.
        let big: Vec<u8> = (0..700 * 1024).map(|i| (i % 251) as u8).collect();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        crate::vault::fs_write_file(&root, "notes", "/a.txt", b"alpha").unwrap();
        crate::vault::fs_write_file(&root, "notes", "/empty.txt", b"").unwrap();
        write_in_pieces(&root, "/big.bin", &big, 96 * 1024);
        crate::vault::fs_write_file(&root, "notes", "/gone.txt", b"to empty").unwrap();
        crate::vault::fs_truncate(&root, "notes", "/gone.txt", 0).unwrap();
        // A gap past the end is zero-filled.
        crate::vault::fs_write_range(&root, "notes", "/gap.bin", 0, b"ab").unwrap();
        crate::vault::fs_write_range(&root, "notes", "/gap.bin", 5, b"cd").unwrap();
        close_vault(&root, "notes").unwrap();

        assert_eq!(sealed_digest(&root, "a.txt"), Some(sha256_of(b"alpha")));
        assert_eq!(sealed_digest(&root, "empty.txt"), Some(sha256_of(b"")));
        assert_eq!(sealed_digest(&root, "big.bin"), Some(sha256_of(&big)));
        assert_eq!(sealed_digest(&root, "gone.txt"), Some(sha256_of(b"")));
        assert_eq!(
            sealed_digest(&root, "gap.bin"),
            Some(sha256_of(b"ab\0\0\0cd"))
        );
    }

    #[test]
    fn a_write_in_the_middle_drops_the_digest() {
        let (_tmp, root) = vault_root_with(&[]);
        let mut config = sample_config("notes", "Notes");
        config.backup.keep_last = 9;
        create_vault(&root, config, b"pass-word-ok", KdfUnlockPreset::M32).unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        crate::vault::fs_write_file(&root, "notes", "/a.txt", b"abcdef").unwrap();
        crate::vault::fs_write_range(&root, "notes", "/a.txt", 2, b"XY").unwrap();
        crate::vault::fs_truncate(&root, "notes", "/a.txt", 5).unwrap();
        close_vault(&root, "notes").unwrap();
        assert_eq!(sealed_digest(&root, "a.txt"), None);
        let first = backup_names(&root);
        assert_eq!(first.len(), 1);

        // No digest: the file counts by its storage, which did not move.
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        close_vault(&root, "notes").unwrap();
        assert_eq!(backup_names(&root), first);

        // Rewriting it in place with the same bytes cannot be told apart: one zip.
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        crate::vault::fs_write_range(&root, "notes", "/a.txt", 2, b"XY").unwrap();
        close_vault(&root, "notes").unwrap();
        assert_eq!(backup_names(&root).len(), 2);
    }

    #[test]
    fn streamed_rewrite_of_the_same_bytes_does_not_create_a_backup() {
        let (_tmp, root) = vault_root_with(&[]);
        let mut config = sample_config("notes", "Notes");
        config.backup.keep_last = 9;
        create_vault(&root, config, b"pass-word-ok", KdfUnlockPreset::M32).unwrap();
        let big: Vec<u8> = (0..600 * 1024).map(|i| (i % 241) as u8).collect();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        write_in_pieces(&root, "/big.bin", &big, 128 * 1024);
        close_vault(&root, "notes").unwrap();
        let first = backup_names(&root);
        assert_eq!(first.len(), 1);

        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        crate::vault::fs_truncate(&root, "notes", "/big.bin", 0).unwrap();
        write_in_pieces(&root, "/big.bin", &big, 100 * 1024);
        close_vault(&root, "notes").unwrap();
        assert_eq!(backup_names(&root), first);
    }

    #[test]
    fn a_packed_file_keeps_its_digest() {
        let (_tmp, root) = vault_root_with(&[]);
        let mut config = sample_config("notes", "Notes");
        config.backup.keep_last = 9;
        create_vault(&root, config, b"pass-word-ok", KdfUnlockPreset::M32).unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        // The second piece rewrites chunk 0, so close packs this small blob.
        write_in_pieces(&root, "/a.txt", b"hello world", 5);
        let before_pack = with_open_session(&root.vault_dir("notes").unwrap(), |session| {
            let node = session.index.find("a.txt").unwrap();
            Ok(node.as_file().unwrap().0.to_string())
        })
        .unwrap();
        close_vault(&root, "notes").unwrap();
        let store = root
            .vault_dir("notes")
            .unwrap()
            .join(crate::paths::STORE_DIR_NAME);
        let opened = open_store(&store, b"pass-word-ok").unwrap();
        let node = opened.index.find("a.txt").unwrap();
        assert_ne!(node.as_file().unwrap().0, before_pack, "close packed it");
        let expected = sha256_of(b"hello world");
        assert_eq!(node.current_digest(), Some(expected.as_str()));
        let first = backup_names(&root);

        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        crate::vault::fs_write_file(&root, "notes", "/a.txt", b"hello world").unwrap();
        close_vault(&root, "notes").unwrap();
        assert_eq!(backup_names(&root), first);
    }

    #[test]
    fn writes_skip_hashing_when_no_close_compares() {
        let (_tmp, root) = vault_root_with(&[]);
        let mut config = sample_config("notes", "Notes");
        config.backup.skip_unchanged = false;
        create_vault(&root, config, b"pass-word-ok", KdfUnlockPreset::M32).unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        crate::vault::fs_write_file(&root, "notes", "/a.txt", b"alpha").unwrap();
        write_in_pieces(&root, "/b.txt", b"streamed", 3);
        close_vault(&root, "notes").unwrap();
        assert_eq!(sealed_digest(&root, "a.txt"), None);
        assert_eq!(sealed_digest(&root, "b.txt"), None);
        assert_eq!(backup_names(&root).len(), 1);
    }

    #[test]
    fn close_reads_no_file_contents() {
        let (_tmp, root) = vault_root_with(&[]);
        let mut config = sample_config("notes", "Notes");
        config.backup.keep_last = 9;
        create_vault(&root, config, b"pass-word-ok", KdfUnlockPreset::M32).unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        crate::vault::fs_write_file(&root, "notes", "/a.txt", b"alpha").unwrap();
        close_vault(&root, "notes").unwrap();
        let first = backup_names(&root);
        assert_eq!(first.len(), 1);

        // Break a.txt on disk. Close never decrypts a file, so the sealed
        // digest still decides and no backup is written.
        let store = root
            .vault_dir("notes")
            .unwrap()
            .join(crate::paths::STORE_DIR_NAME);
        let opened = open_store(&store, b"pass-word-ok").unwrap();
        let (file_id, _, _) = opened.index.find("a.txt").unwrap().as_file().unwrap();
        let blob = crate::store::blob_path(&store, file_id).unwrap();
        let len = crate::host_fs::read(&blob).unwrap().len();
        crate::host_fs::write(&blob, vec![0u8; len]).unwrap();

        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        close_vault(&root, "notes").unwrap();
        assert_eq!(backup_names(&root), first);
    }

    #[test]
    fn close_writes_a_backup_on_every_close_when_skip_unchanged_is_off() {
        let (_tmp, root) = vault_root_with(&[]);
        let mut config = sample_config("notes", "Notes");
        config.backup.skip_unchanged = false;
        config.backup.keep_last = 5;
        create_vault(&root, config, b"pass-word-ok", KdfUnlockPreset::M32).unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        close_vault(&root, "notes").unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        close_vault(&root, "notes").unwrap();
        let backups = list_backups(&root, "notes").unwrap();
        assert_eq!(backups.len(), 2);
        assert_ne!(backups[0].file_name, backups[1].file_name);
    }

    #[test]
    fn close_writes_a_new_backup_when_the_recorded_zip_is_gone() {
        let (_tmp, root) = vault_root_with(&[]);
        let mut config = sample_config("notes", "Notes");
        config.backup.keep_last = 5;
        create_vault(&root, config, b"pass-word-ok", KdfUnlockPreset::M32).unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        crate::vault::fs_write_file(&root, "notes", "/a.txt", b"one").unwrap();
        close_vault(&root, "notes").unwrap();
        let first = list_backups(&root, "notes").unwrap();
        assert_eq!(first.len(), 1);

        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        crate::vault::fs_write_file(&root, "notes", "/a.txt", b"two").unwrap();
        close_vault(&root, "notes").unwrap();
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
        close_vault(&root, "notes").unwrap();
        let replaced = list_backups(&root, "notes").unwrap();
        assert_eq!(replaced.len(), 2);
        assert!(replaced.iter().any(|entry| entry.file_name == older));

        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        close_vault(&root, "notes").unwrap();
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

    fn listed_session(root: &crate::paths::VaultRoot, id: &str) -> Option<&'static str> {
        crate::vault::list_vaults(root)
            .unwrap()
            .into_iter()
            .find(|item| item.id == id)
            .expect("vault row")
            .session
    }

    fn copy_tree(src: &std::path::Path, dst: &std::path::Path) {
        std::fs::create_dir_all(dst).unwrap();
        for entry in std::fs::read_dir(src).unwrap() {
            let entry = entry.unwrap();
            let file_type = entry.file_type().unwrap();
            let to = dst.join(entry.file_name());
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                copy_tree(&entry.path(), &to);
            } else if file_type.is_file() {
                std::fs::copy(entry.path(), &to).unwrap();
            }
        }
    }

    fn replace_tree(src: &std::path::Path, dst: &std::path::Path) {
        std::fs::remove_dir_all(dst).unwrap();
        copy_tree(src, dst);
    }

    #[test]
    fn rolled_back_store_is_recovery_and_unlock_keeps_that_store() {
        let (tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        crate::vault::fs_write_file(&root, "notes", "/notes.txt", b"generation-one").unwrap();
        close_vault(&root, "notes").unwrap();
        assert_eq!(listed_session(&root, "notes"), None);

        let store = root.vault_store_dir("notes").unwrap();
        let snapshot = tmp.path().join("store-generation-one");
        copy_tree(&store, &snapshot);

        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        crate::vault::fs_write_file(&root, "notes", "/notes.txt", b"generation-two").unwrap();
        close_vault(&root, "notes").unwrap();
        let newer = crate::vault::load_vault_persistence(root.vault_dir("notes").unwrap())
            .unwrap()
            .expect("persistence")
            .content_hash
            .expect("content_hash");
        let rolled_back_hash = crate::store::content_hash_hex(&snapshot).unwrap();
        assert_ne!(rolled_back_hash, newer);

        replace_tree(&snapshot, &store);
        let persistence = crate::vault::load_vault_persistence(root.vault_dir("notes").unwrap())
            .unwrap()
            .expect("persistence");
        assert_eq!(persistence.content_hash.as_deref(), Some(newer.as_str()));
        assert_eq!(listed_session(&root, "notes"), Some("recovery"));

        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        assert_eq!(
            crate::vault::fs_read_file(&root, "notes", "/notes.txt").unwrap(),
            b"generation-one"
        );
        assert_eq!(listed_session(&root, "notes"), Some("open"));
        let during_open = crate::vault::load_vault_persistence(root.vault_dir("notes").unwrap())
            .unwrap()
            .expect("persistence")
            .content_hash;
        assert_eq!(during_open.as_deref(), Some(newer.as_str()));
        close_vault(&root, "notes").unwrap();

        assert_eq!(listed_session(&root, "notes"), None);
        let accepted = crate::vault::load_vault_persistence(root.vault_dir("notes").unwrap())
            .unwrap()
            .expect("persistence")
            .content_hash
            .expect("content_hash");
        assert_eq!(accepted, crate::store::content_hash_hex(&store).unwrap());
        assert_ne!(accepted, newer);
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        assert_eq!(
            crate::vault::fs_read_file(&root, "notes", "/notes.txt").unwrap(),
            b"generation-one"
        );
        close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn a_damaged_chunk_is_not_content_hash_recovery() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        let store = root.vault_store_dir("notes").unwrap();
        let before = crate::store::content_hash_hex(&store).unwrap();
        let mut flipped = false;
        let mut pending = vec![store.join(crate::store::DATA_DIR_NAME)];
        while let Some(dir) = pending.pop() {
            for entry in std::fs::read_dir(&dir).unwrap() {
                let entry = entry.unwrap();
                let path = entry.path();
                let file_type = entry.file_type().unwrap();
                if file_type.is_dir() {
                    pending.push(path);
                    continue;
                }
                if path.extension().and_then(|ext| ext.to_str()) != Some("blob") {
                    continue;
                }
                let mut bytes = std::fs::read(&path).unwrap();
                assert!(!bytes.is_empty());
                let last = bytes.len() - 1;
                bytes[last] ^= 0xff;
                std::fs::write(&path, bytes).unwrap();
                flipped = true;
                break;
            }
            if flipped {
                break;
            }
        }
        assert!(flipped);
        assert_eq!(crate::store::content_hash_hex(&store).unwrap(), before);
        assert_eq!(listed_session(&root, "notes"), None);
    }

    #[test]
    fn a_missing_content_hash_or_unreadable_store_is_not_recovery() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        let vault_dir = root.vault_dir("notes").unwrap();
        let mut persistence = crate::vault::load_vault_persistence(&vault_dir)
            .unwrap()
            .expect("persistence");
        persistence.content_hash = None;
        super::save_vault_persistence(&vault_dir, &persistence).unwrap();
        let store = root.vault_store_dir("notes").unwrap();
        let index = store
            .join(crate::store::INDEX_DIR_NAME)
            .join(crate::store::INDEX_FILE_NAME);
        std::fs::write(&index, b"torn").unwrap();
        assert_eq!(listed_session(&root, "notes"), None);

        let header = store
            .join(crate::store::HEADER_DIR_NAME)
            .join(crate::store::HEADER_FILE_NAME);
        std::fs::remove_file(&header).unwrap();
        std::fs::remove_file(
            store
                .join(crate::store::HEADER_DIR_NAME)
                .join(format!("{}.copy", crate::store::HEADER_FILE_NAME)),
        )
        .unwrap();
        assert!(crate::store::content_hash_hex(&store).is_err());
        assert_eq!(listed_session(&root, "notes"), None);
    }

    #[test]
    fn a_torn_primary_index_still_unlocks_and_close_clears_recovery() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        crate::vault::fs_write_file(&root, "notes", "/notes.txt", b"kept").unwrap();
        close_vault(&root, "notes").unwrap();
        assert_eq!(listed_session(&root, "notes"), None);

        let store = root.vault_store_dir("notes").unwrap();
        let index = store
            .join(crate::store::INDEX_DIR_NAME)
            .join(crate::store::INDEX_FILE_NAME);
        let original = std::fs::read(&index).unwrap();
        std::fs::write(&index, b"torn").unwrap();
        assert_eq!(listed_session(&root, "notes"), Some("recovery"));

        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        assert_eq!(
            crate::vault::fs_read_file(&root, "notes", "/notes.txt").unwrap(),
            b"kept"
        );
        assert_eq!(std::fs::read(&index).unwrap(), original);
        close_vault(&root, "notes").unwrap();
        assert_eq!(listed_session(&root, "notes"), None);
    }
}
