//! Upriv backend process for the Electron shell.
//!
//! Speaks newline-delimited JSON over stdin/stdout (no TCP port). The Electron
//! main process spawns this binary with piped stdio and proxies renderer calls.

mod rpc;
mod wire;

use std::io::{self, BufRead, Write};

use serde_json::json;
use wire::{handle_request, RequestOutcome, WireIn, WireOut};

use crate::rpc::RpcErrorBody;

/// Reject absurdly large request lines before parsing them.
///
/// Easy to spot / change: bump this constant (or delete the guard below) if a
/// real command ever needs a bigger single-line payload.
const MAX_REQUEST_LINE_BYTES: usize = 1 << 20; // 1 MiB

fn write_out(message: &WireOut) -> io::Result<()> {
    let line = serde_json::to_string(message)?;
    let mut stdout = io::stdout().lock();
    writeln!(stdout, "{line}")?;
    stdout.flush()
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

/// Best-effort `id` recovery so a caller waiting on a Promise gets a structured
/// error instead of hanging until its timeout. Returns `None` when the line is
/// too malformed to even locate an id.
fn extract_request_id(raw: &str) -> Option<u64> {
    let value: serde_json::Value = serde_json::from_str(raw).ok()?;
    value.get("id")?.as_u64()
}

fn main() {
    if let Err(error) = run() {
        eprintln!("[upriv-daemon] fatal stdout error: {error}");
        std::process::exit(1);
    }
}

fn run() -> io::Result<()> {
    write_out(&WireOut::Ready)?;
    write_out(&WireOut::Event {
        name: "daemon_ready".to_string(),
        payload: json!({ "version": upriv_core::app_version() }),
    })?;

    match upriv_core::app_home_dir() {
        Ok(home) => {
            let nearby = upriv_core::setup_nearby_anchor()
                .map(|p| p.display().to_string())
                .unwrap_or_else(|_| home.display().to_string());
            eprintln!(
                "[upriv-daemon] startup app_home={} nearby_anchor={}",
                home.display(),
                nearby
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
                write_out(&invalid_request(id, "request line too large".to_string()))?;
            }
            continue;
        }

        let inbound: WireIn = match serde_json::from_str(trimmed) {
            Ok(value) => value,
            Err(error) => {
                eprintln!("[upriv-daemon] invalid request JSON: {error}");
                if let Some(id) = extract_request_id(trimmed) {
                    write_out(&invalid_request(
                        id,
                        format!("invalid request JSON: {error}"),
                    ))?;
                }
                continue;
            }
        };

        match inbound {
            WireIn::Request { id, method, params } => match handle_request(id, method, params) {
                RequestOutcome::Continue(response) => write_out(&response)?,
                RequestOutcome::Shutdown(response) => {
                    write_out(&response)?;
                    break;
                }
            },
        }
    }

    Ok(())
}
