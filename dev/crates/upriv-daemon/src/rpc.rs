// Daemon RPC methods — keep in sync with @upriv/shared `CORE_RPC_COMMANDS` + `DESKTOP_ONLY_RPC_COMMANDS`.
// Protocol error codes — keep in sync with @upriv/shared `RPC_PROTOCOL_ERROR_CODES`.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Deserialize)]
pub struct RpcRequest {
    pub method: String,
    /// Reserved for the vault RPCs being ported; `app_version`/`app_shutdown`
    /// take no arguments yet, so it is deserialized but not read.
    #[serde(default)]
    #[allow(dead_code)]
    pub params: Value,
}

#[derive(Debug, Serialize)]
pub struct RpcErrorBody {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

#[derive(Debug, Serialize)]
pub struct RpcResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcErrorBody>,
}

pub fn handle_rpc(req: RpcRequest) -> RpcResponse {
    match req.method.as_str() {
        "app_version" => ok(json!({ "version": upriv_core::app_version() })),
        "app_shutdown" => ok(json!(null)),
        other => err("unknown_method", format!("unknown method: {other}")),
    }
}

fn ok(result: Value) -> RpcResponse {
    RpcResponse {
        ok: true,
        result: Some(result),
        error: None,
    }
}

fn err(code: &str, message: String) -> RpcResponse {
    RpcResponse {
        ok: false,
        result: None,
        error: Some(RpcErrorBody {
            code: code.to_string(),
            message,
            details: None,
        }),
    }
}
