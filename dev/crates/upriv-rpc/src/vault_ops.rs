//! Vault file / backup / delete / import RPC handlers.

use std::path::Path;

use serde::Deserialize;
use serde_json::{json, Value};
use upriv_core::{
    abort_import_vault, close_all_vaults, close_all_vaults_now, delete_backups, delete_vault,
    export_backups, export_logical_seven_zip, export_plain_zip, export_store_zip, fs_create_file,
    fs_create_folder, fs_delete, fs_ensure_folder, fs_import_from_os_path, fs_list_tree, fs_move,
    fs_os_path, fs_preview_fits, fs_read_file, fs_read_range, fs_rename, fs_tree_revision,
    fs_truncate, fs_write_file, import_logical_files_zip, import_logical_files_zip_path,
    import_logical_os_path, import_logical_seven_zip, import_logical_seven_zip_path,
    import_store_from_archive_path, import_store_zip, ingest_import_directory, list_backups,
    parse_backup_import_path, parse_embedded_settings, probe_import_zip_bytes,
    probe_import_zip_path, probe_logical_seven_zip, probe_logical_seven_zip_path, probe_store_zip,
    promote_backup_save, read_import_archive_bytes, read_import_zip_settings, read_zip_config_toml,
    save_backup_now, seven_zip_export_available, sweep_plain_exports, vault_list_item, BackupEntry,
    ExportInclude, ImportExtras, ImportZipProbe, KdfUnlockPreset, VaultConfig, ZipImportClass,
};

use super::secret::{secret_bytes, SecretString};
use super::{
    err, map_core_err, ok, optional_vault_root, path_utf8, require_vault_root, RpcResponse,
};
#[cfg(unix)]
use upriv_core::ingest_import_reader;

fn b64_encode(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn b64_decode(raw: &str) -> Result<Vec<u8>, RpcResponse> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(raw.trim())
        .map_err(|error| err("invalid_request", format!("invalid base64: {error}")))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultIdParams {
    id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultFsPathParams {
    id: String,
    path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultFsWriteParams {
    id: String,
    path: String,
    content_b64: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultFsRangeParams {
    id: String,
    path: String,
    offset: u64,
    #[serde(default)]
    len: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultFsWriteRangeParams {
    id: String,
    path: String,
    offset: u64,
    content_b64: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultFsTruncateParams {
    id: String,
    path: String,
    size: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultFsCreateParams {
    id: String,
    parent_path: String,
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultFsImportOsFileParams {
    id: String,
    parent_path: String,
    name: String,
    os_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultFsRenameParams {
    id: String,
    path: String,
    new_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultFsMoveParams {
    id: String,
    from_path: String,
    to_folder_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BackupStampsParams {
    id: String,
    stamps: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BackupStampParams {
    id: String,
    stamp: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BackupExportParams {
    id: String,
    stamps: Vec<String>,
    dest_dir: String,
    /// Names this export for `job_status` and `job_cancel`.
    job: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultExportParams {
    id: String,
    #[serde(default)]
    format: Option<String>,
    #[serde(default)]
    password: Option<SecretString>,
    #[serde(default)]
    seven_zip: Option<upriv_core::config::vault_config::VaultSevenZipSection>,
    /// `.upriv-config/` of a `.7z` or a plain-text `.zip` carries the file-manager layout.
    #[serde(default)]
    include_workspace: bool,
    /// `.upriv-config/` of a `.7z` or a plain-text `.zip` carries the vault settings.
    #[serde(default)]
    include_settings: bool,
    /// The folder the export file goes into, named after the vault.
    dest_dir: String,
    /// Names this export for `job_status` and `job_cancel`.
    job: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BackupSaveParams {
    id: String,
    /// Names this save for `job_status` and `job_cancel`.
    job: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultImportZipParams {
    settings: VaultConfig,
    #[serde(default)]
    content_b64: Option<String>,
    #[serde(default)]
    archive_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultImport7zParams {
    settings: VaultConfig,
    password: SecretString,
    #[serde(default)]
    unlock_preset: Option<KdfUnlockPreset>,
    #[serde(default)]
    content_b64: Option<String>,
    #[serde(default)]
    archive_path: Option<String>,
    #[serde(default)]
    archive_password: Option<SecretString>,
    #[serde(default)]
    welcome: Option<super::VaultWelcomeParams>,
    /// Keep the file-manager layout the archive carries.
    #[serde(default)]
    keep_workspace: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultImportFilesZipParams {
    settings: VaultConfig,
    password: SecretString,
    #[serde(default)]
    unlock_preset: Option<KdfUnlockPreset>,
    #[serde(default)]
    content_b64: Option<String>,
    #[serde(default)]
    archive_path: Option<String>,
    #[serde(default)]
    welcome: Option<super::VaultWelcomeParams>,
    /// Keep the file-manager layout the archive carries.
    #[serde(default)]
    keep_workspace: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultImportProbeParams {
    #[serde(default)]
    content_b64: Option<String>,
    #[serde(default)]
    archive_path: Option<String>,
    #[serde(default)]
    archive_password: Option<SecretString>,
    #[serde(default)]
    kind: Option<String>,
}

fn load_archive_bytes(
    content_b64: Option<&str>,
    archive_path: Option<&str>,
) -> Result<Vec<u8>, RpcResponse> {
    if let Some(path) = archive_path.map(str::trim).filter(|s| !s.is_empty()) {
        return read_import_archive_bytes(std::path::Path::new(path)).map_err(map_core_err);
    }
    if let Some(raw) = content_b64.map(str::trim).filter(|s| !s.is_empty()) {
        return b64_decode(raw);
    }
    Err(err(
        "invalid_request",
        "archivePath or contentB64 is required".into(),
    ))
}

fn infer_import_kind(kind: Option<&str>, archive_path: Option<&str>) -> &'static str {
    if let Some(raw) = kind.map(str::trim).filter(|s| !s.is_empty()) {
        if raw.eq_ignore_ascii_case("seven_zip") || raw.eq_ignore_ascii_case("7z") {
            return "seven_zip";
        }
        return "store_zip";
    }
    if archive_path
        .map(str::trim)
        .filter(|s| s.to_ascii_lowercase().ends_with(".7z"))
        .is_some()
    {
        return "seven_zip";
    }
    "store_zip"
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AppShutdownParams {
    /// The quit dialog's Close now.
    #[serde(default)]
    now: bool,
}

pub(super) fn app_shutdown(params: Value) -> RpcResponse {
    // Quit always runs. Params it cannot read mean the full close.
    let now = serde_json::from_value::<AppShutdownParams>(params).is_ok_and(|parsed| parsed.now);
    // The daemon waits for its workers before it exits. Every export and
    // Back up now, running or still queued, stops within one buffer and
    // removes its file.
    let stopped = upriv_core::stop_all_jobs();
    if stopped > 0 {
        let count = stopped.to_string();
        upriv_core::logging::log_event(
            upriv_core::logging::LogLevel::Info,
            "jobs_stopped_on_quit",
            &[("count", count.as_str())],
        );
    }
    match optional_vault_root() {
        Ok(Some(root)) => {
            let closed = if now {
                close_all_vaults_now(&root)
            } else {
                close_all_vaults(&root)
            };
            match closed {
                Ok(_) => ok(json!(null)),
                Err(error) => map_core_err(error),
            }
        }
        Ok(None) => ok(json!(null)),
        Err(response) => response,
    }
}

pub(super) fn vault_fs_list(params: Value) -> RpcResponse {
    let parsed: VaultIdParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match fs_list_tree(&root, parsed.id.trim()) {
        Ok(tree) => match serde_json::to_value(&tree) {
            Ok(tree) => match fs_tree_revision(&root, parsed.id.trim()) {
                Ok(revision) => ok(json!({ "tree": tree, "revision": revision })),
                Err(error) => map_core_err(error),
            },
            Err(error) => err("invalid_request", error.to_string()),
        },
        Err(error) => map_core_err(error),
    }
}

pub(super) fn vault_fs_revision(params: Value) -> RpcResponse {
    let parsed: VaultIdParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match fs_tree_revision(&root, parsed.id.trim()) {
        Ok(revision) => ok(json!({ "revision": revision })),
        Err(error) => map_core_err(error),
    }
}

pub(super) fn vault_fs_preview_fits(params: Value) -> RpcResponse {
    let parsed: VaultFsPathParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match fs_preview_fits(&root, parsed.id.trim(), &parsed.path) {
        Ok(fits) => ok(json!({ "fits": fits })),
        Err(error) => map_core_err(error),
    }
}

pub(super) fn vault_fs_read(params: Value) -> RpcResponse {
    let parsed: VaultFsPathParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match fs_read_file(&root, parsed.id.trim(), &parsed.path) {
        Ok(bytes) => ok(json!({
            "contentB64": b64_encode(&bytes),
            "size": bytes.len() as u64,
        })),
        Err(error) => map_core_err(error),
    }
}

pub(super) fn vault_fs_read_range(params: Value) -> RpcResponse {
    let parsed: VaultFsRangeParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match fs_read_range(
        &root,
        parsed.id.trim(),
        &parsed.path,
        parsed.offset,
        parsed.len,
    ) {
        Ok(bytes) => ok(json!({
            "contentB64": b64_encode(&bytes),
            "size": bytes.len() as u64,
        })),
        Err(error) => map_core_err(error),
    }
}

pub(super) fn vault_fs_write(params: Value) -> RpcResponse {
    let parsed: VaultFsWriteParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let bytes = match b64_decode(&parsed.content_b64) {
        Ok(bytes) => bytes,
        Err(response) => return response,
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match fs_write_file(&root, parsed.id.trim(), &parsed.path, &bytes) {
        Ok(revision) => ok(json!({ "revision": revision })),
        Err(error) => map_core_err(error),
    }
}

pub(super) fn vault_fs_write_range(params: Value) -> RpcResponse {
    let parsed: VaultFsWriteRangeParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let bytes = match b64_decode(&parsed.content_b64) {
        Ok(bytes) => bytes,
        Err(response) => return response,
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match upriv_core::fs_write_range(&root, parsed.id.trim(), &parsed.path, parsed.offset, &bytes) {
        Ok(revision) => ok(json!({ "revision": revision })),
        Err(error) => map_core_err(error),
    }
}

pub(super) fn vault_fs_import_os_file(params: Value) -> RpcResponse {
    let parsed: VaultFsImportOsFileParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match fs_import_from_os_path(
        &root,
        parsed.id.trim(),
        &parsed.parent_path,
        parsed.name.trim(),
        Path::new(parsed.os_path.trim()),
    ) {
        Ok((path, revision)) => ok(json!({ "path": path, "revision": revision })),
        Err(error) => map_core_err(error),
    }
}

pub(super) fn vault_fs_truncate(params: Value) -> RpcResponse {
    let parsed: VaultFsTruncateParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match fs_truncate(&root, parsed.id.trim(), &parsed.path, parsed.size) {
        Ok(revision) => ok(json!({ "revision": revision })),
        Err(error) => map_core_err(error),
    }
}

pub(super) fn vault_fs_create_file(params: Value) -> RpcResponse {
    let parsed: VaultFsCreateParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match fs_create_file(&root, parsed.id.trim(), &parsed.parent_path, &parsed.name) {
        Ok((path, revision)) => ok(json!({ "path": path, "revision": revision })),
        Err(error) => map_core_err(error),
    }
}

pub(super) fn vault_fs_create_folder(params: Value) -> RpcResponse {
    let parsed: VaultFsCreateParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match fs_create_folder(&root, parsed.id.trim(), &parsed.parent_path, &parsed.name) {
        Ok((path, revision)) => ok(json!({ "path": path, "revision": revision })),
        Err(error) => map_core_err(error),
    }
}

pub(super) fn vault_fs_ensure_folder(params: Value) -> RpcResponse {
    let parsed: VaultFsCreateParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match fs_ensure_folder(&root, parsed.id.trim(), &parsed.parent_path, &parsed.name) {
        Ok((path, revision)) => ok(json!({ "path": path, "revision": revision })),
        Err(error) => map_core_err(error),
    }
}

pub(super) fn vault_fs_delete(params: Value) -> RpcResponse {
    let parsed: VaultFsPathParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match fs_delete(&root, parsed.id.trim(), &parsed.path) {
        Ok(revision) => ok(json!({ "revision": revision })),
        Err(error) => map_core_err(error),
    }
}

pub(super) fn vault_fs_rename(params: Value) -> RpcResponse {
    let parsed: VaultFsRenameParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match fs_rename(&root, parsed.id.trim(), &parsed.path, &parsed.new_name) {
        Ok((path, revision)) => ok(json!({ "path": path, "revision": revision })),
        Err(error) => map_core_err(error),
    }
}

pub(super) fn vault_fs_os_path(params: Value) -> RpcResponse {
    let parsed: VaultFsPathParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match fs_os_path(&root, parsed.id.trim(), &parsed.path) {
        Ok(path) => match path.to_str() {
            Some(os_path) => ok(json!({ "osPath": os_path })),
            None => err("vault_mount_failed", "mount path is not valid UTF-8".into()),
        },
        // The in-app file manager asks on every open. No OS folder is normal
        // when the switch is off, and on macOS and mobile there is never one.
        Err(upriv_core::UprivError::VaultMountFailed(detail)) => {
            let reason = upriv_core::mount::mount_failure_reason(&detail);
            ok(json!({ "osPath": null, "reason": reason }))
        }
        Err(error) => map_core_err(error),
    }
}

pub(super) fn vault_fs_move(params: Value) -> RpcResponse {
    let parsed: VaultFsMoveParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match fs_move(
        &root,
        parsed.id.trim(),
        &parsed.from_path,
        &parsed.to_folder_path,
    ) {
        Ok((path, revision)) => ok(json!({ "path": path, "revision": revision })),
        Err(error) => map_core_err(error),
    }
}

pub(super) fn vault_delete(params: Value) -> RpcResponse {
    let parsed: VaultIdParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match delete_vault(&root, parsed.id.trim()) {
        Ok(()) => ok(json!(null)),
        Err(error) => map_core_err(error),
    }
}

pub(super) fn vault_discard_import(params: Value) -> RpcResponse {
    let parsed: VaultIdParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match abort_import_vault(&root, parsed.id.trim()) {
        Ok(()) => ok(json!(null)),
        Err(error) => map_core_err(error),
    }
}

pub(super) fn vault_ingest_directory(params: Value) -> RpcResponse {
    let parsed: VaultFsPathParams = match serde_json::from_value(params) {
        Ok(value) => value,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match ingest_import_directory(&root, parsed.id.trim(), parsed.path.trim()) {
        Ok(()) => ok(json!(null)),
        Err(error) => map_core_err(error),
    }
}

/// Read one already-open file descriptor into the import session.
///
/// The caller transferred ownership of `fd` (Android `detachFd`). Not a JSON
/// RPC: a desktop daemon must not import an arbitrary process file descriptor.
pub fn ingest_content_fd(vault_id: &str, logical_path: &str, fd: i32) -> RpcResponse {
    if fd < 0 {
        return err("invalid_request", "import file is unavailable".into());
    }
    #[cfg(unix)]
    {
        use std::fs::File;
        use std::os::unix::io::FromRawFd;
        // SAFETY: the caller moved this descriptor in and will not close it.
        let mut file = unsafe { File::from_raw_fd(fd) };
        let root = match require_vault_root() {
            Ok(root) => root,
            Err(response) => return response,
        };
        match ingest_import_reader(&root, vault_id.trim(), logical_path.trim(), &mut file) {
            Ok(()) => ok(json!(null)),
            Err(error) => map_core_err(error),
        }
    }
    #[cfg(not(unix))]
    {
        let _ = (vault_id, logical_path, fd);
        err("not_implemented", "content import is unavailable".into())
    }
}

pub(super) fn vault_export_capabilities(_params: Value) -> RpcResponse {
    ok(json!({ "sevenZip": seven_zip_export_available() }))
}

/// Write `{display_name}.zip` or `.7z` into the chosen folder. Returns when the file is in place, when it fails, or when
/// `job_cancel` stops it.
pub(super) fn vault_export(params: Value) -> RpcResponse {
    let parsed: VaultExportParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let dest_dir = std::path::PathBuf::from(parsed.dest_dir.trim());
    if !dest_dir.is_absolute() {
        return err("invalid_request", "destDir must be an absolute path".into());
    }
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    let include = ExportInclude {
        workspace: parsed.include_workspace,
        settings: parsed.include_settings,
    };
    let exported = match parsed.format.as_deref().unwrap_or("store_zip") {
        "seven_zip" => export_logical_seven_zip(
            &root,
            parsed.id.trim(),
            secret_bytes(parsed.password.as_ref()),
            parsed.seven_zip.as_ref(),
            include,
            &dest_dir,
            &parsed.job,
        ),
        "plain_zip" => export_plain_zip(
            &root,
            parsed.id.trim(),
            secret_bytes(parsed.password.as_ref()),
            include,
            &dest_dir,
            &parsed.job,
        ),
        _ => export_store_zip(&root, parsed.id.trim(), &dest_dir, &parsed.job),
    };
    match exported {
        Ok(file) => match path_utf8(&file.path) {
            Ok(path) => ok(json!({ "path": path, "size": file.size })),
            Err(response) => response,
        },
        Err(error) => map_core_err(error),
    }
}

pub(super) fn vault_import_zip(params: Value) -> RpcResponse {
    let parsed: VaultImportZipParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    let imported = if let Some(path) = parsed
        .archive_path
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        import_store_from_archive_path(&root, parsed.settings, path)
    } else {
        match load_archive_bytes(parsed.content_b64.as_deref(), None) {
            Ok(bytes) => import_store_zip(&root, parsed.settings, &bytes),
            Err(response) => return response,
        }
    };
    match imported {
        Ok(id) => match vault_list_item(&root, &id) {
            Ok(item) => ok(json!({ "vault": super::vault_list_item_json(&item) })),
            Err(error) => map_core_err(error),
        },
        Err(error) => map_core_err(error),
    }
}

pub(super) fn vault_import_7z(params: Value) -> RpcResponse {
    let parsed: VaultImport7zParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    if parsed.password.is_empty() {
        return err("invalid_request", "password is required".into());
    }
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    let archive_pw = secret_bytes(parsed.archive_password.as_ref());
    let preset = parsed.unlock_preset.unwrap_or(KdfUnlockPreset::M256);
    let extras = ImportExtras {
        welcome: parsed
            .welcome
            .as_ref()
            .map(super::VaultWelcomeParams::as_core),
        keep_workspace: parsed.keep_workspace,
    };
    let imported = if let Some(path) = parsed
        .archive_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        import_logical_seven_zip_path(
            &root,
            parsed.settings,
            parsed.password.as_bytes(),
            preset,
            Path::new(path),
            archive_pw,
            extras,
        )
    } else {
        let bytes = match load_archive_bytes(parsed.content_b64.as_deref(), None) {
            Ok(bytes) => bytes,
            Err(response) => return response,
        };
        import_logical_seven_zip(
            &root,
            parsed.settings,
            parsed.password.as_bytes(),
            preset,
            &bytes,
            archive_pw,
            extras,
        )
    };
    match imported {
        Ok(id) => match vault_list_item(&root, &id) {
            Ok(item) => ok(json!({ "vault": super::vault_list_item_json(&item) })),
            Err(error) => map_core_err(error),
        },
        Err(error) => map_core_err(error),
    }
}

pub(super) fn vault_import_files_zip(params: Value) -> RpcResponse {
    let parsed: VaultImportFilesZipParams = match serde_json::from_value(params) {
        Ok(v) => v,
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
    let extras = ImportExtras {
        welcome: parsed
            .welcome
            .as_ref()
            .map(super::VaultWelcomeParams::as_core),
        keep_workspace: parsed.keep_workspace,
    };
    let path = parsed
        .archive_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let imported = if let Some(path) = path {
        import_logical_files_zip_path(
            &root,
            parsed.settings,
            parsed.password.as_bytes(),
            preset,
            Path::new(path),
            extras,
        )
    } else {
        match load_archive_bytes(parsed.content_b64.as_deref(), None) {
            Ok(bytes) => import_logical_files_zip(
                &root,
                parsed.settings,
                parsed.password.as_bytes(),
                preset,
                &bytes,
                extras,
            ),
            Err(response) => return response,
        }
    };
    match imported {
        Ok(id) => match vault_list_item(&root, &id) {
            Ok(item) => ok(json!({ "vault": super::vault_list_item_json(&item) })),
            Err(error) => map_core_err(error),
        },
        Err(error) => map_core_err(error),
    }
}

pub(super) fn vault_import_os_path(params: Value) -> RpcResponse {
    let parsed: VaultImportFilesZipParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    if parsed.password.is_empty() {
        return err("invalid_request", "password is required".into());
    }
    let Some(path) = parsed
        .archive_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return err("invalid_request", "source path is required".into());
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    let preset = parsed.unlock_preset.unwrap_or(KdfUnlockPreset::M256);
    match import_logical_os_path(
        &root,
        parsed.settings,
        parsed.password.as_bytes(),
        preset,
        Path::new(path),
        parsed
            .welcome
            .as_ref()
            .map(super::VaultWelcomeParams::as_core),
    ) {
        Ok(id) => match vault_list_item(&root, &id) {
            Ok(item) => ok(json!({ "vault": super::vault_list_item_json(&item) })),
            Err(error) => map_core_err(error),
        },
        Err(error) => map_core_err(error),
    }
}

pub(super) fn vault_import_probe(params: Value) -> RpcResponse {
    let parsed: VaultImportProbeParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    let kind = infer_import_kind(parsed.kind.as_deref(), parsed.archive_path.as_deref());
    let archive_pw = secret_bytes(parsed.archive_password.as_ref());
    let path = parsed
        .archive_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let probed = if kind == "seven_zip" {
        if let Some(path) = path {
            probe_logical_seven_zip_path(Path::new(path), archive_pw)
        } else {
            let bytes = match load_archive_bytes(parsed.content_b64.as_deref(), None) {
                Ok(bytes) => bytes,
                Err(response) => return response,
            };
            probe_logical_seven_zip(&bytes, archive_pw)
        }
    } else if let Some(path) = path {
        if parse_backup_import_path(path).is_none() {
            match probe_import_zip_path(Path::new(path)) {
                Ok(probe) if probe.class == ZipImportClass::Files => {
                    return ok(files_zip_probe_body(&probe))
                }
                Ok(_) => {}
                Err(error) => return map_core_err(error),
            }
        }
        read_import_zip_settings(&root, path)
    } else {
        let bytes = match load_archive_bytes(parsed.content_b64.as_deref(), None) {
            Ok(bytes) => bytes,
            Err(response) => return response,
        };
        match probe_import_zip_bytes(&bytes) {
            Ok(probe) if probe.class == ZipImportClass::Files => {
                return ok(files_zip_probe_body(&probe))
            }
            Ok(_) => probe_store_zip(&bytes).and_then(|_| {
                read_zip_config_toml(std::io::Cursor::new(bytes)).and_then(parse_optional_settings)
            }),
            Err(error) => return map_core_err(error),
        }
    };
    match probed {
        Ok(settings) => ok(probe_ok_body(kind, settings.as_ref())),
        Err(upriv_core::UprivError::WrongPassword) => ok(json!({ "ok": false, "kind": kind })),
        Err(error) if kind == "seven_zip" => map_core_err(error),
        Err(_) => ok(json!({ "ok": false, "kind": kind })),
    }
}

fn parse_optional_settings(
    bytes: Option<Vec<u8>>,
) -> upriv_core::Result<Option<upriv_core::EmbeddedVaultSettings>> {
    match bytes {
        Some(bytes) => parse_embedded_settings(&bytes).map(Some),
        None => Ok(None),
    }
}

/// A `.zip` of readable files, with what its `.upriv-config/` carries.
fn files_zip_probe_body(probe: &ImportZipProbe) -> Value {
    let mut body = probe_ok_body("files_zip", probe.settings.as_ref());
    body["carriesWorkspace"] = json!(probe.workspace);
    body
}

fn probe_ok_body(kind: &str, settings: Option<&upriv_core::EmbeddedVaultSettings>) -> Value {
    let mut body = json!({ "ok": true, "kind": kind });
    let Some(parsed) = settings else {
        return body;
    };
    if let Ok(mut value) = serde_json::to_value(&parsed.config) {
        if let Some(security) = value
            .get_mut("security")
            .and_then(|item| item.as_object_mut())
        {
            security.remove("password_changed_at");
        }
        body["settings"] = value;
    }
    if let Some(preset) = parsed.unlock_preset {
        body["unlockPreset"] = serde_json::to_value(preset).unwrap_or(Value::Null);
    }
    body
}

/// Wipe the unfinished plain-text exports a crash left. `folders` are the
/// storage-access folders holding one that are not mounted now.
pub(super) fn vault_plain_export_sweep(_params: Value) -> RpcResponse {
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match sweep_plain_exports(&root) {
        Ok(folders) => ok(json!({ "folders": folders })),
        Err(error) => map_core_err(error),
    }
}

pub(super) fn backup_list(params: Value) -> RpcResponse {
    let parsed: VaultIdParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match list_backups(&root, parsed.id.trim()) {
        Ok(entries) => ok(json!({
            "backups": entries.iter().map(backup_entry_json).collect::<Vec<_>>(),
        })),
        Err(error) => map_core_err(error),
    }
}

fn backup_entry_json(entry: &BackupEntry) -> Value {
    json!({
        "stamp": entry.stamp,
        "fileName": entry.file_name,
        "createdAt": entry.created_at,
        "sizeBytes": entry.size_bytes,
        "saved": entry.saved,
    })
}

/// Zip the closed vault into `backups/saves/` now. Returns the new save, or
/// `job_cancelled` when `job_cancel` stopped it first.
pub(super) fn backup_save(params: Value) -> RpcResponse {
    let parsed: BackupSaveParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match save_backup_now(&root, parsed.id.trim(), &parsed.job) {
        Ok(entry) => ok(json!({ "backup": backup_entry_json(&entry) })),
        Err(error) => map_core_err(error),
    }
}

pub(super) fn backup_delete(params: Value) -> RpcResponse {
    let parsed: BackupStampsParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match delete_backups(&root, parsed.id.trim(), &parsed.stamps) {
        Ok(()) => ok(json!(null)),
        Err(error) => map_core_err(error),
    }
}

pub(super) fn backup_promote(params: Value) -> RpcResponse {
    let parsed: BackupStampParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match promote_backup_save(&root, parsed.id.trim(), parsed.stamp.trim()) {
        Ok(()) => ok(json!(null)),
        Err(error) => map_core_err(error),
    }
}

/// Copy one backup, or bundle several, into the chosen folder. Returns when
/// the file is in place, when it fails, or when `job_cancel` stops it.
pub(super) fn backup_export(params: Value) -> RpcResponse {
    let parsed: BackupExportParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    if parsed.stamps.is_empty() {
        return err("invalid_request", "stamps is required".into());
    }
    let dest_dir = std::path::PathBuf::from(parsed.dest_dir.trim());
    if !dest_dir.is_absolute() {
        return err("invalid_request", "destDir must be an absolute path".into());
    }
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match export_backups(
        &root,
        parsed.id.trim(),
        &parsed.stamps,
        &dest_dir,
        &parsed.job,
    ) {
        Ok(file) => match path_utf8(&file.path) {
            Ok(path) => ok(json!({ "path": path, "size": file.size })),
            Err(response) => response,
        },
        Err(error) => map_core_err(error),
    }
}
