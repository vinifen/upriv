//! Upriv backend process for the Electron shell.
//!
//! Speaks newline-delimited JSON over stdin/stdout (no TCP port). The Electron
//! main process spawns this binary with piped stdio and proxies renderer calls.
//!
//! **Concurrency:** Argon2-bound methods (`vault_open`, `vault_create`) run on a
//! dedicated worker thread so the stdin loop can still answer light RPCs
//! (settings, groups, list, close, …). Electron already matches responses by
//! `id` (out-of-order OK). One Argon2 at a time: single worker + core
//! `with_unlock_lock`.

mod wire;

use std::io::{self, BufRead, Write};
use std::panic::{self, AssertUnwindSafe};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

use serde_json::json;
use upriv_rpc::RpcErrorBody;
use wire::{handle_request, is_argon2_bound_method, RequestOutcome, WireIn, WireOut};

/// Reject absurdly large request lines before parsing them.
///
/// Easy to spot / change: bump this constant (or delete the guard below) if a
/// real command ever needs a bigger single-line payload.
const MAX_REQUEST_LINE_BYTES: usize = 1 << 20; // 1 MiB

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

fn run_request_caught(id: u64, method: String, params: serde_json::Value) -> RequestOutcome {
    panic::catch_unwind(AssertUnwindSafe(|| handle_request(id, method, params)))
        .unwrap_or_else(|_| RequestOutcome::Continue(internal_error_response(id)))
}

fn spawn_argon2_worker(stdout: Arc<Mutex<io::Stdout>>) -> (Sender<HeavyJob>, JoinHandle<()>) {
    let (tx, rx) = mpsc::channel::<HeavyJob>();
    let handle = thread::Builder::new()
        .name("upriv-argon2".into())
        .spawn(move || {
            while let Ok(job) = rx.recv() {
                match job {
                    HeavyJob::Shutdown => break,
                    HeavyJob::Request { id, method, params } => {
                        // Heavy methods are never `app_shutdown`.
                        let response = match run_request_caught(id, method, params) {
                            RequestOutcome::Continue(wire) | RequestOutcome::Shutdown(wire) => wire,
                        };
                        if let Err(error) = write_out(&stdout, &response) {
                            eprintln!("[upriv-daemon] heavy worker stdout error: {error}");
                            break;
                        }
                    }
                }
            }
        })
        .expect("spawn upriv-argon2 worker");
    (tx, handle)
}

fn main() {
    if let Err(error) = run() {
        eprintln!("[upriv-daemon] fatal stdout error: {error}");
        std::process::exit(1);
    }
}

fn run() -> io::Result<()> {
    panic::set_hook(Box::new(|info| {
        eprintln!("[upriv-daemon] panic: {info}");
    }));
    // Pin distribution once after spawn env is in place (Electron sets UPRIV_*).
    let _ = upriv_core::init_app_distribution();

    let stdout = Arc::new(Mutex::new(io::stdout()));
    let (heavy_tx, heavy_join) = spawn_argon2_worker(Arc::clone(&stdout));

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

    let stdin = io::stdin();
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(value) => value,
            Err(error) => {
                eprintln!("[upriv-daemon] stdin read error: {error}");
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
                write_out(
                    &stdout,
                    &invalid_request(id, "request line too large".to_string()),
                )?;
            }
            continue;
        }

        let inbound: WireIn = match serde_json::from_str(trimmed) {
            Ok(value) => value,
            Err(error) => {
                eprintln!("[upriv-daemon] invalid request JSON: {error}");
                if let Some(id) = extract_request_id(trimmed) {
                    write_out(
                        &stdout,
                        &invalid_request(id, format!("invalid request JSON: {error}")),
                    )?;
                }
                continue;
            }
        };

        match inbound {
            WireIn::Request { id, method, params } => {
                if is_argon2_bound_method(&method) {
                    if heavy_tx
                        .send(HeavyJob::Request { id, method, params })
                        .is_err()
                    {
                        write_out(&stdout, &internal_error_response(id))?;
                        break;
                    }
                    continue;
                }

                match run_request_caught(id, method, params) {
                    RequestOutcome::Continue(response) => write_out(&stdout, &response)?,
                    RequestOutcome::Shutdown(response) => {
                        write_out(&stdout, &response)?;
                        break;
                    }
                }
            }
        }
    }

    // Finish in-flight Argon2 work before flushing logs / exiting.
    let _ = heavy_tx.send(HeavyJob::Shutdown);
    drop(heavy_tx);
    if let Err(error) = heavy_join.join() {
        eprintln!("[upriv-daemon] argon2 worker join panicked: {error:?}");
    }

    upriv_core::logging::flush_logging_session();
    Ok(())
}
