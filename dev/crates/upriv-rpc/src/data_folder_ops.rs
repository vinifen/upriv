//! Data-folder export RPC handler: one zip of the whole `.upriv`. Its
//! progress and stop are `job_status` and `job_cancel`.

use std::path::PathBuf;

use serde::Deserialize;
use serde_json::{json, Value};
use upriv_core::export_data_folder;
use upriv_core::host_fs::HostFsQuery;

use super::{err, map_core_err, ok, path_utf8, require_vault_root, RpcResponse};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DataFolderExportParams {
    dest_dir: String,
    /// Zip name without `.zip`; it also names the folder inside the zip.
    name: String,
    /// Names this export for `job_status` and `job_cancel`.
    job: String,
}

/// Write `<name>.zip` into the chosen folder. Returns when the zip is in
/// place, when it fails, or when `job_cancel` stops it.
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
    match export_data_folder(&root, &dest_dir, &parsed.name, &parsed.job) {
        Ok(export) => match path_utf8(&export.path) {
            Ok(path) => ok(json!({ "path": path, "size": export.size })),
            Err(response) => response,
        },
        Err(error) => map_core_err(error),
    }
}
