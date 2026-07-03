use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Deserialize)]
pub struct RpcRequest {
    pub method: String,
    #[serde(default)]
    #[allow(dead_code)]
    pub params: Value,
}

#[derive(Debug, Serialize)]
pub struct RpcResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub fn handle_rpc(req: RpcRequest) -> RpcResponse {
    match req.method.as_str() {
        "app_version" => ok(json!(upriv_core::app_version())),
        other => err(format!("unknown method: {other}")),
    }
}

fn ok(result: Value) -> RpcResponse {
    RpcResponse {
        ok: true,
        result: Some(result),
        error: None,
    }
}

fn err(message: String) -> RpcResponse {
    RpcResponse {
        ok: false,
        result: None,
        error: Some(message),
    }
}
