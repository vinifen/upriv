//! Upriv shared Rust core for desktop (`upriv-daemon`) and mobile (JNI/FFI).
//!
//! Current surface: `logging`, `time`, `app_version()`, `error`, `paths`
//! (layout, resolve, alias, initialize), `config` (app `settings.toml` + vault
//! `config.toml`), `store` (header + index + chunk I/O), `vault` (list / create /
//! open / close / fs / backup / delete / import).

pub mod config;
pub mod error;
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
    load_app_settings, load_app_settings_at, load_vault_config, load_vault_config_raw,
    load_vault_groups, parse_settings_toml_str, parse_vault_groups_toml_str, quiet_targets_changed,
    refuse_config_save_if_busy, remap_grouped_vault_id, reorder_vault_group_grouped_vaults,
    reorder_vault_groups, repair_vault_groups, save_app_settings, save_app_settings_session,
    save_app_settings_session_with_alias_sync, save_app_settings_with_alias_sync,
    save_vault_config, save_vault_config_checked, serialize_settings_toml_str,
    sync_alias_with_app_settings, update_vault_group, vault_config_path, vault_groups_path,
    AppSectionSettings, AppSettings, LoadedAppSettings, LoadedVaultGroups, LoggingSettings,
    UiSettings, UpdateVaultGroupParams, VaultConfig, VaultGroup, VaultGroupCreate,
    VaultGroupUpdate, VaultGroupsFile, VaultIdentitySection, VaultStorageMode, VaultStorageSection,
    CONFIG_SAVE_QUIET_TARGETS, VAULT_GROUPS_FILE_NAME,
};
pub use error::{Result, UprivError};
pub use paths::{
    app_home_dir, deactivate_vault_root_alias_everywhere, default_vault_root_anchor,
    detect_app_distribution, discover_vault_root_upward, display_name_to_vault_id,
    distribution_str, env_default_root_anchor, init_app_distribution, initialize_vault_root,
    initialize_vault_root_with_bootstrap, inspect_vault_root_at, is_vault_root_marker,
    open_or_initialize_vault_root, read_vault_root_alias, rename_incomplete_upriv,
    resolve_vault_root, setup_default_root_anchor, suggested_vault_root,
    validate_existing_vault_root, write_vault_root_alias, write_vault_root_alias_for_root,
    AppDistribution, IncompleteReplacePolicy, OpenedVaultRoot, ResolveVaultRoot,
    ResolveVaultRootOptions, VaultRoot, VaultRootAlias, VaultRootBootstrapPrefs,
    VaultRootDirStatus, VaultRootMode, VaultRootSource, VAULT_ROOT_ALIAS_FILE,
    VAULT_ROOT_SETTINGS_REL,
};
pub use runtime_state::{acknowledge_dirty_close, dirty_close_ids, sweep_stale_mount_leaves};
pub use session::{
    is_unlock_in_flight, is_vault_open, open_session_ids, vault_activity_blocks_root_switch,
};
pub use store::{KdfUnlockPreset, FORMAT_VERSION as STORE_FORMAT_VERSION};
pub use time::{utc_filename_stamp, utc_timestamp_iso_millis, utc_ymdhms};
pub use vault::{
    backup_on_close, backup_zip_file, close_all_vaults, close_vault, create_vault, delete_backups,
    delete_vault, export_backups_to_path, export_logical_seven_zip,
    export_logical_seven_zip_to_path, export_store_zip, export_store_zip_to_path, fs_create_file,
    fs_create_folder, fs_delete, fs_ensure_folder, fs_import_from_os_path, fs_list_tree, fs_mkdir,
    fs_move, fs_os_path, fs_read_file, fs_read_range, fs_rename, fs_tree_revision, fs_truncate,
    fs_write_file, fs_write_from_reader, fs_write_range, import_from_backup,
    import_logical_seven_zip, import_store_from_archive_path, import_store_tree, import_store_zip,
    list_backups, list_vaults, load_vault_persistence, open_vault, probe_export_password,
    probe_logical_seven_zip, probe_store_zip, probe_store_zip_path, promote_backup_save,
    read_backup_zip_bytes, read_import_archive_bytes, rename_vault, seven_zip_export_available,
    vault_list_item, zip_directory_to_bytes, zip_directory_to_path, BackupEntry, CloseVaultOutcome,
    VaultListItem, VaultPersistence, VaultRenameResult,
};

/// Application version (from repo-root `VERSION`, set in build.rs).
pub fn app_version() -> &'static str {
    env!("UPRIV_APP_VERSION")
}
