//! Data-folder export RPC handlers: one zip of the whole `.upriv`.

use std::path::PathBuf;

use serde::Deserialize;
use serde_json::{json, Value};
use upriv_core::host_fs::HostFsQuery;
use upriv_core::{cancel_data_folder_export, data_folder_export_status, export_data_folder};

use super::{
    err, map_core_err, ok, optional_vault_root, path_utf8, require_vault_root, RpcResponse,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DataFolderExportParams {
    dest_dir: String,
}

/// Write `upriv-<stamp>.zip` into the chosen folder. Returns when the zip is
/// in place, when it fails, or when `data_folder_export_cancel` stops it.
pub(super) fn export(params: Value) -> RpcResponse {
    let parsed: DataFolderExportParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let dest_dir = PathBuf::from(parsed.dest_dir.trim());
    if !dest_dir.is_absolute() {
        return err("invalid_request", "destDir must be an absolute path".into());
    }
    if !dest_dir.host_is_dir() {
        return err("invalid_request", "destDir is not a folder".into());
    }
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match export_data_folder(&root, &dest_dir) {
        Ok(export) => match path_utf8(&export.path) {
            Ok(path) => ok(json!({ "path": path, "size": export.size })),
            Err(response) => response,
        },
        Err(error) => map_core_err(error),
    }
}

/// Progress of the running export. `running: false` when none runs.
pub(super) fn export_status() -> RpcResponse {
    let status = match optional_vault_root() {
        Ok(Some(root)) => data_folder_export_status(root.root()),
        Ok(None) => None,
        Err(response) => return response,
    };
    ok(match status {
        Some(status) => json!({
            "running": true,
            "bytesDone": status.bytes_done,
            "bytesTotal": status.bytes_total,
        }),
        None => json!({ "running": false, "bytesDone": 0, "bytesTotal": 0 }),
    })
}

/// Stop the running export. `data_folder_export` then fails with
/// `data_folder_export_cancelled` and leaves no file behind.
pub(super) fn export_cancel() -> RpcResponse {
    let cancelled = match optional_vault_root() {
        Ok(Some(root)) => cancel_data_folder_export(root.root()),
        Ok(None) => false,
        Err(response) => return response,
    };
    ok(json!({ "cancelled": cancelled }))
}
