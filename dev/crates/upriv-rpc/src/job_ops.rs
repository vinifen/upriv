//! Job RPC handlers: progress and stop for a vault export, Back up now, a
//! backup export, and the data-folder export, by the job id the UI sent with
//! that request.

use serde::Deserialize;
use serde_json::{json, Value};
use upriv_core::logging::{log_event, LogLevel};
use upriv_core::{cancel_job, job_status};

use super::{err, ok, RpcResponse};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct JobParams {
    job: String,
}

/// Who asked for the stop, for the log.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum StopBy {
    /// The Stop button.
    User,
    /// The window's budget or the call's own timeout ran out.
    Timeout,
}

impl StopBy {
    fn as_str(self) -> &'static str {
        match self {
            StopBy::User => "user",
            StopBy::Timeout => "timeout",
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CancelParams {
    job: String,
    by: StopBy,
}

fn parse<T: for<'de> Deserialize<'de>>(params: Value) -> Result<T, RpcResponse> {
    serde_json::from_value(params).map_err(|error| err("invalid_request", error.to_string()))
}

/// How far the job got. `running: false` once it ended, or before it started.
pub(super) fn status(params: Value) -> RpcResponse {
    let parsed: JobParams = match parse(params) {
        Ok(parsed) => parsed,
        Err(response) => return response,
    };
    ok(match job_status(&parsed.job) {
        Some(status) => json!({
            "running": true,
            "bytesDone": status.bytes_done,
            "bytesTotal": status.bytes_total,
        }),
        None => json!({ "running": false, "bytesDone": 0, "bytesTotal": 0 }),
    })
}

/// Stop the job. Its request then fails with `job_cancelled` and leaves no
/// file. A job that has not started yet ends as soon as it starts.
pub(super) fn cancel(params: Value) -> RpcResponse {
    let parsed: CancelParams = match parse(params) {
        Ok(parsed) => parsed,
        Err(response) => return response,
    };
    let running = cancel_job(&parsed.job);
    log_event(
        LogLevel::Info,
        "job_cancel",
        &[
            ("by", parsed.by.as_str()),
            ("running", if running { "true" } else { "false" }),
        ],
    );
    ok(json!({ "running": running }))
}
