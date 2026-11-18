//! Upriv shared Rust core for desktop (`upriv-daemon`) and mobile (JNI/FFI).
//!
//! Current surface: `logging`, `time`, `app_version()`, `error`, `device`,
//! `folder_list` (the per-device folder lists), `paths` (layout, launch
//! resolution, initialize), `config` (app `settings.toml` + vault
//! `config.toml`), `store` (header + index + chunk I/O), `vault` (list /
//! create / open / close / fs / backup / delete / import / data folder).

pub mod config;
pub mod device;
pub mod error;
mod failure;
pub mod folder_list;
pub mod folder_probe;
pub mod host_fs;
pub mod lockfile;
pub mod logging;
pub mod mount;
pub mod paths;
pub mod runtime_state;
pub mod session;
pub mod store;
pub mod time;
pub mod vault;

#[cfg(test)]
mod test_support;

pub use config::{
    create_vault_group_with_sort, delete_vault_group, discover_bootstrap_root, known_vault_ids,
    load_app_settings, load_app_settings_at, load_vault_config, load_vault_groups,
    quiet_targets_changed, refuse_config_save_if_busy, remap_grouped_vault_id,
    reorder_vault_group_grouped_vaults, reorder_vault_groups, repair_vault_groups,
    save_app_settings_at, save_app_settings_session, save_vault_config, save_vault_config_checked,
    serialize_settings_toml_str, update_vault_group, vault_config_path, vault_groups_path,
    AppListChanges, AppSectionSettings, AppSettings, ListsSaved, LoadedAppSettings,
    LoadedVaultGroups, LoggingSettings, UiSettings, UpdateVaultGroupParams, VaultConfig,
    VaultGroup, VaultGroupCreate, VaultGroupUpdate, VaultGroupsFile, VaultIdentitySection,
    VaultListChanges, CONFIG_SAVE_QUIET_TARGETS, VAULT_GROUPS_FILE_NAME,
};
pub use device::{set_platform_identity, this_device, DeviceId, DeviceSystem, ThisDevice};
pub use error::{Result, UprivError};
pub use paths::{
    app_home_dir, data_folder_lost, default_vault_root_anchor, detect_app_distribution,
    discover_vault_root_upward, display_name_to_vault_id, distribution_str,
    env_default_root_anchor, explicit_data_folder, init_app_distribution, initialize_vault_root,
    initialize_vault_root_with_bootstrap, inspect_vault_root_at, is_vault_root_marker,
    open_or_initialize_vault_root, rename_incomplete_upriv, resolve_vault_root,
    setup_default_root_anchor, suggested_vault_root, validate_existing_vault_root, AppDistribution,
    IncompleteReplacePolicy, OpenedVaultRoot, ResolveVaultRoot, ResolveVaultRootOptions,
    UprivDirRelocate, VaultRoot, VaultRootBootstrapPrefs, VaultRootDirStatus, VaultRootSource,
    VAULT_ROOT_SETTINGS_REL,
};
pub use runtime_state::{dirty_close_ids, sweep_stale_mount_leaves, vault_held_elsewhere};
pub use session::{
    cancel_job, is_data_folder_export_running, is_unlock_in_flight, job_status, open_session_ids,
    stop_all_jobs, vault_activity_blocks_root_switch, ClosePhase, JobStatus, JobStop,
};
pub use store::{
    KdfUnlockPreset, PasswordChangeState, VaultPlainFiles, VaultStorage, VaultStorageMode,
    FORMAT_VERSION as STORE_FORMAT_VERSION,
};
pub use time::{utc_filename_stamp, utc_timestamp_iso_millis, utc_ymdhms};
pub use vault::{
    abort_import_vault, apply_data_folder, attach_unlocked_folder, backup_listing, backup_zip_file,
    change_vault_kdf, change_vault_password, change_vault_storage, close_all_vaults,
    close_all_vaults_now, close_state, close_vault, close_vault_auto, close_vault_now,
    create_vault, create_vault_as_job, data_folder_entered, data_folder_status, data_folder_view,
    delete_backups, delete_vault, device_trees, end_lost_sessions, export_backups,
    export_data_folder, export_logical_seven_zip, export_plain_zip, export_store_zip,
    finish_import_session, finish_password_change, folder_status, forget_backup_folder,
    fs_create_file, fs_create_folder, fs_delete, fs_ensure_folder, fs_held_delete, fs_held_list,
    fs_held_restore, fs_import_from_os_path, fs_list_tree, fs_mkdir, fs_move, fs_os_path,
    fs_preview_fits, fs_read_file, fs_read_range, fs_rename, fs_tree_revision, fs_truncate,
    fs_write_file, fs_write_from_reader, fs_write_range, hurry_close, hurry_delete,
    hurry_partial_wipes, hurry_quit, import_logical_files_zip, import_logical_files_zip_path,
    import_logical_os_path, import_logical_seven_zip, import_logical_seven_zip_path, import_slots,
    import_store_from_archive_path, import_store_zip, ingest_import_directory,
    ingest_import_reader, leave_lost_data_folder, list_backups, list_vaults,
    load_vault_persistence, open_import_session, open_vault, open_vault_as_job,
    parse_backup_import_path, plain_deletions, plain_leftover, plain_record_forget, plain_send,
    plain_status, plain_sync, plain_unsend, probe_import_zip_bytes, probe_import_zip_path,
    probe_logical_seven_zip, probe_logical_seven_zip_path, promote_backup_save,
    read_import_archive_bytes, read_import_zip_bytes_settings, read_import_zip_settings,
    rebuild_vault, remove_plain_leftover, rename_backup, rename_vault, save_backup_now,
    search_data_folder, set_plain_observer, seven_zip_export_available, sweep_unfinished,
    unlocked_destination, unlocked_folder_info, update_key_copies, vault_disk_usage,
    vault_key_status, vault_list_item, wait_for_partial_wipes, wait_for_previous_app, AttachAnswer,
    BackupEntry, BackupListing, BackupSection, BackupSkip, CloseState, CloseVaultOutcome,
    DataFolderApplied, DataFolderApply, DataFolderContent, DataFolderDetails, DataFolderExport,
    DataFolderSearch, DataFolderStatus, DataFolderView, EmbeddedVaultSettings, ExportInclude,
    ExportedFile, FolderDetails, FolderStatus, HeldFile, HeldItem, ImportExtras, ImportZipProbe,
    KeyCopies, KeyStatus, OsFolder, OutsideBackups, PasswordChangeFinishResult,
    PasswordChangeResult, PlainCloseSummary, PlainFolderClass, PlainLeftover, PlainObserver,
    PlainRecordState, PlainRecordView, PlainStatus, PlainSyncReport, PlainTotals, PlainUnsend,
    PlainWipe, SavedBackup, SectionDevice, SectionKind, SevenZipProbe, StatusList,
    StorageChangeResult, StorageReset, StoreZipSettings, UnlockRamChangeResult,
    UnlockedDestination, UnlockedFolderInfo, VaultDeleteOutcome, VaultDiskUsage, VaultListItem,
    VaultOpened, VaultPersistence, VaultRebuild, VaultRenameResult, VaultWelcome, ZipImportClass,
    BACKUP_NAME_MAX_CHARS, WELCOME_FILE_MAX_BYTES, WELCOME_README_LOGICAL_PATH,
};

/// Application version (from repo-root `VERSION`, set in build.rs).
pub fn app_version() -> &'static str {
    env!("UPRIV_APP_VERSION")
}
