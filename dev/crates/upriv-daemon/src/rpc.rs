// Daemon RPC methods — keep in sync with @upriv/shared `CORE_RPC_COMMANDS` + `DESKTOP_ONLY_RPC_COMMANDS`.
// Protocol error codes — keep in sync with @upriv/shared `RPC_PROTOCOL_ERROR_CODES`.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use upriv_core::{
    app_home_dir, deactivate_vault_root_alias_everywhere, inspect_vault_root_at, load_app_settings,
    open_or_initialize_vault_root_with_policy_and_bootstrap, read_vault_root_alias,
    resolve_vault_root, save_app_settings_session_with_alias_sync, suggested_vault_root,
    write_vault_root_alias_for_root, AppSettings, IncompleteReplacePolicy, ResolveVaultRoot,
    ResolveVaultRootOptions, VaultRootBootstrapPrefs, VaultRootDirStatus, VaultRootMode,
    VaultRootSource, VAULT_ROOT_ALIAS_FILE,
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
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ResolveParams {
    #[serde(default)]
    vault_root_mode: VaultRootMode,
    #[serde(default)]
    explicit_path: Option<String>,
    /// Debug-only alternate app home (`UPRIV_DEV` must be set); rejected otherwise.
    #[serde(default)]
    binary_dir: Option<String>,
}

/// Bootstrap UI prefs applied only when creating a new `.upriv/`.
///
/// Wire nests these under `bootstrap` (camelCase) so future pre-root UI prefs
/// (theme selector on Gate, high-contrast, etc.) can extend this bag without
/// renaming setup RPC params again. Selecting an already-valid root ignores
/// this object entirely — see AGENT.md § "Selecting an existing `.upriv`".
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BootstrapPrefsParams {
    #[serde(default)]
    locale: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PathParams {
    path: String,
    #[serde(default)]
    replace_incomplete: bool,
    #[serde(default)]
    replace_policy: Option<String>,
    #[serde(default)]
    bootstrap: Option<BootstrapPrefsParams>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SetupDefaultRootParams {
    #[serde(default)]
    replace_incomplete: bool,
    /// `"delete"` | `"rename"` — **required** when `replace_incomplete` is true
    /// (no daemon default; UI/TS must pass policy explicitly).
    #[serde(default)]
    replace_policy: Option<String>,
    #[serde(default)]
    bootstrap: Option<BootstrapPrefsParams>,
}

pub fn handle_rpc(req: RpcRequest) -> RpcResponse {
    match req.method.as_str() {
        "app_version" => ok(json!({
            "version": upriv_core::app_version(),
            "distribution": upriv_core::distribution_str(upriv_core::detect_app_distribution()),
        })),
        "app_shutdown" => ok(json!(null)),
        "app_settings_get" => app_settings_get(),
        "app_settings_save" => app_settings_save(req.params),
        "vault_root_resolve" => vault_root_resolve(req.params),
        "vault_root_setup_default_root" => vault_root_setup_default_root(req.params),
        "vault_root_setup_path" => vault_root_setup_path(req.params),
        "vault_root_read_alias" => vault_root_read_alias(),
        "vault_root_default_root_status" => vault_root_default_root_status(),
        "vault_root_inspect_path" => vault_root_inspect_path(req.params),
        "vault_root_suggested_custom_path" => vault_root_suggested_custom_path(),
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
    let binary_dir = match (std::env::var_os("UPRIV_DEV").is_some(), parsed.binary_dir) {
        (_, None) => None,
        (true, Some(dir)) => {
            let trimmed = dir.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(PathBuf::from(trimmed))
            }
        }
        (false, Some(_)) => {
            return err(
                "invalid_request",
                "binaryDir is only allowed when UPRIV_DEV is set".into(),
            );
        }
    };
    let options = ResolveVaultRootOptions {
        explicit: match parsed.explicit_path.filter(|s| !s.trim().is_empty()) {
            Some(path) => {
                let path = PathBuf::from(path);
                if let Err(response) = require_absolute_path(&path) {
                    return response;
                }
                Some(path)
            }
            None => None,
        },
        mode: parsed.vault_root_mode,
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
            default_root_anchor,
            distribution,
        }) => {
            let alias = match path_utf8(&alias_path) {
                Ok(p) => p,
                Err(response) => return response,
            };
            let default_root = match path_utf8(&default_root_anchor) {
                Ok(p) => p,
                Err(response) => return response,
            };
            ok(json!({
                "status": "needs_setup",
                "aliasPath": alias,
                "defaultRootAnchor": default_root,
                "distribution": upriv_core::distribution_str(distribution),
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

/// Validate the wire `bootstrap.locale` and require a non-empty value.
///
/// Used **before** any disk mutation when the setup RPC will create a new
/// `.upriv/` — so a missing locale cannot leave a freshly created root stuck
/// on the built-in `"en"` default (fixes review A2/A3: no retry window where
/// `.upriv/` exists but `settings.toml` still says `"en"`).
fn require_bootstrap_locale(
    bootstrap: Option<&BootstrapPrefsParams>,
) -> Result<String, RpcResponse> {
    let locale = bootstrap
        .and_then(|prefs| prefs.locale.as_deref())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    match locale {
        Some(value) => Ok(value.to_string()),
        None => {
            eprintln!("upriv-daemon: bootstrap.locale is required when creating a new vault-root");
            Err(err(
                "invalid_request",
                "bootstrap.locale is required when creating a new vault-root".into(),
            ))
        }
    }
}

/// Resolve wire `bootstrap` prefs for an `open_or_initialize_*` call.
///
/// Pre-inspects `dir` **before** touching disk:
/// - Valid → `Ok(None)`. Bootstrap prefs are silently ignored (AGENT.md
///   contract: selecting an existing `.upriv` must not rewrite its
///   `settings.toml`).
/// - Absent / Incomplete / Unreadable → require a non-empty `bootstrap.locale`
///   and return `Some(VaultRootBootstrapPrefs { locale: Some(..) })` so the
///   init call writes `[ui].locale` atomically as part of the first (and only)
///   `settings.toml` write.
fn bootstrap_prefs_for_dir(
    dir: &Path,
    bootstrap: Option<&BootstrapPrefsParams>,
) -> Result<Option<VaultRootBootstrapPrefs>, RpcResponse> {
    match inspect_vault_root_at(dir) {
        VaultRootDirStatus::Valid => Ok(None),
        _ => {
            let locale = require_bootstrap_locale(bootstrap)?;
            Ok(Some(VaultRootBootstrapPrefs {
                locale: Some(locale),
            }))
        }
    }
}

fn vault_root_setup_default_root(params: Value) -> RpcResponse {
    let parsed: SetupDefaultRootParams = match serde_json::from_value(params) {
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
    let anchor = match upriv_core::setup_default_root_anchor() {
        Ok(path) => path,
        Err(error) => return map_core_err(error),
    };
    // Pre-validate bootstrap prefs BEFORE any disk mutation when we will create.
    // Selecting an existing Valid root does not require bootstrap prefs.
    let prefs = match bootstrap_prefs_for_dir(&anchor, parsed.bootstrap.as_ref()) {
        Ok(value) => value,
        Err(response) => return response,
    };
    // Init writes `[ui].locale` atomically as part of the first (and only)
    // settings.toml write when creating — no separate post-create stamp step
    // exists here anymore (A2/A3). Retry after a later step fails will find
    // a Valid `.upriv/` with the correct locale already on disk.
    let opened = match open_or_initialize_vault_root_with_policy_and_bootstrap(
        &anchor,
        replace,
        prefs.as_ref(),
    ) {
        Ok(opened) => opened,
        Err(error) => return map_core_err(error),
    };
    let root = opened.root;
    // Partial-failure / retry-safe contract: init may succeed before deactivate.
    // If deactivate fails, `.upriv/` at the anchor is already correctly stamped —
    // UI should retry deactivate / re-enter setup (no automatic rollback).
    if let Err(error) = deactivate_vault_root_alias_everywhere() {
        return map_core_err(error);
    }
    match path_utf8(root.root()) {
        Ok(root_path) => ok(json!({ "rootPath": root_path })),
        Err(response) => response,
    }
}

fn vault_root_status_str(status: VaultRootDirStatus) -> &'static str {
    match status {
        VaultRootDirStatus::Absent => "absent",
        VaultRootDirStatus::Valid => "valid",
        VaultRootDirStatus::Incomplete => "incomplete",
        VaultRootDirStatus::Unreadable => "unreadable",
    }
}

fn vault_root_default_root_status() -> RpcResponse {
    let anchor = match upriv_core::setup_default_root_anchor() {
        Ok(path) => path,
        Err(error) => return map_core_err(error),
    };
    let default_root_anchor = match path_utf8(&anchor) {
        Ok(p) => p,
        Err(response) => return response,
    };
    ok(json!({
        "status": vault_root_status_str(inspect_vault_root_at(&anchor)),
        "defaultRootAnchor": default_root_anchor,
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

fn vault_root_suggested_custom_path() -> RpcResponse {
    match suggested_vault_root() {
        Ok(path) => match path_utf8(&path) {
            Ok(path) => ok(json!({ "path": path })),
            Err(response) => response,
        },
        Err(error) => map_core_err(error),
    }
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
    // Pre-validate bootstrap prefs BEFORE any disk mutation when we will create.
    // Selecting an existing Valid root does not require bootstrap prefs.
    let prefs = match bootstrap_prefs_for_dir(&path, parsed.bootstrap.as_ref()) {
        Ok(value) => value,
        Err(response) => return response,
    };
    // Init writes `[ui].locale` atomically on create — no separate stamp step
    // (A2/A3). If alias write fails, `.upriv/` at `path` already carries the
    // correct locale, so retrying setup is safe.
    let opened = match open_or_initialize_vault_root_with_policy_and_bootstrap(
        &path,
        replace,
        prefs.as_ref(),
    ) {
        Ok(opened) => opened,
        Err(error) => return map_core_err(error),
    };
    let root = opened.root;
    let home = match upriv_core::app_home_dir() {
        Ok(dir) => dir,
        Err(error) => return map_core_err(error),
    };
    if let Err(error) = write_vault_root_alias_for_root(&home, &root) {
        return map_core_err(error);
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

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct AppSettingsSaveParams {
    /// Nested `AppSettings` (snake_case sections: `ui`, `logging`, `app`).
    settings: AppSettings,
    /// When false, write TOML only (caller already mutated `.upriv-root`). Default true.
    /// Wire name is camelCase `syncAlias` only — `sync_alias` is rejected by deny_unknown_fields.
    #[serde(default = "default_sync_alias", rename = "syncAlias")]
    sync_alias: bool,
}

fn default_sync_alias() -> bool {
    true
}

fn app_settings_save(params: Value) -> RpcResponse {
    let parsed: AppSettingsSaveParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let settings = parsed.settings;
    // Reject relative custom paths the same way as setup_path.
    if settings.app.vault_root_mode == VaultRootMode::CustomRoot {
        let path = settings.app.upriv_root_path.trim();
        if path.is_empty() {
            return err(
                "invalid_request",
                "custom_root mode requires a non-empty upriv_root_path".into(),
            );
        }
        if let Err(response) = require_absolute_path(Path::new(path)) {
            return response;
        }
    }
    match save_app_settings_session_with_alias_sync(&settings, parsed.sync_alias) {
        Ok(wrote) => ok(json!({ "wrote": wrote })),
        Err(error) => map_core_err(error),
    }
}

fn source_str(source: VaultRootSource) -> &'static str {
    match source {
        VaultRootSource::Explicit => "explicit",
        VaultRootSource::CustomRoot => "custom_root",
        VaultRootSource::DefaultRoot => "default_root",
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
        upriv_core::UprivError::VaultNotFound(p) => ("vault_not_found", Some(p.as_path())),
        upriv_core::UprivError::VaultConfigInvalid { path, .. } => {
            ("vault_config_invalid", Some(path.as_path()))
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
        "vault_root_setup_default_root",
        "vault_root_setup_path",
        "vault_root_read_alias",
        "vault_root_default_root_status",
        "vault_root_inspect_path",
        "vault_root_suggested_custom_path",
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

    fn bootstrap(locale: Option<&str>) -> BootstrapPrefsParams {
        BootstrapPrefsParams {
            locale: locale.map(|s| s.to_string()),
        }
    }

    #[test]
    fn require_bootstrap_locale_rejects_missing_empty_and_whitespace() {
        assert!(require_bootstrap_locale(None).is_err());
        assert!(require_bootstrap_locale(Some(&bootstrap(None))).is_err());
        assert!(require_bootstrap_locale(Some(&bootstrap(Some("")))).is_err());
        assert!(require_bootstrap_locale(Some(&bootstrap(Some("   ")))).is_err());
        assert_eq!(
            require_bootstrap_locale(Some(&bootstrap(Some("pt-BR")))).unwrap(),
            "pt-BR"
        );
        assert_eq!(
            require_bootstrap_locale(Some(&bootstrap(Some("  es  ")))).unwrap(),
            "es"
        );
    }

    /// A2/A3 create path: absent `.upriv/` at target → bootstrap.locale required before disk.
    #[test]
    fn bootstrap_prefs_for_dir_requires_locale_when_absent() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            inspect_vault_root_at(dir.path()),
            VaultRootDirStatus::Absent
        );
        let err = bootstrap_prefs_for_dir(dir.path(), None).unwrap_err();
        assert_eq!(
            err.error.as_ref().map(|e| e.code.as_str()),
            Some("invalid_request")
        );
        let prefs = bootstrap_prefs_for_dir(dir.path(), Some(&bootstrap(Some("pt-BR"))))
            .unwrap()
            .expect("bootstrap prefs when creating");
        assert_eq!(prefs.locale.as_deref(), Some("pt-BR"));
    }

    /// AGENT.md contract: selecting a Valid existing root must not require
    /// bootstrap prefs (settings.toml is not rewritten on this path).
    #[test]
    fn bootstrap_prefs_for_dir_none_when_valid() {
        let dir = tempfile::tempdir().unwrap();
        upriv_core::initialize_vault_root(dir.path()).unwrap();
        assert_eq!(inspect_vault_root_at(dir.path()), VaultRootDirStatus::Valid);
        assert!(bootstrap_prefs_for_dir(dir.path(), None).unwrap().is_none());
        assert!(
            bootstrap_prefs_for_dir(dir.path(), Some(&bootstrap(Some("pt-BR"))))
                .unwrap()
                .is_none()
        );
    }

    /// A2/A3 create path: incomplete `.upriv/` at target → bootstrap.locale
    /// still required before disk (incomplete→replace path also creates).
    #[test]
    fn bootstrap_prefs_for_dir_requires_locale_when_incomplete() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".upriv")).unwrap();
        assert_eq!(
            inspect_vault_root_at(dir.path()),
            VaultRootDirStatus::Incomplete
        );
        assert!(bootstrap_prefs_for_dir(dir.path(), None).is_err());
        let prefs = bootstrap_prefs_for_dir(dir.path(), Some(&bootstrap(Some("es"))))
            .unwrap()
            .expect("bootstrap prefs on incomplete→replace");
        assert_eq!(prefs.locale.as_deref(), Some("es"));
    }
}
