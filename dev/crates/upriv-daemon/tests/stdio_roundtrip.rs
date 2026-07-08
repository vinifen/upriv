//! Integration tests for stdio NDJSON protocol.

use std::io::{BufRead, Write};
use std::process::{Command, Stdio};
use std::time::Duration;

fn spawn_daemon() -> std::process::Child {
    Command::new(env!("CARGO_BIN_EXE_upriv-daemon"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        // Inherit stderr so daemon diagnostics surface when a test fails.
        .stderr(Stdio::inherit())
        .spawn()
        .expect("spawn upriv-daemon")
}

fn read_line(reader: &mut impl BufRead) -> String {
    let mut line = String::new();
    reader.read_line(&mut line).expect("read stdout line");
    line.trim().to_string()
}

#[test]
fn stdio_ready_and_daemon_ready_event() {
    let mut child = spawn_daemon();
    let mut stdout = std::io::BufReader::new(child.stdout.take().expect("stdout"));

    let ready: serde_json::Value =
        serde_json::from_str(&read_line(&mut stdout)).expect("parse ready");
    assert_eq!(ready["type"], "ready");

    let event: serde_json::Value =
        serde_json::from_str(&read_line(&mut stdout)).expect("parse event");
    assert_eq!(event["type"], "event");
    assert_eq!(event["name"], "daemon_ready");
    assert_eq!(event["payload"]["version"], upriv_core::app_version());

    child.kill().expect("kill daemon");
    child.wait().expect("wait on daemon");
}

#[test]
fn stdio_invalid_json_returns_structured_error() {
    let mut child = spawn_daemon();
    let mut stdout = std::io::BufReader::new(child.stdout.take().expect("stdout"));
    let mut stdin = child.stdin.take().expect("stdin");

    let _ready = read_line(&mut stdout);
    let _event = read_line(&mut stdout);

    // Valid JSON object carrying an id, but not a well-formed request.
    writeln!(stdin, r#"{{"id":7,"nonsense":true}}"#).expect("write request");
    stdin.flush().expect("flush stdin");

    let response: serde_json::Value =
        serde_json::from_str(&read_line(&mut stdout)).expect("parse response");
    assert_eq!(response["id"], 7);
    assert_eq!(response["ok"], false);
    assert_eq!(response["error"]["code"], "invalid_request");

    child.kill().expect("kill daemon");
    child.wait().expect("wait on daemon");
}

#[test]
fn stdio_app_version_roundtrip() {
    let mut child = spawn_daemon();
    let mut stdout = std::io::BufReader::new(child.stdout.take().expect("stdout"));
    let mut stdin = child.stdin.take().expect("stdin");

    let _ready = read_line(&mut stdout);
    let _event = read_line(&mut stdout);

    writeln!(
        stdin,
        r#"{{"type":"request","id":1,"method":"app_version","params":{{}}}}"#
    )
    .expect("write request");
    stdin.flush().expect("flush stdin");

    let response: serde_json::Value =
        serde_json::from_str(&read_line(&mut stdout)).expect("parse response");
    assert_eq!(response["type"], "response");
    assert_eq!(response["id"], 1);
    assert_eq!(response["ok"], true);
    assert_eq!(response["result"]["version"], upriv_core::app_version());

    child.kill().expect("kill daemon");
    child.wait().expect("wait on daemon");
}

#[test]
fn stdio_unknown_method_returns_structured_error() {
    let mut child = spawn_daemon();
    let mut stdout = std::io::BufReader::new(child.stdout.take().expect("stdout"));
    let mut stdin = child.stdin.take().expect("stdin");

    let _ready = read_line(&mut stdout);
    let _event = read_line(&mut stdout);

    writeln!(
        stdin,
        r#"{{"type":"request","id":2,"method":"nope","params":{{}}}}"#
    )
    .expect("write request");
    stdin.flush().expect("flush stdin");

    let response: serde_json::Value =
        serde_json::from_str(&read_line(&mut stdout)).expect("parse response");
    assert_eq!(response["ok"], false);
    assert_eq!(response["error"]["code"], "unknown_method");

    child.kill().expect("kill daemon");
    child.wait().expect("wait on daemon");
}

#[test]
fn stdio_app_shutdown_exits_cleanly() {
    let mut child = spawn_daemon();
    let mut stdout = std::io::BufReader::new(child.stdout.take().expect("stdout"));
    let mut stdin = child.stdin.take().expect("stdin");

    let _ready = read_line(&mut stdout);
    let _event = read_line(&mut stdout);

    writeln!(
        stdin,
        r#"{{"type":"request","id":3,"method":"app_shutdown","params":{{}}}}"#
    )
    .expect("write request");
    stdin.flush().expect("flush stdin");

    let response: serde_json::Value =
        serde_json::from_str(&read_line(&mut stdout)).expect("parse response");
    assert_eq!(response["ok"], true);

    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    loop {
        if let Some(status) = child.try_wait().expect("poll daemon") {
            assert!(status.success());
            return;
        }
        if std::time::Instant::now() >= deadline {
            panic!("daemon did not exit after app_shutdown");
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}
