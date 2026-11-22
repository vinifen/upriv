//! Declarative config load/save (SDD §4.2 `config/`).
//!
//! Two layers — keep them separate:
//!
//! | Module | On-disk | Role |
//! |--------|---------|------|
//! | [`app_settings`] | `.upriv/settings.toml` | **System / app** preferences (UI, logging, package layout). Marker for vault-root. |
//! | [`vault_config`] | `.upriv/vaults/<id>/config.toml` | **Per-vault** options (identity, storage, …) |
//! | [`vault_groups`] | `.upriv/vault_groups.toml` | Optional vault **groups** (list organization only) |
//!
//! Finding the data folder in use stays in [`crate::paths`]; load and save
//! call into it.

pub mod app_settings;
pub mod edit_policy;
pub mod list_saves;
pub mod vault_config;
pub mod vault_groups;

pub(crate) use app_settings::update_app_settings;
pub use app_settings::{
    discover_bootstrap_root, load_app_settings, load_app_settings_at, parse_settings_toml_str,
    save_app_settings_at, save_app_settings_session, serialize_settings_toml_str,
    AppSectionSettings, AppSettings, LoadedAppSettings, LoggingSettings, UiSettings,
};
pub use edit_policy::{
    quiet_targets_changed, refuse_config_save_if_busy, save_vault_config_checked,
    CONFIG_SAVE_QUIET_TARGETS,
};
pub use list_saves::{AppListChanges, ListsSaved, VaultListChanges};
pub use vault_config::{
    load_vault_config, save_vault_config, serialize_vault_config_toml, set_vault_hidden,
    vault_config_path, VaultBackupMode, VaultConfig, VaultIdentitySection,
    VAULT_CONFIG_TOML_GROUPS_NOTE,
};
pub use vault_groups::{
    create_vault_group_with_sort, delete_vault_group, known_vault_ids, load_vault_groups,
    remap_grouped_vault_id, remove_vault_from_groups, reorder_vault_group_grouped_vaults,
    reorder_vault_groups, repair_vault_groups, update_vault_group, vault_groups_path,
    LoadedVaultGroups, UpdateVaultGroupParams, VaultGroup, VaultGroupCreate, VaultGroupUpdate,
    VaultGroupsFile, VAULT_GROUPS_FILE_NAME,
};
