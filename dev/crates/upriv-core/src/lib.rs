//! Upriv shared Rust core for desktop (`upriv-daemon`) and mobile (JNI/FFI).
//!
//! Current surface: `logging`, `time`, `app_version()`, `error`, `paths`
//! (layout, resolve, alias, initialize), `config` (app `settings.toml` + vault
//! `config.toml`). Vault list scan is crate-internal until `vault_list` RPC.

pub mod config;
pub mod error;
pub mod logging;
pub mod paths;
pub mod time;
pub mod vault;

pub use config::{
    apply_setup_ui_locale, discover_bootstrap_root, load_app_settings, load_app_settings_at,
    load_vault_config, save_app_settings, save_app_settings_session,
    save_app_settings_session_with_alias_sync, save_app_settings_with_alias_sync,
    sync_alias_with_app_settings, vault_config_path, AppSectionSettings, AppSettings,
    LoadedAppSettings, LoggingSettings, UiSettings, VaultConfig, VaultIdentitySection,
    VaultStorageMode, VaultStorageSection,
};
pub use error::{Result, UprivError};
pub use paths::{
    app_home_dir, deactivate_vault_root_alias_everywhere, default_vault_root_anchor,
    detect_app_distribution, discover_vault_root_upward, distribution_str, env_default_root_anchor,
    initialize_vault_root, init_app_distribution, inspect_vault_root_at, is_vault_root_marker,
    open_or_initialize_vault_root, open_or_initialize_vault_root_with_options,
    open_or_initialize_vault_root_with_policy, read_vault_root_alias, rename_incomplete_upriv,
    resolve_vault_root, setup_default_root_anchor, suggested_vault_root,
    validate_existing_vault_root, write_vault_root_alias, write_vault_root_alias_for_root,
    AppDistribution, IncompleteReplacePolicy, ResolveVaultRoot, ResolveVaultRootOptions, VaultRoot,
    VaultRootAlias, VaultRootDirStatus, VaultRootMode, VaultRootSource, VAULT_ROOT_ALIAS_FILE,
    VAULT_ROOT_SETTINGS_REL,
};
pub use time::{utc_filename_stamp, utc_timestamp_iso_millis, utc_ymdhms};

/// Application version (from `dev/VERSION`, set in build.rs).
pub fn app_version() -> &'static str {
    env!("UPRIV_APP_VERSION")
}
