//! Plaintext-folder RPCs. Handlers for an open `upriv_plain` vault and for
//! recovery of a leftover folder.

use serde::Deserialize;
use serde_json::{json, Value};
use upriv_core::{
    open_vault_as_job, plain_deletions, plain_leftover, plain_send, plain_status, plain_sync,
    plain_unsend, remove_plain_leftover, vault_held_elsewhere, wait_for_previous_app,
};

use super::secret::SecretString;
use super::{err, map_core_err, ok, require_vault_root, RpcResponse};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultIdParams {
    id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultOpenParams {
    id: String,
    #[serde(default)]
    password: Option<SecretString>,
    job: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultPlainDeletionsParams {
    id: String,
    apply: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultPlainPathsParams {
    id: String,
    paths: Vec<String>,
}

/// The vault and job a `vault_open` names, read in place: the password is
/// neither parsed nor copied.
fn open_target(params: &Value) -> Option<(&str, &str)> {
    let id = params.get("id")?.as_str()?.trim();
    let job = params.get("job")?.as_str()?;
    Some((id, job))
}

/// True when the vault this `vault_open` names is still held by the core of
/// an app that went away, so the open waits first ([`vault_open_wait`]).
/// One lock test: light enough for the request loop.
pub fn vault_open_must_wait(params: &Value) -> bool {
    let Some((id, _)) = open_target(params) else {
        return false;
    };
    require_vault_root().is_ok_and(|root| vault_held_elsewhere(&root, id))
}

/// Wait, with no time limit, until the vault this `vault_open` names is free,
/// its job is stopped, or Upriv quits. The desktop core runs it on a thread of
/// its own, so the lane every unlock shares stays free for other vaults; the
/// open then runs on that lane. A request it cannot read waits for nothing
/// and gets its answer from the open itself.
pub fn vault_open_wait(params: &Value) {
    let Some((id, job)) = open_target(params) else {
        return;
    };
    if let Ok(root) = require_vault_root() {
        let _ = wait_for_previous_app(&root, id, job);
    }
}

pub(super) fn vault_open(params: Value) -> RpcResponse {
    let parsed: VaultOpenParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let password = match parsed.password {
        Some(ref value) if !value.is_empty() => value.as_bytes(),
        _ => return err("invalid_request", "password is required".into()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match open_vault_as_job(&root, parsed.id.trim(), password, &parsed.job) {
        Ok(opened) => ok(serde_json::to_value(opened).unwrap_or(json!(null))),
        Err(error) => map_core_err(error),
    }
}

pub(super) fn vault_plain_leftover(params: Value) -> RpcResponse {
    let parsed: VaultIdParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match plain_leftover(&root, parsed.id.trim()) {
        Ok(leftover) => ok(serde_json::to_value(leftover).unwrap_or(json!(null))),
        Err(error) => map_core_err(error),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultPlainRemoveParams {
    id: String,
    /// Names this wipe for `job_status` and `job_cancel`.
    job: String,
}

pub(super) fn vault_plain_remove(params: Value) -> RpcResponse {
    let parsed: VaultPlainRemoveParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match remove_plain_leftover(&root, parsed.id.trim(), &parsed.job) {
        Ok(wipe) => ok(serde_json::to_value(wipe).unwrap_or(json!(null))),
        Err(error) => map_core_err(error),
    }
}

pub(super) fn vault_plain_sync(params: Value) -> RpcResponse {
    let parsed: VaultIdParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match plain_sync(&root, parsed.id.trim()) {
        Ok(report) => ok(serde_json::to_value(report).unwrap_or(json!(null))),
        Err(error) => map_core_err(error),
    }
}

pub(super) fn vault_plain_send(params: Value) -> RpcResponse {
    let parsed: VaultPlainPathsParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match plain_send(&root, parsed.id.trim(), &parsed.paths) {
        Ok(files) => ok(json!({ "files": files })),
        Err(error) => map_core_err(error),
    }
}

pub(super) fn vault_plain_unsend(params: Value) -> RpcResponse {
    let parsed: VaultPlainPathsParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match plain_unsend(&root, parsed.id.trim(), &parsed.paths) {
        Ok(outcome) => ok(serde_json::to_value(outcome).unwrap_or(json!(null))),
        Err(error) => map_core_err(error),
    }
}

pub(super) fn vault_plain_status(params: Value) -> RpcResponse {
    let parsed: VaultIdParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match plain_status(&root, parsed.id.trim()) {
        Ok(status) => ok(serde_json::to_value(status).unwrap_or(json!(null))),
        Err(error) => map_core_err(error),
    }
}

pub(super) fn vault_plain_deletions(params: Value) -> RpcResponse {
    let parsed: VaultPlainDeletionsParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match plain_deletions(&root, parsed.id.trim(), parsed.apply) {
        Ok(status) => ok(serde_json::to_value(status).unwrap_or(json!(null))),
        Err(error) => map_core_err(error),
    }
}
