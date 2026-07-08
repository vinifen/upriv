use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::rpc::{handle_rpc, RpcErrorBody, RpcRequest};

/// Stdio transport envelope (`type: "request"`). Fields map 1:1 to `RpcRequest` in `rpc.rs`.
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
