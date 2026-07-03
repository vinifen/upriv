//! Upriv product logic — crypto, vault I/O, 7z, state machine.
//! Desktop (`src-tauri`) and mobile (JNI/FFI) call this crate only.

pub mod backup;
pub mod config;
pub mod crypto;
pub mod encrypted_dir;
pub mod error;
pub mod logging;
pub mod mount;
pub mod paths;
pub mod plain;
pub mod session;
pub mod seven_zip;
pub mod storage;
pub mod store;
pub mod vault;

pub use config::{
    discover_vault_ids, initialize_vault_root, load_app_settings, load_vault_config,
    save_app_settings, save_vault_config, AppSettings, PersistenceState, SecuritySection,
    StorageMode, VaultConfig, VaultPersistence,
};
pub use error::{Result, UprivError};
pub use paths::{discover_vault_root_auto, is_vault_root_marker, VaultRoot};
pub use encrypted_dir::{
    close as encrypted_dir_close, close_by_id as encrypted_dir_close_by_id,
    open as encrypted_dir_open, seal_closed as encrypted_dir_seal_closed, EncryptedDirSession,
    WorkspaceMountKind,
};
pub use mount::path_is_fuse_mount;
pub use plain::{close as plain_close, close_by_id as plain_close_by_id, open as plain_open, PlainSession};
pub use backup::{
    delete_backups, list_backups, promote_to_save, read_backup_bytes, BackupEntry,
};
pub use logging::{
    append_log, delete_log_files, list_log_files, read_log_file, LogFileDto, LogLevel,
};
pub use session::{
    delete_disk_session, has_disk_session, persist_disk_session, read_disk_session,
    uses_disk_session, SessionPassword,
};
pub use seven_zip::SevenZip;
pub use storage::{FsVaultStorage, VaultStorage};

pub use vault::{
    assess_recovery, change_password, create_vault, delete_vault, list_vaults, needs_recovery,
    reorder_vaults, resolve_recovery, RecoveryAction, RecoveryInfo, VaultListRow,
};

/// Application / crate version (shared with Tauri `app_version` command).
pub fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
