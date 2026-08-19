//! Mobile FFI — same RPC surface as `upriv-daemon`, in-process via UniFFI.
//!
//! Kotlin/Swift bindings are generated from this crate (`uniffi-bindgen --library`).
//! React Native loads `libupriv_ffi.so` (Android) or the staticlib (iOS).

uniffi::setup_scaffolding!();

use upriv_rpc::{handle_rpc, RpcRequest};

/// Product version string (from `dev/VERSION`).
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

    let response = handle_rpc(RpcRequest { method, params });
    serde_json::to_string(&response).unwrap_or_else(|_| {
        r#"{"ok":false,"error":{"code":"invalid_request","message":"serialize failed"}}"#
            .to_string()
    })
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
}
