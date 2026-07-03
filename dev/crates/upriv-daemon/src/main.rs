//! Upriv backend process for the Electron shell.
//!
//! Speaks newline-delimited JSON over stdin/stdout (no TCP port). The Electron
//! main process spawns this binary with piped stdio and proxies renderer calls.

mod rpc;
mod wire;

use std::io::{self, BufRead, Write};

use wire::{handle_request, WireIn, WireOut};

fn write_out(message: &WireOut) {
    let line = serde_json::to_string(message).expect("serialize wire message");
    let mut stdout = io::stdout().lock();
    writeln!(stdout, "{line}").expect("write stdout");
    stdout.flush().expect("flush stdout");
}

fn main() {
    write_out(&WireOut::Ready);

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

        let inbound: WireIn = match serde_json::from_str(trimmed) {
            Ok(value) => value,
            Err(error) => {
                eprintln!("[upriv-daemon] invalid request JSON: {error}");
                continue;
            }
        };

        match inbound {
            WireIn::Request { id, method, params } => {
                write_out(&handle_request(id, method, params));
            }
        }
    }
}
