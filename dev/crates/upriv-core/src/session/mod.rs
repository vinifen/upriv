//! In-process vault sessions and surface unlock throttle (SECURITY-CRYPTO).
//!
//! One map per process (desktop daemon / mobile FFI). Closing Upriv clears it.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex, MutexGuard, PoisonError, TryLockError};
use std::time::{Duration, Instant};

use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use crate::error::{Result, UprivError};
use crate::store::{OpenedStore, VaultHeader, VaultIndex};

mod jobs;

pub use jobs::{
    cancel_job, job_status, log_request_panic, note_panic, stop_all_jobs, JobStatus, JobStop,
};
pub(crate) use jobs::{Job, JobKind, ProgressReader};

const FAILURE_WINDOW: Duration = Duration::from_secs(60);
const BLOCK_DURATION: Duration = Duration::from_secs(60);
const FAILURES_BEFORE_BLOCK: usize = 5;

#[derive(Zeroize, ZeroizeOnDrop)]
pub struct OpenSession {
    pub vault_id: String,
    /// The vault's name as `config.toml` gave it at open. A rename needs the
    /// vault closed, so it holds for the session; the explorer's root shows it.
    pub display_name: String,
    #[zeroize(skip)]
    pub vault_dir: PathBuf,
    #[zeroize(skip)]
    pub header: VaultHeader,
    pub master_key: [u8; 32],
    pub content_key: [u8; 32],
    pub index_key: [u8; 64],
    /// The key of the recovery records the vault's blobs carry.
    pub record_key: [u8; 32],
    #[zeroize(skip)]
    pub index: VaultIndex,
    /// Writers must set this; `close_vault` reseals the index regardless until then.
    pub dirty: bool,
    /// Explorer cache invalidation — bumped on every committed mutation, when
    /// a file's problem mark changes, and when a held blob is deleted.
    #[zeroize(skip)]
    pub tree_revision: u64,
    /// OS mount (FUSE/WinFsp). Declared before `lock` so drop unmounts before
    /// the process lock file is released.
    #[zeroize(skip)]
    pub mount: Option<crate::mount::MountedVault>,
    /// Why `mount` is missing after an open that tried to attach one.
    #[zeroize(skip)]
    pub mount_failure: Option<String>,
    /// The plain-file folder of an open `upriv_plain` vault.
    #[zeroize(skip)]
    pub(crate) plain: Option<crate::vault::PlainSession>,
    /// Process lockfile; released when the session is dropped.
    #[zeroize(skip)]
    pub lock: Option<crate::lockfile::VaultLock>,
    /// Import and other ingest sessions must not snapshot a vault that was just created.
    #[zeroize(skip)]
    pub skip_close_backup: bool,
    /// Files appended by an import that are not in the sealed index yet.
    #[zeroize(skip)]
    pub unsealed_imports: u64,
    /// Blob files named in the session and not yet flushed with the index.
    #[zeroize(skip)]
    pub(crate) staged_blobs: crate::store::StagedBlobs,
    /// Range writes waiting for the next index seal. Every seal clears it.
    #[zeroize(skip)]
    pub deferred: Option<DeferredWrites>,
    /// The file-manager layout (root `.upriv-workspace.json`) written since
    /// the last seal. Layout is not vault data, so it waits in RAM for the
    /// next seal or close instead of sealing the index on its own.
    pub pending_layout: Option<Zeroizing<Vec<u8>>>,
}

/// Range writes whose chunks are already in their blobs while the sealed index
/// still names the bytes from before them.
#[derive(Debug, Clone)]
pub struct DeferredWrites {
    /// Names this batch, so a timer seals only the batch it was started for.
    pub batch: u64,
    /// Plaintext bytes written in the batch.
    pub bytes: u64,
    /// Blobs the batch wrote to, checked for dead ciphertext after the seal.
    pub blob_ids: Vec<String>,
}

impl OpenSession {
    pub fn from_opened(
        vault_id: String,
        display_name: String,
        vault_dir: PathBuf,
        opened: OpenedStore,
    ) -> Self {
        let mut master_key = [0u8; 32];
        master_key.copy_from_slice(opened.master_key.as_ref());
        let mut content_key = [0u8; 32];
        content_key.copy_from_slice(opened.content_key.as_ref());
        let mut index_key = [0u8; 64];
        index_key.copy_from_slice(opened.index_key.as_ref());
        let mut record_key = [0u8; 32];
        record_key.copy_from_slice(opened.record_key.as_ref());
        Self {
            vault_id,
            display_name,
            vault_dir,
            header: opened.header,
            master_key,
            content_key,
            index_key,
            record_key,
            index: opened.index,
            dirty: false,
            tree_revision: 0,
            mount: None,
            mount_failure: None,
            plain: None,
            lock: None,
            skip_close_backup: false,
            unsealed_imports: 0,
            staged_blobs: crate::store::StagedBlobs::default(),
            deferred: None,
            pending_layout: None,
        }
    }

    /// What the next seal of this session's tree writes its records with.
    pub(crate) fn records(&self) -> crate::store::Records<'_> {
        crate::store::Records {
            header: &self.header,
            key: &self.record_key,
            index: &self.index,
        }
    }

    /// Record and flush the staged blobs ([`crate::store::StagedBlobs::sync`])
    /// for the seal of the tree as it is now.
    pub(crate) fn sync_staged_blobs(&mut self, due: crate::store::RecordsDue) -> Result<()> {
        let records = crate::store::Records {
            header: &self.header,
            key: &self.record_key,
            index: &self.index,
        };
        self.staged_blobs.sync(&records, due)
    }
}

#[derive(Default)]
struct UnlockThrottle {
    failures: Vec<Instant>,
    blocked_until: Option<Instant>,
}

static SESSIONS: LazyLock<Mutex<HashMap<PathBuf, Arc<Mutex<OpenSession>>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static THROTTLE: LazyLock<Mutex<HashMap<PathBuf, UnlockThrottle>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
/// One Argon2 unlock/create at a time in this process (RAM + insert_session race).
static UNLOCK_GATE: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));
/// Vault dirs mid-close (`take_session` … flush done). Covers the gap where
/// the session map is empty but flush still runs against the current root.
static CLOSING: LazyLock<Mutex<HashMap<PathBuf, Closing>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
/// Vault dirs mid-open / mid-create-seed (before `insert_session`). Refcounted so
/// overlapping `open_vault` calls keep the mark until the last guard drops.
/// `rename_vault` honors this without waiting on Argon2 or using `UNLOCK_GATE`.
static PREPARING: LazyLock<Mutex<HashMap<PathBuf, usize>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
/// Backup zips an export is reading, by vault dir. Each export adds its own
/// entries, so two exports of one zip each hold it.
static BACKUP_EXPORTS: LazyLock<Mutex<HashMap<PathBuf, Vec<PathBuf>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
/// Serializes create (and other dir-scoped writes) per `vaults/<id>/`.
static VAULT_DIR_GATES: LazyLock<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
/// Serializes vault folder create + deep rename (slug alloc / `fs::rename`).
static VAULT_REGISTRY_GATE: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));
/// Data folders being copied into a zip, keyed by vault-root. One export per
/// folder at a time.
static DATA_FOLDER_EXPORTS: LazyLock<Mutex<HashSet<PathBuf>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

/// Lock one of the process-wide tables or gates. Work that panicked while it
/// held one leaves the lock poisoned, and what it holds is still whole: each
/// change to a table is one insert, removal, or count, and a gate holds
/// nothing. So the lock is taken as it is: one failed job never leaves every
/// open and export of a vault refused until Upriv restarts.
pub(crate) fn lock_table<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// An open session whose own lock is poisoned: work on it panicked, and its
/// index may be half changed, so it is not used again.
fn open_session_poisoned() -> UprivError {
    UprivError::VaultStoreInvalid {
        path: PathBuf::from("session"),
        detail: "open session poisoned".into(),
    }
}

/// Serialize Argon2-bound work for the whole process (`open` + create seed).
pub fn with_unlock_lock<T>(f: impl FnOnce() -> Result<T>) -> Result<T> {
    let _held = lock_table(&UNLOCK_GATE);
    f()
}

fn vault_dir_gate(vault_dir: &Path) -> Arc<Mutex<()>> {
    lock_table(&VAULT_DIR_GATES)
        .entry(vault_dir.to_path_buf())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone()
}

/// Exclusive critical section for one vault directory (create TOCTOU).
pub fn with_vault_dir_lock<T>(vault_dir: &Path, f: impl FnOnce() -> Result<T>) -> Result<T> {
    let gate = vault_dir_gate(vault_dir);
    let _held = lock_table(&gate);
    f()
}

/// Same section as [`with_vault_dir_lock`], without waiting.
/// A holder (rewrap, open, rename) makes the caller return [`UprivError::VaultBusy`].
pub fn try_with_vault_dir_lock<T>(vault_dir: &Path, f: impl FnOnce() -> Result<T>) -> Result<T> {
    let gate = vault_dir_gate(vault_dir);
    let _held = match gate.try_lock() {
        Ok(guard) => guard,
        Err(TryLockError::WouldBlock) => return Err(UprivError::VaultBusy),
        Err(TryLockError::Poisoned(poisoned)) => poisoned.into_inner(),
    };
    f()
}

/// Process-wide identity lock: slug allocation + `vaults/<id>/` create/rename.
pub fn with_vault_registry_lock<T>(f: impl FnOnce() -> Result<T>) -> Result<T> {
    let _held = lock_table(&VAULT_REGISTRY_GATE);
    f()
}

/// Lock two vault directories in `Path` order (avoids A→B / B→A deadlock).
pub fn with_vault_dir_locks<T>(
    first: &Path,
    second: &Path,
    f: impl FnOnce() -> Result<T>,
) -> Result<T> {
    if first == second {
        return with_vault_dir_lock(first, f);
    }
    let (a, b) = if first.as_os_str() <= second.as_os_str() {
        (first, second)
    } else {
        (second, first)
    };
    with_vault_dir_lock(a, || with_vault_dir_lock(b, f))
}

fn lock_sessions() -> MutexGuard<'static, HashMap<PathBuf, Arc<Mutex<OpenSession>>>> {
    lock_table(&SESSIONS)
}

fn lock_throttle() -> MutexGuard<'static, HashMap<PathBuf, UnlockThrottle>> {
    lock_table(&THROTTLE)
}

pub fn is_vault_open_at(vault_dir: &Path) -> bool {
    lock_sessions().contains_key(vault_dir)
}

/// Ids of the sessions open under `vaults_dir`.
pub(crate) fn open_session_ids_under(vaults_dir: &Path) -> Vec<String> {
    lock_sessions()
        .iter()
        .filter(|(dir, _)| dir.starts_with(vaults_dir))
        .filter_map(|(_, session)| session.lock().ok().map(|inner| inner.vault_id.clone()))
        .collect()
}

pub fn open_session_ids() -> Vec<String> {
    let guard = lock_sessions();
    let mut ids = Vec::new();
    for session in guard.values() {
        if let Ok(inner) = session.lock() {
            ids.push(inner.vault_id.clone());
        }
    }
    ids
}

/// Refuse export and rewrap while this vault is open, closing, or already held.
pub fn ensure_vault_session_closed(vault_dir: &Path) -> Result<()> {
    if is_vault_open_at(vault_dir) || is_vault_closing_at(vault_dir) {
        return Err(UprivError::VaultMustBeClosed);
    }
    if is_vault_preparing_at(vault_dir) {
        return Err(UprivError::VaultBusy);
    }
    Ok(())
}

/// Refuse vault-root switch while any vault is open, mid-close, held for
/// export / rewrap / open / create, Argon2 is in flight, or the data folder
/// is being exported.
///
/// UI also blocks queued opening/creating rows before core work starts. This is
/// the process-side backstop so setup RPCs cannot race unlock, flush, export,
/// or a password / unlock-RAM rewrite.
pub fn vault_activity_blocks_root_switch() -> bool {
    if !open_session_ids().is_empty() {
        return true;
    }
    if is_data_folder_export_running() {
        return true;
    }
    if any_closing() {
        return true;
    }
    if any_preparing() {
        return true;
    }
    is_unlock_in_flight()
}

/// True while `with_unlock_lock` holds the process Argon2 gate (open/create seed).
pub fn is_unlock_in_flight() -> bool {
    matches!(UNLOCK_GATE.try_lock(), Err(TryLockError::WouldBlock))
}

fn any_closing() -> bool {
    !lock_table(&CLOSING).is_empty()
}

fn any_preparing() -> bool {
    lock_table(&PREPARING).values().any(|count| *count > 0)
}

pub fn is_vault_closing_at(vault_dir: &Path) -> bool {
    lock_table(&CLOSING).contains_key(vault_dir)
}

/// Where an in-flight close of this vault is. `None` when no close is running.
pub fn vault_close_phase_at(vault_dir: &Path) -> Option<ClosePhase> {
    lock_table(&CLOSING)
        .get(vault_dir)
        .map(|closing| closing.phase)
}

/// Make the close running for this vault finish the Close now way. False when
/// none is running.
pub(crate) fn hurry_close_at(vault_dir: &Path) -> bool {
    lock_table(&CLOSING)
        .get(vault_dir)
        .map(|closing| closing.hurry.store(true, Ordering::Relaxed))
        .is_some()
}

/// [`hurry_close_at`] for every close running under `vaults_dir`.
pub(crate) fn hurry_closes_under(vaults_dir: &Path) {
    lock_table(&CLOSING)
        .iter()
        .filter(|(dir, _)| dir.starts_with(vaults_dir))
        .for_each(|(_, closing)| closing.hurry.store(true, Ordering::Relaxed));
}

/// True while a close runs under `vaults_dir`.
pub(crate) fn any_close_under(vaults_dir: &Path) -> bool {
    lock_table(&CLOSING)
        .keys()
        .any(|dir| dir.starts_with(vaults_dir))
}

/// True while this vault is mid-open or mid-create-seed.
pub fn is_vault_preparing_at(vault_dir: &Path) -> bool {
    lock_table(&PREPARING)
        .get(vault_dir)
        .is_some_and(|count| *count > 0)
}

/// True while a vault folder under `vaults_dir` is open or mid-close.
pub(crate) fn any_session_under(vaults_dir: &Path) -> bool {
    lock_sessions()
        .keys()
        .any(|dir| dir.starts_with(vaults_dir))
        || any_close_under(vaults_dir)
}

/// True while a vault folder under `vaults_dir` is held for open, create,
/// import, export, backup, or rewrap.
pub(crate) fn any_preparing_under(vaults_dir: &Path) -> bool {
    lock_table(&PREPARING)
        .iter()
        .any(|(dir, count)| *count > 0 && dir.starts_with(vaults_dir))
}

/// True while any data folder is being copied into a zip.
pub fn is_data_folder_export_running() -> bool {
    !lock_table(&DATA_FOLDER_EXPORTS).is_empty()
}

/// Refuse work that would add, move, or remove files the running export of the
/// data folder at `root` may still copy: a new vault folder, or a backup delete or pin.
pub(crate) fn ensure_data_folder_export_idle(root: &Path) -> Result<()> {
    if lock_table(&DATA_FOLDER_EXPORTS).contains(root) {
        return Err(UprivError::DataFolderExportBusy);
    }
    Ok(())
}

/// Marks the data folder at `root` as being exported until dropped.
pub(crate) struct DataFolderExportGuard {
    root: PathBuf,
}

impl DataFolderExportGuard {
    pub(crate) fn enter(root: &Path) -> Result<Self> {
        if !lock_table(&DATA_FOLDER_EXPORTS).insert(root.to_path_buf()) {
            return Err(UprivError::DataFolderExportBusy);
        }
        Ok(Self {
            root: root.to_path_buf(),
        })
    }
}

impl Drop for DataFolderExportGuard {
    fn drop(&mut self) {
        lock_table(&DATA_FOLDER_EXPORTS).remove(&self.root);
    }
}

fn lock_backup_exports() -> MutexGuard<'static, HashMap<PathBuf, Vec<PathBuf>>> {
    lock_table(&BACKUP_EXPORTS)
}

/// True while a backup export reads this vault's backups.
pub(crate) fn is_vault_backup_export_at(vault_dir: &Path) -> bool {
    lock_backup_exports()
        .get(vault_dir)
        .is_some_and(|zips| !zips.is_empty())
}

/// Refuse with [`UprivError::BackupExporting`] while an export reads any of
/// `zips`, so a delete or a pin never pulls a backup from under it.
pub(crate) fn ensure_backups_not_exporting(vault_dir: &Path, zips: &[PathBuf]) -> Result<()> {
    let exports = lock_backup_exports();
    let reading = exports
        .get(vault_dir)
        .is_some_and(|held| zips.iter().any(|zip| held.contains(zip)));
    if reading {
        return Err(UprivError::BackupExporting);
    }
    Ok(())
}

/// Remove `zip` unless an export reads it; true when it was removed. The
/// registry stays locked across the removal, so an export never starts on a
/// zip that is halfway gone. Retention uses this: it runs without the vault's
/// lock, and a zip it skips goes on a later close.
pub(crate) fn remove_backup_unless_exporting(vault_dir: &Path, zip: &Path) -> Result<bool> {
    let exports = lock_backup_exports();
    if exports
        .get(vault_dir)
        .is_some_and(|held| held.iter().any(|read| read == zip))
    {
        return Ok(false);
    }
    crate::host_fs::remove_file(zip)?;
    Ok(true)
}

/// Holds the backup zips an export reads. Until it is dropped, delete and
/// rename of the vault refuse, delete and pin of those zips refuse, and
/// retention leaves them. A backup is a frozen file, so open, close, and every
/// other export stay free.
pub(crate) struct BackupExportGuard {
    vault_dir: PathBuf,
    zips: Vec<PathBuf>,
}

impl BackupExportGuard {
    /// Each zip must still be a file: retention may have removed one since
    /// the export found it.
    pub(crate) fn enter(vault_dir: &Path, zips: Vec<PathBuf>) -> Result<Self> {
        use crate::host_fs::HostFsQuery;

        let mut exports = lock_backup_exports();
        if let Some(gone) = zips.iter().find(|zip| !zip.host_is_file()) {
            return Err(UprivError::VaultPathNotFound(gone.display().to_string()));
        }
        exports
            .entry(vault_dir.to_path_buf())
            .or_default()
            .extend(zips.iter().cloned());
        Ok(Self {
            vault_dir: vault_dir.to_path_buf(),
            zips,
        })
    }
}

impl Drop for BackupExportGuard {
    fn drop(&mut self) {
        let mut exports = lock_backup_exports();
        let Some(held) = exports.get_mut(&self.vault_dir) else {
            return;
        };
        // One entry per zip of this export; another export of the same zip keeps its own.
        for zip in &self.zips {
            if let Some(at) = held.iter().position(|read| read == zip) {
                held.swap_remove(at);
            }
        }
        if held.is_empty() {
            exports.remove(&self.vault_dir);
        }
    }
}

/// Step of an in-flight close, read by the UI while `vault_close` runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClosePhase {
    /// Packing, index flush, and state write.
    Flush,
    /// Writing the close backup zip.
    Backup,
}

impl ClosePhase {
    pub fn as_str(self) -> &'static str {
        match self {
            ClosePhase::Flush => "flush",
            ClosePhase::Backup => "backup",
        }
    }
}

/// One close in flight.
struct Closing {
    phase: ClosePhase,
    /// Set once this close should finish the Close now way.
    hurry: Arc<AtomicBool>,
}

/// Mark `vault_dir` as closing until dropped (covers flush after `take_session`).
pub(crate) struct ClosingGuard {
    vault_dir: PathBuf,
    hurry: Arc<AtomicBool>,
    backup: Job,
}

impl ClosingGuard {
    pub(crate) fn enter(vault_dir: &Path) -> Self {
        let hurry = Arc::new(AtomicBool::new(false));
        // Close now ends the backup.
        let backup = Job::stopped_by(Arc::clone(&hurry));
        lock_table(&CLOSING).insert(
            vault_dir.to_path_buf(),
            Closing {
                phase: ClosePhase::Flush,
                hurry: Arc::clone(&hurry),
            },
        );
        Self {
            vault_dir: vault_dir.to_path_buf(),
            hurry,
            backup,
        }
    }

    pub(crate) fn hurry(&self) -> &Arc<AtomicBool> {
        &self.hurry
    }

    /// The job the close backup zip runs as.
    pub(crate) fn backup_job(&self) -> &Job {
        &self.backup
    }

    pub(crate) fn set_phase(&self, phase: ClosePhase) {
        if let Some(current) = lock_table(&CLOSING).get_mut(&self.vault_dir) {
            current.phase = phase;
        }
    }
}

impl Drop for ClosingGuard {
    fn drop(&mut self) {
        lock_table(&CLOSING).remove(&self.vault_dir);
    }
}

/// Mark `vault_dir` as preparing until dropped (open, create, export, or rewrap).
pub(crate) struct PreparingGuard {
    vault_dir: PathBuf,
}

impl PreparingGuard {
    pub(crate) fn enter(vault_dir: &Path) -> Self {
        *lock_table(&PREPARING)
            .entry(vault_dir.to_path_buf())
            .or_insert(0) += 1;
        Self {
            vault_dir: vault_dir.to_path_buf(),
        }
    }

    /// One holder. Open, export, and rewrap use this so they cannot overlap.
    pub(crate) fn enter_exclusive(vault_dir: &Path) -> Result<Self> {
        let mut guard = lock_table(&PREPARING);
        if guard.get(vault_dir).is_some_and(|count| *count > 0) {
            return Err(UprivError::VaultBusy);
        }
        *guard.entry(vault_dir.to_path_buf()).or_insert(0) += 1;
        Ok(Self {
            vault_dir: vault_dir.to_path_buf(),
        })
    }
}

impl Drop for PreparingGuard {
    fn drop(&mut self) {
        let mut guard = lock_table(&PREPARING);
        match guard.get_mut(&self.vault_dir) {
            Some(count) if *count > 1 => *count -= 1,
            Some(_) => {
                guard.remove(&self.vault_dir);
            }
            None => {}
        }
    }
}

pub fn insert_session(session: OpenSession) -> Result<()> {
    let mut guard = lock_sessions();
    if guard.contains_key(&session.vault_dir) {
        return Err(UprivError::VaultAlreadyOpen(session.vault_id.clone()));
    }
    guard.insert(session.vault_dir.clone(), Arc::new(Mutex::new(session)));
    Ok(())
}

pub fn take_session(vault_dir: &Path) -> Result<OpenSession> {
    let arc = lock_sessions()
        .remove(vault_dir)
        .ok_or_else(|| UprivError::VaultNotOpen(vault_dir.display().to_string()))?;
    let mutex = wait_unique_session(arc)?;
    mutex.into_inner().map_err(|_| open_session_poisoned())
}

fn wait_unique_session(mut arc: Arc<Mutex<OpenSession>>) -> Result<Mutex<OpenSession>> {
    loop {
        match Arc::try_unwrap(arc) {
            Ok(mutex) => return Ok(mutex),
            Err(remaining) => {
                drop(remaining.lock().map_err(|_| open_session_poisoned())?);
                arc = remaining;
                std::thread::yield_now();
            }
        }
    }
}

/// Run `f` against the open session without removing it from the map.
pub fn with_open_session<T>(
    vault_dir: &Path,
    f: impl FnOnce(&mut OpenSession) -> Result<T>,
) -> Result<T> {
    let arc = lock_sessions()
        .get(vault_dir)
        .cloned()
        .ok_or_else(|| UprivError::VaultNotOpen(vault_dir.display().to_string()))?;
    let mut session = arc.lock().map_err(|_| open_session_poisoned())?;
    f(&mut session)
}

/// Fail closed if this vault is in the 60 s block window.
pub fn check_unlock_allowed(vault_dir: &Path) -> Result<()> {
    let mut guard = lock_throttle();
    let state = guard.entry(vault_dir.to_path_buf()).or_default();
    let now = Instant::now();
    if let Some(until) = state.blocked_until {
        if now < until {
            let retry = until.saturating_duration_since(now).as_secs().max(1);
            return Err(UprivError::VaultUnlockBlocked {
                retry_after_secs: retry,
            });
        }
        state.blocked_until = None;
        state.failures.clear();
    }
    Ok(())
}

pub fn record_unlock_success(vault_dir: &Path) {
    lock_throttle().remove(vault_dir);
}

pub fn record_unlock_failure(vault_dir: &Path) -> Result<()> {
    let mut guard = lock_throttle();
    let state = guard.entry(vault_dir.to_path_buf()).or_default();
    let now = Instant::now();
    state
        .failures
        .retain(|at| now.duration_since(*at) < FAILURE_WINDOW);
    state.failures.push(now);
    if state.failures.len() >= FAILURES_BEFORE_BLOCK {
        state.blocked_until = Some(now + BLOCK_DURATION);
        state.failures.clear();
        return Err(UprivError::VaultUnlockBlocked {
            retry_after_secs: BLOCK_DURATION.as_secs(),
        });
    }
    Ok(())
}

#[cfg(test)]
pub(crate) fn clear_throttle_key_for_tests(vault_dir: &Path) {
    lock_throttle().remove(vault_dir);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preparing_mark_is_refcounted() {
        let dir = PathBuf::from(format!(
            "/upriv-test-preparing-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        assert!(!is_vault_preparing_at(&dir));
        let first = PreparingGuard::enter(&dir);
        let second = PreparingGuard::enter(&dir);
        assert!(is_vault_preparing_at(&dir));
        drop(first);
        assert!(is_vault_preparing_at(&dir));
        drop(second);
        assert!(!is_vault_preparing_at(&dir));
    }

    #[test]
    fn throttle_blocks_after_five_failures() {
        let dir = PathBuf::from(format!(
            "/upriv-test-throttle-blocks-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        clear_throttle_key_for_tests(&dir);
        for _ in 0..4 {
            record_unlock_failure(&dir).expect("not blocked yet");
        }
        let err = record_unlock_failure(&dir).unwrap_err();
        assert!(matches!(err, UprivError::VaultUnlockBlocked { .. }));
        let blocked = check_unlock_allowed(&dir).unwrap_err();
        assert!(matches!(blocked, UprivError::VaultUnlockBlocked { .. }));
        clear_throttle_key_for_tests(&dir);
    }

    #[test]
    fn success_clears_failures() {
        let dir = PathBuf::from(format!(
            "/upriv-test-throttle-ok-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        clear_throttle_key_for_tests(&dir);
        for _ in 1..FAILURES_BEFORE_BLOCK {
            record_unlock_failure(&dir).expect("not blocked yet");
        }
        record_unlock_success(&dir);
        // The count starts over: the same number of failures still does not block.
        for _ in 1..FAILURES_BEFORE_BLOCK {
            record_unlock_failure(&dir).expect("count was cleared");
        }
        check_unlock_allowed(&dir).unwrap();
        clear_throttle_key_for_tests(&dir);
    }

    #[test]
    fn closing_mark_blocks_root_switch() {
        let dir = PathBuf::from(format!(
            "/upriv-test-closing-mark-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        // Only assert the positive path: ClosingGuard alone is enough to block.
        // Do not assert process-wide idle — parallel Argon2 holds UNLOCK_GATE.
        let _guard = ClosingGuard::enter(&dir);
        assert!(vault_activity_blocks_root_switch());
    }

    #[test]
    fn preparing_mark_blocks_root_switch() {
        let dir = PathBuf::from(format!(
            "/upriv-test-preparing-mark-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        assert!(!is_vault_preparing_at(&dir));
        let held = PreparingGuard::enter_exclusive(&dir).expect("enter preparing");
        assert!(is_vault_preparing_at(&dir));
        assert!(matches!(
            PreparingGuard::enter_exclusive(&dir),
            Err(UprivError::VaultBusy)
        ));
        // Positive only: another test may also hold the unlock gate.
        assert!(vault_activity_blocks_root_switch());
        drop(held);
        assert!(!is_vault_preparing_at(&dir));
    }

    #[test]
    fn close_phase_follows_guard() {
        let dir = PathBuf::from(format!(
            "/upriv-test-close-phase-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        assert_eq!(vault_close_phase_at(&dir), None);
        {
            let guard = ClosingGuard::enter(&dir);
            assert_eq!(vault_close_phase_at(&dir), Some(ClosePhase::Flush));
            guard.set_phase(ClosePhase::Backup);
            assert_eq!(vault_close_phase_at(&dir), Some(ClosePhase::Backup));
            assert!(is_vault_closing_at(&dir));
        }
        assert_eq!(vault_close_phase_at(&dir), None);
        assert!(!is_vault_closing_at(&dir));
    }

    #[test]
    fn close_now_stops_the_close_backup() {
        let dir = PathBuf::from(format!(
            "/upriv-test-close-backup-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let guard = ClosingGuard::enter(&dir);
        assert!(!guard.backup_job().is_stopped());
        guard.hurry().store(true, Ordering::Relaxed);
        assert!(guard.backup_job().is_stopped());
    }

    #[test]
    fn throttle_is_keyed_by_path_string_not_inode() {
        let a = PathBuf::from(format!(
            "/upriv-test-throttle-path-a-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let b = PathBuf::from(format!(
            "/upriv-test-throttle-path-b-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        clear_throttle_key_for_tests(&a);
        clear_throttle_key_for_tests(&b);
        for _ in 0..5 {
            let _ = record_unlock_failure(&a);
        }
        check_unlock_allowed(&a).unwrap_err();
        check_unlock_allowed(&b).expect("distinct path = distinct throttle bucket");
        clear_throttle_key_for_tests(&a);
        clear_throttle_key_for_tests(&b);
    }

    #[test]
    fn work_that_panicked_holding_a_vault_leaves_it_usable() {
        let dir = PathBuf::from(format!(
            "/upriv-test-panic-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let panicked = std::panic::catch_unwind(|| {
            let _held = PreparingGuard::enter_exclusive(&dir).unwrap();
            let _ = with_vault_dir_lock(&dir, || -> Result<()> {
                with_unlock_lock(|| -> Result<()> { panic!("export went wrong") })
            });
        });
        assert!(panicked.is_err());
        // The gates it held, and the mark its guard dropped while unwinding.
        assert!(!is_vault_preparing_at(&dir));
        with_vault_dir_lock(&dir, || with_unlock_lock(|| Ok(()))).unwrap();
        try_with_vault_dir_lock(&dir, || Ok(())).unwrap();
        drop(PreparingGuard::enter_exclusive(&dir).unwrap());
    }
}
