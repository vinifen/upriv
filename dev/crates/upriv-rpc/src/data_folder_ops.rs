//! Data folder RPC handlers: the data folder list (`data_folder_list`), the
//! apply that saves it and opens the folder it selects, the search for a
//! folder that answers after the selected one did not at launch, and the zip
//! of the whole `.upriv`. The search and the export are jobs: their progress
//! and stop are `job_status` and `job_cancel`.

use std::path::PathBuf;

use serde::Deserialize;
use serde_json::{json, Value};
use upriv_core::folder_list::data_folder::DataFolderChoice;
use upriv_core::folder_list::ListChanges;
use upriv_core::host_fs::HostFsQuery;
use upriv_core::logging::session_logger;
use upriv_core::{
    apply_data_folder, data_folder_view, export_data_folder, search_data_folder, DataFolderApply,
    UprivDirRelocate,
};

use super::{
    bootstrap_prefs, current_root_path_for_log, err, leave_then_reopen_logging,
    log_vault_root_setup, map_core_err, ok, parse_replace_policy_flag, path_utf8,
    require_vault_root, BootstrapPrefsParams, RpcResponse,
};

fn optional_path(path: Option<PathBuf>) -> Result<Option<String>, RpcResponse> {
    path.map(|path| path_utf8(&path)).transpose()
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ListParams {
    /// An empty list, the file left unread: Start a new list.
    #[serde(default)]
    new_list: bool,
}

/// Every device's group of the list, Default's folder on a computer, and
/// the data folder the environment sets, which wins over the list.
pub(super) fn list(params: Value) -> RpcResponse {
    let parsed: ListParams = if params.is_null() {
        ListParams::default()
    } else {
        match serde_json::from_value(params) {
            Ok(value) => value,
            Err(error) => return err("invalid_request", error.to_string()),
        }
    };
    let view = match data_folder_view(parsed.new_list) {
        Ok(view) => view,
        Err(error) => return map_core_err(error),
    };
    let default_folder = match optional_path(view.default_folder) {
        Ok(path) => path,
        Err(response) => return response,
    };
    let explicit = match optional_path(view.explicit) {
        Ok(path) => path,
        Err(response) => return response,
    };
    ok(json!({
        "list": view.list,
        "defaultFolder": default_folder,
        "explicit": explicit,
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ApplyParams {
    /// What the person changed in the list. Empty uses the selection as it is.
    #[serde(default)]
    changes: ListChanges<DataFolderChoice>,
    /// Start from an empty list in place of one that cannot be read.
    #[serde(default)]
    new_list: bool,
    #[serde(default)]
    replace_incomplete: bool,
    /// `"reset_settings"` | `"rename"` | `"delete"`, required with
    /// `replace_incomplete`.
    #[serde(default)]
    replace_policy: Option<String>,
    bootstrap: Option<BootstrapPrefsParams>,
    /// A phone: copy its private data folder into the folder it selects
    /// first. Desktop omits it.
    #[serde(default)]
    adopt_private_root: bool,
    /// The job that copy runs as, so the person can stop it. Required with
    /// `adopt_private_root`.
    #[serde(default)]
    job: Option<String>,
}

fn private_root_str(relocate: UprivDirRelocate) -> &'static str {
    match relocate {
        UprivDirRelocate::Absent => "none",
        UprivDirRelocate::Moved => "moved",
        UprivDirRelocate::DestinationOccupied => "left_behind",
    }
}

/// Save the person's edits of the list and open the folder it selects.
pub(super) fn apply(params: Value) -> RpcResponse {
    let parsed: ApplyParams = match serde_json::from_value(params) {
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
    let bootstrap = match bootstrap_prefs(parsed.bootstrap.as_ref()) {
        Ok(prefs) => prefs,
        Err(response) => return response,
    };
    let adopt_private = match (parsed.adopt_private_root, parsed.job) {
        (false, _) => None,
        (true, Some(job)) => Some(job),
        (true, None) => {
            return err("invalid_request", "adoptPrivateRoot requires a job".into());
        }
    };
    // Vaults of a data folder a resolve found lost can never close: any still
    // open end, so only work that still runs holds the switch (`root_idle`).
    // While a data folder is in use nothing ends here.
    let ended = upriv_core::end_lost_sessions();
    if upriv_core::vault_activity_blocks_root_switch() {
        return map_core_err(upriv_core::UprivError::VaultRootBusy);
    }
    let from_path = current_root_path_for_log();
    let prev_logger = session_logger();
    let applied = match apply_data_folder(&DataFolderApply {
        changes: parsed.changes,
        new_list: parsed.new_list,
        replace,
        bootstrap,
        adopt_private,
    }) {
        Ok(applied) => applied,
        Err(error) => return map_core_err(error),
    };
    let root_path = match path_utf8(applied.root.root()) {
        Ok(path) => path,
        Err(response) => return response,
    };
    let source = applied.source.as_str();
    if applied.switched {
        upriv_core::data_folder_entered(applied.root.root());
        leave_then_reopen_logging(
            prev_logger.as_deref(),
            from_path.as_deref(),
            &root_path,
            source,
        );
        log_vault_root_setup(
            source,
            applied.created,
            applied.prior,
            replace,
            &root_path,
            from_path.as_deref(),
        );
    }
    let mut body = json!({
        "rootPath": root_path,
        "source": source,
        "switched": applied.switched,
        "ended": ended,
    });
    if let Some(relocate) = applied.private_root {
        body["privateRoot"] = json!(private_root_str(relocate));
    }
    ok(body)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SearchParams {
    /// Names this search for `job_status` and `job_cancel`.
    job: String,
}

/// Look for a data folder that answers, the selected one first. A folder
/// found becomes the selection; the caller resolves again.
pub(super) fn search(params: Value) -> RpcResponse {
    let parsed: SearchParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    match search_data_folder(&parsed.job) {
        Ok(found) => ok(serde_json::to_value(found).unwrap_or(json!(null))),
        Err(error) => map_core_err(error),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DataFolderExportParams {
    dest_dir: String,
    /// Zip name without `.zip`; it also names the folder at the zip's top,
    /// which holds the data folder under its own name.
    name: String,
    /// Off leaves every vault's `backups/` folder empty in the copy.
    include_backups: bool,
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
    match export_data_folder(
        &root,
        &dest_dir,
        &parsed.name,
        parsed.include_backups,
        &parsed.job,
    ) {
        Ok(export) => match path_utf8(&export.path) {
            Ok(path) => ok(json!({ "path": path, "size": export.size })),
            Err(response) => response,
        },
        Err(error) => map_core_err(error),
    }
}
