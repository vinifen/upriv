//! Upriv backend process for the Electron shell.
//!
//! Speaks newline-delimited JSON over stdin/stdout (no TCP port). The Electron
//! main process spawns this binary with piped stdio and proxies renderer calls.
//!
//! **Concurrency:** Off-stdin lanes, so a long import or rewrap does not sit in
//! front of a lock.
//! - `upriv-argon2`: short unlocks (`vault_open`, `vault_create`). An open
//!   whose vault the core of an app that went away still holds first waits
//!   on an `upriv-open-wait` thread of its own, so it holds no lane.
//! - `upriv-fs-io`: close, delete, and the quit (`app_shutdown`).
//! - `upriv-rewrap`: password and unlock-RAM change (safety zip plus header
//!   commit), and the rebuild of a lost index (pinned copy plus index seal).
//! - `upriv-pack`: zip and `.7z` import, vault and backup export. One at a time.
//! - `upriv-data-folder`: the zip of the whole data folder, and a phone's copy
//!   of its private data folder. Work it refuses on the other lanes answers at
//!   once instead of waiting behind the copy.
//! - `upriv-import`: file imports and the `.7z` password test. One thread per
//!   import slot (one file on a single core, up to four on a large desktop).
//!
//! Light RPCs stay on the stdin loop, so `job_status` and `job_cancel` answer
//! beside every job. Electron matches responses by `id`. One Argon2 at a time:
//! single worker + core `with_unlock_lock`.
//!
//! **Quit:** the first `app_shutdown` runs on the close lane. A Close now
//! hurries from stdin first, so it never waits behind a close already on that
//! lane: as the first call (the quit dialog's Close now), or as a second one
//! sent while a normal quit runs, which then answers at once. Electron ends
//! stdin once the first one answers.

mod plain_watch;
mod wire;

use std::io::{self, BufRead, Write};
use std::panic::{self, AssertUnwindSafe};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

use serde_json::json;
use upriv_rpc::RpcErrorBody;
use wire::{
    handle_request, heavy_lane, is_heavy_method, waits_before_lane, HeavyLane, WireIn, WireOut,
    SHUTDOWN_METHOD,
};
use zeroize::Zeroizing;

/// Reject absurdly large request lines before parsing them.
///
/// Easy to spot / change: bump this constant (or delete the guard below) if a
/// real command ever needs a bigger single-line payload.
const MAX_REQUEST_LINE_BYTES: usize = 8 << 20; // 8 MiB (vault_fs_write + base64)

enum HeavyJob {
    Request {
        id: u64,
        method: String,
        params: serde_json::Value,
    },
    /// Drain the queue and exit the worker (sent once on process shutdown).
    Shutdown,
}

fn write_out(stdout: &Mutex<io::Stdout>, message: &WireOut) -> io::Result<()> {
    let line = serde_json::to_string(message)?;
    let mut guard = stdout
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    writeln!(guard, "{line}")?;
    guard.flush()
}

/// Wire error `{ ok: false, error: { code: "invalid_request", ... } }`.
fn invalid_request(id: u64, message: String) -> WireOut {
    WireOut::Response {
        id,
        ok: false,
        result: None,
        error: Some(RpcErrorBody {
            code: "invalid_request".to_string(),
            message,
            details: None,
        }),
    }
}

fn internal_error_response(id: u64) -> WireOut {
    WireOut::Response {
        id,
        ok: false,
        result: None,
        error: Some(RpcErrorBody {
            code: "internal_error".into(),
            message: "internal error while handling request".into(),
            details: None,
        }),
    }
}

/// Best-effort `id` recovery so a caller waiting on a Promise gets a structured
/// error instead of hanging until its timeout. Returns `None` when the line is
/// too malformed to even locate an id.
fn extract_request_id(raw: &str) -> Option<u64> {
    let value: serde_json::Value = serde_json::from_str(raw).ok()?;
    value.get("id")?.as_u64()
}

/// For anything that can run after the app is gone: `eprintln!` panics once
/// the stderr pipe has no reader, and the vaults still have to be closed.
fn log_stderr(message: std::fmt::Arguments<'_>) {
    let _ = writeln!(io::stderr(), "[upriv-daemon] {message}");
}

fn run_request_caught(id: u64, method: String, params: serde_json::Value) -> WireOut {
    let name = method.clone();
    panic::catch_unwind(AssertUnwindSafe(|| handle_request(id, method, params))).unwrap_or_else(
        |_| {
            upriv_core::session::log_request_panic(&name);
            internal_error_response(id)
        },
    )
}

fn spawn_worker_pool(
    count: usize,
    thread_name: &'static str,
    stdout: Arc<Mutex<io::Stdout>>,
) -> (Sender<HeavyJob>, Vec<JoinHandle<()>>) {
    let count = count.max(1);
    let (tx, rx) = mpsc::channel::<HeavyJob>();
    let rx = Arc::new(Mutex::new(rx));
    let mut handles = Vec::with_capacity(count);
    for index in 0..count {
        let rx = Arc::clone(&rx);
        let stdout = Arc::clone(&stdout);
        let name = format!("{thread_name}-{index}");
        let handle = thread::Builder::new()
            .name(name.clone())
            .spawn(move || loop {
                let job = {
                    let guard = rx.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
                    guard.recv()
                };
                match job {
                    Ok(HeavyJob::Shutdown) | Err(_) => break,
                    Ok(HeavyJob::Request { id, method, params }) => {
                        let response = run_request_caught(id, method, params);
                        if let Err(error) = write_out(&stdout, &response) {
                            log_stderr(format_args!("{name} stdout error: {error}"));
                            break;
                        }
                    }
                }
            })
            .unwrap_or_else(|_| panic!("spawn {thread_name} worker"));
        handles.push(handle);
    }
    (tx, handles)
}

fn spawn_named_worker(
    thread_name: &'static str,
    stdout: Arc<Mutex<io::Stdout>>,
) -> (Sender<HeavyJob>, JoinHandle<()>) {
    let (tx, rx) = mpsc::channel::<HeavyJob>();
    let handle = thread::Builder::new()
        .name(thread_name.into())
        .spawn(move || {
            while let Ok(job) = rx.recv() {
                match job {
                    HeavyJob::Shutdown => break,
                    HeavyJob::Request { id, method, params } => {
                        let response = run_request_caught(id, method, params);
                        if let Err(error) = write_out(&stdout, &response) {
                            log_stderr(format_args!("{thread_name} stdout error: {error}"));
                            break;
                        }
                    }
                }
            }
        })
        .unwrap_or_else(|_| panic!("spawn {thread_name} worker"));
    (tx, handle)
}

fn main() {
    if let Err(error) = run() {
        eprintln!("[upriv-daemon] fatal stdout error: {error}");
        std::process::exit(1);
    }
}

fn run() -> io::Result<()> {
    // A panic inside this hook would abort the process, and the app may be
    // gone already: [`log_stderr`] never panics.
    panic::set_hook(Box::new(|info| {
        upriv_core::session::note_panic(info.location());
        log_stderr(format_args!("panic: {info}"));
    }));
    // Pin distribution once after spawn env is in place (Electron sets UPRIV_*).
    let _ = upriv_core::init_app_distribution();
    plain_watch::install();

    let stdout = Arc::new(Mutex::new(io::stdout()));
    let (argon2_tx, argon2_join) = spawn_named_worker("upriv-argon2", Arc::clone(&stdout));
    let (lifecycle_tx, lifecycle_join) = spawn_named_worker("upriv-fs-io", Arc::clone(&stdout));
    let (rewrap_tx, rewrap_join) = spawn_named_worker("upriv-rewrap", Arc::clone(&stdout));
    let (pack_tx, pack_join) = spawn_named_worker("upriv-pack", Arc::clone(&stdout));
    let (data_folder_tx, data_folder_join) =
        spawn_named_worker("upriv-data-folder", Arc::clone(&stdout));
    let (backup_folder_tx, backup_folder_join) =
        spawn_named_worker("upriv-backup-folder", Arc::clone(&stdout));
    let import_count = upriv_core::import_slots();
    let (import_tx, import_joins) =
        spawn_worker_pool(import_count, "upriv-import", Arc::clone(&stdout));

    write_out(&stdout, &WireOut::Ready)?;
    write_out(
        &stdout,
        &WireOut::Event {
            name: "daemon_ready".to_string(),
            payload: json!({ "version": upriv_core::app_version() }),
        },
    )?;

    match upriv_core::app_home_dir() {
        Ok(home) => {
            let default_root = upriv_core::setup_default_root_anchor()
                .map(|p| p.display().to_string())
                .unwrap_or_else(|_| home.display().to_string());
            eprintln!(
                "[upriv-daemon] startup app_home={} default_root_anchor={}",
                home.display(),
                default_root
            );
        }
        Err(error) => {
            eprintln!("[upriv-daemon] startup: could not resolve app_home: {error}");
        }
    }

    // Set once the first `app_shutdown` went to the close lane.
    let mut shutting_down = false;
    let stdin = io::stdin();
    // A write that fails means the app is gone, the same as stdin ending.
    for line in stdin.lock().lines() {
        // Lines carry passwords and file bytes; wipe each one when its iteration ends.
        let line = match line {
            Ok(value) => Zeroizing::new(value),
            Err(error) => {
                log_stderr(format_args!("stdin read error: {error}"));
                break;
            }
        };

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if trimmed.len() > MAX_REQUEST_LINE_BYTES {
            eprintln!(
                "[upriv-daemon] request line too large: {} bytes (max {MAX_REQUEST_LINE_BYTES})",
                trimmed.len()
            );
            if let Some(id) = extract_request_id(trimmed) {
                let refused = invalid_request(id, "request line too large".to_string());
                if write_out(&stdout, &refused).is_err() {
                    break;
                }
            }
            continue;
        }

        let inbound: WireIn = match serde_json::from_str(trimmed) {
            Ok(value) => value,
            Err(error) => {
                eprintln!("[upriv-daemon] invalid request JSON: {error}");
                if let Some(id) = extract_request_id(trimmed) {
                    let refused = invalid_request(id, format!("invalid request JSON: {error}"));
                    if write_out(&stdout, &refused).is_err() {
                        break;
                    }
                }
                continue;
            }
        };

        match inbound {
            WireIn::Request { id, method, params } => {
                if method == SHUTDOWN_METHOD {
                    if shutting_down {
                        // Close now while the quit runs: hurry it, answer now.
                        upriv_rpc::hurry_shutdown();
                        let hurried = WireOut::Response {
                            id,
                            ok: true,
                            result: Some(json!(null)),
                            error: None,
                        };
                        if write_out(&stdout, &hurried).is_err() {
                            break;
                        }
                        continue;
                    }
                    shutting_down = true;
                    // Close now straight from the quit dialog: hurry from here
                    // at once. On the close lane it waits behind any close
                    // already running, which would not hurry until then.
                    if upriv_rpc::shutdown_is_now(&params) {
                        upriv_rpc::hurry_shutdown();
                    }
                }
                if waits_before_lane(&method, &params) {
                    let tx = argon2_tx.clone();
                    let out = Arc::clone(&stdout);
                    let waiting =
                        thread::Builder::new()
                            .name("upriv-open-wait".into())
                            .spawn(move || {
                                upriv_rpc::vault_open_wait(&params);
                                if tx.send(HeavyJob::Request { id, method, params }).is_err() {
                                    let _ = write_out(&out, &internal_error_response(id));
                                }
                            });
                    if waiting.is_err() && write_out(&stdout, &internal_error_response(id)).is_err()
                    {
                        break;
                    }
                    continue;
                }
                if is_heavy_method(&method, &params) {
                    let lane = heavy_lane(&method, &params).expect("heavy method has a lane");
                    let tx = match lane {
                        HeavyLane::Argon2 => &argon2_tx,
                        HeavyLane::Lifecycle => &lifecycle_tx,
                        HeavyLane::Rewrap => &rewrap_tx,
                        HeavyLane::Pack => &pack_tx,
                        HeavyLane::Import => &import_tx,
                        HeavyLane::DataFolder => &data_folder_tx,
                        HeavyLane::BackupFolder => &backup_folder_tx,
                    };
                    if tx.send(HeavyJob::Request { id, method, params }).is_err() {
                        let _ = write_out(&stdout, &internal_error_response(id));
                        break;
                    }
                    continue;
                }

                let response = run_request_caught(id, method, params);
                if write_out(&stdout, &response).is_err() {
                    break;
                }
            }
        }
    }

    // The app left without `app_shutdown`: a crash, a kill, or a quit that did
    // not wait. Do what that call does, so the next launch finds the vaults
    // closed. A quit already on the close lane finishes before the join below.
    if !shutting_down {
        let _ = run_request_caught(0, SHUTDOWN_METHOD.to_string(), json!({}));
    }

    // Finish in-flight work before flushing logs / exiting.
    let _ = argon2_tx.send(HeavyJob::Shutdown);
    drop(argon2_tx);
    if let Err(error) = argon2_join.join() {
        log_stderr(format_args!("argon2 worker join panicked: {error:?}"));
    }
    let _ = lifecycle_tx.send(HeavyJob::Shutdown);
    drop(lifecycle_tx);
    if let Err(error) = lifecycle_join.join() {
        log_stderr(format_args!("fs-io worker join panicked: {error:?}"));
    }
    let _ = rewrap_tx.send(HeavyJob::Shutdown);
    drop(rewrap_tx);
    if let Err(error) = rewrap_join.join() {
        log_stderr(format_args!("rewrap worker join panicked: {error:?}"));
    }
    let _ = pack_tx.send(HeavyJob::Shutdown);
    drop(pack_tx);
    if let Err(error) = pack_join.join() {
        log_stderr(format_args!("pack worker join panicked: {error:?}"));
    }
    let _ = data_folder_tx.send(HeavyJob::Shutdown);
    drop(data_folder_tx);
    if let Err(error) = data_folder_join.join() {
        log_stderr(format_args!("data-folder worker join panicked: {error:?}"));
    }
    // A call stuck on a dead drive must not hold the core open: this worker is
    // left to the process exit rather than joined.
    let _ = backup_folder_tx.send(HeavyJob::Shutdown);
    drop(backup_folder_tx);
    drop(backup_folder_join);
    for _ in 0..import_joins.len() {
        let _ = import_tx.send(HeavyJob::Shutdown);
    }
    drop(import_tx);
    for handle in import_joins {
        if let Err(error) = handle.join() {
            log_stderr(format_args!("import worker join panicked: {error:?}"));
        }
    }
    // A plain-text wipe still running ends before the core exits: one a job
    // the quit stopped began after `app_shutdown` answered, and after Close
    // now any other. Electron stops the core once its grace runs out, and the
    // next launch finishes what is left.
    upriv_core::wait_for_partial_wipes();

    upriv_core::logging::flush_logging_session();
    Ok(())
}
