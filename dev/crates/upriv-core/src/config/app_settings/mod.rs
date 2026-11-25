//! System / app settings: load / save `.upriv/settings.toml` (`[ui]`, `[logging]`, `[app]`).
//!
//! This is **not** per-vault `config.toml` (see [`crate::config::vault_config`]).
//! Which data folder a device uses is not in it either: that is the data
//! folder list in the app home ([`crate::folder_list::data_folder`]).

mod load_save;
mod toml;
mod types;

pub use load_save::{
    discover_bootstrap_root, load_app_settings, load_app_settings_at, save_app_settings_at,
    save_app_settings_session,
};
pub(crate) use load_save::{note_os_name_in_settings, update_app_settings};
pub use toml::{parse_settings_toml_str, serialize_settings_toml_str};
pub use types::{AppSectionSettings, AppSettings, LoadedAppSettings, LoggingSettings, UiSettings};
