mod commands;
mod encrypted_sessions;
mod power_linux;
mod workspace_fs;
mod workspace_watcher;

use commands::{
    app_settings_get, app_settings_save, app_vault_root_path_get, app_vault_root_path_set,
    encrypted_vault_close, encrypted_vault_open, open_path_in_file_manager, pick_vault_root_folder,
    encrypted_vault_seal_closed, plain_vault_close, plain_vault_open, vault_change_password,
    vault_config_get, vault_config_save, vault_create, vault_delete, vault_disk_session_exists,
    vault_disk_session_read, vault_list, vault_workspace_mount_status,
    vault_recovery_assess, vault_recovery_resolve, vault_reorder, vault_archive_bytes, backup_list,
    backup_delete, backup_promote_save, backup_read_bytes, log_list, log_get, log_delete, log_append,
    vault_root_auto_detect, vault_root_dev_fallback, vault_root_from_env, vault_root_initialize,
    vault_root_is_valid,
};
use encrypted_sessions::EncryptedDirSessions;
use workspace_fs::{
    workspace_delete, workspace_import_folder, workspace_make_dir, workspace_move, workspace_rename,
    workspace_snapshot, workspace_write_file,
};
use workspace_watcher::{workspace_watch_start, workspace_watch_stop, WorkspaceWatchers};

/// Tauri shell — thin `#[tauri::command]` handlers delegate to `upriv-core`.
#[tauri::command]
fn app_version() -> String {
    upriv_core::app_version().to_string()
}

#[tauri::command]
fn app_exit(app: tauri::AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(EncryptedDirSessions::new())
        .manage(WorkspaceWatchers::new())
        .setup(|app| {
            power_linux::spawn_suspend_watcher(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_version,
            app_exit,
            vault_root_from_env,
            vault_root_auto_detect,
            vault_root_is_valid,
            vault_root_initialize,
            vault_root_dev_fallback,
            app_vault_root_path_get,
            app_vault_root_path_set,
            app_settings_get,
            app_settings_save,
            vault_list,
            plain_vault_open,
            plain_vault_close,
            encrypted_vault_open,
            encrypted_vault_close,
            encrypted_vault_seal_closed,
            vault_workspace_mount_status,
            vault_config_get,
            vault_config_save,
            vault_create,
            vault_reorder,
            vault_delete,
            vault_change_password,
            vault_recovery_assess,
            vault_recovery_resolve,
            vault_disk_session_exists,
            vault_disk_session_read,
            backup_list,
            backup_delete,
            backup_promote_save,
            backup_read_bytes,
            vault_archive_bytes,
            log_list,
            log_get,
            log_delete,
            log_append,
            open_path_in_file_manager,
            pick_vault_root_folder,
            workspace_snapshot,
            workspace_write_file,
            workspace_make_dir,
            workspace_import_folder,
            workspace_delete,
            workspace_rename,
            workspace_move,
            workspace_watch_start,
            workspace_watch_stop,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
