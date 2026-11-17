//! Shared RPC method handlers — keep in sync with `@upriv/shared`
//! `CORE_RPC_COMMANDS` and `MOBILE_ONLY_RPC_COMMANDS`. Electron main sends
//! `app_shutdown` before SIGTERM. Protocol error codes —
//! keep in sync with `@upriv/shared` `RPC_PROTOCOL_ERROR_CODES`.
//!
//! Desktop: `upriv-daemon` wraps this over stdio NDJSON.
//! Mobile: `upriv-ffi` exposes the same dispatch via UniFFI `invoke`.

// Protocol error codes — keep in sync with @upriv/shared `RPC_PROTOCOL_ERROR_CODES`.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use upriv_core::host_fs::HostFsQuery;
use upriv_core::logging::{
    clear_logging_session, delete_session_log_files, ensure_logging_session,
    list_session_log_files, log_app_start, log_event, log_vault_root_entered,
    log_vault_root_leaving_on, log_vault_root_ready, read_session_log_file, reset_vault_root_ready,
    vault_root_was_ready, LogLevel, Logger,
};
use upriv_core::{
    change_vault_kdf, change_vault_password, close_state, close_vault, close_vault_auto,
    close_vault_now, create_vault_as_job, create_vault_group_with_sort, data_folder_lost,
    delete_vault_group, discover_bootstrap_root, finish_import_session, finish_password_change,
    hurry_close, known_vault_ids, list_vaults, load_app_settings, load_vault_config,
    load_vault_groups, open_import_session, rebuild_vault, rename_vault,
    reorder_vault_group_grouped_vaults, reorder_vault_groups, repair_vault_groups,
    resolve_vault_root, save_app_settings_session, suggested_vault_root, update_key_copies,
    update_vault_group, vault_disk_usage, vault_key_status, vault_list_item, AppSettings,
    CloseState, IncompleteReplacePolicy, KdfUnlockPreset, ResolveVaultRoot,
    ResolveVaultRootOptions, UpdateVaultGroupParams, VaultConfig, VaultGroup, VaultListItem,
    VaultRootBootstrapPrefs, VaultRootDirStatus, VaultStorageMode, VaultWelcome,
};

mod data_folder_ops;
mod device_ops;
mod folder_ops;
mod job_ops;
mod plain_ops;
mod secret;
mod vault_ops;

pub use plain_ops::{vault_open_must_wait, vault_open_wait};
use secret::SecretString;
pub use vault_ops::{hurry_shutdown, ingest_content_fd, shutdown_is_now};

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
    explicit_path: Option<String>,
    /// Debug-only alternate app home (`UPRIV_DEV` must be set); rejected otherwise.
    #[serde(default)]
    binary_dir: Option<String>,
}

/// Bootstrap UI prefs applied only when creating a new `.upriv/`.
///
/// Wire nests these under `bootstrap` (camelCase) so future pre-root UI prefs
/// (theme selector on Gate, high-contrast, etc.) extend this bag. Opening an
/// already-valid data folder ignores it — see AGENT.md § "Selecting an
/// existing `.upriv`".
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BootstrapPrefsParams {
    #[serde(default)]
    locale: Option<String>,
}

pub fn handle_rpc(req: RpcRequest) -> RpcResponse {
    match req.method.as_str() {
        "app_version" => ok(json!({
            "version": upriv_core::app_version(),
            "distribution": upriv_core::distribution_str(upriv_core::detect_app_distribution()),
        })),
        "app_shutdown" => vault_ops::app_shutdown(req.params),
        "device_info" => device_ops::info(),
        "device_identity_set" => device_ops::identity_set(req.params),
        "device_trees" => folder_ops::device_trees_rpc(),
        "folder_status" => folder_ops::folder_status_rpc(req.params),
        "app_settings_get" => app_settings_get(),
        "app_settings_save" => app_settings_save(req.params),
        "vault_root_resolve" => vault_root_resolve(req.params),
        "vault_root_suggested_custom_path" => vault_root_suggested_custom_path(),
        "data_folder_list" => data_folder_ops::list(req.params),
        "data_folder_apply" => data_folder_ops::apply(req.params),
        "data_folder_search" => data_folder_ops::search(req.params),
        "log_list" => log_list(),
        "log_get" => log_get(req.params),
        "log_delete" => log_delete(req.params),
        "log_event" => log_append_event(req.params),
        "vault_group_list" => vault_group_list(),
        "vault_group_create" => vault_group_create(req.params),
        "vault_group_update" => vault_group_update(req.params),
        "vault_group_delete" => vault_group_delete(req.params),
        "vault_group_set_collapsed" => vault_group_set_collapsed(req.params),
        "vault_group_reorder" => vault_group_reorder(req.params),
        "vault_group_reorder_grouped_vaults" => vault_group_reorder_grouped_vaults(req.params),
        "vault_group_repair" => vault_group_repair(),
        "vault_list" => vault_list(),
        "vault_create" => vault_create(req.params),
        "vault_open" => plain_ops::vault_open(req.params),
        "vault_plain_destination" => plain_ops::vault_plain_destination(req.params),
        "vault_plain_leftover" => plain_ops::vault_plain_leftover(req.params),
        "vault_plain_remove" => plain_ops::vault_plain_remove(req.params),
        "vault_plain_sync" => plain_ops::vault_plain_sync(req.params),
        "vault_plain_status" => plain_ops::vault_plain_status(req.params),
        "vault_plain_deletions" => plain_ops::vault_plain_deletions(req.params),
        "vault_plain_send" => plain_ops::vault_plain_send(req.params),
        "vault_plain_unsend" => plain_ops::vault_plain_unsend(req.params),
        "plain_record_forget" => folder_ops::plain_record_forget_rpc(req.params),
        "vault_unlocked_folder_attach" => folder_ops::vault_unlocked_folder_attach(req.params),
        "vault_unlocked_folder_info" => folder_ops::vault_unlocked_folder_info(req.params),
        "vault_close" => vault_close(req.params),
        "vault_change_password" => vault_change_password(req.params),
        "vault_password_change_finish" => vault_password_change_finish(req.params),
        "vault_change_kdf" => vault_change_kdf(req.params),
        "vault_key_copies_update" => vault_key_copies_update(req.params),
        "vault_rebuild" => vault_rebuild(req.params),
        "vault_close_phase" => vault_close_phase(req.params),
        "vault_close_hurry" => vault_close_hurry(req.params),
        "vault_export_capabilities" => vault_ops::vault_export_capabilities(req.params),
        "vault_config_get" => vault_config_get(req.params),
        "vault_disk_usage" => vault_disk_usage_rpc(req.params),
        "vault_key_status" => vault_key_status_rpc(req.params),
        "vault_config_save" => vault_config_save(req.params),
        "vault_rename" => vault_rename(req.params),
        "vault_delete" => vault_ops::vault_delete(req.params),
        "vault_delete_hurry" => vault_ops::vault_delete_hurry(req.params),
        "vault_export" => vault_ops::vault_export(req.params),
        "vault_unfinished_sweep" => vault_ops::vault_unfinished_sweep(req.params),
        "vault_import_zip" => vault_ops::vault_import_zip(req.params),
        "vault_import_7z" => vault_ops::vault_import_7z(req.params),
        "vault_import_files_zip" => vault_ops::vault_import_files_zip(req.params),
        "vault_import_os_path" => vault_ops::vault_import_os_path(req.params),
        "vault_ingest_open" => vault_ingest_open(req.params),
        "vault_ingest_directory" => vault_ops::vault_ingest_directory(req.params),
        "vault_discard_import" => vault_ops::vault_discard_import(req.params),
        "vault_import_probe" => vault_ops::vault_import_probe(req.params),
        "vault_fs_list" => vault_ops::vault_fs_list(req.params),
        "vault_fs_held" => vault_ops::vault_fs_held(req.params),
        "vault_fs_held_restore" => vault_ops::vault_fs_held_restore(req.params),
        "vault_fs_held_delete" => vault_ops::vault_fs_held_delete(req.params),
        "vault_fs_revision" => vault_ops::vault_fs_revision(req.params),
        "vault_fs_preview_fits" => vault_ops::vault_fs_preview_fits(req.params),
        "vault_fs_read" => vault_ops::vault_fs_read(req.params),
        "vault_fs_read_range" => vault_ops::vault_fs_read_range(req.params),
        "vault_fs_write" => vault_ops::vault_fs_write(req.params),
        "vault_fs_write_range" => vault_ops::vault_fs_write_range(req.params),
        "vault_fs_import_os_file" => vault_ops::vault_fs_import_os_file(req.params),
        "vault_fs_truncate" => vault_ops::vault_fs_truncate(req.params),
        "vault_fs_create_file" => vault_ops::vault_fs_create_file(req.params),
        "vault_fs_create_folder" => vault_ops::vault_fs_create_folder(req.params),
        "vault_fs_ensure_folder" => vault_ops::vault_fs_ensure_folder(req.params),
        "vault_fs_delete" => vault_ops::vault_fs_delete(req.params),
        "vault_fs_rename" => vault_ops::vault_fs_rename(req.params),
        "vault_fs_os_path" => vault_ops::vault_fs_os_path(req.params),
        "vault_fs_move" => vault_ops::vault_fs_move(req.params),
        "backup_list" => vault_ops::backup_list(req.params),
        "backup_rename" => folder_ops::backup_rename(req.params),
        "backup_folder_forget" => folder_ops::backup_folder_forget(req.params),
        "backup_delete" => vault_ops::backup_delete(req.params),
        "backup_promote" => vault_ops::backup_promote(req.params),
        "backup_save" => vault_ops::backup_save(req.params),
        "backup_export" => vault_ops::backup_export(req.params),
        "data_folder_export" => data_folder_ops::export(req.params),
        "job_status" => job_ops::status(req.params),
        "job_cancel" => job_ops::cancel(req.params),
        other => err("unknown_method", format!("unknown method: {other}")),
    }
}

/// UTF-8 strict path for JSON wire — never silent lossy conversion.
fn path_utf8(path: &Path) -> Result<String, RpcResponse> {
    path.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| err("invalid_path_encoding", "path is not valid UTF-8".into()))
}

/// Electron sets these when a Windows install directory still holds `.upriv`
/// or the move out of that directory failed. Absent on every other launch.
fn relocate_notice() -> Option<(&'static str, String)> {
    let notice = std::env::var("UPRIV_VAULT_RELOCATE_NOTICE").unwrap_or_default();
    let path = std::env::var("UPRIV_VAULT_RELOCATE_PATH").unwrap_or_default();
    let notice = match notice.as_str() {
        "left_behind" => "left_behind",
        "move_failed" => "move_failed",
        _ => return None,
    };
    if path.is_empty() {
        return None;
    }
    Some((notice, path))
}

fn with_relocate_notice(mut body: Value) -> Value {
    if let Some((notice, path)) = relocate_notice() {
        if let Some(object) = body.as_object_mut() {
            object.insert("relocateNotice".into(), json!(notice));
            object.insert("relocatePath".into(), json!(path));
        }
    }
    body
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
        binary_dir,
    };
    match resolve_vault_root(options) {
        Ok(ResolveVaultRoot::Found { root, source }) => {
            let root_path = match path_utf8(root.root()) {
                Ok(p) => p,
                Err(response) => return response,
            };
            let source = source.as_str();
            upriv_core::data_folder_entered(root.root());
            log_app_start("vault_root_resolve");
            log_vault_root_ready(source, &root_path);
            // Probe can run more than once on Gate launch — keep at DEBUG.
            log_event(
                LogLevel::Debug,
                "vault_root_resolve",
                &[("status", "found"), ("source", source)],
            );
            ok(with_relocate_notice(json!({
                "status": "found",
                "rootPath": root_path,
                "source": source,
            })))
        }
        Ok(ResolveVaultRoot::NeedsSetup {
            default_root_anchor,
            distribution,
        }) => {
            let default_root = match path_utf8(&default_root_anchor) {
                Ok(p) => p,
                Err(response) => return response,
            };
            let ended = leave_lost_data_folder();
            ok(with_relocate_notice(json!({
                "status": "needs_setup",
                "defaultRootAnchor": default_root,
                "distribution": upriv_core::distribution_str(distribution),
                "ended": ended,
            })))
        }
        Ok(ResolveVaultRoot::SelectedFailed { place, reason }) => {
            let ended = leave_lost_data_folder();
            ok(with_relocate_notice(json!({
                "status": "selected_failed",
                "choice": place.choice_name(),
                "reason": reason,
                "ended": ended,
            })))
        }
        Err(error) => fail_loud_vault_root_resolve(error),
    }
}

/// No data folder is in use now (the first run, or a selection that does
/// not answer, also one lost while Upriv ran): drop the writer so it cannot
/// recreate `.upriv/logs`, and the next data folder logs `vault_root_ready`
/// again.
fn leave_no_data_folder() {
    clear_logging_session();
    reset_vault_root_ready();
}

/// The selected choice holds no data folder that answers: the one in use,
/// if any, is lost, and every vault still open in it ends. Returns the names
/// of the vaults that ended with it.
fn leave_lost_data_folder() -> Vec<String> {
    leave_no_data_folder();
    upriv_core::leave_lost_data_folder()
}

fn fail_loud_vault_root_resolve(error: upriv_core::UprivError) -> RpcResponse {
    match &error {
        upriv_core::UprivError::VaultRootIncomplete { .. }
        | upriv_core::UprivError::VaultRootNotFound(_)
        | upriv_core::UprivError::DataFolderListInvalid { .. } => leave_no_data_folder(),
        _ => {}
    }
    map_core_err(error)
}

fn parse_replace_policy_flag(
    replace_incomplete: bool,
    replace_policy: Option<&str>,
) -> Result<Option<IncompleteReplacePolicy>, RpcResponse> {
    if !replace_incomplete {
        return Ok(None);
    }
    match replace_policy {
        Some("reset_settings") => Ok(Some(IncompleteReplacePolicy::ResetSettings)),
        Some("rename") => Ok(Some(IncompleteReplacePolicy::Rename)),
        Some("delete") => Ok(Some(IncompleteReplacePolicy::Delete)),
        Some(other) => Err(err(
            "invalid_request",
            format!(
                "replacePolicy must be \"reset_settings\", \"rename\", or \"delete\", got {other:?}"
            ),
        )),
        None => Err(err(
            "invalid_request",
            "replacePolicy is required when replaceIncomplete is true".into(),
        )),
    }
}

/// The preferences a new data folder starts with. `bootstrap.locale` is
/// required on every apply, checked before anything is written, so a folder
/// an apply makes never starts on the built-in default locale.
fn bootstrap_prefs(
    bootstrap: Option<&BootstrapPrefsParams>,
) -> Result<VaultRootBootstrapPrefs, RpcResponse> {
    let locale = bootstrap
        .and_then(|prefs| prefs.locale.as_deref())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    match locale {
        Some(value) => Ok(VaultRootBootstrapPrefs {
            locale: Some(value.to_string()),
        }),
        None => Err(err(
            "invalid_request",
            "bootstrap.locale is required to apply the data folder list".into(),
        )),
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
            // Logging session opens lazily on the first `log_event` (e.g. settings_save).
            ok(json!({
                "settings": loaded.settings,
                "rootPath": root_path,
                "onDisk": loaded.on_disk,
            }))
        }
        Err(error) => map_core_err(error),
    }
}

fn log_list() -> RpcResponse {
    match list_session_log_files() {
        Ok(files) => ok(json!({ "files": files })),
        Err(error) => map_core_err(error),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LogEventParams {
    event: String,
}

/// Allowlisted UI events. No vault id, display name, or paths.
fn log_append_event(params: Value) -> RpcResponse {
    let parsed: LogEventParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    match parsed.event.as_str() {
        "vault_hidden" => {
            log_event(LogLevel::Info, "vault_hidden", &[]);
            ok(json!(null))
        }
        "vault_group_hidden" => {
            log_event(LogLevel::Info, "vault_group_hidden", &[]);
            ok(json!(null))
        }
        "ui_crash" => {
            // No payload — do not attach component stacks or user paths.
            log_event(LogLevel::Error, "ui_crash", &[]);
            ok(json!(null))
        }
        "import_cache_wipe_failed" => {
            // No URI — picker cache path must not land in session logs.
            log_event(LogLevel::Warn, "import_cache_wipe_failed", &[]);
            ok(json!(null))
        }
        _ => err("invalid_request", "event is not allowed".into()),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LogFilenameParams {
    filename: String,
}

fn log_get(params: Value) -> RpcResponse {
    let parsed: LogFilenameParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let filename = parsed.filename.trim();
    if filename.is_empty() {
        return err("invalid_request", "filename is required".into());
    }
    match read_session_log_file(filename) {
        Ok(Some(file)) => ok(json!({ "file": file })),
        Ok(None) => ok(json!({ "file": Value::Null })),
        Err(error @ upriv_core::UprivError::LogFileTooLarge { .. }) => {
            err("log_file_too_large", error.to_string())
        }
        Err(error) => map_core_err(error),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LogDeleteParams {
    filenames: Vec<String>,
}

fn log_delete(params: Value) -> RpcResponse {
    let parsed: LogDeleteParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    match delete_session_log_files(&parsed.filenames) {
        Ok(()) => {
            let deleted_active = parsed
                .filenames
                .iter()
                .any(|name| name.starts_with("current-"));
            // Do not `log_event` after deleting the live `current-*` — that would
            // reopen the writer and recreate an empty active file immediately.
            if !deleted_active {
                let count = parsed.filenames.len().to_string();
                log_event(LogLevel::Info, "logs_deleted", &[("count", count.as_str())]);
            } else {
                eprintln!(
                    "[upriv-rpc] deleted {} log file(s) including active current-*",
                    parsed.filenames.len()
                );
            }
            ok(json!(null))
        }
        Err(upriv_core::UprivError::Io(error))
            if error.kind() == std::io::ErrorKind::InvalidInput =>
        {
            let touched_active = parsed
                .filenames
                .iter()
                .any(|name| name.starts_with("current-"));
            // Do not `log_event` after releasing `current-*` — that recreates the active file.
            if !touched_active {
                log_event(
                    LogLevel::Warn,
                    "logs_delete_failed",
                    &[("reason", "invalid_request")],
                );
            } else {
                eprintln!(
                    "[upriv-rpc] logs_delete_failed (invalid_request) after touching current-*"
                );
            }
            err("invalid_request", error.to_string())
        }
        Err(
            error @ (upriv_core::UprivError::VaultRootNotFound(_)
            | upriv_core::UprivError::VaultRootIncomplete { .. }),
        ) => map_core_err(error),
        Err(error) => {
            let touched_active = parsed
                .filenames
                .iter()
                .any(|name| name.starts_with("current-"));
            if !touched_active {
                log_event(
                    LogLevel::Error,
                    "logs_delete_failed",
                    &[("reason", "io_error")],
                );
            } else {
                eprintln!("[upriv-rpc] logs_delete_failed (io_error) after touching current-*");
            }
            map_core_err(error)
        }
    }
}

/// Bootstrap (never `vault_root_ready` this process, no `.upriv` yet) → `Ok(None)`.
/// After a data folder was ready, finding none is mid-session integrity: the
/// data folder in use was lost (case B). Its selection stays, and the call
/// answers `vault_root_not_found`, so the Gate resolves again.
fn optional_vault_root() -> Result<Option<upriv_core::VaultRoot>, RpcResponse> {
    match discover_bootstrap_root() {
        Ok(Some(root)) => Ok(Some(root)),
        Ok(None) if vault_root_was_ready() => Err(map_core_err(data_folder_lost())),
        Ok(None) => Ok(None),
        Err(error) => Err(map_core_err(error)),
    }
}

fn require_vault_root() -> Result<upriv_core::VaultRoot, RpcResponse> {
    match optional_vault_root() {
        Ok(Some(root)) => Ok(root),
        Ok(None) => Err(err(
            "vault_root_not_found",
            "no vault-root available".into(),
        )),
        Err(response) => Err(response),
    }
}

fn empty_group_list_json() -> Value {
    json!({
        "groups": [],
        "droppedOrphans": 0,
        "droppedDuplicateAssignments": 0,
        "invalid": false,
    })
}

fn group_to_json(group: &VaultGroup) -> Value {
    json!({
        "id": group.id,
        "displayName": group.display_name,
        "order": group.order,
        "collapsed": group.collapsed,
        "hidden": group.hidden,
        "groupedVaults": group.grouped_vaults,
        "groupedVaultSort": group.grouped_vault_sort,
        "groupedVaultSortDirection": group.grouped_vault_sort_direction,
    })
}

fn vault_group_list() -> RpcResponse {
    let root = match optional_vault_root() {
        Ok(Some(root)) => root,
        Ok(None) => return ok(empty_group_list_json()),
        Err(response) => return response,
    };
    let known = match known_vault_ids(&root) {
        Ok(ids) => ids,
        Err(error) => return map_core_err(error),
    };
    match load_vault_groups(&root, &known) {
        Ok(loaded) => ok(json!({
            "groups": loaded.groups.iter().map(group_to_json).collect::<Vec<_>>(),
            "droppedOrphans": loaded.dropped_orphans,
            "droppedDuplicateAssignments": loaded.dropped_duplicate_assignments,
            // Dual membership is soft-dropped on list but still on disk until mutate
            // heals it — surface repair so the UI is not stuck without a banner.
            "invalid": loaded.dropped_duplicate_assignments > 0,
        })),
        Err(upriv_core::UprivError::VaultGroupsInvalid { .. }) => ok(json!({
            "groups": [],
            "droppedOrphans": 0,
            "droppedDuplicateAssignments": 0,
            "invalid": true,
        })),
        Err(error) => map_core_err(error),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultGroupCreateParams {
    id: String,
    display_name: String,
    #[serde(default)]
    grouped_vaults: Option<Vec<String>>,
    #[serde(default)]
    grouped_vault_sort: Option<String>,
    #[serde(default)]
    grouped_vault_sort_direction: Option<String>,
    #[serde(default)]
    hidden: Option<bool>,
}

fn vault_group_create(params: Value) -> RpcResponse {
    let parsed: VaultGroupCreateParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    let grouped_vaults = parsed.grouped_vaults.unwrap_or_default();
    match create_vault_group_with_sort(
        &root,
        &parsed.id,
        &parsed.display_name,
        &grouped_vaults,
        parsed.grouped_vault_sort.as_deref(),
        parsed.grouped_vault_sort_direction.as_deref(),
        parsed.hidden.unwrap_or(false),
    ) {
        Ok(created) => {
            log_event(
                LogLevel::Info,
                "vault_group_created",
                &[("id", created.group.id.as_str())],
            );
            if created.group.hidden {
                log_event(LogLevel::Info, "vault_group_hidden", &[]);
            }
            if created.sibling_vaults_moved {
                log_event(
                    LogLevel::Info,
                    "vault_group_vaults_moved",
                    &[("id", created.group.id.as_str())],
                );
            }
            ok(json!({ "group": group_to_json(&created.group) }))
        }
        Err(error) => map_core_err(error),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultGroupUpdateParams {
    id: String,
    #[serde(default)]
    display_name: Option<String>,
    #[serde(default)]
    collapsed: Option<bool>,
    #[serde(default)]
    order: Option<i64>,
    #[serde(default)]
    grouped_vaults: Option<Vec<String>>,
    #[serde(default)]
    grouped_vault_sort: Option<String>,
    #[serde(default)]
    grouped_vault_sort_direction: Option<String>,
    #[serde(default)]
    hidden: Option<bool>,
}

fn vault_group_update(params: Value) -> RpcResponse {
    let parsed: VaultGroupUpdateParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match update_vault_group(
        &root,
        &parsed.id,
        UpdateVaultGroupParams {
            display_name: parsed.display_name.as_deref(),
            collapsed: parsed.collapsed,
            order: parsed.order,
            grouped_vaults: parsed.grouped_vaults.as_deref(),
            grouped_vault_sort: parsed.grouped_vault_sort.as_deref(),
            grouped_vault_sort_direction: parsed.grouped_vault_sort_direction.as_deref(),
            hidden: parsed.hidden,
        },
    ) {
        Ok(updated) => {
            if updated.grouped_vaults_changed {
                log_event(
                    LogLevel::Info,
                    "vault_group_vaults_moved",
                    &[("id", updated.group.id.as_str())],
                );
            }
            if updated.hidden_became_true {
                log_event(LogLevel::Info, "vault_group_hidden", &[]);
            }
            let metadata_patched = parsed.display_name.is_some()
                || parsed.collapsed.is_some()
                || parsed.order.is_some()
                || parsed.grouped_vault_sort.is_some()
                || parsed.grouped_vault_sort_direction.is_some()
                || parsed.hidden.is_some();
            let is_pure_membership_move = updated.grouped_vaults_changed && !metadata_patched;
            if !is_pure_membership_move {
                log_event(
                    LogLevel::Info,
                    "vault_group_updated",
                    &[("id", updated.group.id.as_str())],
                );
            }
            ok(json!({ "group": group_to_json(&updated.group) }))
        }
        Err(error) => map_core_err(error),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultGroupIdParams {
    id: String,
}

fn vault_group_delete(params: Value) -> RpcResponse {
    let parsed: VaultGroupIdParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match delete_vault_group(&root, &parsed.id) {
        Ok(Some(_)) => {
            log_event(
                LogLevel::Info,
                "vault_group_deleted",
                &[("id", parsed.id.as_str())],
            );
            ok(json!(null))
        }
        Ok(None) => err(
            "vault_group_not_found",
            format!("group not found: {}", parsed.id),
        ),
        Err(error) => map_core_err(error),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultGroupCollapsedParams {
    id: String,
    collapsed: bool,
}

fn vault_group_set_collapsed(params: Value) -> RpcResponse {
    let parsed: VaultGroupCollapsedParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match update_vault_group(
        &root,
        &parsed.id,
        UpdateVaultGroupParams {
            collapsed: Some(parsed.collapsed),
            ..Default::default()
        },
    ) {
        Ok(updated) => ok(json!({ "group": group_to_json(&updated.group) })),
        Err(error) => map_core_err(error),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultGroupOrderEntry {
    id: String,
    order: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultGroupReorderParams {
    orders: Vec<VaultGroupOrderEntry>,
}

fn vault_group_reorder(params: Value) -> RpcResponse {
    let parsed: VaultGroupReorderParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    let orders: Vec<(String, i64)> = parsed
        .orders
        .into_iter()
        .map(|entry| (entry.id, entry.order))
        .collect();
    match reorder_vault_groups(&root, &orders) {
        Ok(groups) => {
            log_event(LogLevel::Info, "vault_groups_reordered", &[]);
            ok(json!({
                "groups": groups.iter().map(group_to_json).collect::<Vec<_>>(),
            }))
        }
        Err(error) => map_core_err(error),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultGroupReorderGroupedVaultsParams {
    id: String,
    #[serde(default)]
    grouped_vaults: Option<Vec<String>>,
}

fn vault_group_reorder_grouped_vaults(params: Value) -> RpcResponse {
    let parsed: VaultGroupReorderGroupedVaultsParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    let grouped_vaults = parsed.grouped_vaults.unwrap_or_default();
    match reorder_vault_group_grouped_vaults(&root, &parsed.id, &grouped_vaults) {
        Ok(group) => {
            log_event(
                LogLevel::Info,
                "vault_group_grouped_vaults_reordered",
                &[("id", group.id.as_str())],
            );
            ok(json!({ "group": group_to_json(&group) }))
        }
        Err(error) => map_core_err(error),
    }
}

fn vault_group_repair() -> RpcResponse {
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match repair_vault_groups(&root) {
        Ok(()) => {
            log_event(LogLevel::Warn, "vault_groups_repaired", &[]);
            ok(json!(null))
        }
        Err(error) => map_core_err(error),
    }
}

fn storage_mode_wire(mode: VaultStorageMode) -> &'static str {
    match mode {
        VaultStorageMode::EncryptedDir => "encrypted_dir",
        VaultStorageMode::UprivPlain => "upriv_plain",
    }
}

fn vault_list_item_json(item: &VaultListItem) -> Value {
    let unlock_preset = item
        .unlock_preset
        .and_then(|preset| serde_json::to_value(preset).ok());
    json!({
        "id": item.id,
        "displayName": item.display_name,
        "session": item.session,
        "storageMode": storage_mode_wire(item.storage_mode),
        "order": item.order,
        "passwordHint": item.password_hint,
        "hidden": item.hidden,
        "note": item.note,
        "lastAccessedAt": item.last_accessed_at,
        "unlockPreset": unlock_preset,
        "keyCount": item.key_count,
        "passwordChange": item.password_change,
        "deleteUnfinished": item.delete_unfinished,
        "plainLeftover": item.plain_leftover,
        "plainRecords": item.plain_records,
        "outsideBackups": item.outside_backups,
    })
}

fn vault_list() -> RpcResponse {
    let root = match optional_vault_root() {
        Ok(Some(root)) => root,
        Ok(None) => return ok(json!({ "vaults": [] })),
        Err(response) => return response,
    };
    match list_vaults(&root) {
        Ok(items) => ok(json!({
            "vaults": items.iter().map(vault_list_item_json).collect::<Vec<_>>(),
        })),
        Err(error) => map_core_err(error),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultCreateParams {
    password: SecretString,
    #[serde(default)]
    unlock_preset: Option<KdfUnlockPreset>,
    settings: VaultConfig,
    #[serde(default)]
    welcome: Option<VaultWelcomeParams>,
    job: String,
    /// A phone import fills this vault next (`vault_ingest_*`); it stays
    /// recorded as unfinished until `vault_close` with `reason: "import"`.
    #[serde(default)]
    for_import: bool,
}

/// Localized `README.md` + the layout that opens it. Sent on scratch create and
/// on imports of ordinary files — never on a store `.zip` or a backup.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultWelcomeParams {
    readme: String,
    workspace: String,
}

impl VaultWelcomeParams {
    fn as_core(&self) -> VaultWelcome<'_> {
        VaultWelcome {
            readme: &self.readme,
            workspace: &self.workspace,
        }
    }
}

fn vault_create(params: Value) -> RpcResponse {
    let parsed: VaultCreateParams = match serde_json::from_value(params) {
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
    // Same trim `create_vault` persists — padded request ids still resolve via
    // `vault_dir`, but the returned row must be looked up with that folder id.
    let id = parsed.settings.vault.id.trim().to_string();
    match create_vault_as_job(
        &root,
        parsed.settings,
        parsed.password.as_bytes(),
        preset,
        parsed.welcome.as_ref().map(VaultWelcomeParams::as_core),
        parsed.for_import,
        &parsed.job,
    ) {
        Ok(()) => match vault_list_item(&root, &id) {
            Ok(item) => ok(json!({ "vault": vault_list_item_json(&item) })),
            Err(error) => map_core_err(error),
        },
        Err(error) => map_core_err(error),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultIdPasswordParams {
    id: String,
    #[serde(default)]
    password: Option<SecretString>,
}

/// Unlock for streaming an import. No desktop mount, so the file manager stays closed.
fn vault_ingest_open(params: Value) -> RpcResponse {
    let parsed: VaultIdPasswordParams = match serde_json::from_value(params) {
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
    match open_import_session(&root, parsed.id.trim(), password) {
        Ok(()) => ok(json!(null)),
        Err(error) => map_core_err(error),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultChangePasswordParams {
    id: String,
    current_password: SecretString,
    new_password: SecretString,
    /// The **Back up first** switch.
    back_up_first: bool,
    job: String,
}

/// A new key for a closed vault, every file rewritten with it.
fn vault_change_password(params: Value) -> RpcResponse {
    let parsed: VaultChangePasswordParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match change_vault_password(
        &root,
        parsed.id.trim(),
        parsed.current_password.as_bytes(),
        parsed.new_password.as_bytes(),
        parsed.back_up_first,
        &parsed.job,
    ) {
        Ok(changed) => ok(json!(changed)),
        Err(error) => map_core_err(error),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultPasswordChangeFinishParams {
    id: String,
    password: SecretString,
    job: String,
}

/// Rewrite the files an unfinished password change left on earlier keys.
fn vault_password_change_finish(params: Value) -> RpcResponse {
    let parsed: VaultPasswordChangeFinishParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match finish_password_change(
        &root,
        parsed.id.trim(),
        parsed.password.as_bytes(),
        &parsed.job,
    ) {
        Ok(finished) => ok(json!(finished)),
        Err(error) => map_core_err(error),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultJobParams {
    id: String,
    job: String,
}

/// The pass after an open: every blob's key copy made the header's, when
/// one is behind. Answers `done` at once when nothing is due.
fn vault_key_copies_update(params: Value) -> RpcResponse {
    let parsed: VaultJobParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match update_key_copies(&root, parsed.id.trim(), &parsed.job) {
        Ok(state) => ok(json!({ "keyCopies": state })),
        Err(error) => map_core_err(error),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultChangeKdfParams {
    id: String,
    current_password: SecretString,
    unlock_preset: KdfUnlockPreset,
    job: String,
}

fn vault_change_kdf(params: Value) -> RpcResponse {
    let parsed: VaultChangeKdfParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match change_vault_kdf(
        &root,
        parsed.id.trim(),
        parsed.current_password.as_bytes(),
        parsed.unlock_preset,
        &parsed.job,
    ) {
        Ok(changed) => ok(json!(changed)),
        Err(error) => map_core_err(error),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultRebuildParams {
    id: String,
    password: SecretString,
    job: String,
}

/// Rebuild a closed vault from its blobs: the header from their key copies,
/// the tree from their records and the backups.
fn vault_rebuild(params: Value) -> RpcResponse {
    let parsed: VaultRebuildParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match rebuild_vault(
        &root,
        parsed.id.trim(),
        parsed.password.as_bytes(),
        &parsed.job,
    ) {
        Ok(rebuilt) => ok(json!(rebuilt)),
        Err(error) => map_core_err(error),
    }
}

fn vault_close(params: Value) -> RpcResponse {
    let parsed: VaultCloseParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    let id = parsed.id.trim();
    let closed = match parsed.reason.as_deref().unwrap_or("user") {
        "user" => close_vault(&root, id),
        "auto" => close_vault_auto(&root, id),
        "now" => close_vault_now(&root, id),
        // A phone import whose files are all in.
        "import" => finish_import_session(&root, id),
        other => {
            return err(
                "invalid_request",
                format!("vault_close reason must be user, auto, now, or import, got {other}"),
            );
        }
    };
    match closed {
        Ok(outcome) => ok(json!({
            "backupFailed": outcome.backup_failed,
            "backupFailure": outcome.backup_failure,
            "backupSwitches": outcome.backup_switches,
            "plain": outcome.plain,
        })),
        Err(error) => map_core_err(error),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultCloseParams {
    id: String,
    #[serde(default)]
    reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultIdParams {
    id: String,
}

/// Where a vault's close stands: `state` is `open`, `closing`, or `closed`,
/// and `phase` (`flush` or `backup`) is the step of a running close, `null`
/// otherwise. Light: it answers while the close, or the quit, holds its lane.
fn vault_close_phase(params: Value) -> RpcResponse {
    let parsed: VaultIdParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match close_state(&root, parsed.id.trim()) {
        Ok(state) => {
            let phase = match state {
                CloseState::Closing(phase) => Some(phase.as_str()),
                CloseState::Open | CloseState::Closed => None,
            };
            ok(json!({ "state": state.as_str(), "phase": phase }))
        }
        Err(error) => map_core_err(error),
    }
}

/// Close now on a close that is already running. Light: it must answer while
/// that close holds its lane.
fn vault_close_hurry(params: Value) -> RpcResponse {
    let parsed: VaultIdParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match hurry_close(&root, parsed.id.trim()) {
        Ok(running) => ok(json!({ "running": running })),
        Err(error) => map_core_err(error),
    }
}

fn vault_disk_usage_rpc(params: Value) -> RpcResponse {
    let parsed: VaultIdParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match vault_disk_usage(&root, parsed.id.trim()) {
        Ok(usage) => ok(json!({
            "storeBytes": usage.store_bytes,
            "heldBytes": usage.held_bytes,
            "filesBytes": usage.files_bytes,
        })),
        Err(error) => map_core_err(error),
    }
}

/// Where an open vault's keys stand, for Info: `{ open: false }` while it
/// has no open session.
fn vault_key_status_rpc(params: Value) -> RpcResponse {
    let parsed: VaultIdParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match vault_key_status(&root, parsed.id.trim()) {
        Ok(Some(status)) => ok(json!({
            "open": true,
            "filesWaiting": status.files_waiting,
            "keyCopiesDue": status.key_copies_due,
            "keyCopiesUpdating": status.key_copies_updating,
        })),
        Ok(None) => ok(json!({ "open": false })),
        Err(error) => map_core_err(error),
    }
}

fn vault_config_get(params: Value) -> RpcResponse {
    let parsed: VaultIdParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    let dir = match root.vault_dir(parsed.id.trim()) {
        Ok(dir) => dir,
        Err(error) => return map_core_err(error),
    };
    // `Path::is_dir` / `exists` look at the real filesystem. A storage-access
    // vault lives at the logical `/upriv-saf-root/...` path, so those checks
    // are false even when the vault is listed.
    if !dir.host_is_dir() {
        return map_core_err(upriv_core::UprivError::VaultNotFound(dir));
    }
    match load_vault_config(&dir) {
        Ok(config) => match serde_json::to_value(&config) {
            Ok(settings) => ok(json!({ "settings": settings })),
            Err(error) => err("invalid_request", error.to_string()),
        },
        Err(upriv_core::UprivError::VaultConfigInvalid { path, .. }) if !path.host_exists() => {
            map_core_err(upriv_core::UprivError::VaultNotFound(dir))
        }
        Err(error) => map_core_err(error),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultConfigSaveParams {
    id: String,
    /// The settings as the window holds them. Their folder lists are not
    /// read: `lists` carries what changed in them.
    settings: VaultConfig,
    #[serde(default)]
    lists: upriv_core::VaultListChanges,
}

fn vault_config_save(params: Value) -> RpcResponse {
    let parsed: VaultConfigSaveParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    let id = parsed.id.trim();
    let dir = match root.vault_dir(id) {
        Ok(dir) => dir,
        Err(error) => return map_core_err(error),
    };
    if !dir.host_is_dir() {
        return map_core_err(upriv_core::UprivError::VaultNotFound(dir));
    }
    match upriv_core::save_vault_config_checked(&root, id, &parsed.settings, &parsed.lists) {
        Ok(saved) => ok(json!({ "id": id, "keptFolders": saved.kept_folders })),
        Err(error) => map_core_err(error),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultRenameParams {
    id: String,
    display_name: String,
}

fn vault_rename(params: Value) -> RpcResponse {
    let parsed: VaultRenameParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match rename_vault(&root, parsed.id.trim(), &parsed.display_name) {
        Ok(result) => ok(json!({
            "id": result.id,
            "previousId": result.previous_id,
            "displayName": result.display_name,
            "idChanged": result.id_changed,
        })),
        Err(error) => map_core_err(error),
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct AppSettingsSaveParams {
    /// Nested `AppSettings` (snake_case sections: `ui`, `logging`, `app`). Its
    /// folder lists are not read: `lists` carries what changed in them.
    settings: AppSettings,
    #[serde(default)]
    lists: upriv_core::AppListChanges,
}

fn app_settings_save(params: Value) -> RpcResponse {
    let parsed: AppSettingsSaveParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let settings = parsed.settings;
    match save_app_settings_session(&settings, &parsed.lists) {
        Ok(saved) => {
            let wrote = saved.is_some();
            // Re-open the writer so `[logging]` changes apply at once.
            let _ = ensure_logging_session();
            log_event(
                LogLevel::Info,
                "settings_save",
                &[
                    ("wrote", if wrote { "true" } else { "false" }),
                    ("locale", settings.ui.locale.as_str()),
                    ("theme", settings.ui.theme.as_str()),
                    (
                        "log_enabled",
                        if settings.logging.enabled {
                            "true"
                        } else {
                            "false"
                        },
                    ),
                    ("log_level", settings.logging.level.as_str()),
                ],
            );
            let saved = saved.unwrap_or_default();
            ok(json!({
                "wrote": wrote,
                "unchangedVaults": saved.unchanged_vaults,
                "keptFolders": saved.kept_folders,
            }))
        }
        Err(error) => {
            // Code only. The Display string of a settings error includes a path.
            log_event(LogLevel::Error, "settings_save_failed", &[]);
            map_core_err_response(error, false)
        }
    }
}

fn replace_policy_str(policy: IncompleteReplacePolicy) -> &'static str {
    match policy {
        IncompleteReplacePolicy::ResetSettings => "reset_settings",
        IncompleteReplacePolicy::Rename => "rename",
        IncompleteReplacePolicy::Delete => "delete",
    }
}

/// Disk fields for an RPC failure. The code only — never the Display string.
fn rpc_error_log_fields(code: &str) -> [(&str, &str); 1] {
    [("code", code)]
}

fn current_root_path_for_log() -> Option<String> {
    let loaded = load_app_settings().ok()?;
    let root = loaded.root_path?;
    root.to_str().map(str::to_string)
}

fn root_paths_equal(a: &str, b: &str) -> bool {
    if a == b {
        return true;
    }
    let pa = Path::new(a);
    let pb = Path::new(b);
    match (pa.canonicalize(), pb.canonicalize()) {
        (Ok(ca), Ok(cb)) => ca == cb,
        _ => false,
    }
}

fn leave_then_reopen_logging(
    prev_logger: Option<&Logger>,
    from: Option<&str>,
    to: &str,
    source: &str,
) {
    if let (Some(logger), Some(from)) = (prev_logger, from) {
        if !root_paths_equal(from, to) {
            log_vault_root_leaving_on(logger, from, to, source);
        }
    }
    let _ = ensure_logging_session();
}

fn log_vault_root_setup(
    source: &str,
    created: bool,
    prior_status: VaultRootDirStatus,
    replace: Option<IncompleteReplacePolicy>,
    root_path: &str,
    from_path: Option<&str>,
) {
    if prior_status == VaultRootDirStatus::Incomplete {
        if let Some(policy) = replace {
            log_event(
                LogLevel::Warn,
                "vault_root_replace_incomplete",
                &[("policy", replace_policy_str(policy)), ("source", source)],
            );
        }
    }
    log_app_start("vault_root_setup");
    if let Some(from) = from_path.filter(|from| !root_paths_equal(from, root_path)) {
        // Entered writes on the new root (session already points there after setup).
        log_vault_root_entered(from, root_path, source);
    } else {
        log_vault_root_ready(source, root_path);
    }
    log_event(
        LogLevel::Info,
        "vault_root_setup",
        &[
            ("source", source),
            ("created", if created { "true" } else { "false" }),
            ("prior", vault_root_status_str(prior_status)),
            ("path", root_path),
        ],
    );
}

fn map_core_err(error: upriv_core::UprivError) -> RpcResponse {
    map_core_err_response(error, true)
}

fn map_core_err_response(error: upriv_core::UprivError, emit_log: bool) -> RpcResponse {
    let (code, path) = match &error {
        upriv_core::UprivError::VaultRootNotFound(p) => ("vault_root_not_found", Some(p.as_path())),
        upriv_core::UprivError::VaultRootIncomplete { path, .. } => {
            ("vault_root_incomplete", Some(path.as_path()))
        }
        upriv_core::UprivError::DataFolderListInvalid { .. } => ("data_folder_list_invalid", None),
        upriv_core::UprivError::DataFolderUnavailable(_) => ("data_folder_unavailable", None),
        upriv_core::UprivError::VaultRootBusy => ("vault_root_busy", None),
        upriv_core::UprivError::VaultNotFound(p) => ("vault_not_found", Some(p.as_path())),
        upriv_core::UprivError::VaultConfigInvalid { path, .. } => {
            ("vault_config_invalid", Some(path.as_path()))
        }
        upriv_core::UprivError::VaultConfigBusy { .. } => ("vault_config_busy", None),
        upriv_core::UprivError::VaultGroupsInvalid { path, .. } => {
            ("vault_groups_invalid", Some(path.as_path()))
        }
        upriv_core::UprivError::VaultGroupNotFound(_) => ("vault_group_not_found", None),
        upriv_core::UprivError::VaultAlreadyExists(p) => {
            ("vault_already_exists", Some(p.as_path()))
        }
        upriv_core::UprivError::WrongPassword => ("wrong_password", None),
        upriv_core::UprivError::VaultAlreadyOpen(_) => ("vault_already_open", None),
        upriv_core::UprivError::VaultNotOpen(_) => ("vault_not_open", None),
        upriv_core::UprivError::VaultUnlockBlocked { .. } => ("vault_unlock_blocked", None),
        upriv_core::UprivError::InsufficientRam => ("insufficient_ram", None),
        upriv_core::UprivError::InsufficientRamExport => ("insufficient_ram_export", None),
        upriv_core::UprivError::VaultStoreInvalid { path, .. } => {
            ("vault_store_invalid", Some(path.as_path()))
        }
        upriv_core::UprivError::PlainDestinationInvalid { path, .. } => {
            ("plain_destination_invalid", Some(path.as_path()))
        }
        upriv_core::UprivError::PlainLeftover => ("plain_leftover", None),
        upriv_core::UprivError::PlainNamesUnsupported { .. } => ("plain_names_unsupported", None),
        upriv_core::UprivError::PlainSpaceShort { .. } => ("plain_space_short", None),
        upriv_core::UprivError::PlainFolderUnwritable { .. } => ("plain_folder_unwritable", None),
        upriv_core::UprivError::UnlockedFolderUnset => ("unlocked_folder_unset", None),
        upriv_core::UprivError::UnlockedFolderUnavailable(p) => {
            ("unlocked_folder_unavailable", Some(p.as_path()))
        }
        upriv_core::UprivError::PlainFolderUnreachable { .. } => ("plain_folder_unreachable", None),
        upriv_core::UprivError::FolderListInvalid { .. } => ("folder_list_invalid", None),
        upriv_core::UprivError::FolderPathRefused { issue, .. } => (
            match issue {
                upriv_core::folder_list::PathIssue::Reserved => "folder_path_reserved",
                upriv_core::folder_list::PathIssue::Overlap => "folder_overlap",
                upriv_core::folder_list::PathIssue::Empty
                | upriv_core::folder_list::PathIssue::NotAbsolute => "folder_path_invalid",
            },
            None,
        ),
        upriv_core::UprivError::FolderPathDuplicate { .. } => ("folder_path_duplicate", None),
        upriv_core::UprivError::FolderInUse { .. } => ("folder_in_use", None),
        upriv_core::UprivError::MountDriverMissing => ("vault_mount_driver_missing", None),
        upriv_core::UprivError::MountFilesystemUnsupported(p) => {
            ("vault_mount_filesystem", Some(p.as_path()))
        }
        upriv_core::UprivError::BackupUnavailable(_) => ("backup_unavailable", None),
        upriv_core::UprivError::BackupNameInvalid => ("backup_name_invalid", None),
        upriv_core::UprivError::LogFileTooLarge { path, .. } => {
            ("log_file_too_large", Some(path.as_path()))
        }
        upriv_core::UprivError::VaultPathNotFound(_) => ("vault_path_not_found", None),
        upriv_core::UprivError::VaultPathExists(_) => ("vault_path_exists", None),
        upriv_core::UprivError::VaultHeldNotFound(_) => ("vault_held_not_found", None),
        upriv_core::UprivError::VaultFileTooLarge { path, .. } => {
            ("vault_file_too_large", Some(path.as_path()))
        }
        upriv_core::UprivError::VaultFileUnreadable { .. } => ("vault_file_unreadable", None),
        upriv_core::UprivError::VaultIndexUnreadable { .. } => ("vault_index_unreadable", None),
        upriv_core::UprivError::VaultIndexReadable => ("vault_index_readable", None),
        upriv_core::UprivError::VaultHeaderUnreadable => ("vault_header_unreadable", None),
        upriv_core::UprivError::PasswordOutdated => ("password_outdated", None),
        upriv_core::UprivError::PasswordChangeInterrupted => ("password_change_interrupted", None),
        upriv_core::UprivError::PasswordChangeSpaceShort { .. } => {
            ("password_change_space_short", None)
        }
        upriv_core::UprivError::VaultDeleting => ("vault_deleting", None),
        upriv_core::UprivError::VaultLocked(p) => ("vault_locked", Some(p.as_path())),
        upriv_core::UprivError::VaultMountFailed(_) => ("vault_mount_failed", None),
        upriv_core::UprivError::ImportArchiveNotFound(p) => {
            ("import_archive_not_found", Some(p.as_path()))
        }
        upriv_core::UprivError::ImportSourceUnreadable(p) => {
            ("import_source_unreadable", Some(p.as_path()))
        }
        upriv_core::UprivError::VaultMustBeClosed => ("vault_must_be_closed", None),
        upriv_core::UprivError::VaultBusy => ("vault_busy", None),
        upriv_core::UprivError::PasswordUnchanged => ("password_unchanged", None),
        upriv_core::UprivError::UnlockRamUnchanged => ("unlock_ram_unchanged", None),
        upriv_core::UprivError::JobCancelled => ("job_cancelled", None),
        upriv_core::UprivError::JobIdInvalid => ("invalid_request", None),
        upriv_core::UprivError::JobNotStoppable => ("job_not_stoppable", None),
        upriv_core::UprivError::DataFolderBusy => ("data_folder_busy", None),
        upriv_core::UprivError::DataFolderExportBusy => ("data_folder_export_busy", None),
        upriv_core::UprivError::BackupExporting => ("backup_exporting", None),
        upriv_core::UprivError::DataFolderExportSpaceShort { .. } => {
            ("data_folder_export_space_short", None)
        }
        upriv_core::UprivError::ExportDestinationReserved(p) => {
            ("export_destination_reserved", Some(p.as_path()))
        }
        upriv_core::UprivError::DataFolderExportNameInvalid => {
            ("data_folder_export_name_invalid", None)
        }
        upriv_core::UprivError::DataFolderExportNameTaken(p) => {
            ("data_folder_export_name_taken", Some(p.as_path()))
        }
        upriv_core::UprivError::DeviceUnknown => ("device_unknown", None),
        upriv_core::UprivError::VaultPlainElsewhere { .. } => ("vault_plain_elsewhere", None),
        upriv_core::UprivError::Io(io) if upriv_core::host_fs::is_unreachable(io) => {
            ("vault_root_unreachable", None)
        }
        upriv_core::UprivError::Io(_) => ("io_error", None),
    };
    let message = error.to_string();
    if emit_log {
        let level = match code {
            "vault_root_incomplete"
            | "vault_root_busy"
            | "wrong_password"
            | "password_outdated"
            | "password_change_interrupted"
            | "vault_unlock_blocked"
            | "password_unchanged"
            | "unlock_ram_unchanged"
            | "job_cancelled"
            | "job_not_stoppable" => LogLevel::Warn,
            _ => LogLevel::Error,
        };
        // `message` stays on the RPC response for the person at the screen.
        // It must not be written under `.upriv/logs/`: Display text for
        // `VaultPathNotFound`, `VaultPathExists`, `VaultFileTooLarge`, and
        // some `VaultStoreInvalid` values is the logical path inside the vault.
        log_event(level, "rpc_error", &rpc_error_log_fields(code));
    }
    let details = match &error {
        upriv_core::UprivError::VaultUnlockBlocked { retry_after_secs } => {
            Some(json!({ "retryAfterSecs": retry_after_secs }))
        }
        upriv_core::UprivError::VaultConfigBusy { target } => Some(json!({ "target": target })),
        upriv_core::UprivError::VaultFileTooLarge { size, max, .. } => {
            Some(json!({ "size": size, "max": max }))
        }
        upriv_core::UprivError::VaultFileUnreadable { problem, .. } => {
            Some(json!({ "problem": problem.as_str() }))
        }
        upriv_core::UprivError::PlainDestinationInvalid { reason, .. } => {
            let path = path.and_then(|p| p.to_str()).unwrap_or("");
            Some(json!({ "path": path, "reason": reason.as_str() }))
        }
        upriv_core::UprivError::PlainNamesUnsupported { count, examples } => {
            Some(json!({ "count": count, "examples": examples }))
        }
        upriv_core::UprivError::PlainSpaceShort { needed, available }
        | upriv_core::UprivError::DataFolderExportSpaceShort { needed, available }
        | upriv_core::UprivError::PasswordChangeSpaceShort { needed, available } => {
            Some(json!({ "needed": needed, "available": available }))
        }
        upriv_core::UprivError::PlainFolderUnwritable { count } => Some(json!({ "count": count })),
        upriv_core::UprivError::VaultPlainElsewhere {
            device,
            system,
            path,
        }
        | upriv_core::UprivError::PlainFolderUnreachable {
            device,
            system,
            path,
        } => Some(json!({ "device": device, "system": system, "path": path })),
        upriv_core::UprivError::FolderPathRefused { path, issue } => {
            Some(json!({ "path": path, "issue": issue.as_str() }))
        }
        upriv_core::UprivError::FolderPathDuplicate { path }
        | upriv_core::UprivError::FolderInUse { path } => Some(json!({ "path": path })),
        upriv_core::UprivError::BackupUnavailable(reason)
        | upriv_core::UprivError::DataFolderUnavailable(reason) => {
            Some(json!({ "reason": reason.as_str() }))
        }
        _ => path.and_then(|p| p.to_str().map(|s| json!({ "path": s }))),
    };
    err_with_details(code, message, details)
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

/// Pin `default_root` to one temporary app home for the whole test process.
/// `cargo test` runs inside `dev/`, where discovery would otherwise reach the
/// developer's own data folder. Call it before a test touches `upriv_core`.
#[cfg(test)]
pub(crate) fn isolate_app_home() {
    static APP_HOME: std::sync::OnceLock<tempfile::TempDir> = std::sync::OnceLock::new();
    APP_HOME.get_or_init(|| {
        let home = tempfile::tempdir().expect("test app home");
        std::env::set_var("UPRIV_DEFAULT_ROOT_ANCHOR", home.path());
        home
    });
}

#[cfg(test)]
mod log_redaction_tests {
    use super::rpc_error_log_fields;

    #[test]
    fn rpc_error_log_fields_carry_the_code_and_not_a_logical_path() {
        let canary = "CANARY-merger-filename.xlsx";
        let shown = upriv_core::UprivError::VaultPathNotFound(canary.into()).to_string();
        assert!(shown.contains(canary), "{shown}");
        let fields = rpc_error_log_fields("vault_path_not_found");
        assert_eq!(fields, [("code", "vault_path_not_found")]);
        let rendered = format!("{fields:?}");
        assert!(!rendered.contains(canary));
        assert!(!rendered.contains("message"));
    }
}

#[cfg(test)]
mod error_mapping_tests {
    use serde_json::json;
    use upriv_core::store::FileProblem;

    #[test]
    fn an_unreadable_file_carries_its_problem_and_no_path_in_details() {
        for (problem, wire) in [
            (FileProblem::Missing, "missing"),
            (FileProblem::Damaged, "damaged"),
        ] {
            let response = super::map_core_err_response(
                upriv_core::UprivError::VaultFileUnreadable {
                    path: "docs/a.txt".into(),
                    problem,
                },
                false,
            );
            let error = response.error.unwrap();
            assert_eq!(error.code, "vault_file_unreadable");
            assert_eq!(error.details, Some(json!({ "problem": wire })));
        }
    }

    #[test]
    fn a_held_file_that_cannot_be_put_back_has_its_own_code() {
        let response = super::map_core_err_response(
            upriv_core::UprivError::VaultHeldNotFound("x.blob".into()),
            false,
        );
        assert_eq!(response.error.unwrap().code, "vault_held_not_found");
    }

    #[test]
    fn held_calls_need_names() {
        crate::isolate_app_home();
        for method in ["vault_fs_held_restore", "vault_fs_held_delete"] {
            let response = super::handle_rpc(super::RpcRequest {
                method: method.into(),
                params: json!({ "id": "notes", "names": [] }),
            });
            assert_eq!(response.error.unwrap().code, "invalid_request", "{method}");
        }
    }
}

/// Registered methods match `rpc-methods.json` (`core`, `mobileOnly`, `desktopOnly`).
#[cfg(test)]
mod contract_tests {
    use super::*;
    use serde::Deserialize;
    use serde_json::json;

    /// [`super::handle_rpc`] inside the test app home ([`crate::isolate_app_home`]).
    fn handle_rpc(req: RpcRequest) -> RpcResponse {
        crate::isolate_app_home();
        super::handle_rpc(req)
    }

    #[test]
    fn shutdown_is_now_only_for_the_close_now_flag() {
        assert!(shutdown_is_now(&json!({ "now": true })));
        assert!(!shutdown_is_now(&json!({ "now": false })));
        assert!(!shutdown_is_now(&json!({})));
        // Params it cannot read mean the full close.
        assert!(!shutdown_is_now(&json!({ "now": "yes" })));
        assert!(!shutdown_is_now(&json!({ "hurry": true })));
    }

    const REGISTERED_METHODS: &[&str] = &[
        "app_version",
        "app_shutdown",
        "device_info",
        "device_identity_set",
        "device_trees",
        "folder_status",
        "app_settings_get",
        "app_settings_save",
        "vault_root_resolve",
        "vault_root_suggested_custom_path",
        "data_folder_list",
        "data_folder_apply",
        "data_folder_search",
        "log_list",
        "log_get",
        "log_delete",
        "log_event",
        "vault_group_list",
        "vault_group_create",
        "vault_group_update",
        "vault_group_delete",
        "vault_group_set_collapsed",
        "vault_group_reorder",
        "vault_group_reorder_grouped_vaults",
        "vault_group_repair",
        "vault_list",
        "vault_create",
        "vault_open",
        "vault_plain_destination",
        "vault_plain_leftover",
        "vault_plain_remove",
        "vault_plain_sync",
        "vault_plain_status",
        "vault_plain_deletions",
        "vault_plain_send",
        "vault_plain_unsend",
        "plain_record_forget",
        "vault_unlocked_folder_attach",
        "vault_unlocked_folder_info",
        "vault_close",
        "vault_change_password",
        "vault_password_change_finish",
        "vault_change_kdf",
        "vault_key_copies_update",
        "vault_rebuild",
        "vault_close_phase",
        "vault_close_hurry",
        "vault_export_capabilities",
        "vault_config_get",
        "vault_disk_usage",
        "vault_key_status",
        "vault_config_save",
        "vault_rename",
        "vault_delete",
        "vault_delete_hurry",
        "vault_export",
        "vault_unfinished_sweep",
        "vault_import_zip",
        "vault_import_7z",
        "vault_import_files_zip",
        "vault_import_os_path",
        "vault_ingest_open",
        "vault_ingest_directory",
        "vault_discard_import",
        "vault_import_probe",
        "vault_fs_list",
        "vault_fs_held",
        "vault_fs_held_restore",
        "vault_fs_held_delete",
        "vault_fs_revision",
        "vault_fs_preview_fits",
        "vault_fs_read",
        "vault_fs_read_range",
        "vault_fs_write",
        "vault_fs_write_range",
        "vault_fs_import_os_file",
        "vault_fs_truncate",
        "vault_fs_create_file",
        "vault_fs_create_folder",
        "vault_fs_ensure_folder",
        "vault_fs_delete",
        "vault_fs_rename",
        "vault_fs_os_path",
        "vault_fs_move",
        "backup_list",
        "backup_rename",
        "backup_folder_forget",
        "backup_delete",
        "backup_promote",
        "backup_save",
        "backup_export",
        "data_folder_export",
        "job_status",
        "job_cancel",
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

    fn call(method: &str, params: Value) -> RpcResponse {
        handle_rpc(RpcRequest {
            method: method.into(),
            params,
        })
    }

    fn error_code(response: &RpcResponse) -> Option<&str> {
        response.error.as_ref().map(|e| e.code.as_str())
    }

    #[test]
    fn a_job_that_is_not_running_reports_so() {
        let status = call("job_status", json!({ "job": "rpc-never-started" }));
        assert_eq!(
            status.result,
            Some(json!({
                "running": false,
                "bytesDone": 0,
                "bytesTotal": 0,
                "stoppable": true,
                "step": null,
            }))
        );
        let cancel = call(
            "job_cancel",
            json!({ "job": "rpc-never-started", "by": "user" }),
        );
        assert_eq!(cancel.result, Some(json!({ "stopping": false })));
        let by_auto_close = call(
            "job_cancel",
            json!({ "job": "rpc-never-started-2", "by": "auto_close" }),
        );
        assert_eq!(by_auto_close.result, Some(json!({ "stopping": false })));
        let malformed = call("job_cancel", json!({ "job": "a/b", "by": "user" }));
        assert_eq!(error_code(&malformed), Some("invalid_request"));
        let timeout = call(
            "job_cancel",
            json!({ "job": "rpc-never-started", "by": "timeout" }),
        );
        assert_eq!(error_code(&timeout), Some("invalid_request"));
        // A stop names who asked for it.
        let unnamed = call("job_cancel", json!({ "job": "rpc-never-started" }));
        assert_eq!(error_code(&unnamed), Some("invalid_request"));
        let unknown = call("job_cancel", json!({ "job": "x", "by": "admin" }));
        assert_eq!(error_code(&unknown), Some("invalid_request"));
        for method in ["job_status", "job_cancel"] {
            assert_eq!(
                error_code(&call(method, json!({}))),
                Some("invalid_request")
            );
        }
    }

    #[test]
    fn long_jobs_need_a_job_id() {
        for (method, params) in [
            (
                "vault_export",
                json!({ "id": "notes", "destPath": "/media/usb/Notes.zip" }),
            ),
            ("backup_save", json!({ "id": "notes" })),
            (
                "backup_export",
                json!({ "id": "notes", "keys": ["data/20260101000000-notes.zip"], "destDir": "/media/usb" }),
            ),
            ("vault_unlocked_folder_attach", json!({ "id": "notes" })),
            (
                "data_folder_export",
                json!({ "destDir": "/media/usb", "name": "copy" }),
            ),
            ("data_folder_search", json!({})),
        ] {
            assert_eq!(
                error_code(&call(method, params)),
                Some("invalid_request"),
                "{method}"
            );
        }
    }

    #[test]
    fn a_vault_export_needs_a_folder_to_write_into() {
        let response = call(
            "vault_export",
            json!({ "id": "notes", "job": "rpc-export" }),
        );
        assert_eq!(error_code(&response), Some("invalid_request"));
        for dest_dir in ["  ", "relative/folder"] {
            let refused = call(
                "vault_export",
                json!({ "id": "notes", "destDir": dest_dir, "job": "rpc-export" }),
            );
            assert_eq!(error_code(&refused), Some("invalid_request"), "{dest_dir}");
        }
    }

    #[test]
    fn a_plain_text_export_needs_a_folder_and_a_job_like_the_others() {
        let no_job = call(
            "vault_export",
            json!({ "id": "notes", "format": "plain_zip", "destDir": "/media/usb" }),
        );
        assert_eq!(error_code(&no_job), Some("invalid_request"));
        let relative = call(
            "vault_export",
            json!({
                "id": "notes",
                "format": "plain_zip",
                "destDir": "relative/folder",
                "job": "rpc-export",
                "includeWorkspace": true,
                "includeSettings": false,
            }),
        );
        assert_eq!(error_code(&relative), Some("invalid_request"));
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

    #[test]
    fn data_folder_export_needs_a_zip_name() {
        let dest = std::env::temp_dir();
        let response = handle_rpc(RpcRequest {
            method: "data_folder_export".into(),
            params: json!({ "destDir": dest.to_str().expect("utf-8 temp dir") }),
        });
        assert_eq!(
            response.error.as_ref().map(|e| e.code.as_str()),
            Some("invalid_request")
        );
    }

    #[test]
    fn registered_methods_match_shared_contract() {
        #[derive(Deserialize)]
        struct RpcMethodContract {
            core: Vec<String>,
            #[serde(rename = "mobileOnly")]
            mobile_only: Vec<String>,
            #[serde(rename = "desktopOnly")]
            desktop_only: Vec<String>,
        }
        let contract: RpcMethodContract = serde_json::from_str(include_str!(
            "../../../apps/shared/src/domain/core-rpc/tests/rpc-methods.json"
        ))
        .expect("rpc-methods.json");
        let mut expected = contract.core;
        expected.extend(contract.mobile_only);
        expected.extend(contract.desktop_only);
        expected.sort();
        let mut registered: Vec<String> = REGISTERED_METHODS
            .iter()
            .map(|s| (*s).to_string())
            .collect();
        registered.sort();
        assert_eq!(registered, expected);
    }

    #[test]
    fn log_event_vault_hidden_has_no_name_fields() {
        let ok_response = handle_rpc(RpcRequest {
            method: "log_event".into(),
            params: json!({ "event": "vault_hidden" }),
        });
        assert!(ok_response.ok, "{ok_response:?}");

        let other = handle_rpc(RpcRequest {
            method: "log_event".into(),
            params: json!({ "event": "app_start" }),
        });
        assert_eq!(
            other.error.as_ref().map(|e| e.code.as_str()),
            Some("invalid_request")
        );

        let crash = handle_rpc(RpcRequest {
            method: "log_event".into(),
            params: json!({ "event": "ui_crash" }),
        });
        assert!(crash.ok, "{crash:?}");

        let group_hidden = handle_rpc(RpcRequest {
            method: "log_event".into(),
            params: json!({ "event": "vault_group_hidden" }),
        });
        assert!(group_hidden.ok, "{group_hidden:?}");

        let wipe_failed = handle_rpc(RpcRequest {
            method: "log_event".into(),
            params: json!({ "event": "import_cache_wipe_failed" }),
        });
        assert!(wipe_failed.ok, "{wipe_failed:?}");

        let wipe_with_path = handle_rpc(RpcRequest {
            method: "log_event".into(),
            params: json!({ "event": "import_cache_wipe_failed", "path": "/tmp/x" }),
        });
        assert_eq!(
            wipe_with_path.error.as_ref().map(|e| e.code.as_str()),
            Some("invalid_request")
        );

        let with_name = handle_rpc(RpcRequest {
            method: "log_event".into(),
            params: json!({ "event": "vault_hidden", "name": "Secret" }),
        });
        assert_eq!(
            with_name.error.as_ref().map(|e| e.code.as_str()),
            Some("invalid_request")
        );
    }

    fn bootstrap(locale: Option<&str>) -> BootstrapPrefsParams {
        BootstrapPrefsParams {
            locale: locale.map(|s| s.to_string()),
        }
    }

    #[test]
    fn bootstrap_prefs_need_a_locale() {
        assert!(bootstrap_prefs(None).is_err());
        assert!(bootstrap_prefs(Some(&bootstrap(None))).is_err());
        assert!(bootstrap_prefs(Some(&bootstrap(Some("")))).is_err());
        assert!(bootstrap_prefs(Some(&bootstrap(Some("   ")))).is_err());
        assert_eq!(
            bootstrap_prefs(Some(&bootstrap(Some("  es  "))))
                .unwrap()
                .locale
                .as_deref(),
            Some("es")
        );
    }

    #[test]
    fn data_folder_apply_needs_a_locale_and_a_job_to_adopt() {
        let no_locale = call("data_folder_apply", json!({}));
        assert_eq!(error_code(&no_locale), Some("invalid_request"));
        let no_job = call(
            "data_folder_apply",
            json!({ "bootstrap": { "locale": "en" }, "adoptPrivateRoot": true }),
        );
        assert_eq!(error_code(&no_job), Some("invalid_request"));
        let no_policy = call(
            "data_folder_apply",
            json!({ "bootstrap": { "locale": "en" }, "replaceIncomplete": true }),
        );
        assert_eq!(error_code(&no_policy), Some("invalid_request"));
    }

    #[test]
    fn the_data_folder_list_answers_with_defaults_folder() {
        let listed = call("data_folder_list", json!({}));
        let result = listed.result.expect("result");
        assert!(result["defaultFolder"].is_string(), "{result}");
        assert!(result["list"].is_object(), "{result}");
    }

    #[test]
    fn a_data_folder_row_status_needs_no_data_folder_in_use() {
        let dir = tempfile::tempdir().unwrap();
        let status = call(
            "folder_status",
            json!({ "list": "data_folder", "path": dir.path().to_str().unwrap() }),
        );
        let result = status.result.expect("result");
        assert_eq!(result["state"], "ok");
        assert_eq!(result["content"], "empty");
        let refused = call(
            "folder_status",
            json!({ "list": "data_folder", "path": "relative" }),
        );
        assert_eq!(refused.result.expect("result")["state"], "refused");
        let no_path = call("folder_status", json!({ "list": "backup" }));
        assert_eq!(error_code(&no_path), Some("invalid_request"));
    }

    #[test]
    fn replace_policy_flag_accepts_every_wire_policy() {
        for policy in [
            IncompleteReplacePolicy::ResetSettings,
            IncompleteReplacePolicy::Rename,
            IncompleteReplacePolicy::Delete,
        ] {
            let wire = replace_policy_str(policy);
            assert_eq!(
                parse_replace_policy_flag(true, Some(wire)).unwrap(),
                Some(policy)
            );
        }
        assert_eq!(
            parse_replace_policy_flag(false, Some("bogus")).unwrap(),
            None
        );
        assert!(parse_replace_policy_flag(true, Some("bogus")).is_err());
        assert!(parse_replace_policy_flag(true, None).is_err());
    }

    #[test]
    fn data_folder_apply_refuses_while_vault_session_open() {
        crate::isolate_app_home();
        let dir = tempfile::tempdir().unwrap();
        upriv_core::initialize_vault_root(dir.path()).unwrap();
        let root = upriv_core::VaultRoot::discover(dir.path()).unwrap();
        let cfg = upriv_core::VaultConfig {
            vault: upriv_core::config::VaultIdentitySection {
                id: "busy-root".into(),
                display_name: "Busy Root".into(),
                order: 1,
                note: String::new(),
                hidden: false,
                password_hint: String::new(),
            },
            storage: upriv_core::VaultStorageSection::default(),
            unlocked_folder: Default::default(),
            backup: Default::default(),
            security: Default::default(),
            auto_close: Default::default(),
            file_manager: Default::default(),
            seven_zip: Default::default(),
            deleting: None,
        };
        upriv_core::create_vault(
            &root,
            cfg,
            b"pass-word-ok",
            upriv_core::KdfUnlockPreset::M32,
        )
        .expect("create");
        upriv_core::open_vault(&root, "busy-root", b"pass-word-ok").expect("open");

        let blocked = call(
            "data_folder_apply",
            json!({ "bootstrap": { "locale": "en" } }),
        );
        assert_eq!(error_code(&blocked), Some("vault_root_busy"), "{blocked:?}");

        upriv_core::close_vault(&root, "busy-root").expect("close");
        // The list is left alone: the app home is shared by every test here.
        let after = call(
            "data_folder_apply",
            json!({ "bootstrap": { "locale": "en" }, "replaceIncomplete": true }),
        );
        assert_ne!(
            after.error.as_ref().map(|e| e.code.as_str()),
            Some("vault_root_busy"),
            "idle setup must not return vault_root_busy: {after:?}"
        );
    }
}
