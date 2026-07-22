//! Declarative config load/save (SDD §4.2 `config/`).
//!
//! Two layers — keep them separate:
//!
//! | Module | On-disk | Role |
//! |--------|---------|------|
//! | [`app_settings`] | `.upriv/settings.toml` | **System / app** preferences (UI, logging, package layout). Marker for vault-root. |
//! | [`vault_config`] | `.upriv/vaults/<id>/config.toml` | **Per-vault** options (identity, storage, …) |
//!
//! Path discovery and `.upriv-root` alias stay in [`crate::paths`]. This module
//! calls into `paths` when load/save must find a root or sync the alias.

pub mod app_settings;
pub mod vault_config;

pub use app_settings::{
    apply_setup_ui_locale, discover_bootstrap_root, load_app_settings, load_app_settings_at,
    save_app_settings, save_app_settings_session, save_app_settings_session_with_alias_sync,
    save_app_settings_with_alias_sync, sync_alias_with_app_settings, AppSectionSettings,
    AppSettings, LoadedAppSettings, LoggingSettings, UiSettings,
};
pub use vault_config::{
    load_vault_config, vault_config_path, VaultConfig, VaultIdentitySection, VaultStorageMode,
    VaultStorageSection,
};
