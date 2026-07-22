//! System / app settings: load / save `.upriv/settings.toml` (`[ui]`, `[logging]`, `[app]`).
//!
//! This is **not** per-vault `config.toml` (see [`crate::config::vault_config`]).
//!
//! Vault-root **mode and path are not stored in TOML**. They live in the app-home
//! `.upriv-root` alias (`status=active|inactive` + path). The wire/`AppSettings`
//! fields `vault_root_mode` and `upriv_root_path` are derived on load and
//! drive alias updates on save.

mod load_save;
mod toml;
mod types;

pub use load_save::{
    apply_setup_ui_locale, discover_bootstrap_root, load_app_settings, load_app_settings_at,
    save_app_settings, save_app_settings_session, save_app_settings_session_with_alias_sync,
    save_app_settings_with_alias_sync, sync_alias_with_app_settings,
};
pub use types::{AppSectionSettings, AppSettings, LoadedAppSettings, LoggingSettings, UiSettings};
