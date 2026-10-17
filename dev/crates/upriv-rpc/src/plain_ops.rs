//! Plaintext-folder RPCs. Handlers for an open `upriv_plain` vault and for
//! recovery of a leftover folder.

use std::path::Path;

use serde::Deserialize;
use serde_json::{json, Value};
use upriv_core::{
    confirm_plain_destination, import_plain_leftover, open_vault, open_vault_confirmed,
    plain_deletions, plain_destination, plain_holders, plain_leftover, plain_status, plain_sync,
    remove_plain_leftover, vault_list_item, KdfUnlockPreset, OpenVaultOutcome, VaultConfig,
};

use super::secret::SecretString;
use super::{err, map_core_err, ok, require_vault_root, vault_list_item_json, RpcResponse};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultIdParams {
    id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultOpenParams {
    id: String,
    #[serde(default)]
    password: Option<SecretString>,
    #[serde(default)]
    confirm_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultPlainConfirmParams {
    id: String,
    path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultPlainDeletionsParams {
    id: String,
    apply: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultPlainImportParams {
    id: String,
    password: SecretString,
    #[serde(default)]
    unlock_preset: Option<KdfUnlockPreset>,
    settings: VaultConfig,
}

pub(super) fn vault_open(params: Value) -> RpcResponse {
    let parsed: VaultOpenParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let password = match parsed.password {
        Some(ref value) if !value.is_empty() => value.as_bytes(),
        _ => return err("invalid_request", "password is required".into()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    let id = parsed.id.trim();
    let opened = match parsed.confirm_path.as_deref().map(str::trim) {
        Some(path) if !path.is_empty() => {
            open_vault_confirmed(&root, id, password, Path::new(path))
        }
        _ => open_vault(&root, id, password),
    };
    match opened {
        Ok(OpenVaultOutcome::Opened) => ok(json!(null)),
        Ok(OpenVaultOutcome::PlainConfirm { path, class }) => ok(json!({
            "pendingPlainConfirm": {
                "path": path.display().to_string(),
                "class": class,
            }
        })),
        Err(error) => map_core_err(error),
    }
}

pub(super) fn vault_plain_confirm(params: Value) -> RpcResponse {
    let parsed: VaultPlainConfirmParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let path = parsed.path.trim();
    if path.is_empty() {
        return err("invalid_request", "path is required".into());
    }
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match confirm_plain_destination(&root, parsed.id.trim(), Path::new(path)) {
        Ok(()) => ok(json!(null)),
        Err(error) => map_core_err(error),
    }
}

pub(super) fn vault_plain_destination(params: Value) -> RpcResponse {
    let parsed: VaultIdParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match plain_destination(&root, parsed.id.trim()) {
        Ok(dest) => ok(serde_json::to_value(dest).unwrap_or(json!(null))),
        Err(error) => map_core_err(error),
    }
}

pub(super) fn vault_plain_leftover(params: Value) -> RpcResponse {
    let parsed: VaultIdParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match plain_leftover(&root, parsed.id.trim()) {
        Ok(leftover) => ok(serde_json::to_value(leftover).unwrap_or(json!(null))),
        Err(error) => map_core_err(error),
    }
}

pub(super) fn vault_plain_remove(params: Value) -> RpcResponse {
    let parsed: VaultIdParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match remove_plain_leftover(&root, parsed.id.trim()) {
        Ok(wipe) => ok(serde_json::to_value(wipe).unwrap_or(json!(null))),
        Err(error) => map_core_err(error),
    }
}

pub(super) fn vault_plain_import(params: Value) -> RpcResponse {
    let parsed: VaultPlainImportParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    if parsed.password.is_empty() {
        return err("invalid_request", "password is required".into());
    }
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    let preset = parsed.unlock_preset.unwrap_or(KdfUnlockPreset::M256);
    match import_plain_leftover(
        &root,
        parsed.id.trim(),
        parsed.settings,
        parsed.password.as_bytes(),
        preset,
    ) {
        Ok(made) => match vault_list_item(&root, &made.id) {
            Ok(item) => ok(json!({
                "vault": vault_list_item_json(&item),
                "skipped": made.skipped,
                "wipe": made.wipe,
            })),
            Err(error) => map_core_err(error),
        },
        Err(error) => map_core_err(error),
    }
}

pub(super) fn vault_plain_sync(params: Value) -> RpcResponse {
    let parsed: VaultIdParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match plain_sync(&root, parsed.id.trim()) {
        Ok(report) => ok(serde_json::to_value(report).unwrap_or(json!(null))),
        Err(error) => map_core_err(error),
    }
}

pub(super) fn vault_plain_status(params: Value) -> RpcResponse {
    let parsed: VaultIdParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match plain_status(&root, parsed.id.trim()) {
        Ok(status) => ok(serde_json::to_value(status).unwrap_or(json!(null))),
        Err(error) => map_core_err(error),
    }
}

pub(super) fn vault_plain_deletions(params: Value) -> RpcResponse {
    let parsed: VaultPlainDeletionsParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match plain_deletions(&root, parsed.id.trim(), parsed.apply) {
        Ok(status) => ok(serde_json::to_value(status).unwrap_or(json!(null))),
        Err(error) => map_core_err(error),
    }
}

pub(super) fn vault_plain_holders(params: Value) -> RpcResponse {
    let parsed: VaultIdParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match plain_holders(&root, parsed.id.trim()) {
        Ok(holders) => ok(serde_json::to_value(holders).unwrap_or(json!(null))),
        Err(error) => map_core_err(error),
    }
}
