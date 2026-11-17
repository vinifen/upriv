//! Folder list RPCs: the status of a row of any list, an encrypted vault's
//! unlocked folder after its open, the phone trees this device's rows name,
//! a plain-text record the person forgets, and a backup's name and folder.

use serde::Deserialize;
use serde_json::{json, Value};
use upriv_core::{
    attach_unlocked_folder, data_folder_status, device_trees, folder_status, forget_backup_folder,
    plain_record_forget, rename_backup, unlocked_folder_info, StatusList,
};

use super::{err, map_core_err, ok, require_vault_root, RpcResponse};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
enum StatusListParam {
    DataFolder,
    Unlocked,
    Backup,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FolderStatusParams {
    list: StatusListParam,
    /// The row's path. Absent for the data folder list's Default.
    #[serde(default)]
    path: Option<String>,
    /// The vault of a vault's list. Absent for the app's.
    #[serde(default)]
    vault: Option<String>,
}

/// The status of one row, within its own limit. Tiers 2 and 3: whether the
/// folder answers and takes a write, then what it holds. The data folder
/// list needs no data folder in use: Setup checks its rows too.
pub(super) fn folder_status_rpc(params: Value) -> RpcResponse {
    let parsed: FolderStatusParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let path = parsed.path.as_deref().map(str::trim);
    let list = match parsed.list {
        StatusListParam::DataFolder => {
            return match data_folder_status(path) {
                Ok(status) => ok(serde_json::to_value(status).unwrap_or(json!(null))),
                Err(error) => map_core_err(error),
            };
        }
        StatusListParam::Unlocked => StatusList::Unlocked,
        StatusListParam::Backup => StatusList::Backup,
    };
    let Some(path) = path else {
        return err("invalid_request", "path is required".into());
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    let vault = parsed.vault.as_deref().map(str::trim);
    let status = folder_status(&root, list, path, vault);
    ok(serde_json::to_value(status).unwrap_or(json!(null)))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultJobParams {
    id: String,
    /// Names this attach for `job_status` and `job_cancel`.
    job: String,
}

/// Mount the open encrypted vault's unlocked folder, walking its chain.
pub(super) fn vault_unlocked_folder_attach(params: Value) -> RpcResponse {
    let parsed: VaultJobParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match attach_unlocked_folder(&root, parsed.id.trim(), &parsed.job) {
        Ok(answer) => ok(serde_json::to_value(answer).unwrap_or(json!(null))),
        Err(error) => map_core_err(error),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultIdParams {
    id: String,
}

/// A vault's unlocked folder on this device, for its Info window.
pub(super) fn vault_unlocked_folder_info(params: Value) -> RpcResponse {
    let parsed: VaultIdParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match unlocked_folder_info(&root, parsed.id.trim()) {
        Ok(info) => ok(serde_json::to_value(info).unwrap_or(json!(null))),
        Err(error) => map_core_err(error),
    }
}

/// The storage-access trees this device's rows name, for a phone to mount.
pub(super) fn device_trees_rpc() -> RpcResponse {
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    ok(json!({ "trees": device_trees(&root) }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PlainRecordParams {
    id: String,
    token: String,
}

/// Forget a plain-text folder on record. Its files stay as they are.
pub(super) fn plain_record_forget_rpc(params: Value) -> RpcResponse {
    let parsed: PlainRecordParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match plain_record_forget(&root, parsed.id.trim(), parsed.token.trim()) {
        Ok(()) => ok(json!(null)),
        Err(error) => map_core_err(error),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BackupRenameParams {
    id: String,
    key: String,
    name: String,
}

/// Name a backup, which pins it, or take its name away.
pub(super) fn backup_rename(params: Value) -> RpcResponse {
    let parsed: BackupRenameParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match rename_backup(&root, parsed.id.trim(), parsed.key.trim(), &parsed.name) {
        Ok(entry) => ok(serde_json::to_value(entry).unwrap_or(json!(null))),
        Err(error) => map_core_err(error),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BackupFolderParams {
    id: String,
    folder: String,
}

/// Stop listing a folder of backups; its files stay.
pub(super) fn backup_folder_forget(params: Value) -> RpcResponse {
    let parsed: BackupFolderParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match forget_backup_folder(&root, parsed.id.trim(), parsed.folder.trim()) {
        Ok(()) => ok(json!(null)),
        Err(error) => map_core_err(error),
    }
}
