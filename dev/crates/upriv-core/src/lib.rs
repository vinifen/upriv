//! Upriv shared Rust core for desktop (`upriv-daemon`) and mobile (JNI/FFI).
//!
//! Current surface: `logging`, `time`, `app_version()`, `error`, `paths`
//! (layout, resolve, alias, initialize), `config` (app `settings.toml` + vault
//! `config.toml`), `contents` (header + index + chunk I/O), `vault` (list / create /
//! open / close).

pub mod config;
pub mod contents;
pub mod error;
pub mod logging;
pub mod paths;
pub mod session;
pub mod time;
pub mod vault;

#[cfg(test)]
mod test_support;

pub use config::{
    create_vault_group_with_sort, delete_vault_group, discover_bootstrap_root, known_vault_ids,
    load_app_settings, load_app_settings_at, load_vault_config, load_vault_config_raw,
    load_vault_groups, parse_settings_toml_str, parse_vault_groups_toml_str, quiet_targets_changed,
    refuse_config_save_if_busy, reorder_vault_group_grouped_vaults, reorder_vault_groups,
    repair_vault_groups, save_app_settings, save_app_settings_session,
    save_app_settings_session_with_alias_sync, save_app_settings_with_alias_sync,
    save_vault_config, save_vault_config_checked, serialize_settings_toml_str,
    sync_alias_with_app_settings, update_vault_group, vault_config_path, vault_groups_path,
    AppSectionSettings, AppSettings, LoadedAppSettings, LoadedVaultGroups, LoggingSettings,
    UiSettings, UpdateVaultGroupParams, VaultConfig, VaultGroup, VaultGroupCreate,
    VaultGroupUpdate, VaultGroupsFile, VaultIdentitySection, VaultStorageMode, VaultStorageSection,
    CONFIG_SAVE_QUIET_TARGETS, VAULT_GROUPS_FILE_NAME,
};
pub use contents::{KdfUnlockPreset, FORMAT_VERSION as STORE_FORMAT_VERSION};
pub use error::{Result, UprivError};
pub use paths::{
    app_home_dir, deactivate_vault_root_alias_everywhere, default_vault_root_anchor,
    detect_app_distribution, discover_vault_root_upward, distribution_str, env_default_root_anchor,
    init_app_distribution, initialize_vault_root, initialize_vault_root_with_bootstrap,
    inspect_vault_root_at, is_vault_root_marker, open_or_initialize_vault_root,
    read_vault_root_alias, rename_incomplete_upriv, resolve_vault_root, setup_default_root_anchor,
    suggested_vault_root, validate_existing_vault_root, write_vault_root_alias,
    write_vault_root_alias_for_root, AppDistribution, IncompleteReplacePolicy, OpenedVaultRoot,
    ResolveVaultRoot, ResolveVaultRootOptions, VaultRoot, VaultRootAlias, VaultRootBootstrapPrefs,
    VaultRootDirStatus, VaultRootMode, VaultRootSource, VAULT_ROOT_ALIAS_FILE,
    VAULT_ROOT_SETTINGS_REL,
};
pub use session::{
    is_unlock_in_flight, is_vault_open, open_session_ids, vault_activity_blocks_root_switch,
};
pub use time::{utc_filename_stamp, utc_timestamp_iso_millis, utc_ymdhms};
pub use vault::{
    close_vault, create_vault, list_vaults, load_vault_persistence, open_vault, vault_list_item,
    VaultListItem, VaultPersistence,
};

/// Application version (from repo-root `VERSION`, set in build.rs).
pub fn app_version() -> &'static str {
    env!("UPRIV_APP_VERSION")
}
