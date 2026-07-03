use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::rpc::{handle_rpc, RpcRequest};

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
        error: Option<String>,
    },
    #[allow(dead_code)]
    Event {
        name: String,
        payload: Value,
    },
}

pub fn handle_request(id: u64, method: String, params: Value) -> WireOut {
    let response = handle_rpc(RpcRequest { method, params });
    WireOut::Response {
        id,
        ok: response.ok,
        result: response.result,
        error: response.error,
    }
}
