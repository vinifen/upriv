//! Plaintext vaults (`upriv_plain`). While one is open, its files are also
//! real files in a folder other apps can open, with no FUSE or WinFsp. The
//! store stays the vault: the folder is a working copy, kept in sync both
//! ways, and wiped at close. Files nobody saved stay, and the vault lists as
//! recovery until the user decides what happens to them.
//!
//! Open order: the place is checked, the folder recorded in `state.json`,
//! made and marked, then filled. A failure after the first file wipes what
//! was written.

mod dest;
mod disk;
mod holders;
mod leftover;
mod marker;
mod names;
mod policy;
mod residue;
mod sweep;
mod sync;
mod volume;
mod worker;

use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;

use self::disk::DiskStamp;
use self::marker::{Marker, MARKER_NAME};
use self::names::NameRules;
use self::sweep::Visit;
use self::sync::Synced;
use crate::config::{load_vault_config, VaultConfig};
use crate::error::{Result, UprivError};
use crate::logging::{log_event, LogLevel};
use crate::paths::VaultRoot;
use crate::runtime_state::{self, PlainRecord};
use crate::session::with_open_session;
use crate::store::{is_reserved_logical, VaultIndex};
use crate::vault::wipe::WipeOptions;

pub use dest::{plain_destination, PlainDestination, PlainPlace};
pub use holders::PlainHolder;
pub use leftover::{
    import_plain_leftover, plain_leftover, remove_plain_leftover, PlainLeftover,
    PlainLeftoverImport, PlainWipe,
};
pub use volume::PlainFolderClass;
pub use worker::{set_plain_observer, PlainObserver};

pub(crate) use leftover::{adopt_orphans, clear_closed_leaf, clear_for_delete, ensure_no_leftover};
pub(crate) use policy::forget as forget_plain_policy;
pub(crate) use worker::store_changed;

/// Free space a folder must have beyond the vault's files: room for the
/// temp copy of the largest write and for the filesystem's own overhead.
const SPACE_MARGIN_MIN: u64 = 16 * 1024 * 1024;
/// Most held deletions one status lists by name.
const MAX_HELD_LISTED: usize = 50;

/// An open plaintext vault's folder, and what both sides looked like after
/// the last pass.
pub(crate) struct PlainSession {
    folder: PathBuf,
    /// Also in the folder's marker and the `state.json` record.
    token: String,
    /// Helper files at the top of the folder (`.nomedia`); never vault files.
    helpers: Vec<String>,
    made_folder: bool,
    bridge: bool,
    rules: NameRules,
    synced: HashMap<String, Synced>,
    /// Folder deletions waiting for the user after a mass change.
    held: BTreeSet<String>,
    /// Paths other apps changed or removed this session.
    touched: HashSet<String>,
    /// Most files the folder held at once this session.
    tracked: usize,
    totals: PlainTotals,
    last: Option<PlainSyncReport>,
    since: String,
}

impl PlainSession {
    fn new(folder: PathBuf, token: String, helpers: Vec<String>, made_folder: bool, rules: NameRules) -> Self {
        Self {
            bridge: crate::host_fs::is_bridge_path(&folder),
            folder,
            token,
            helpers,
            made_folder,
            rules,
            synced: HashMap::new(),
            held: BTreeSet::new(),
            touched: HashSet::new(),
            tracked: 0,
            totals: PlainTotals::default(),
            last: None,
            since: crate::time::utc_timestamp_iso_millis(),
        }
    }

    pub(crate) fn folder(&self) -> &Path {
        &self.folder
    }

    /// Other apps changed most of the vault this session: close keeps the
    /// backup from before it, so the new one cannot push it out.
    fn mass_changed(&self) -> bool {
        sync::is_mass_change(self.touched.len(), self.tracked)
    }

    #[cfg(test)]
    fn for_tests(family: volume::FsFamily) -> Self {
        Self::new(
            PathBuf::from("/folder"),
            "token".into(),
            Vec::new(),
            true,
            NameRules::new(family),
        )
    }
}

/// What one pass did.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlainSyncReport {
    /// Folder changes saved into the store.
    pub saved: u32,
    /// Store changes written to the folder.
    pub written: u32,
    /// Files changed on both sides. The folder copy was saved under a new name.
    pub conflicts: u32,
    /// Folder deletions waiting for the user.
    pub held_deletions: u32,
    /// Links, special files, unreadable entries, and names a vault cannot hold.
    pub skipped: u32,
    /// Store files the folder refused: names its system cannot hold, or a full drive.
    pub unwritable: u32,
    /// Steps left for the next pass because a side moved on meanwhile.
    pub retry: u32,
    /// The folder or its marker is gone. Nothing synced.
    pub folder_missing: bool,
}

impl PlainSyncReport {
    /// Nothing changed and nothing needs the user.
    pub fn is_quiet(&self) -> bool {
        self.saved == 0
            && self.written == 0
            && self.conflicts == 0
            && self.held_deletions == 0
            && self.unwritable == 0
            && !self.folder_missing
    }
}

/// What other apps did this session, as saved into the store.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlainTotals {
    pub added: u32,
    pub changed: u32,
    pub removed: u32,
}

/// `vault_plain_status`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlainStatus {
    pub folder: String,
    /// UTC time the folder was filled (RFC 3339).
    pub since: String,
    pub last: Option<PlainSyncReport>,
    /// The first held deletions by path, for the prompt.
    pub held_deletions: Vec<String>,
    pub held_count: u32,
    pub totals: PlainTotals,
}

/// What close did with the folder. `kept` files could not be saved or wiped;
/// while any are left the vault lists as recovery.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlainCloseSummary {
    /// Folder changes the closing pass saved.
    pub saved: u32,
    pub conflicts: u32,
    /// Deletions the user never confirmed. The store kept those files.
    pub held_deletions: u32,
    pub wiped: u32,
    pub kept: u32,
    pub totals: PlainTotals,
    /// The backup from before this session was kept for good.
    pub backup_pinned: bool,
}

/// Before the unlock: a leftover folder, a place this system cannot use, or
/// a folder that is not free stops the open before the key is derived.
pub(crate) fn check_before_unlock(root: &VaultRoot, vault_id: &str, config: &VaultConfig) -> Result<()> {
    leftover::ensure_no_leftover(root, vault_id)?;
    let dest = dest::resolve(root, config)?;
    dest::check(root, vault_id, &dest)?;
    dest::inspect_leaf(&dest.folder, vault_id)?;
    Ok(())
}

/// Fill the folder of a vault that was just unlocked. `consent` is the path
/// the user agreed to after [`UprivError::PlainDestinationUnconfirmed`].
///
/// On failure the caller drops the session. What was written is wiped
/// first; when that wipe falls short, the record stays and the vault lists
/// as recovery.
pub(crate) fn activate(
    root: &VaultRoot,
    vault_id: &str,
    vault_dir: &Path,
    consent: Option<&Path>,
) -> Result<()> {
    let config = load_vault_config(vault_dir)?;
    let wipe = WipeOptions::from_vault_config(&config);
    let dest = dest::resolve(root, &config)?;
    dest::check(root, vault_id, &dest)?;
    let volume = volume::inspect(&dest.folder);
    let rules = NameRules::new(volume.family);
    let (confirmed, unsupported, needed, helpers) = with_open_session(vault_dir, |session| {
        Ok((
            policy::is_confirmed(session, &dest.source),
            names::unsupported_names(&session.index, &rules),
            space_needed(&session.index),
            residue::helper_names(&session.index),
        ))
    })?;
    if !confirmed && consent != Some(dest.folder.as_path()) {
        return Err(UprivError::PlainDestinationUnconfirmed {
            path: dest.folder,
            class: volume.class,
        });
    }
    if !unsupported.is_empty() {
        return Err(UprivError::PlainNamesUnsupported {
            count: unsupported.len(),
            examples: unsupported.into_iter().take(names::MAX_NAME_EXAMPLES).collect(),
        });
    }
    dest::ensure_parent(root, &dest)?;
    if let Some(available) = volume::free_bytes(&dest.folder) {
        if available < needed {
            return Err(UprivError::PlainSpaceShort { needed, available });
        }
    }
    let leaf = dest::inspect_leaf(&dest.folder, vault_id)?;
    let token = uuid::Uuid::new_v4().simple().to_string();
    let record = PlainRecord {
        host: crate::lockfile::hostname()?,
        path: leftover::record_path(root, &dest).ok_or_else(|| UprivError::WorkspacePathInvalid {
            path: dest.folder.clone(),
            detail: "folder path is not valid UTF-8".into(),
        })?,
        in_data_folder: dest.in_data_folder(),
        token: token.clone(),
        since: crate::time::utc_timestamp_iso_millis(),
    };
    runtime_state::add_plain_record(root, vault_id, record)?;
    let plain = PlainSession::new(dest.folder.clone(), token, helpers, leaf.made_by_upriv(), rules);
    let marker = Marker::open(vault_id, &plain.token, &plain.helpers, plain.made_folder);
    if let Err(error) = with_open_session(vault_dir, |session| {
        session.plain = Some(plain);
        Ok(())
    }) {
        let _ = runtime_state::remove_plain_record(root, vault_id, &marker.token);
        return Err(error);
    }
    let worker = worker::register(vault_id, vault_dir, wipe);
    match fill(vault_dir, &dest, leaf, &marker, &worker) {
        Ok(Filled::Done(files)) => {
            if let Err(error) = worker::start(&worker, &dest.folder) {
                abandon(root, vault_id, vault_dir, &wipe);
                return Err(error);
            }
            residue::watch(&dest.folder);
            log_event(
                LogLevel::Info,
                "vault_plain_opened",
                &[("id", vault_id), ("files", files.to_string().as_str())],
            );
            Ok(())
        }
        // Close asked to stop while the folder was filling. It runs next and
        // wipes what was written.
        Ok(Filled::Cancelled) => Ok(()),
        Err(error) => {
            abandon(root, vault_id, vault_dir, &wipe);
            Err(error)
        }
    }
}

enum Filled {
    Done(u32),
    Cancelled,
}

/// Make the folder, mark it, confirm the place, and write every file.
fn fill(
    vault_dir: &Path,
    dest: &dest::Destination,
    leaf: dest::Leaf,
    marker: &Marker,
    worker: &worker::Worker,
) -> Result<Filled> {
    let folder = dest.folder.as_path();
    match leaf {
        dest::Leaf::Missing => disk::make_leaf(folder)?,
        dest::Leaf::Closed { .. } => disk::set_folder_writable(folder, true)?,
        dest::Leaf::Empty => {}
    }
    marker::write(folder, marker)?;
    residue::protect_folder(folder, &marker.helpers);
    with_open_session(vault_dir, |session| policy::confirm(session, &dest.source))?;
    let report = worker.pass()?;
    if worker.cancel_flag().load(Ordering::Relaxed) {
        return Ok(Filled::Cancelled);
    }
    if report.folder_missing {
        return Err(UprivError::WorkspaceUnavailable(folder.to_path_buf()));
    }
    if report.unwritable > 0 {
        return Err(UprivError::PlainFolderUnwritable {
            count: report.unwritable as usize,
        });
    }
    Ok(Filled::Done(report.written))
}

/// Undo a fill that failed: wipe what it wrote and drop the folder session.
fn abandon(root: &VaultRoot, vault_id: &str, vault_dir: &Path, wipe: &WipeOptions) {
    worker::stop(vault_dir);
    let plain = with_open_session(vault_dir, |session| Ok(session.plain.take()))
        .ok()
        .flatten();
    if let Some(plain) = plain {
        let wiped = wipe_session(root, vault_id, &plain, wipe);
        log_event(
            LogLevel::Warn,
            "vault_plain_open_abandoned",
            &[("id", vault_id), ("kept", wiped.kept.to_string().as_str())],
        );
    }
}

fn space_needed(index: &VaultIndex) -> u64 {
    let total: u64 = index
        .nodes
        .iter()
        .filter(|node| !is_reserved_logical(&node.path))
        .filter_map(|node| node.as_file().map(|(_, size, _)| size))
        .fold(0u64, u64::saturating_add);
    total.saturating_add((total / 50).max(SPACE_MARGIN_MIN))
}

/// The closing pass of a plaintext vault: the thread stops, then one last
/// pass saves what other apps changed. `None` for any other vault.
///
/// Waits for an open that is still filling the folder; [`activate`] stops
/// early once this cancels it.
pub(crate) fn before_close(vault_dir: &Path) -> Option<PlainSyncReport> {
    worker::cancel(vault_dir);
    let closing = crate::session::with_vault_dir_lock(vault_dir, || {
        let plain = with_open_session(vault_dir, |session| Ok(session.plain.is_some()))?;
        if !plain {
            return Ok(None);
        }
        worker::stop(vault_dir);
        let wipe = WipeOptions::for_vault_dir(vault_dir);
        match sync::run(vault_dir, true, &AtomicBool::new(false), &wipe) {
            Ok(report) => Ok(Some(report)),
            Err(_) => {
                log_event(LogLevel::Warn, "vault_plain_close_pass_failed", &[]);
                Ok(Some(PlainSyncReport::default()))
            }
        }
    });
    closing.ok().flatten()
}

/// Close could not save the store and put the session back: sync resumes.
pub(crate) fn resume_after_failed_close(vault_dir: &Path, vault_id: &str) {
    let folder = with_open_session(vault_dir, |session| {
        Ok(session.plain.as_ref().map(|plain| plain.folder.clone()))
    });
    let Ok(Some(folder)) = folder else {
        return;
    };
    let wipe = WipeOptions::for_vault_dir(vault_dir);
    let worker = worker::register(vault_id, vault_dir, wipe);
    if worker::start(&worker, &folder).is_err() {
        log_event(LogLevel::Warn, "vault_plain_sync_stopped", &[("id", vault_id)]);
    }
}

/// Close pins the backup from before this session when other apps changed
/// most of the vault.
pub(crate) fn wants_pinned_backup(plain: &PlainSession) -> bool {
    plain.mass_changed()
}

/// After the store is saved: wipe what the folder holds that the store has,
/// and leave the folder the way the next open expects.
pub(crate) fn after_close(
    root: &VaultRoot,
    vault_id: &str,
    vault_dir: &Path,
    plain: PlainSession,
    closing: Option<PlainSyncReport>,
    backup_pinned: bool,
) -> PlainCloseSummary {
    let wipe = WipeOptions::for_vault_dir(vault_dir);
    let wiped = wipe_session(root, vault_id, &plain, &wipe);
    let closing = closing.unwrap_or_default();
    let summary = PlainCloseSummary {
        saved: closing.saved,
        conflicts: closing.conflicts,
        held_deletions: plain.held.len() as u32,
        wiped: wiped.wiped,
        kept: wiped.kept,
        totals: plain.totals,
        backup_pinned,
    };
    log_event(
        LogLevel::Info,
        "vault_plain_closed",
        &[
            ("id", vault_id),
            ("wiped", summary.wiped.to_string().as_str()),
            ("kept", summary.kept.to_string().as_str()),
        ],
    );
    summary
}

/// Wipe what this session wrote or saved, then remove the folder when
/// nothing of the user's was left in it.
///
/// Only files whose stamp is the one the last pass saw are wiped, so this
/// runs even when the marker is gone: a folder put in its place holds none
/// of them.
fn wipe_session(root: &VaultRoot, vault_id: &str, plain: &PlainSession, opts: &WipeOptions) -> PlainWipe {
    let folder = plain.folder.as_path();
    let marker = marker::read(folder)
        .ok()
        .flatten()
        .filter(|marker| marker.written_by(vault_id, &plain.token));
    let mut choose = |rel: &str, stamp: &DiskStamp| saved_or_ours(plain, rel, stamp);
    let wiped = match sweep::sweep_folder(folder, &[MARKER_NAME], opts, &mut choose) {
        Ok(swept) => PlainWipe {
            wiped: swept.wiped,
            kept: swept.kept.len() as u32,
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => PlainWipe::default(),
        Err(_) => PlainWipe { wiped: 0, kept: 1 },
    };
    if wiped.kept == 0 {
        let finished = match &marker {
            Some(marker) => leftover::finish_folder(folder, marker).is_ok(),
            None => {
                if plain.made_folder {
                    let _ = crate::host_fs::remove_dir(folder);
                }
                true
            }
        };
        if finished {
            let _ = runtime_state::remove_plain_record(root, vault_id, &plain.token);
        }
    }
    residue::purge_after_close(folder, opts);
    wiped
}

/// A file the store holds as it is on disk, a temp file of the sync, or a
/// helper file the session wrote.
fn saved_or_ours(plain: &PlainSession, rel: &str, stamp: &DiskStamp) -> Visit {
    let name = rel.rsplit('/').next().unwrap_or(rel);
    let helper = !rel.contains('/') && plain.helpers.iter().any(|helper| helper == rel);
    let saved = matches!(plain.synced.get(rel), Some(Synced::File { disk, .. }) if disk == stamp);
    if helper || saved || disk::is_temp_name(name) {
        Visit::Wipe
    } else {
        Visit::Keep
    }
}

fn plain_vault_dir(root: &VaultRoot, vault_id: &str) -> Result<PathBuf> {
    let vault_dir = root.vault_dir(vault_id)?;
    let open_plain = with_open_session(&vault_dir, |session| Ok(session.plain.is_some()))?;
    if !open_plain {
        return Err(UprivError::VaultNotOpen(vault_id.to_string()));
    }
    Ok(vault_dir)
}

/// `vault_plain_sync`: one pass now. A phone app calls it when it comes back
/// to the foreground.
pub fn plain_sync(root: &VaultRoot, vault_id: &str) -> Result<PlainSyncReport> {
    let vault_dir = plain_vault_dir(root, vault_id)?;
    worker::run_now(&vault_dir, vault_id)
}

/// `vault_plain_status`: the open folder and how syncing went.
pub fn plain_status(root: &VaultRoot, vault_id: &str) -> Result<PlainStatus> {
    let vault_dir = plain_vault_dir(root, vault_id)?;
    with_open_session(&vault_dir, |session| {
        let plain = session
            .plain
            .as_ref()
            .ok_or_else(|| UprivError::VaultNotOpen(vault_id.to_string()))?;
        Ok(PlainStatus {
            folder: plain.folder.display().to_string(),
            since: plain.since.clone(),
            last: plain.last.clone(),
            held_deletions: plain.held.iter().take(MAX_HELD_LISTED).cloned().collect(),
            held_count: plain.held.len() as u32,
            totals: plain.totals,
        })
    })
}

/// `vault_plain_deletions`: remove the held files from the store (`apply`),
/// or write them back to the folder.
pub fn plain_deletions(root: &VaultRoot, vault_id: &str, apply: bool) -> Result<PlainStatus> {
    let vault_dir = plain_vault_dir(root, vault_id)?;
    let removed = worker::exclusive(&vault_dir, vault_id, || {
        with_open_session(&vault_dir, |session| sync::settle_held(session, apply))
    })?;
    log_event(
        LogLevel::Info,
        "vault_plain_deletions_settled",
        &[("id", vault_id), ("removed", removed.to_string().as_str())],
    );
    store_changed(&vault_dir);
    plain_status(root, vault_id)
}

/// `vault_plain_holders`: apps with files of the open folder still open.
pub fn plain_holders(root: &VaultRoot, vault_id: &str) -> Result<Vec<PlainHolder>> {
    let vault_dir = plain_vault_dir(root, vault_id)?;
    let folder = with_open_session(&vault_dir, |session| {
        Ok(session.plain.as_ref().map(|plain| plain.folder.clone()))
    })?
    .ok_or_else(|| UprivError::VaultNotOpen(vault_id.to_string()))?;
    Ok(holders::holders(&folder))
}
