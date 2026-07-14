//! Upriv shared Rust core for desktop (`upriv-daemon`) and mobile (JNI/FFI).
//!
//! Current surface: `logging`, `time`, `app_version()`, `error`, and `paths`
//! (layout, resolve, alias, initialize, settings.toml). `vault_list` next.

pub mod error;
pub mod logging;
pub mod paths;
pub mod time;

pub use error::{Result, UprivError};
pub use paths::{
    app_home_dir, apply_setup_ui_locale, deactivate_vault_root_alias,
    deactivate_vault_root_alias_everywhere, delete_vault_root_alias,
    delete_vault_root_alias_everywhere, discover_bootstrap_root, discover_vault_root_near,
    env_nearby_anchor, initialize_vault_root, inspect_vault_root_at, is_vault_root_marker,
    load_app_settings, load_app_settings_at, open_or_initialize_vault_root,
    open_or_initialize_vault_root_with_options, open_or_initialize_vault_root_with_policy,
    read_vault_root_alias, rename_incomplete_upriv, resolve_vault_root, save_app_settings,
    save_app_settings_session, setup_nearby_anchor, sync_alias_with_app_settings,
    validate_existing_vault_root, write_vault_root_alias, AppSectionSettings, AppSettings,
    IncompleteReplacePolicy, LoadedAppSettings, LoggingSettings, NearbyVaultRootStatus,
    ResolveVaultRoot, ResolveVaultRootOptions, UiSettings, VaultRoot, VaultRootAlias,
    VaultRootSource, VAULT_ROOT_ALIAS_FILE, VAULT_ROOT_SETTINGS_REL,
};
pub use time::{utc_filename_stamp, utc_timestamp_iso_millis, utc_ymdhms};

/// Application version (from `dev/VERSION`, set in build.rs).
pub fn app_version() -> &'static str {
    env!("UPRIV_APP_VERSION")
}
