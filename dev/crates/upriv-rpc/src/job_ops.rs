//! Job RPC handlers: progress and stop for every long request that carries a
//! `job` id (see `upriv_core::session` jobs).

use serde::Deserialize;
use serde_json::{json, Value};
use upriv_core::logging::{log_event, LogLevel};
use upriv_core::{cancel_job, job_status, skip_job_backup, JobStatus, JobStop};

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
/// is in its last step. `step` names what a job made of steps does now (a
/// password change, an unlock-RAM change, a delete), `null` for the others.
pub(super) fn status(params: Value) -> RpcResponse {
    let parsed: JobParams = match parse(params) {
        Ok(parsed) => parsed,
        Err(response) => return response,
    };
    ok(match job_status(&parsed.job) {
        Some(status) => running_status(status),
        None => json!({
            "running": false,
            "bytesDone": 0,
            "bytesTotal": 0,
            "stoppable": true,
            "step": null,
        }),
    })
}

/// A running job's progress, as `job_status` and a close's backup
/// (`vault_close_phase`) answer it.
pub(super) fn running_status(status: JobStatus) -> Value {
    json!({
        "running": true,
        "bytesDone": status.bytes_done,
        "bytesTotal": status.bytes_total,
        "stoppable": status.stoppable,
        "step": status.step.map(|step| step.as_str()),
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

/// Stop the backup the job writes before its change (a password change's
/// Back up first) and let the job go on without it. `stopping: false` when
/// the job is not writing one now: it has none, or it went past it.
pub(super) fn skip_backup(params: Value) -> RpcResponse {
    let parsed: JobParams = match parse(params) {
        Ok(parsed) => parsed,
        Err(response) => return response,
    };
    match skip_job_backup(&parsed.job) {
        Ok(stopping) => {
            log_event(
                LogLevel::Info,
                "job_backup_skip",
                &[("outcome", if stopping { "stopping" } else { "none" })],
            );
            ok(json!({ "stopping": stopping }))
        }
        Err(error) => map_core_err(error),
    }
}
