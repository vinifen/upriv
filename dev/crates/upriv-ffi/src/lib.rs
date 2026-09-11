//! Mobile FFI — same RPC surface as `upriv-daemon`, in-process via UniFFI.
//!
//! Kotlin/Swift bindings are generated from this crate (`uniffi-bindgen --library`).
//! React Native loads `libupriv_ffi.so` (Android) or the staticlib (iOS).

uniffi::setup_scaffolding!();

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::Once;

use upriv_rpc::{handle_rpc, RpcErrorBody, RpcRequest, RpcResponse};

fn install_panic_hook() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        std::panic::set_hook(Box::new(|info| {
            eprintln!("[upriv-ffi] panic: {info}");
        }));
    });
}

fn internal_error_envelope() -> String {
    r#"{"ok":false,"error":{"code":"internal_error","message":"internal error while handling request"}}"#
        .to_string()
}

/// Product version string (from repo-root `VERSION`).
#[uniffi::export]
pub fn app_version() -> String {
    upriv_core::app_version().to_string()
}

/**
 * Pin app home + distribution before CORE RPCs (Android/iOS have no HOME/XDG).
 *
 * Mirrors Electron setting `UPRIV_DEFAULT_ROOT_ANCHOR` / `UPRIV_DISTRIBUTION`.
 * Idempotent — later calls with the same values are fine.
 */
#[uniffi::export]
pub fn configure_runtime(app_home: String, distribution: String) {
    install_panic_hook();
    let home = app_home.trim();
    if !home.is_empty() {
        // SAFETY: called once from the RN module before concurrent RPC use.
        unsafe {
            std::env::set_var("UPRIV_DEFAULT_ROOT_ANCHOR", home);
        }
    }
    let dist = distribution.trim();
    if !dist.is_empty() {
        unsafe {
            std::env::set_var("UPRIV_DISTRIBUTION", dist);
        }
    }
    let _ = upriv_core::init_app_distribution();
}

/**
 * Dispatch one CORE RPC method.
 *
 * `params_json` must be a JSON value (object or `null`/`{}`).
 * Returns the same envelope as the daemon: `{ "ok": true, "result": ... }`
 * or `{ "ok": false, "error": { "code", "message", "details?" } }`.
 */
#[uniffi::export]
pub fn invoke(method: String, params_json: String) -> String {
    install_panic_hook();
    let params = if params_json.trim().is_empty() {
        serde_json::Value::Object(serde_json::Map::new())
    } else {
        match serde_json::from_str(&params_json) {
            Ok(value) => value,
            Err(error) => {
                return serde_json::to_string(&serde_json::json!({
                    "ok": false,
                    "error": {
                        "code": "invalid_request",
                        "message": format!("invalid params JSON: {error}"),
                    }
                }))
                .unwrap_or_else(|_| {
                    r#"{"ok":false,"error":{"code":"invalid_request","message":"invalid params"}}"#
                        .to_string()
                });
            }
        }
    };

    let response = catch_unwind(AssertUnwindSafe(|| {
        handle_rpc(RpcRequest { method, params })
    }))
    .unwrap_or_else(|_| RpcResponse {
        ok: false,
        result: None,
        error: Some(RpcErrorBody {
            code: "internal_error".into(),
            message: "internal error while handling request".into(),
            details: None,
        }),
    });
    serde_json::to_string(&response).unwrap_or_else(|_| internal_error_envelope())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_version_non_empty() {
        assert!(!app_version().is_empty());
    }

    #[test]
    fn invoke_app_version_ok() {
        let raw = invoke("app_version".into(), "{}".into());
        let value: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(value["ok"], true);
        assert!(!value["result"]["version"].as_str().unwrap().is_empty());
    }

    #[test]
    fn invoke_unknown_method() {
        let raw = invoke("nope".into(), "{}".into());
        let value: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(value["ok"], false);
        assert_eq!(value["error"]["code"], "unknown_method");
    }

    #[test]
    fn invoke_invalid_params_json() {
        let raw = invoke("app_version".into(), "{".into());
        let value: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(value["ok"], false);
        assert_eq!(value["error"]["code"], "invalid_request");
    }
}
