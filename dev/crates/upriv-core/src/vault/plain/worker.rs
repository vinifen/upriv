//! The thread that keeps an open plaintext vault in sync: a pass shortly
//! after the app changes the store, a few seconds after other apps change the
//! folder, and every two minutes in any case.
//!
//! Lock order: the session lock may be held while the store pokes this
//! module (`store_changed`). Nothing here takes a session lock while holding
//! the worker map or a schedule.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, OnceLock, Weak};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use super::{sync, PlainSyncReport};
use crate::error::{Result, UprivError};
use crate::logging::{log_event, LogLevel};
use crate::vault::wipe::WipeOptions;

/// After the app writes, wait this long for the next write before a pass.
const STORE_QUIET: Duration = Duration::from_millis(300);
/// A steady stream of app writes still reaches the folder this often.
const STORE_MAX_WAIT: Duration = Duration::from_secs(2);
/// Other apps save in bursts (temp file, rename, metadata). Wait for quiet.
const FOLDER_QUIET: Duration = Duration::from_secs(3);
const FOLDER_MAX_WAIT: Duration = Duration::from_secs(30);
/// A pass runs at least this often, with or without notifications.
const PERIODIC: Duration = Duration::from_secs(2 * 60);

/// Tells the vault when something under a plaintext folder changed. The
/// desktop daemon backs it with the system's file watcher. Without one, the
/// periodic pass still runs. The app reads how passes went from
/// `vault_plain_status`.
pub trait PlainObserver: Send + Sync {
    /// Call `changed` whenever something under `folder` changes, until
    /// [`Self::unwatch`] for the same vault.
    fn watch(&self, vault_id: &str, folder: &Path, changed: Arc<dyn Fn() + Send + Sync>);
    fn unwatch(&self, vault_id: &str);
}

/// Install the observer for this process. Later folders use it.
pub fn set_plain_observer(observer: Arc<dyn PlainObserver>) {
    if let Ok(mut slot) = observer_slot().lock() {
        *slot = Some(observer);
    }
}

fn observer_slot() -> &'static Mutex<Option<Arc<dyn PlainObserver>>> {
    static OBSERVER: OnceLock<Mutex<Option<Arc<dyn PlainObserver>>>> = OnceLock::new();
    OBSERVER.get_or_init(|| Mutex::new(None))
}

fn observer() -> Option<Arc<dyn PlainObserver>> {
    observer_slot().lock().ok().and_then(|slot| slot.clone())
}

#[derive(Clone, Copy)]
struct Due {
    first: Instant,
    at: Instant,
}

impl Due {
    fn poke(slot: &mut Option<Due>, quiet: Duration, max_wait: Duration) {
        let now = Instant::now();
        let first = slot.map_or(now, |due| due.first);
        *slot = Some(Due {
            first,
            at: (now + quiet).min(first + max_wait),
        });
    }
}

struct Schedule {
    store: Option<Due>,
    folder: Option<Due>,
    periodic: Instant,
    stop: bool,
}

impl Schedule {
    fn next(&self) -> Instant {
        [self.store, self.folder]
            .into_iter()
            .flatten()
            .map(|due| due.at)
            .fold(self.periodic, Instant::min)
    }
}

/// One open plaintext vault's sync.
pub(super) struct Worker {
    vault_id: String,
    dir: PathBuf,
    wipe: WipeOptions,
    schedule: Mutex<Schedule>,
    wake: Condvar,
    /// Stops the pass that is running. Only close sets it.
    cancel: AtomicBool,
    /// One pass at a time, from the thread or from [`run_now`].
    gate: Mutex<()>,
    thread: Mutex<Option<JoinHandle<()>>>,
}

fn workers() -> MutexGuard<'static, HashMap<PathBuf, Arc<Worker>>> {
    static WORKERS: OnceLock<Mutex<HashMap<PathBuf, Arc<Worker>>>> = OnceLock::new();
    WORKERS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn find(dir: &Path) -> Option<Arc<Worker>> {
    workers().get(dir).cloned()
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl Worker {
    fn poke_store(&self) {
        Due::poke(&mut lock(&self.schedule).store, STORE_QUIET, STORE_MAX_WAIT);
        self.wake.notify_one();
    }

    fn poke_folder(&self) {
        Due::poke(
            &mut lock(&self.schedule).folder,
            FOLDER_QUIET,
            FOLDER_MAX_WAIT,
        );
        self.wake.notify_one();
    }

    pub(super) fn cancel_flag(&self) -> &AtomicBool {
        &self.cancel
    }

    /// Run one pass now, between the thread's passes.
    pub(super) fn pass(&self) -> Result<PlainSyncReport> {
        let _gate = lock(&self.gate);
        if self.cancel.load(Ordering::Relaxed) {
            return Err(UprivError::VaultNotOpen(self.vault_id.clone()));
        }
        let report = sync::run(&self.dir, false, &self.cancel, &self.wipe);
        lock(&self.schedule).periodic = Instant::now() + PERIODIC;
        report
    }
}

/// Make the worker for a vault whose folder is being filled. It can be
/// cancelled from here on; [`start`] gives it its thread.
pub(super) fn register(vault_id: &str, dir: &Path, wipe: WipeOptions) -> Arc<Worker> {
    let worker = Arc::new(Worker {
        vault_id: vault_id.to_string(),
        dir: dir.to_path_buf(),
        wipe,
        schedule: Mutex::new(Schedule {
            store: None,
            folder: None,
            periodic: Instant::now() + PERIODIC,
            stop: false,
        }),
        wake: Condvar::new(),
        cancel: AtomicBool::new(false),
        gate: Mutex::new(()),
        thread: Mutex::new(None),
    });
    workers().insert(dir.to_path_buf(), worker.clone());
    worker
}

/// Start the periodic thread and folder notifications.
pub(super) fn start(worker: &Arc<Worker>, folder: &Path) -> Result<()> {
    let weak = Arc::downgrade(worker);
    let thread = std::thread::Builder::new()
        .name("upriv-plain-sync".into())
        .spawn(move || run_loop(weak))?;
    *lock(&worker.thread) = Some(thread);
    if let Some(observer) = observer() {
        let weak = Arc::downgrade(worker);
        observer.watch(
            &worker.vault_id,
            folder,
            Arc::new(move || {
                if let Some(worker) = weak.upgrade() {
                    worker.poke_folder();
                }
            }),
        );
    }
    Ok(())
}

fn run_loop(weak: Weak<Worker>) {
    loop {
        let Some(worker) = weak.upgrade() else {
            return;
        };
        {
            let mut schedule = lock(&worker.schedule);
            loop {
                if schedule.stop {
                    return;
                }
                let now = Instant::now();
                let next = schedule.next();
                if next <= now {
                    break;
                }
                schedule = worker
                    .wake
                    .wait_timeout(schedule, next - now)
                    .map(|(guard, _)| guard)
                    .unwrap_or_else(|poisoned| poisoned.into_inner().0);
            }
            schedule.store = None;
            schedule.folder = None;
        }
        match worker.pass() {
            Ok(_) => {}
            Err(UprivError::VaultNotOpen(_)) => return,
            Err(_) => log_event(
                LogLevel::Warn,
                "vault_plain_sync_failed",
                &[("id", worker.vault_id.as_str())],
            ),
        }
    }
}

/// The app changed the store of the vault at `dir`. Called with the session
/// lock held, so it only marks the worker due.
pub(crate) fn store_changed(dir: &Path) {
    if let Some(worker) = find(dir) {
        worker.poke_store();
    }
}

/// Stop the pass that is running, if any, without waiting for it.
pub(super) fn cancel(dir: &Path) {
    if let Some(worker) = find(dir) {
        worker.cancel.store(true, Ordering::Relaxed);
    }
}

/// Stop notifications and the thread, and wait for the pass that is running.
/// Returns once no pass of this vault can run again.
pub(super) fn stop(dir: &Path) {
    let Some(worker) = workers().remove(dir) else {
        return;
    };
    worker.cancel.store(true, Ordering::Relaxed);
    lock(&worker.schedule).stop = true;
    worker.wake.notify_all();
    if let Some(observer) = observer() {
        observer.unwatch(&worker.vault_id);
    }
    let thread = lock(&worker.thread).take();
    if let Some(thread) = thread {
        if thread.thread().id() != std::thread::current().id() {
            let _ = thread.join();
        }
    }
    drop(lock(&worker.gate));
}

/// One pass now, for a phone app coming back to the foreground or a user who
/// asked. Waits for a pass that is already running.
pub(super) fn run_now(dir: &Path, vault_id: &str) -> Result<PlainSyncReport> {
    let worker = find(dir).ok_or_else(|| UprivError::VaultNotOpen(vault_id.to_string()))?;
    worker.pass()
}

/// Run `f` while no pass of this vault runs.
pub(super) fn exclusive<T>(dir: &Path, vault_id: &str, f: impl FnOnce() -> Result<T>) -> Result<T> {
    let worker = find(dir).ok_or_else(|| UprivError::VaultNotOpen(vault_id.to_string()))?;
    let _gate = lock(&worker.gate);
    f()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_stream_of_pokes_still_comes_due_by_the_cap() {
        let mut slot = None;
        Due::poke(&mut slot, Duration::from_secs(3), Duration::from_secs(30));
        let first = slot.unwrap();
        assert!(first.at <= first.first + Duration::from_secs(3));
        Due::poke(&mut slot, Duration::from_secs(60), Duration::from_secs(30));
        let capped = slot.unwrap();
        assert_eq!(capped.first, first.first);
        assert_eq!(capped.at, first.first + Duration::from_secs(30));
    }

    #[test]
    fn the_next_wake_is_the_earliest_due() {
        let now = Instant::now();
        let schedule = Schedule {
            store: Some(Due {
                first: now,
                at: now + Duration::from_secs(1),
            }),
            folder: None,
            periodic: now + PERIODIC,
            stop: false,
        };
        assert_eq!(schedule.next(), now + Duration::from_secs(1));
    }
}
