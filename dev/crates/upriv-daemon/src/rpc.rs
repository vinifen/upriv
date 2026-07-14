// Daemon RPC methods — keep in sync with @upriv/shared `CORE_RPC_COMMANDS` + `DESKTOP_ONLY_RPC_COMMANDS`.
// Protocol error codes — keep in sync with @upriv/shared `RPC_PROTOCOL_ERROR_CODES`.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use upriv_core::{
    app_home_dir, apply_setup_ui_locale, deactivate_vault_root_alias_everywhere,
    inspect_vault_root_at, load_app_settings, open_or_initialize_vault_root_with_policy,
    read_vault_root_alias, resolve_vault_root, save_app_settings_session, write_vault_root_alias,
    AppSettings, IncompleteReplacePolicy, NearbyVaultRootStatus, ResolveVaultRoot,
    ResolveVaultRootOptions, VaultRootSource, VAULT_ROOT_ALIAS_FILE,
};

#[derive(Debug, Deserialize)]
pub struct RpcRequest {
    pub method: String,
    #[serde(default)]
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResolveParams {
    #[serde(default = "default_true")]
    auto_detect: bool,
    #[serde(default)]
    explicit_path: Option<String>,
    /// Debug-only alternate app home (`UPRIV_DEV` must be set); ignored otherwise.
    #[serde(default)]
    binary_dir: Option<String>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PathParams {
    path: String,
    #[serde(default)]
    replace_incomplete: bool,
    #[serde(default)]
    replace_policy: Option<String>,
    #[serde(default)]
    locale: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetupNearbyParams {
    #[serde(default)]
    replace_incomplete: bool,
    /// `"delete"` | `"rename"` — used when `replace_incomplete` is true (default delete).
    #[serde(default)]
    replace_policy: Option<String>,
    #[serde(default)]
    locale: Option<String>,
}

pub fn handle_rpc(req: RpcRequest) -> RpcResponse {
    match req.method.as_str() {
        "app_version" => ok(json!({ "version": upriv_core::app_version() })),
        "app_shutdown" => ok(json!(null)),
        "app_settings_get" => app_settings_get(),
        "app_settings_save" => app_settings_save(req.params),
        "vault_root_resolve" => vault_root_resolve(req.params),
        "vault_root_setup_nearby" => vault_root_setup_nearby(req.params),
        "vault_root_setup_path" => vault_root_setup_path(req.params),
        "vault_root_rewrite_alias" => vault_root_rewrite_alias(req.params),
        "vault_root_deactivate_alias" => vault_root_deactivate_alias(),
        "vault_root_read_alias" => vault_root_read_alias(),
        "vault_root_nearby_status" => vault_root_nearby_status(),
        "vault_root_inspect_path" => vault_root_inspect_path(req.params),
        other => err("unknown_method", format!("unknown method: {other}")),
    }
}

/// UTF-8 strict path for JSON wire — never silent lossy conversion.
fn path_utf8(path: &Path) -> Result<String, RpcResponse> {
    path.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| err("invalid_path_encoding", "path is not valid UTF-8".into()))
}

fn vault_root_resolve(params: Value) -> RpcResponse {
    let parsed: ResolveParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let binary_dir = if std::env::var_os("UPRIV_DEV").is_some() {
        parsed
            .binary_dir
            .filter(|s| !s.trim().is_empty())
            .map(PathBuf::from)
    } else {
        None
    };
    let options = ResolveVaultRootOptions {
        explicit: parsed
            .explicit_path
            .filter(|s| !s.trim().is_empty())
            .map(PathBuf::from),
        auto_detect: parsed.auto_detect,
        binary_dir,
    };
    match resolve_vault_root(options) {
        Ok(ResolveVaultRoot::Found { root, source }) => {
            let root_path = match path_utf8(root.root()) {
                Ok(p) => p,
                Err(response) => return response,
            };
            ok(json!({
                "status": "found",
                "rootPath": root_path,
                "source": source_str(source),
            }))
        }
        Ok(ResolveVaultRoot::NeedsSetup {
            alias_path,
            nearby_anchor,
        }) => {
            let alias = match path_utf8(&alias_path) {
                Ok(p) => p,
                Err(response) => return response,
            };
            let nearby = match path_utf8(&nearby_anchor) {
                Ok(p) => p,
                Err(response) => return response,
            };
            ok(json!({
                "status": "needs_setup",
                "aliasPath": alias,
                "nearbyAnchor": nearby,
            }))
        }
        Err(error) => map_core_err(error),
    }
}

fn parse_replace_policy_flag(
    replace_incomplete: bool,
    replace_policy: Option<&str>,
) -> Result<Option<IncompleteReplacePolicy>, RpcResponse> {
    if !replace_incomplete {
        return Ok(None);
    }
    match replace_policy {
        Some("rename") => Ok(Some(IncompleteReplacePolicy::Rename)),
        Some("delete") => Ok(Some(IncompleteReplacePolicy::Delete)),
        Some(other) => Err(err(
            "invalid_request",
            format!("replacePolicy must be \"rename\" or \"delete\", got {other:?}"),
        )),
        None => Err(err(
            "invalid_request",
            "replacePolicy is required when replaceIncomplete is true".into(),
        )),
    }
}

fn vault_root_setup_nearby(params: Value) -> RpcResponse {
    let parsed: SetupNearbyParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let replace = match parse_replace_policy_flag(
        parsed.replace_incomplete,
        parsed.replace_policy.as_deref(),
    ) {
        Ok(policy) => policy,
        Err(response) => return response,
    };
    let anchor = match upriv_core::setup_nearby_anchor() {
        Ok(path) => path,
        Err(error) => return map_core_err(error),
    };
    let result = open_or_initialize_vault_root_with_policy(&anchor, replace);
    match result {
        Ok(root) => {
            // Alias/deactivate first so a locale failure does not leave active fixed alias.
            if let Err(error) = deactivate_vault_root_alias_everywhere() {
                return map_core_err(error);
            }
            if let Err(error) = apply_setup_ui_locale(root.root(), parsed.locale.as_deref()) {
                eprintln!("upriv-daemon: setup_nearby locale apply failed: {error}");
            }
            match path_utf8(root.root()) {
                Ok(root_path) => ok(json!({ "rootPath": root_path })),
                Err(response) => response,
            }
        }
        Err(error) => map_core_err(error),
    }
}

fn vault_root_status_str(status: NearbyVaultRootStatus) -> &'static str {
    match status {
        NearbyVaultRootStatus::Absent => "absent",
        NearbyVaultRootStatus::Valid => "valid",
        NearbyVaultRootStatus::Incomplete => "incomplete",
        NearbyVaultRootStatus::Unreadable => "unreadable",
    }
}

fn vault_root_nearby_status() -> RpcResponse {
    let anchor = match upriv_core::setup_nearby_anchor() {
        Ok(path) => path,
        Err(error) => return map_core_err(error),
    };
    let nearby_anchor = match path_utf8(&anchor) {
        Ok(p) => p,
        Err(response) => return response,
    };
    ok(json!({
        "status": vault_root_status_str(inspect_vault_root_at(&anchor)),
        "nearbyAnchor": nearby_anchor,
    }))
}

fn vault_root_inspect_path(params: Value) -> RpcResponse {
    let parsed: PathParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let path = PathBuf::from(parsed.path.trim());
    if let Err(response) = require_absolute_path(&path) {
        return response;
    }
    let path_str = match path_utf8(&path) {
        Ok(p) => p,
        Err(response) => return response,
    };
    ok(json!({
        "status": vault_root_status_str(inspect_vault_root_at(&path)),
        "path": path_str,
    }))
}

fn require_absolute_path(path: &Path) -> Result<(), RpcResponse> {
    if path.as_os_str().is_empty() {
        return Err(err("invalid_request", "path is required".into()));
    }
    if !path.is_absolute() {
        return Err(err(
            "invalid_request",
            "path must be absolute (relative paths and ~ are not supported)".into(),
        ));
    }
    Ok(())
}

fn vault_root_setup_path(params: Value) -> RpcResponse {
    let parsed: PathParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let path = PathBuf::from(parsed.path.trim());
    if let Err(response) = require_absolute_path(&path) {
        return response;
    }
    let replace = match parse_replace_policy_flag(
        parsed.replace_incomplete,
        parsed.replace_policy.as_deref(),
    ) {
        Ok(policy) => policy,
        Err(response) => return response,
    };
    let root = match open_or_initialize_vault_root_with_policy(&path, replace) {
        Ok(root) => root,
        Err(error) => return map_core_err(error),
    };
    let home = match upriv_core::app_home_dir() {
        Ok(dir) => dir,
        Err(error) => return map_core_err(error),
    };
    if let Err(error) = write_vault_root_alias(&home, root.root()) {
        return map_core_err(error);
    }
    if let Err(error) = apply_setup_ui_locale(root.root(), parsed.locale.as_deref()) {
        eprintln!("upriv-daemon: setup_path locale apply failed: {error}");
    }
    let alias_path = home.join(VAULT_ROOT_ALIAS_FILE);
    let root_path = match path_utf8(root.root()) {
        Ok(p) => p,
        Err(response) => return response,
    };
    let alias = match path_utf8(&alias_path) {
        Ok(p) => p,
        Err(response) => return response,
    };
    ok(json!({
        "rootPath": root_path,
        "aliasPath": alias,
    }))
}

fn vault_root_rewrite_alias(params: Value) -> RpcResponse {
    let parsed: PathParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let path = PathBuf::from(parsed.path.trim());
    if let Err(response) = require_absolute_path(&path) {
        return response;
    }
    let home = match upriv_core::app_home_dir() {
        Ok(dir) => dir,
        Err(error) => return map_core_err(error),
    };
    match write_vault_root_alias(&home, &path) {
        Ok(()) => ok(json!(null)),
        Err(error) => map_core_err(error),
    }
}

fn vault_root_deactivate_alias() -> RpcResponse {
    match deactivate_vault_root_alias_everywhere() {
        Ok(()) => ok(json!(null)),
        Err(error) => map_core_err(error),
    }
}

fn vault_root_read_alias() -> RpcResponse {
    let home = match app_home_dir() {
        Ok(dir) => dir,
        Err(error) => return map_core_err(error),
    };
    match read_vault_root_alias(&home) {
        Ok(None) => ok(json!(null)),
        Ok(Some(alias)) => match path_utf8(&alias.path) {
            Ok(path) => ok(json!({
                "path": path,
                "active": alias.active,
            })),
            Err(response) => response,
        },
        Err(error) => map_core_err(error),
    }
}

fn app_settings_get() -> RpcResponse {
    match load_app_settings() {
        Ok(loaded) => {
            let root_path = match loaded.root_path {
                Some(ref p) => match path_utf8(p) {
                    Ok(s) => Some(s),
                    Err(response) => return response,
                },
                None => None,
            };
            ok(json!({
                "settings": loaded.settings,
                "rootPath": root_path,
                "onDisk": loaded.on_disk,
            }))
        }
        Err(error) => map_core_err(error),
    }
}

fn app_settings_save(params: Value) -> RpcResponse {
    let settings: AppSettings = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    // Reject relative fixed paths the same way as setup_path.
    if !settings.app.auto_detect_vault_root {
        let path = settings.app.upriv_root_path.trim();
        if !path.is_empty() {
            if let Err(response) = require_absolute_path(Path::new(path)) {
                return response;
            }
        }
    }
    match save_app_settings_session(&settings) {
        Ok(wrote) => ok(json!({ "wrote": wrote })),
        Err(error) => map_core_err(error),
    }
}

fn source_str(source: VaultRootSource) -> &'static str {
    match source {
        VaultRootSource::Explicit => "explicit",
        VaultRootSource::Alias => "alias",
        VaultRootSource::Nearby => "nearby",
    }
}

fn map_core_err(error: upriv_core::UprivError) -> RpcResponse {
    let (code, path) = match &error {
        upriv_core::UprivError::VaultRootNotFound(p) => ("vault_root_not_found", Some(p.as_path())),
        upriv_core::UprivError::VaultRootIncomplete { path, .. } => {
            ("vault_root_incomplete", Some(path.as_path()))
        }
        upriv_core::UprivError::VaultRootAliasInvalid(p) => {
            ("vault_root_alias_invalid", Some(p.as_path()))
        }
        upriv_core::UprivError::Io(_) => ("io_error", None),
    };
    let details = path.and_then(|p| p.to_str().map(|s| json!({ "path": s })));
    err_with_details(code, error.to_string(), details)
}

fn ok(result: Value) -> RpcResponse {
    RpcResponse {
        ok: true,
        result: Some(result),
        error: None,
    }
}

fn err(code: &str, message: String) -> RpcResponse {
    err_with_details(code, message, None)
}

fn err_with_details(code: &str, message: String, details: Option<Value>) -> RpcResponse {
    RpcResponse {
        ok: false,
        result: None,
        error: Some(RpcErrorBody {
            code: code.to_string(),
            message,
            details,
        }),
    }
}

/// Keep in sync with `@upriv/shared` `CORE_RPC_COMMANDS` + `DESKTOP_ONLY_RPC_COMMANDS`.
#[cfg(test)]
mod contract_tests {
    use super::*;
    use serde_json::json;

    const REGISTERED_METHODS: &[&str] = &[
        "app_version",
        "app_shutdown",
        "app_settings_get",
        "app_settings_save",
        "vault_root_resolve",
        "vault_root_setup_nearby",
        "vault_root_setup_path",
        "vault_root_rewrite_alias",
        "vault_root_deactivate_alias",
        "vault_root_read_alias",
        "vault_root_nearby_status",
        "vault_root_inspect_path",
    ];

    #[test]
    fn registered_methods_are_not_unknown() {
        for method in REGISTERED_METHODS {
            let response = handle_rpc(RpcRequest {
                method: (*method).to_string(),
                params: json!({}),
            });
            let code = response.error.as_ref().map(|e| e.code.as_str());
            assert_ne!(
                code,
                Some("unknown_method"),
                "{method} must be registered in handle_rpc"
            );
        }
    }

    #[test]
    fn typo_method_is_unknown() {
        let response = handle_rpc(RpcRequest {
            method: "vault_root_clear_alias".into(),
            params: json!({}),
        });
        assert_eq!(
            response.error.as_ref().map(|e| e.code.as_str()),
            Some("unknown_method")
        );
    }
}
