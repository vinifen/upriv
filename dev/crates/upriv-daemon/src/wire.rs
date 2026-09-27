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

/// Methods whose whole call is Argon2id. Handled on the daemon `upriv-argon2`
/// worker so light RPCs (`app_settings_*`, groups, list, …) are not blocked on
/// stdin.
///
/// Still one Argon2 at a time: single worker + `upriv_core::session::with_unlock_lock`.
/// A long `.7z` pack or import takes that lock only for the Argon2 moment.
/// The rest of the job runs on `upriv-pack`, not on this worker and not on
/// the close worker.
pub fn is_argon2_bound_method(method: &str, _params: &Value) -> bool {
    matches!(
        method,
        "vault_open" | "vault_create" | "vault_export_probe" | "vault_ingest_open"
    )
}

/// Close, delete, and backup download. Own worker so a lock is not stuck
/// behind a multi-minute import or export.
pub fn is_lifecycle_io_method(method: &str) -> bool {
    matches!(
        method,
        "vault_close" | "vault_delete" | "backup_get" | "vault_discard_import"
    )
}

/// Vault-file import, portable export, and in-app file import.
/// Separate from close: those jobs must not share one queue.
pub fn is_pack_io_method(method: &str) -> bool {
    matches!(
        method,
        "vault_fs_import_os_file"
            | "vault_import_zip"
            | "vault_import_7z"
            | "vault_import_files_zip"
            | "vault_import_os_path"
            | "vault_export"
    )
}

/// Long contents I/O that would stall stdin if run inline.
pub fn is_long_io_method(method: &str, _params: &Value) -> bool {
    is_lifecycle_io_method(method) || is_pack_io_method(method)
}

/// Which off-stdin worker runs this method.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HeavyLane {
    Argon2,
    Lifecycle,
    Pack,
}

pub fn heavy_lane(method: &str, params: &Value) -> Option<HeavyLane> {
    if is_argon2_bound_method(method, params) {
        return Some(HeavyLane::Argon2);
    }
    if is_lifecycle_io_method(method) {
        return Some(HeavyLane::Lifecycle);
    }
    if is_pack_io_method(method) {
        return Some(HeavyLane::Pack);
    }
    None
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
    fn argon2_worker_is_only_short_unlocks() {
        let empty = Value::Null;
        assert!(is_argon2_bound_method("vault_open", &empty));
        assert!(is_argon2_bound_method("vault_ingest_open", &empty));
        assert!(is_lifecycle_io_method("vault_discard_import"));
        assert!(!is_argon2_bound_method("vault_ingest_directory", &empty));
        assert!(!is_long_io_method("vault_ingest_directory", &empty));
        assert!(is_argon2_bound_method("vault_create", &empty));
        assert!(is_argon2_bound_method("vault_export_probe", &empty));
        assert!(!is_argon2_bound_method("vault_import_7z", &empty));
        assert!(!is_argon2_bound_method("vault_import_zip", &empty));
        assert!(!is_argon2_bound_method("vault_close", &empty));
        assert!(!is_argon2_bound_method("app_settings_save", &empty));
        assert!(!is_argon2_bound_method("vault_list", &empty));
        assert!(!is_heavy_method("vault_store_size", &empty));
        assert!(!is_argon2_bound_method("app_shutdown", &empty));
        assert!(!is_argon2_bound_method("vault_fs_import_os_file", &empty));
        assert!(is_long_io_method("vault_fs_import_os_file", &empty));
        assert!(is_long_io_method("vault_import_zip", &empty));
        assert!(is_long_io_method("vault_import_7z", &empty));
        assert!(is_lifecycle_io_method("vault_close"));
        assert!(is_lifecycle_io_method("vault_delete"));
        assert!(is_lifecycle_io_method("backup_get"));
        assert_eq!(
            heavy_lane("vault_close", &empty),
            Some(HeavyLane::Lifecycle)
        );
        assert_eq!(heavy_lane("vault_import_7z", &empty), Some(HeavyLane::Pack));
        assert_eq!(
            heavy_lane("vault_import_files_zip", &empty),
            Some(HeavyLane::Pack)
        );
        assert_eq!(
            heavy_lane("vault_import_os_path", &empty),
            Some(HeavyLane::Pack)
        );
        assert_eq!(
            heavy_lane("vault_import_zip", &empty),
            Some(HeavyLane::Pack)
        );
        assert_ne!(
            heavy_lane("vault_close", &empty),
            heavy_lane("vault_import_7z", &empty)
        );
        assert!(is_heavy_method("vault_import_7z", &empty));
        assert!(is_heavy_method("vault_fs_import_os_file", &empty));
        assert!(is_heavy_method("vault_close", &empty));
        assert!(is_heavy_method("vault_delete", &empty));
        assert!(!is_heavy_method("vault_fs_write_range", &empty));
        assert!(!is_heavy_method("app_settings_save", &empty));
    }

    #[test]
    fn export_does_not_share_the_argon2_worker() {
        let store_zip = serde_json::json!({ "format": "store_zip" });
        let missing = serde_json::json!({});
        let seven_zip = serde_json::json!({ "format": "seven_zip" });
        for params in [&store_zip, &missing, &seven_zip] {
            assert!(!is_argon2_bound_method("vault_export", params));
            assert!(is_long_io_method("vault_export", params));
            assert!(is_heavy_method("vault_export", params));
            assert_eq!(heavy_lane("vault_export", params), Some(HeavyLane::Pack));
        }
    }
}
