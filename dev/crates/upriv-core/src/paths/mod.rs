//! Vault-root path contract (PRD §5 / SDD §3 / `prod-example/README.md`).
//!
//! - [`VaultRoot`] — paths under an opened root  
//! - [`resolve_vault_root`] — launch discovery (explicit → alias → nearby)  
//! - [`initialize_vault_root`] — create default `.upriv/` layout  
//! - [`load_app_settings`] / [`save_app_settings`] — `.upriv/settings.toml`
//!
//! Alias (`.upriv-root` in app home) is created only for “another folder”.
//! Auto-detect ignores active alias (settings are source of truth) and deactivates it on save.

mod init;
mod resolve;
mod settings;

pub use init::{
    has_vault_root_marker, initialize_vault_root, inspect_vault_root_at,
    open_or_initialize_vault_root, open_or_initialize_vault_root_with_options,
    open_or_initialize_vault_root_with_policy, rename_incomplete_upriv,
    validate_existing_vault_root, IncompleteReplacePolicy, NearbyVaultRootStatus,
};
pub use resolve::{
    app_home_dir, binary_dir, deactivate_vault_root_alias, deactivate_vault_root_alias_everywhere,
    delete_vault_root_alias, delete_vault_root_alias_everywhere, discover_vault_root_near,
    env_nearby_anchor, read_vault_root_alias, resolve_vault_root, setup_nearby_anchor,
    vault_root_alias_path, write_vault_root_alias, ResolveVaultRoot, ResolveVaultRootOptions,
    VaultRootAlias, VaultRootSource, VAULT_ROOT_ALIAS_FILE,
};
pub use settings::{
    apply_setup_ui_locale, discover_bootstrap_root, load_app_settings, load_app_settings_at,
    save_app_settings, save_app_settings_session, sync_alias_with_app_settings, AppSectionSettings,
    AppSettings, LoadedAppSettings, LoggingSettings, UiSettings,
};

use std::path::{Path, PathBuf};

use crate::error::{Result, UprivError};

#[cfg(test)]
pub(crate) static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Marker file that identifies a Upriv vault-root directory.
pub const VAULT_ROOT_SETTINGS_REL: &str = ".upriv/settings.toml";

const SETTINGS_REL: &str = VAULT_ROOT_SETTINGS_REL;
const VAULTS_DIR_REL: &str = ".upriv/vaults";
const STATE_FILE_REL: &str = ".upriv/state.json";
const LOGS_DIR_REL: &str = ".upriv/logs";
const APP_DIR_REL: &str = ".upriv/app";
const WORKSPACE_DIR_REL: &str = "workspace";
const RUNTIME_DIR_REL: &str = ".upriv/runtime";

/// True when `path` contains the Upriv vault-root marker (`.upriv/settings.toml`).
pub fn is_vault_root_marker(path: impl AsRef<Path>) -> bool {
    path.as_ref().join(SETTINGS_REL).is_file()
}

/// Canonical paths under a vault-root directory.
#[derive(Debug, Clone)]
pub struct VaultRoot {
    root: PathBuf,
}

impl VaultRoot {
    /// Open an existing vault-root (must contain a **valid** `.upriv/settings.toml`).
    ///
    /// Uses the same rules as inspect/nearby: missing `.upriv` → NotFound;
    /// `.upriv` present but broken/empty → Incomplete (not NotFound).
    pub fn discover(path: impl AsRef<Path>) -> Result<Self> {
        let root = path.as_ref().canonicalize().map_err(UprivError::from)?;
        crate::paths::validate_existing_vault_root(&root)?;
        Ok(Self { root })
    }

    /// Use a vault-root path without requiring the marker (unit tests).
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn settings_path(&self) -> PathBuf {
        self.root.join(SETTINGS_REL)
    }

    pub fn state_path(&self) -> PathBuf {
        self.root.join(STATE_FILE_REL)
    }

    pub fn logs_dir(&self) -> PathBuf {
        self.root.join(LOGS_DIR_REL)
    }

    pub fn app_dir(&self) -> PathBuf {
        self.root.join(APP_DIR_REL)
    }

    pub fn workspace_dir(&self) -> PathBuf {
        self.root.join(WORKSPACE_DIR_REL)
    }

    /// User-visible mount target: `workspace/{display_name}/`.
    pub fn workspace_vault_dir(&self, display_name: &str) -> PathBuf {
        self.workspace_dir()
            .join(sanitize_path_component(display_name))
    }

    pub fn vaults_dir(&self) -> PathBuf {
        self.root.join(VAULTS_DIR_REL)
    }

    pub fn vault_dir(&self, vault_id: &str) -> PathBuf {
        self.vaults_dir().join(sanitize_path_component(vault_id))
    }

    pub fn vault_config_path(&self, vault_id: &str) -> PathBuf {
        self.vault_dir(vault_id).join("config.toml")
    }

    pub fn vault_persistence_path(&self, vault_id: &str) -> PathBuf {
        self.vault_dir(vault_id).join("persistence.json")
    }

    /// Main archive: `vaults/<id>/archive/{display_name}.7z` (display name not normalized).
    pub fn vault_archive_path(&self, vault_id: &str, display_name: &str) -> PathBuf {
        self.vault_dir(vault_id)
            .join("archive")
            .join(format!("{}.7z", sanitize_path_component(display_name)))
    }

    pub fn vault_store_dir(&self, vault_id: &str) -> PathBuf {
        self.vault_dir(vault_id).join("store")
    }

    pub fn vault_backups_dir(&self, vault_id: &str) -> PathBuf {
        self.vault_dir(vault_id).join("backups")
    }

    pub fn runtime_lock_path(&self, vault_id: &str) -> PathBuf {
        self.root
            .join(RUNTIME_DIR_REL)
            .join(format!("{}.lock", sanitize_path_component(vault_id)))
    }
}

/// Reject `..`, empty, and path separators so joins cannot escape the vault-root.
fn sanitize_path_component(name: &str) -> &str {
    let trimmed = name.trim();
    if trimmed.is_empty()
        || trimmed == "."
        || trimmed == ".."
        || trimmed.contains('/')
        || trimmed.contains('\\')
    {
        "_"
    } else {
        trimmed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn prod_example_root() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../..")
            .join("prod-example")
    }

    #[test]
    fn discovers_prod_example_root() {
        let root = VaultRoot::discover(prod_example_root()).expect("prod-example vault root");
        assert!(root.settings_path().is_file());
        assert!(root.vault_config_path("plain-folder-demo").is_file());
        assert!(root.vault_config_path("my-encrypted-notes").is_file());
        assert!(root
            .vault_archive_path("my-encrypted-notes", "My Encrypted Notes")
            .is_file());
    }

    #[test]
    fn marker_false_without_settings() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!is_vault_root_marker(dir.path()));
        let err = VaultRoot::discover(dir.path()).unwrap_err();
        assert!(matches!(err, UprivError::VaultRootNotFound(_)));
    }

    #[test]
    fn discover_empty_upriv_dir_is_incomplete() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".upriv")).unwrap();
        let err = VaultRoot::discover(dir.path()).unwrap_err();
        assert!(matches!(err, UprivError::VaultRootIncomplete { .. }));
    }

    #[test]
    fn workspace_path_keeps_display_name() {
        let root = VaultRoot::new("/tmp/fake-root");
        assert_eq!(
            root.workspace_vault_dir("My Encrypted Notes"),
            PathBuf::from("/tmp/fake-root/workspace/My Encrypted Notes")
        );
    }
}
