//! Job RPC handlers: progress and stop for every long request that carries a
//! `job` id (see `upriv_core::session` jobs).

use serde::Deserialize;
use serde_json::{json, Value};
use upriv_core::logging::{log_event, LogLevel};
use upriv_core::{cancel_job, job_status, JobStop};

use super::{err, map_core_err, ok, RpcResponse};

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
    /// An auto-close set to close on time, stopping the vault's running work.
    AutoClose,
}

impl StopBy {
    fn as_str(self) -> &'static str {
        match self {
            StopBy::User => "user",
            StopBy::AutoClose => "auto_close",
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

/// How far the job got. `running: false` before it starts and once it ended;
/// the request's own reply tells those apart. `stoppable: false` once the job
/// is in its last step.
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
            "stoppable": status.stoppable,
        }),
        None => json!({ "running": false, "bytesDone": 0, "bytesTotal": 0, "stoppable": true }),
    })
}

/// Stop the job. Its request then fails with `job_cancelled` and leaves
/// nothing behind. A job that has not started yet ends as soon as it starts
/// (`stopping: false`). A job in its last step answers `job_not_stoppable`.
pub(super) fn cancel(params: Value) -> RpcResponse {
    let parsed: CancelParams = match parse(params) {
        Ok(parsed) => parsed,
        Err(response) => return response,
    };
    let stopped = cancel_job(&parsed.job);
    let outcome = match &stopped {
        Ok(JobStop::Stopping) => "stopping",
        Ok(JobStop::Kept) => "kept",
        Err(_) => "refused",
    };
    log_event(
        LogLevel::Info,
        "job_cancel",
        &[("by", parsed.by.as_str()), ("outcome", outcome)],
    );
    match stopped {
        Ok(stop) => ok(json!({ "stopping": stop == JobStop::Stopping })),
        Err(error) => map_core_err(error),
    }
}
