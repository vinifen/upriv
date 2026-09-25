use serde::{Deserialize, Serialize};
use serde_json::Value;

use upriv_rpc::{handle_rpc, RpcErrorBody, RpcRequest};

/// Stdio transport envelope (`type: "request"`). Fields map 1:1 to `RpcRequest` in `upriv-rpc`.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WireIn {
    Request {
        id: u64,
        method: String,
        #[serde(default)]
        params: Value,
    },
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WireOut {
    Ready,
    Response {
        id: u64,
        ok: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        result: Option<Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<RpcErrorBody>,
    },
    Event {
        name: String,
        payload: Value,
    },
}

pub enum RequestOutcome {
    Continue(WireOut),
    Shutdown(WireOut),
}

/// `vault_export` with `format: "seven_zip"` unlocks the store (Argon2id).
/// Any other format, including a missing one, is a ciphertext zip of `store/`.
fn export_runs_argon2(params: &Value) -> bool {
    params.get("format").and_then(Value::as_str) == Some("seven_zip")
}

/// Methods that run Argon2id. Handled on the daemon `upriv-argon2` worker so
/// light RPCs (`app_settings_*`, groups, list, …) are not blocked on
/// stdin.
///
/// Still one Argon2 at a time: single worker + `upriv_core::session::with_unlock_lock`.
/// A ciphertext `store/` zip does not unlock, so it is not in this set.
pub fn is_argon2_bound_method(method: &str, params: &Value) -> bool {
    match method {
        "vault_open" | "vault_create" | "vault_import_7z" | "vault_export_probe" => true,
        "vault_export" => export_runs_argon2(params),
        _ => false,
    }
}

/// Long contents I/O that would stall stdin if run inline (multi-GB OS import,
/// close backup copy, a ciphertext export zip, or wiping and unlinking a vault
/// tree). Own worker so it does not queue behind Argon2 or block
/// list/settings/lock while it finishes.
pub fn is_long_io_method(method: &str, params: &Value) -> bool {
    match method {
        "vault_fs_import_os_file" | "vault_close" | "vault_delete" | "backup_get" => true,
        "vault_export" => !export_runs_argon2(params),
        _ => false,
    }
}

/// Off-stdin work: Argon2, a ciphertext export zip, a long OS-path import, vault close, or vault delete.
pub fn is_heavy_method(method: &str, params: &Value) -> bool {
    is_argon2_bound_method(method, params) || is_long_io_method(method, params)
}

pub fn handle_request(id: u64, method: String, params: Value) -> RequestOutcome {
    let shutdown = method == "app_shutdown";
    let response = handle_rpc(RpcRequest { method, params });
    let wire = WireOut::Response {
        id,
        ok: response.ok,
        result: response.result,
        error: response.error,
    };
    if shutdown {
        RequestOutcome::Shutdown(wire)
    } else {
        RequestOutcome::Continue(wire)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn argon2_bound_methods_include_open_create_and_7z_import() {
        let empty = Value::Null;
        assert!(is_argon2_bound_method("vault_open", &empty));
        assert!(is_argon2_bound_method("vault_create", &empty));
        assert!(is_argon2_bound_method("vault_import_7z", &empty));
        assert!(is_argon2_bound_method("vault_export_probe", &empty));
        assert!(!is_argon2_bound_method("vault_import_zip", &empty));
        assert!(!is_argon2_bound_method("vault_close", &empty));
        assert!(!is_argon2_bound_method("app_settings_save", &empty));
        assert!(!is_argon2_bound_method("vault_list", &empty));
        assert!(!is_argon2_bound_method("app_shutdown", &empty));
        assert!(!is_argon2_bound_method("vault_fs_import_os_file", &empty));
        assert!(is_long_io_method("vault_fs_import_os_file", &empty));
        assert!(is_long_io_method("vault_close", &empty));
        assert!(is_long_io_method("vault_delete", &empty));
        assert!(is_long_io_method("backup_get", &empty));
        assert!(is_heavy_method("vault_fs_import_os_file", &empty));
        assert!(is_heavy_method("vault_close", &empty));
        assert!(is_heavy_method("vault_delete", &empty));
        assert!(!is_heavy_method("vault_fs_write_range", &empty));
        assert!(!is_heavy_method("app_settings_save", &empty));
    }

    #[test]
    fn store_zip_export_does_not_share_the_argon2_worker() {
        let store_zip = serde_json::json!({ "format": "store_zip" });
        let missing = serde_json::json!({});
        let seven_zip = serde_json::json!({ "format": "seven_zip" });
        assert!(!is_argon2_bound_method("vault_export", &store_zip));
        assert!(is_long_io_method("vault_export", &store_zip));
        assert!(is_heavy_method("vault_export", &store_zip));
        assert!(!is_argon2_bound_method("vault_export", &missing));
        assert!(is_long_io_method("vault_export", &missing));
        assert!(is_argon2_bound_method("vault_export", &seven_zip));
        assert!(!is_long_io_method("vault_export", &seven_zip));
        assert!(is_heavy_method("vault_export", &seven_zip));
    }
}
