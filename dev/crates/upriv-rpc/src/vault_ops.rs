//! Vault file / backup / delete / import RPC handlers.

use std::path::Path;

use serde::Deserialize;
use serde_json::{json, Value};
use upriv_core::{
    acknowledge_dirty_close, close_all_vaults, delete_backups, delete_vault,
    export_backups_to_path, export_logical_seven_zip, export_logical_seven_zip_to_path,
    export_store_zip, export_store_zip_to_path, fs_create_file, fs_create_folder, fs_delete,
    fs_ensure_folder, fs_import_from_os_path, fs_list_tree, fs_mkdir, fs_move, fs_os_path,
    fs_read_file, fs_read_range, fs_rename, fs_tree_revision, fs_truncate, fs_write_file,
    import_logical_seven_zip, import_store_from_archive_path, import_store_zip, list_backups,
    probe_export_password, probe_logical_seven_zip, probe_store_zip, probe_store_zip_path,
    promote_backup_save, read_backup_zip_bytes, read_import_archive_bytes,
    seven_zip_export_available, vault_list_item, KdfUnlockPreset, VaultConfig,
};

use super::{err, map_core_err, ok, optional_vault_root, require_vault_root, RpcResponse};

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
    #[serde(default)]
    stamp: String,
    #[serde(default)]
    stamps: Vec<String>,
    #[serde(default)]
    dest_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultExportProbeParams {
    id: String,
    password: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultExportParams {
    id: String,
    #[serde(default)]
    format: Option<String>,
    #[serde(default)]
    password: Option<String>,
    #[serde(default)]
    seven_zip: Option<upriv_core::config::vault_config::VaultSevenZipSection>,
    #[serde(default)]
    dest_path: Option<String>,
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
    password: String,
    #[serde(default)]
    unlock_preset: Option<KdfUnlockPreset>,
    #[serde(default)]
    content_b64: Option<String>,
    #[serde(default)]
    archive_path: Option<String>,
    #[serde(default)]
    archive_password: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultImportProbeParams {
    #[serde(default)]
    content_b64: Option<String>,
    #[serde(default)]
    archive_path: Option<String>,
    #[serde(default)]
    archive_password: Option<String>,
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

fn parse_dest_path(raw: Option<&str>) -> Result<Option<std::path::PathBuf>, RpcResponse> {
    let Some(trimmed) = raw.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    let path = std::path::PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err(err(
            "invalid_request",
            "destPath must be an absolute path".into(),
        ));
    }
    if path.is_dir() {
        return Err(err("invalid_request", "destPath is a directory".into()));
    }
    let parent = path.parent().filter(|p| !p.as_os_str().is_empty());
    if parent.is_none() || path.file_name().is_none() {
        return Err(err(
            "invalid_request",
            "destPath must include a file name".into(),
        ));
    }
    Ok(Some(path))
}

fn fsync_path(path: &std::path::Path) -> std::io::Result<()> {
    std::fs::File::open(path)?.sync_all()
}

/// Install `tmp` at `dest`. Unix `rename` replaces a file atomically. Windows
/// cannot rename over an existing file, so only then unlink `dest` and retry.
/// Never unlink `dest` first on Unix (a failed rename would drop the original).
fn replace_dest_file(tmp: &std::path::Path, dest: &std::path::Path) -> std::io::Result<()> {
    match std::fs::rename(tmp, dest) {
        Ok(()) => Ok(()),
        Err(error) if dest.exists() => {
            #[cfg(windows)]
            {
                std::fs::remove_file(dest)?;
                std::fs::rename(tmp, dest)
            }
            #[cfg(not(windows))]
            Err(error)
        }
        Err(error) => Err(error),
    }
}

fn write_atomic_dest(
    dest: &std::path::Path,
    write: impl FnOnce(&std::path::Path) -> upriv_core::Result<u64>,
) -> RpcResponse {
    let parent = dest.parent().expect("parse_dest_path");
    let name = dest.file_name().expect("parse_dest_path");
    let tmp = parent.join(format!("{}.upriv-part", name.to_string_lossy()));
    let size = match write(&tmp) {
        Ok(size) => size,
        Err(error) => {
            let _ = std::fs::remove_file(&tmp);
            return map_core_err(error);
        }
    };
    if let Err(error) = fsync_path(&tmp) {
        let _ = std::fs::remove_file(&tmp);
        return map_core_err(error.into());
    }
    if let Err(error) = replace_dest_file(&tmp, dest) {
        // Keep the part file when `dest` is already gone (Windows unlink-then-rename).
        if dest.exists() {
            let _ = std::fs::remove_file(&tmp);
        }
        return map_core_err(error.into());
    }
    ok(json!({
        "path": dest.to_string_lossy(),
        "size": size
    }))
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

pub(super) fn app_shutdown() -> RpcResponse {
    match optional_vault_root() {
        Ok(Some(root)) => match close_all_vaults(&root) {
            Ok(_) => ok(json!(null)),
            Err(error) => map_core_err(error),
        },
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

pub(super) fn vault_fs_mkdir(params: Value) -> RpcResponse {
    let parsed: VaultFsPathParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match fs_mkdir(&root, parsed.id.trim(), &parsed.path) {
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

pub(super) fn vault_recover_ack(params: Value) -> RpcResponse {
    let parsed: VaultIdParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match acknowledge_dirty_close(&root, parsed.id.trim()) {
        Ok(()) => ok(json!(null)),
        Err(error) => map_core_err(error),
    }
}

pub(super) fn vault_export_capabilities(_params: Value) -> RpcResponse {
    ok(json!({ "sevenZip": seven_zip_export_available() }))
}

pub(super) fn vault_export(params: Value) -> RpcResponse {
    let parsed: VaultExportParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    let format = parsed.format.as_deref().unwrap_or("store_zip");
    let dest = match parse_dest_path(parsed.dest_path.as_deref()) {
        Ok(dest) => dest,
        Err(response) => return response,
    };
    if let Some(dest) = dest {
        return match format {
            "seven_zip" => write_atomic_dest(&dest, |tmp| {
                export_logical_seven_zip_to_path(
                    &root,
                    parsed.id.trim(),
                    parsed.password.as_deref().unwrap_or("").as_bytes(),
                    parsed.seven_zip.as_ref(),
                    tmp,
                )
            }),
            _ => write_atomic_dest(&dest, |tmp| {
                export_store_zip_to_path(&root, parsed.id.trim(), tmp)
            }),
        };
    }
    let bytes = match format {
        "seven_zip" => export_logical_seven_zip(
            &root,
            parsed.id.trim(),
            parsed.password.as_deref().unwrap_or("").as_bytes(),
            parsed.seven_zip.as_ref(),
        ),
        _ => export_store_zip(&root, parsed.id.trim()),
    };
    match bytes {
        Ok(bytes) => ok(json!({ "contentB64": b64_encode(&bytes) })),
        Err(error) => map_core_err(error),
    }
}

/// Argon2id unlock only. A wrong password returns `{ ok: false }` and does not pack the `.7z`.
pub(super) fn vault_export_probe(params: Value) -> RpcResponse {
    let parsed: VaultExportProbeParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    match probe_export_password(&root, parsed.id.trim(), parsed.password.as_bytes()) {
        Ok(()) => ok(json!({ "ok": true })),
        Err(upriv_core::UprivError::WrongPassword) => ok(json!({ "ok": false })),
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
    let bytes = match load_archive_bytes(
        parsed.content_b64.as_deref(),
        parsed.archive_path.as_deref(),
    ) {
        Ok(bytes) => bytes,
        Err(response) => return response,
    };
    let archive_pw = parsed.archive_password.as_deref().unwrap_or("").as_bytes();
    let preset = parsed.unlock_preset.unwrap_or(KdfUnlockPreset::M256);
    match import_logical_seven_zip(
        &root,
        parsed.settings,
        parsed.password.as_bytes(),
        preset,
        &bytes,
        archive_pw,
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
    if let Err(response) = require_vault_root() {
        return response;
    }
    let kind = infer_import_kind(parsed.kind.as_deref(), parsed.archive_path.as_deref());
    let archive_pw = parsed.archive_password.as_deref().unwrap_or("").as_bytes();
    let path = parsed
        .archive_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let probed = if kind == "seven_zip" {
        let bytes = match load_archive_bytes(parsed.content_b64.as_deref(), path) {
            Ok(bytes) => bytes,
            Err(response) => return response,
        };
        probe_logical_seven_zip(&bytes, archive_pw)
    } else if let Some(path) = path {
        probe_store_zip_path(Path::new(path))
    } else {
        let bytes = match load_archive_bytes(parsed.content_b64.as_deref(), None) {
            Ok(bytes) => bytes,
            Err(response) => return response,
        };
        probe_store_zip(&bytes)
    };
    match probed {
        Ok(()) => ok(json!({ "ok": true, "kind": kind })),
        Err(upriv_core::UprivError::WrongPassword) => ok(json!({ "ok": false, "kind": kind })),
        Err(error) if kind == "seven_zip" => map_core_err(error),
        Err(_) => ok(json!({ "ok": false, "kind": kind })),
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
            "backups": entries.iter().map(|e| json!({
                "stamp": e.stamp,
                "createdAt": e.created_at,
                "sizeBytes": e.size_bytes,
                "saved": e.saved,
            })).collect::<Vec<_>>(),
        })),
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

pub(super) fn backup_get(params: Value) -> RpcResponse {
    let parsed: BackupStampParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(error) => return err("invalid_request", error.to_string()),
    };
    let stamps: Vec<String> = if parsed.stamps.is_empty() {
        let stamp = parsed.stamp.trim().to_string();
        if stamp.is_empty() {
            return err("invalid_request", "stamp is required".into());
        }
        vec![stamp]
    } else {
        parsed
            .stamps
            .into_iter()
            .map(|stamp| stamp.trim().to_string())
            .filter(|stamp| !stamp.is_empty())
            .collect()
    };
    if stamps.is_empty() {
        return err("invalid_request", "stamp is required".into());
    }
    let root = match require_vault_root() {
        Ok(root) => root,
        Err(response) => return response,
    };
    let dest = match parse_dest_path(parsed.dest_path.as_deref()) {
        Ok(dest) => dest,
        Err(response) => return response,
    };
    let id = parsed.id.trim();
    if let Some(dest) = dest {
        return write_atomic_dest(&dest, |tmp| export_backups_to_path(&root, id, &stamps, tmp));
    }
    if stamps.len() != 1 {
        return err(
            "invalid_request",
            "destPath is required to export several backups".into(),
        );
    }
    match read_backup_zip_bytes(&root, id, &stamps[0]) {
        Ok(bytes) => ok(json!({ "contentB64": b64_encode(&bytes) })),
        Err(error) => map_core_err(error),
    }
}

#[cfg(test)]
mod dest_tests {
    use super::*;

    #[test]
    fn parse_dest_path_none_and_blank_are_inline() {
        assert!(parse_dest_path(None).unwrap().is_none());
        assert!(parse_dest_path(Some("  ")).unwrap().is_none());
    }

    #[test]
    fn parse_dest_path_rejects_relative() {
        let err = parse_dest_path(Some("out.zip")).unwrap_err();
        assert_eq!(err.error.as_ref().unwrap().code, "invalid_request");
    }

    #[test]
    fn parse_dest_path_rejects_directory() {
        let dir = tempfile::tempdir().unwrap();
        let err = parse_dest_path(Some(dir.path().to_str().unwrap())).unwrap_err();
        assert_eq!(
            err.error.as_ref().unwrap().message,
            "destPath is a directory"
        );
    }

    #[test]
    fn replace_dest_file_overwrites_existing() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("out.bin");
        let tmp = dir.path().join("out.bin.upriv-part");
        std::fs::write(&dest, b"old").unwrap();
        std::fs::write(&tmp, b"new-content").unwrap();
        replace_dest_file(&tmp, &dest).unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), b"new-content");
        assert!(!tmp.exists());
    }

    #[test]
    fn write_atomic_dest_overwrites_existing_and_drops_part_file() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("out.bin");
        std::fs::write(&dest, b"old").unwrap();
        let response = write_atomic_dest(&dest, |tmp| {
            std::fs::write(tmp, b"new-bytes")?;
            Ok(9)
        });
        assert!(response.ok, "{response:?}");
        assert_eq!(std::fs::read(&dest).unwrap(), b"new-bytes");
        assert!(!dir.path().join("out.bin.upriv-part").exists());
        let result = response.result.expect("path+size");
        assert_eq!(result["size"], 9);
        assert_eq!(result["path"], dest.to_string_lossy().as_ref());
    }

    #[test]
    fn write_atomic_dest_keeps_original_when_write_fails() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("out.bin");
        std::fs::write(&dest, b"keep-me").unwrap();
        let response = write_atomic_dest(&dest, |_tmp| Err(std::io::Error::other("boom").into()));
        assert!(!response.ok);
        assert_eq!(std::fs::read(&dest).unwrap(), b"keep-me");
        assert!(!dir.path().join("out.bin.upriv-part").exists());
    }
}
