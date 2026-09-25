//! In-process vault sessions and surface unlock throttle (SECURITY-CRYPTO).
//!
//! One map per process (desktop daemon / mobile FFI). Closing Upriv clears it.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::config::VaultSecurityMode;
use crate::error::{Result, UprivError};
use crate::store::{OpenedStore, VaultHeader, VaultIndex};

const FAILURE_WINDOW: Duration = Duration::from_secs(60);
const BLOCK_DURATION: Duration = Duration::from_secs(60);
const FAILURES_BEFORE_BLOCK: usize = 5;

#[derive(Zeroize, ZeroizeOnDrop)]
pub struct OpenSession {
    pub vault_id: String,
    #[zeroize(skip)]
    pub vault_dir: PathBuf,
    #[zeroize(skip)]
    pub header: VaultHeader,
    pub master_key: [u8; 32],
    pub content_key: [u8; 32],
    pub index_key: [u8; 64],
    #[zeroize(skip)]
    pub index: VaultIndex,
    #[zeroize(skip)]
    pub security_mode: VaultSecurityMode,
    /// Writers must set this; `close_vault` reseals the index regardless until then.
    pub dirty: bool,
    /// OS imports applied to the in-memory index since the last seal.
    /// Close, and the next tree list or revision read, seal the remainder.
    pub imports_since_index_seal: u32,
    /// When the sealed index last matched this session. Skip on zeroize — `Instant` is not a secret.
    #[zeroize(skip)]
    pub index_sealed_at: Option<Instant>,
    /// Explorer cache invalidation — bumped on every committed mutation.
    #[zeroize(skip)]
    pub tree_revision: u64,
    /// OS mount (FUSE/WinFsp). Declared before `lock` so drop unmounts before
    /// the process lock file is released.
    #[zeroize(skip)]
    pub mount: Option<crate::mount::MountedVault>,
    /// Process lockfile; released when the session is dropped.
    #[zeroize(skip)]
    pub lock: Option<crate::lockfile::VaultLock>,
}

impl OpenSession {
    pub fn from_opened(
        vault_id: String,
        vault_dir: PathBuf,
        security_mode: VaultSecurityMode,
        opened: OpenedStore,
    ) -> Self {
        let mut master_key = [0u8; 32];
        master_key.copy_from_slice(opened.master_key.as_ref());
        let mut content_key = [0u8; 32];
        content_key.copy_from_slice(opened.content_key.as_ref());
        let mut index_key = [0u8; 64];
        index_key.copy_from_slice(opened.index_key.as_ref());
        Self {
            vault_id,
            vault_dir,
            header: opened.header,
            master_key,
            content_key,
            index_key,
            index: opened.index,
            security_mode,
            dirty: false,
            imports_since_index_seal: 0,
            index_sealed_at: Some(Instant::now()),
            tree_revision: 0,
            mount: None,
            lock: None,
        }
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
static CLOSING: LazyLock<Mutex<HashSet<PathBuf>>> = LazyLock::new(|| Mutex::new(HashSet::new()));
/// Vault dirs mid-open / mid-create-seed (before `insert_session`). Refcounted so
/// overlapping `open_vault` calls keep the mark until the last guard drops.
/// `rename_vault` honors this without waiting on Argon2 or using `UNLOCK_GATE`.
static PREPARING: LazyLock<Mutex<HashMap<PathBuf, usize>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
/// Serializes create (and other dir-scoped writes) per `vaults/<id>/`.
static VAULT_DIR_GATES: LazyLock<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
/// Serializes vault folder create + deep rename (slug alloc / `fs::rename`).
static VAULT_REGISTRY_GATE: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

fn session_lock_poisoned(detail: &str) -> UprivError {
    UprivError::VaultStoreInvalid {
        path: PathBuf::from("session"),
        detail: detail.into(),
    }
}

/// Serialize Argon2-bound work for the whole process (`open` + create seed).
pub fn with_unlock_lock<T>(f: impl FnOnce() -> Result<T>) -> Result<T> {
    let _held = UNLOCK_GATE
        .lock()
        .map_err(|_| session_lock_poisoned("unlock lock poisoned"))?;
    f()
}

/// Exclusive critical section for one vault directory (create TOCTOU).
pub fn with_vault_dir_lock<T>(vault_dir: &Path, f: impl FnOnce() -> Result<T>) -> Result<T> {
    let gate = {
        let mut map = VAULT_DIR_GATES
            .lock()
            .map_err(|_| session_lock_poisoned("vault-dir gate lock poisoned"))?;
        map.entry(vault_dir.to_path_buf())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    };
    let _held = gate
        .lock()
        .map_err(|_| session_lock_poisoned("vault-dir lock poisoned"))?;
    f()
}

/// Process-wide identity lock: slug allocation + `vaults/<id>/` create/rename.
pub fn with_vault_registry_lock<T>(f: impl FnOnce() -> Result<T>) -> Result<T> {
    let _held = VAULT_REGISTRY_GATE
        .lock()
        .map_err(|_| session_lock_poisoned("vault-registry lock poisoned"))?;
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

fn lock_sessions(
) -> Result<std::sync::MutexGuard<'static, HashMap<PathBuf, Arc<Mutex<OpenSession>>>>> {
    SESSIONS.lock().map_err(|_| UprivError::VaultStoreInvalid {
        path: PathBuf::from("session"),
        detail: "session lock poisoned".into(),
    })
}

fn lock_throttle() -> Result<std::sync::MutexGuard<'static, HashMap<PathBuf, UnlockThrottle>>> {
    THROTTLE.lock().map_err(|_| UprivError::VaultStoreInvalid {
        path: PathBuf::from("session"),
        detail: "throttle lock poisoned".into(),
    })
}

pub fn session_key(vault_dir: impl Into<PathBuf>) -> PathBuf {
    vault_dir.into()
}

pub fn is_vault_open_at(vault_dir: &Path) -> bool {
    lock_sessions()
        .map(|g| g.contains_key(vault_dir))
        .unwrap_or(false)
}

pub fn is_vault_open(vault_dir: impl AsRef<Path>) -> bool {
    is_vault_open_at(vault_dir.as_ref())
}

pub fn open_session_ids() -> Vec<String> {
    let Ok(guard) = lock_sessions() else {
        return Vec::new();
    };
    let mut ids = Vec::new();
    for session in guard.values() {
        if let Ok(inner) = session.lock() {
            ids.push(inner.vault_id.clone());
        }
    }
    ids
}

/// Refuse export of this vault while it is open, closing, or seeding.
pub fn ensure_vault_session_closed(vault_dir: &Path) -> Result<()> {
    if is_vault_open_at(vault_dir)
        || is_vault_closing_at(vault_dir)
        || is_vault_preparing_at(vault_dir)
    {
        Err(UprivError::VaultMustBeClosed)
    } else {
        Ok(())
    }
}

/// Refuse vault-root switch while any vault is open, mid-close, or Argon2 is in flight.
///
/// UI also blocks queued opening/creating rows before core work starts. This is
/// the process-side backstop so setup RPCs cannot race unlock / flush.
pub fn vault_activity_blocks_root_switch() -> bool {
    if !open_session_ids().is_empty() {
        return true;
    }
    if any_closing() {
        return true;
    }
    is_unlock_in_flight()
}

/// True while `with_unlock_lock` holds the process Argon2 gate (open/create seed).
pub fn is_unlock_in_flight() -> bool {
    match UNLOCK_GATE.try_lock() {
        Ok(_guard) => false,
        Err(std::sync::TryLockError::WouldBlock) => true,
        Err(std::sync::TryLockError::Poisoned(_)) => true,
    }
}

fn any_closing() -> bool {
    CLOSING.lock().map(|g| !g.is_empty()).unwrap_or(true)
}

pub fn is_vault_closing_at(vault_dir: &Path) -> bool {
    CLOSING
        .lock()
        .map(|g| g.contains(vault_dir))
        .unwrap_or(true)
}

/// True while this vault is mid-open or mid-create-seed. Fail closed on poison.
pub fn is_vault_preparing_at(vault_dir: &Path) -> bool {
    PREPARING
        .lock()
        .map(|g| g.get(vault_dir).is_some_and(|count| *count > 0))
        .unwrap_or(true)
}

/// Mark `vault_dir` as closing until dropped (covers flush after `take_session`).
pub(crate) struct ClosingGuard {
    vault_dir: PathBuf,
}

impl ClosingGuard {
    pub(crate) fn enter(vault_dir: &Path) -> Result<Self> {
        let mut guard = CLOSING
            .lock()
            .map_err(|_| session_lock_poisoned("closing lock poisoned"))?;
        guard.insert(vault_dir.to_path_buf());
        Ok(Self {
            vault_dir: vault_dir.to_path_buf(),
        })
    }
}

impl Drop for ClosingGuard {
    fn drop(&mut self) {
        if let Ok(mut guard) = CLOSING.lock() {
            guard.remove(&self.vault_dir);
        }
    }
}

/// Mark `vault_dir` as preparing until dropped (open Argon2 / create seed).
pub(crate) struct PreparingGuard {
    vault_dir: PathBuf,
}

impl PreparingGuard {
    pub(crate) fn enter(vault_dir: &Path) -> Result<Self> {
        let mut guard = PREPARING
            .lock()
            .map_err(|_| session_lock_poisoned("preparing lock poisoned"))?;
        *guard.entry(vault_dir.to_path_buf()).or_insert(0) += 1;
        Ok(Self {
            vault_dir: vault_dir.to_path_buf(),
        })
    }
}

impl Drop for PreparingGuard {
    fn drop(&mut self) {
        if let Ok(mut guard) = PREPARING.lock() {
            match guard.get_mut(&self.vault_dir) {
                Some(count) if *count > 1 => *count -= 1,
                Some(_) => {
                    guard.remove(&self.vault_dir);
                }
                None => {}
            }
        }
    }
}

pub fn insert_session(session: OpenSession) -> Result<()> {
    let mut guard = lock_sessions()?;
    if guard.contains_key(&session.vault_dir) {
        return Err(UprivError::VaultAlreadyOpen(session.vault_id.clone()));
    }
    guard.insert(session.vault_dir.clone(), Arc::new(Mutex::new(session)));
    Ok(())
}

pub fn take_session(vault_dir: &Path) -> Result<OpenSession> {
    let arc = lock_sessions()?
        .remove(vault_dir)
        .ok_or_else(|| UprivError::VaultNotOpen(vault_dir.display().to_string()))?;
    let mutex = wait_unique_session(arc)?;
    mutex
        .into_inner()
        .map_err(|_| session_lock_poisoned("open session poisoned"))
}

fn wait_unique_session(mut arc: Arc<Mutex<OpenSession>>) -> Result<Mutex<OpenSession>> {
    loop {
        match Arc::try_unwrap(arc) {
            Ok(mutex) => return Ok(mutex),
            Err(remaining) => {
                drop(
                    remaining
                        .lock()
                        .map_err(|_| session_lock_poisoned("open session poisoned"))?,
                );
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
    let arc = lock_sessions()?
        .get(vault_dir)
        .cloned()
        .ok_or_else(|| UprivError::VaultNotOpen(vault_dir.display().to_string()))?;
    let mut session = arc
        .lock()
        .map_err(|_| session_lock_poisoned("open session poisoned"))?;
    f(&mut session)
}

pub fn get_session_vault_id(vault_dir: &Path) -> Option<String> {
    let guard = lock_sessions().ok()?;
    let arc = guard.get(vault_dir)?;
    arc.lock().ok().map(|s| s.vault_id.clone())
}

/// Fail closed if this vault is in the 60 s block window.
pub fn check_unlock_allowed(vault_dir: &Path) -> Result<()> {
    let mut guard = lock_throttle()?;
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
    if let Ok(mut guard) = lock_throttle() {
        guard.remove(vault_dir);
    }
}

pub fn record_unlock_failure(vault_dir: &Path) -> Result<()> {
    let mut guard = lock_throttle()?;
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
    if let Ok(mut g) = THROTTLE.lock() {
        g.remove(vault_dir);
    }
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
        let first = PreparingGuard::enter(&dir).expect("first preparing");
        let second = PreparingGuard::enter(&dir).expect("second preparing");
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
        record_unlock_failure(&dir).unwrap();
        record_unlock_success(&dir);
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
        let _guard = ClosingGuard::enter(&dir).expect("enter closing");
        assert!(vault_activity_blocks_root_switch());
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
}
