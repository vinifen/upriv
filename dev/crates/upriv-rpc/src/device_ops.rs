//! This device's identity: what the UI shows of it, and the identity a phone
//! passes from its platform module when that module starts.

use serde::Deserialize;
use serde_json::{json, Value};

use super::{err, ok, RpcResponse};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DeviceIdentityParams {
    /// The OS machine ID source (`ANDROID_ID`). Empty leaves the device unknown.
    machine_id: String,
}

/// `device_info`: this device's ID when it has one, so the lists can tell
/// its group from the others, its system, and the name its OS gives itself
/// (`null` when it gives none). Only the derived ID leaves core, never the
/// OS machine ID, and no name of the computer or phone.
pub(super) fn info() -> RpcResponse {
    let device = upriv_core::this_device();
    ok(json!({
        "id": device.id,
        "system": device.system,
        "os": upriv_core::this_os_name(),
    }))
}

/// `device_identity_set` (phones): set once by the platform module before
/// anything else runs. A desktop reads its own identity and refuses it.
pub(super) fn identity_set(params: Value) -> RpcResponse {
    let parsed: DeviceIdentityParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    if !upriv_core::set_platform_identity(&parsed.machine_id) {
        return err(
            "invalid_request",
            "only a phone sets its device identity".into(),
        );
    }
    ok(json!(null))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn info_names_this_device_by_its_derived_id() {
        let response = info();
        let result = response.result.expect("result");
        let device = upriv_core::this_device();
        assert_eq!(
            result.get("id").and_then(Value::as_str),
            device.id.as_ref().map(|id| id.as_str())
        );
        assert_eq!(
            result.get("system").and_then(Value::as_str),
            Some(upriv_core::DeviceSystem::current().as_str())
        );
        assert_eq!(
            result.get("os").and_then(Value::as_str),
            upriv_core::this_os_name()
        );
        // No name of the computer leaves core.
        assert_eq!(result.as_object().map(|body| body.len()), Some(3));
    }

    #[test]
    fn a_desktop_refuses_an_identity_from_outside() {
        let response = identity_set(json!({ "machineId": "abc" }));
        assert_eq!(response.error.expect("error").code, "invalid_request");
    }
}
