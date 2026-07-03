use std::fs;
use std::path::PathBuf;

use serde::Serialize;
use tauri::Manager;
use upriv_core::{
    append_log, assess_recovery, change_password, create_vault, delete_backups, delete_log_files,
    delete_vault, discover_vault_root_auto, encrypted_dir_close, encrypted_dir_close_by_id,
    encrypted_dir_open, encrypted_dir_seal_closed, has_disk_session, initialize_vault_root,
    is_vault_root_marker, list_backups, list_log_files, list_vaults, load_app_settings,
    load_vault_config, path_is_fuse_mount,
    plain_close_by_id, plain_open, promote_to_save, read_backup_bytes, read_disk_session,
    read_log_file, reorder_vaults, resolve_recovery, save_app_settings, save_vault_config,
    AppSettings, BackupEntry, LogFileDto, LogLevel, RecoveryAction, RecoveryInfo, SessionPassword,
    SevenZip, UprivError, VaultConfig, VaultRoot, WorkspaceMountKind,
};

use crate::encrypted_sessions::EncryptedDirSessions;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptedVaultOpenResult {
    pub workspace: String,
    pub mount_kind: String,
    pub fuse_verified: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMountStatus {
    pub mount_kind: String,
    pub fuse_verified: bool,
}

fn mount_kind_label(kind: WorkspaceMountKind) -> &'static str {
    match kind {
        WorkspaceMountKind::VirtualFuse => "virtual_fuse",
        WorkspaceMountKind::DevPlaintext => "dev_plaintext",
    }
}

pub fn map_error_public(error: UprivError) -> String {
    map_error(error)
}

fn map_error(error: UprivError) -> String {
    match error {
        UprivError::SevenZipFailed { .. } | UprivError::SevenZipCommand { .. } => {
            "error.archive_test_failed".to_string()
        }
        UprivError::WorkspaceExists(_) => "error.vault_already_open".to_string(),
        UprivError::Io(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {
            "error.vault_already_open".to_string()
        }
        UprivError::StorageModeMismatch { .. } => "error.archive_test_failed".to_string(),
        UprivError::VaultAlreadyExists(_) => "error.vault_already_exists".to_string(),
        UprivError::VaultAlreadyOpen(_) => "error.vault_already_open".to_string(),
        UprivError::InvalidStore(_) => "error.archive_test_failed_open".to_string(),
        UprivError::Crypto(_) => "error.archive_test_failed_open".to_string(),
        UprivError::Mount(_) => "error.fuse_unavailable".to_string(),
        other => other.to_string(),
    }
}

fn open_root(vault_root: &str) -> Result<VaultRoot, String> {
    VaultRoot::discover(vault_root).map_err(map_error)
}

fn seven_zip_for(root: &VaultRoot) -> Result<SevenZip, String> {
    let settings = load_app_settings(root).map_err(map_error)?;
    SevenZip::resolve(root, &settings).map_err(map_error)
}

/// Best-effort structured log — never fails the calling command.
fn emit(root: &VaultRoot, level: LogLevel, event: &str, fields: &str) {
    let _ = append_log(root, level, event, fields);
}

fn local_vault_root_path_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    Ok(config_dir.join("vault_root_path"))
}

#[tauri::command]
pub fn vault_root_from_env() -> Option<String> {
    std::env::var("UPRIV_VAULT_ROOT").ok()
}

/// Search near the executable and cwd for `.upriv/settings.toml`.
#[tauri::command]
pub fn vault_root_auto_detect() -> Option<String> {
    discover_vault_root_auto().map(|path| path.display().to_string())
}

#[tauri::command]
pub fn vault_root_is_valid(path: String) -> bool {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return false;
    }
    is_vault_root_marker(PathBuf::from(trimmed))
}

/// Create the standard Upriv layout in `path` and return its canonical root path.
#[tauri::command]
pub fn vault_root_initialize(path: String) -> Result<String, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("error.vault_root_init_failed".to_string());
    }
    let root = initialize_vault_root(PathBuf::from(trimmed))
        .map_err(|_| "error.vault_root_init_failed".to_string())?;
    Ok(root.root().display().to_string())
}

/// Debug builds: repo `prod-example/` when env and app-local path are unset.
#[tauri::command]
pub fn vault_root_dev_fallback() -> Option<String> {
    #[cfg(debug_assertions)]
    {
        let candidate = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../prod-example")
            .join(".upriv/settings.toml");
        if candidate.is_file() {
            return candidate
                .parent()
                .and_then(|p| p.parent())
                .and_then(|p| p.canonicalize().ok())
                .map(|p| p.display().to_string());
        }
    }
    None
}

#[tauri::command]
pub fn app_vault_root_path_get(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = local_vault_root_path_file(&app)?;
    if !path.is_file() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        Ok(None)
    } else {
        Ok(Some(trimmed.to_string()))
    }
}

#[tauri::command]
pub fn app_vault_root_path_set(app: tauri::AppHandle, path: Option<String>) -> Result<(), String> {
    let file = local_vault_root_path_file(&app)?;
    match path {
        None => {
            if file.is_file() {
                fs::remove_file(file).map_err(|e| e.to_string())?;
            }
            Ok(())
        }
        Some(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                return app_vault_root_path_set(app, None);
            }
            fs::write(file, trimmed).map_err(|e| e.to_string())
        }
    }
}

#[tauri::command]
pub fn app_settings_get(vault_root: String) -> Result<AppSettings, String> {
    let root = open_root(&vault_root)?;
    load_app_settings(&root).map_err(map_error)
}

#[tauri::command]
pub fn app_settings_save(vault_root: String, settings: AppSettings) -> Result<(), String> {
    let root = open_root(&vault_root)?;
    save_app_settings(&root, &settings).map_err(map_error)
}

#[tauri::command]
pub fn vault_list(vault_root: String) -> Result<Vec<upriv_core::VaultListRow>, String> {
    let root = open_root(&vault_root)?;
    list_vaults(&root).map_err(map_error)
}

#[tauri::command]
pub async fn plain_vault_open(
    vault_root: String,
    vault_id: String,
    password: String,
) -> Result<String, String> {
    let root = open_root(&vault_root)?;
    let seven_zip = seven_zip_for(&root)?;
    let config = load_vault_config(&root, &vault_id).map_err(map_error)?;
    let seven_zip = seven_zip.with_vault_options(&config);

    let session =
        plain_open(&root, &vault_id, SessionPassword::from(password.as_str()), &seven_zip)
            .map_err(|err| {
                emit(&root, LogLevel::Error, "vault_open_failed", &format!("vault={vault_id} storage_mode=plain"));
                map_error(err)
            })?;

    emit(&root, LogLevel::Info, "vault_open", &format!("vault={vault_id} storage_mode=plain"));
    Ok(session.workspace_path.display().to_string())
}

#[tauri::command]
pub async fn plain_vault_close(
    vault_root: String,
    vault_id: String,
    password: String,
) -> Result<(), String> {
    let root = open_root(&vault_root)?;
    let seven_zip = seven_zip_for(&root)?;
    let config = load_vault_config(&root, &vault_id).map_err(map_error)?;
    let seven_zip = seven_zip.with_vault_options(&config);

    plain_close_by_id(
        &root,
        &vault_id,
        SessionPassword::from(password.as_str()),
        &seven_zip,
    )
    .map_err(|err| {
        emit(&root, LogLevel::Error, "vault_close_failed", &format!("vault={vault_id} storage_mode=plain"));
        map_error(err)
    })?;

    emit(&root, LogLevel::Info, "vault_close", &format!("vault={vault_id} storage_mode=plain action=seal"));
    Ok(())
}

#[tauri::command]
pub async fn encrypted_vault_open(
    vault_root: String,
    vault_id: String,
    password: String,
    sessions: tauri::State<'_, EncryptedDirSessions>,
) -> Result<EncryptedVaultOpenResult, String> {
    let root = open_root(&vault_root)?;
    let seven_zip = seven_zip_for(&root)?;
    let config = load_vault_config(&root, &vault_id).map_err(map_error)?;
    let seven_zip = seven_zip.with_vault_options(&config);

    let session = encrypted_dir_open(
        &root,
        &vault_id,
        SessionPassword::from(password.as_str()),
        &seven_zip,
    )
    .map_err(|err| {
        emit(&root, LogLevel::Error, "vault_open_failed", &format!("vault={vault_id} storage_mode=encrypted_dir"));
        map_error(err)
    })?;

    let mount_kind = session.workspace_mount_kind();
    let workspace_path = session.workspace_path().to_path_buf();
    let fuse_verified = path_is_fuse_mount(&workspace_path);
    let workspace = workspace_path.display().to_string();
    let kind_label = mount_kind_label(mount_kind);

    emit(
        &root,
        LogLevel::Info,
        "vault_open",
        &format!(
            "vault={vault_id} storage_mode=encrypted_dir mount_kind={kind_label} fuse_verified={fuse_verified}"
        ),
    );

    sessions
        .0
        .lock()
        .map_err(|_| "error.archive_test_failed".to_string())?
        .insert(vault_id, session);

    Ok(EncryptedVaultOpenResult {
        workspace,
        mount_kind: kind_label.to_string(),
        fuse_verified,
    })
}

#[tauri::command]
pub fn vault_workspace_mount_status(
    vault_id: String,
    sessions: tauri::State<'_, EncryptedDirSessions>,
) -> Result<Option<WorkspaceMountStatus>, String> {
    let guard = sessions
        .0
        .lock()
        .map_err(|_| "error.archive_test_failed".to_string())?;
    let Some(session) = guard.get(&vault_id) else {
        return Ok(None);
    };
    let mount_kind = session.workspace_mount_kind();
    let fuse_verified = path_is_fuse_mount(session.workspace_path());
    Ok(Some(WorkspaceMountStatus {
        mount_kind: mount_kind_label(mount_kind).to_string(),
        fuse_verified,
    }))
}

#[tauri::command]
pub async fn encrypted_vault_close(
    vault_root: String,
    vault_id: String,
    password: String,
    seal: bool,
    sessions: tauri::State<'_, EncryptedDirSessions>,
) -> Result<(), String> {
    let root = open_root(&vault_root)?;
    let seven_zip = seven_zip_for(&root)?;
    let config = load_vault_config(&root, &vault_id).map_err(map_error)?;
    let seven_zip = seven_zip.with_vault_options(&config);

    let session = {
        let mut guard = sessions
            .0
            .lock()
            .map_err(|_| "error.archive_test_failed".to_string())?;
        match guard.remove(&vault_id) {
            Some(session) => {
                let candidate = SessionPassword::from(password.as_str());
                if session.password().as_bytes() != candidate.as_bytes() {
                    guard.insert(vault_id.clone(), session);
                    return Err("error.archive_test_failed".to_string());
                }
                Some(session)
            }
            None => None,
        }
    };

    let result = match session {
        Some(session) => encrypted_dir_close(&root, session, seal, &seven_zip).map_err(map_error),
        // Session lost (e.g. dev hot-reload restarted the app): rebuild from disk.
        None => encrypted_dir_close_by_id(
            &root,
            &vault_id,
            SessionPassword::from(password.as_str()),
            seal,
            &seven_zip,
        )
        .map_err(map_error),
    };

    let action = if seal { "seal" } else { "close" };
    match &result {
        Ok(()) => emit(&root, LogLevel::Info, "vault_close", &format!("vault={vault_id} storage_mode=encrypted_dir action={action}")),
        Err(_) => emit(&root, LogLevel::Error, "vault_close_failed", &format!("vault={vault_id} storage_mode=encrypted_dir action={action}")),
    }
    result
}

#[tauri::command]
pub async fn encrypted_vault_seal_closed(
    vault_root: String,
    vault_id: String,
) -> Result<(), String> {
    let root = open_root(&vault_root)?;
    encrypted_dir_seal_closed(&root, &vault_id).map_err(|err| {
        emit(&root, LogLevel::Error, "vault_seal_closed_failed", &format!("vault={vault_id}"));
        map_error(err)
    })?;
    emit(&root, LogLevel::Info, "vault_close", &format!("vault={vault_id} storage_mode=encrypted_dir action=seal from=closed"));
    Ok(())
}

#[tauri::command]
pub fn vault_config_get(vault_root: String, vault_id: String) -> Result<VaultConfig, String> {
    let root = open_root(&vault_root)?;
    load_vault_config(&root, &vault_id).map_err(map_error)
}

#[tauri::command]
pub fn vault_config_save(
    vault_root: String,
    vault_id: String,
    config: VaultConfig,
) -> Result<(), String> {
    let root = open_root(&vault_root)?;
    save_vault_config(&root, &vault_id, &config).map_err(map_error)
}

#[tauri::command]
pub async fn vault_create(
    vault_root: String,
    config: VaultConfig,
    password: String,
) -> Result<(), String> {
    let root = open_root(&vault_root)?;
    let seven_zip = seven_zip_for(&root)?;
    let vault_id = config.vault.id.clone();
    let storage_mode = format!("{:?}", config.storage.mode);
    create_vault(&root, config, &password, &seven_zip).map_err(|err| {
        emit(&root, LogLevel::Error, "vault_create_failed", &format!("vault={vault_id}"));
        map_error(err)
    })?;
    emit(&root, LogLevel::Info, "vault_create", &format!("vault={vault_id} storage_mode={storage_mode}"));
    Ok(())
}

#[tauri::command]
pub fn vault_reorder(vault_root: String, ordered_ids: Vec<String>) -> Result<(), String> {
    let root = open_root(&vault_root)?;
    reorder_vaults(&root, &ordered_ids).map_err(map_error)
}

#[tauri::command]
pub async fn vault_delete(vault_root: String, vault_id: String) -> Result<(), String> {
    let root = open_root(&vault_root)?;
    delete_vault(&root, &vault_id).map_err(map_error)?;
    emit(&root, LogLevel::Warn, "vault_delete", &format!("vault={vault_id}"));
    Ok(())
}

#[tauri::command]
pub async fn vault_change_password(
    vault_root: String,
    vault_id: String,
    current_password: String,
    new_password: String,
    sessions: tauri::State<'_, EncryptedDirSessions>,
) -> Result<(), String> {
    let root = open_root(&vault_root)?;
    let seven_zip = seven_zip_for(&root)?;
    change_password(&root, &vault_id, &current_password, &new_password, &seven_zip)
        .map_err(|err| {
            emit(&root, LogLevel::Error, "vault_change_password_failed", &format!("vault={vault_id}"));
            map_error(err)
        })?;
    emit(&root, LogLevel::Info, "vault_change_password", &format!("vault={vault_id}"));

    // Keep any in-memory session usable: refresh its cached password.
    if let Ok(mut guard) = sessions.0.lock() {
        if let Some(session) = guard.get_mut(&vault_id) {
            session.set_password(SessionPassword::from(new_password.as_str()));
        }
    }
    Ok(())
}

#[tauri::command]
pub fn vault_recovery_assess(vault_root: String, vault_id: String) -> Result<RecoveryInfo, String> {
    let root = open_root(&vault_root)?;
    assess_recovery(&root, &vault_id).map_err(map_error)
}

#[tauri::command]
pub async fn vault_recovery_resolve(
    vault_root: String,
    vault_id: String,
    password: String,
    action: String,
) -> Result<(), String> {
    let root = open_root(&vault_root)?;
    let seven_zip = seven_zip_for(&root)?;
    let recovery_action = match action.as_str() {
        "use_store" => RecoveryAction::UseStore,
        "reimport_archive" => RecoveryAction::ReimportArchive,
        "discard_workspace" => RecoveryAction::DiscardWorkspace,
        _ => return Err("error.archive_test_failed".to_string()),
    };
    resolve_recovery(
        &root,
        &vault_id,
        &password,
        recovery_action,
        &seven_zip,
    )
    .map_err(|err| {
        emit(&root, LogLevel::Error, "vault_recovery_failed", &format!("vault={vault_id} action={action}"));
        map_error(err)
    })?;
    emit(&root, LogLevel::Warn, "vault_recovery", &format!("vault={vault_id} action={action}"));
    Ok(())
}

#[tauri::command]
pub fn backup_list(vault_root: String, vault_id: String) -> Result<Vec<BackupEntry>, String> {
    let root = open_root(&vault_root)?;
    list_backups(&root, &vault_id).map_err(map_error)
}

#[tauri::command]
pub fn backup_delete(
    vault_root: String,
    vault_id: String,
    filenames: Vec<String>,
) -> Result<(), String> {
    let root = open_root(&vault_root)?;
    delete_backups(&root, &vault_id, &filenames).map_err(map_error)
}

#[tauri::command]
pub async fn backup_promote_save(
    vault_root: String,
    vault_id: String,
    filename: String,
) -> Result<(), String> {
    let root = open_root(&vault_root)?;
    promote_to_save(&root, &vault_id, &filename).map_err(map_error)
}

#[tauri::command]
pub async fn backup_read_bytes(
    vault_root: String,
    vault_id: String,
    filename: String,
) -> Result<Vec<u8>, String> {
    let root = open_root(&vault_root)?;
    read_backup_bytes(&root, &vault_id, &filename).map_err(map_error)
}

#[tauri::command]
pub fn log_list(vault_root: String) -> Result<Vec<LogFileDto>, String> {
    let root = open_root(&vault_root)?;
    list_log_files(&root).map_err(map_error)
}

#[tauri::command]
pub fn log_get(vault_root: String, filename: String) -> Result<LogFileDto, String> {
    let root = open_root(&vault_root)?;
    read_log_file(&root, &filename).map_err(map_error)
}

#[tauri::command]
pub fn log_delete(vault_root: String, filenames: Vec<String>) -> Result<(), String> {
    let root = open_root(&vault_root)?;
    delete_log_files(&root, &filenames).map_err(map_error)
}

#[tauri::command]
pub fn log_append(
    vault_root: String,
    level: String,
    event: String,
    fields: Option<String>,
) -> Result<(), String> {
    let root = open_root(&vault_root)?;
    append_log(
        &root,
        LogLevel::parse(&level),
        &event,
        fields.as_deref().unwrap_or(""),
    )
    .map_err(map_error)
}

#[tauri::command]
pub async fn vault_archive_bytes(vault_root: String, vault_id: String) -> Result<Vec<u8>, String> {
    let root = open_root(&vault_root)?;
    let config = load_vault_config(&root, &vault_id).map_err(map_error)?;
    let path = root.vault_archive_path(&config);
    if !path.is_file() {
        return Err(map_error(UprivError::ArchiveNotFound(path)));
    }
    fs::read(path).map_err(|err| map_error(UprivError::from(err)))
}

#[tauri::command]
pub fn vault_disk_session_exists(vault_root: String, vault_id: String) -> Result<bool, String> {
    let root = open_root(&vault_root)?;
    has_disk_session(&root, &vault_id).map_err(map_error)
}

#[tauri::command]
pub fn vault_disk_session_read(
    vault_root: String,
    vault_id: String,
    password: Option<String>,
) -> Result<String, String> {
    let root = open_root(&vault_root)?;
    let session = read_disk_session(
        &root,
        &vault_id,
        password.as_deref(),
    )
    .map_err(map_error)?;
    session
        .as_str()
        .map(|value| value.to_string())
        .ok_or_else(|| "error.archive_test_failed".to_string())
}

#[tauri::command]
pub fn open_path_in_file_manager(
    vault_root: String,
    vault_id: String,
    path: String,
) -> Result<(), String> {
    let root = open_root(&vault_root)?;
    let config = load_vault_config(&root, &vault_id).map_err(map_error)?;
    if !config.policy.allow_external_editors {
        return Err("error.external_editor_blocked".to_string());
    }

    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("error.workspace_not_found".to_string());
    }
    let target = PathBuf::from(trimmed);
    if !target.exists() {
        return Err("error.workspace_not_found".to_string());
    }
    open::that(&target).map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn pick_vault_root_folder() -> Option<String> {
    tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("Select Upriv vault folder")
            .pick_folder()
            .map(|path| path.display().to_string())
    })
    .await
    .ok()
    .flatten()
}
