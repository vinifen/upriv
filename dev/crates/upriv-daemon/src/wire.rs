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

/// Methods that run Argon2id. Handled on the daemon `upriv-argon2` worker so
/// light RPCs (`app_settings_*`, groups, list, …) are not blocked on
/// stdin.
///
/// Still one Argon2 at a time: single worker + `upriv_core::session::with_unlock_lock`.
pub fn is_argon2_bound_method(method: &str) -> bool {
    matches!(
        method,
        "vault_open" | "vault_create" | "vault_import_7z" | "vault_export" | "vault_export_probe"
    )
}

/// Long contents I/O that would stall stdin if run inline (multi-GB OS import,
/// close backup copy, or wiping and unlinking a vault tree). Own worker so it
/// does not queue behind Argon2 or block list/settings/lock while it finishes.
pub fn is_long_io_method(method: &str) -> bool {
    matches!(
        method,
        "vault_fs_import_os_file" | "vault_close" | "vault_delete" | "backup_get"
    )
}

/// Off-stdin work: Argon2, a long OS-path import, vault close, or vault delete.
pub fn is_heavy_method(method: &str) -> bool {
    is_argon2_bound_method(method) || is_long_io_method(method)
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
        assert!(is_argon2_bound_method("vault_open"));
        assert!(is_argon2_bound_method("vault_create"));
        assert!(is_argon2_bound_method("vault_import_7z"));
        assert!(is_argon2_bound_method("vault_export"));
        assert!(is_argon2_bound_method("vault_export_probe"));
        assert!(!is_argon2_bound_method("vault_import_zip"));
        assert!(!is_argon2_bound_method("vault_close"));
        assert!(!is_argon2_bound_method("app_settings_save"));
        assert!(!is_argon2_bound_method("vault_list"));
        assert!(!is_argon2_bound_method("app_shutdown"));
        assert!(!is_argon2_bound_method("vault_fs_import_os_file"));
        assert!(is_long_io_method("vault_fs_import_os_file"));
        assert!(is_long_io_method("vault_close"));
        assert!(is_long_io_method("vault_delete"));
        assert!(is_long_io_method("backup_get"));
        assert!(is_heavy_method("vault_fs_import_os_file"));
        assert!(is_heavy_method("vault_close"));
        assert!(is_heavy_method("vault_delete"));
        assert!(!is_heavy_method("vault_fs_write_range"));
        assert!(!is_heavy_method("app_settings_save"));
    }
}
